import { Aws, CfnOutput, Stack, type StackProps } from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';

export interface EdgeStackProps extends StackProps {
  envName: string;
  /** Public event images. The bucket stays private; CloudFront reads it through OAC. */
  publicAssetsBucket: s3.IBucket;
}

/**
 * CloudFront in front of the public assets bucket.
 * WAF (and the admin IP allowlist) stay a later change: a CloudFront WAF must live in us-east-1.
 *
 * The bucket policy allows every CloudFront distribution in this account, instead of this
 * distribution's id. A specific id would make the data stack depend on this stack while this
 * stack already depends on the bucket.
 */
export class EdgeStack extends Stack {
  readonly assetsDistribution: cloudfront.Distribution;
  readonly assetsPublicBaseUrl: string;

  constructor(scope: Construct, id: string, props: EdgeStackProps) {
    super(scope, id, props);

    const originAccessControl = new cloudfront.S3OriginAccessControl(this, 'AssetsOac', {
      originAccessControlName: `local-events-${props.envName}-assets`,
      description: 'Read public event images',
    });

    props.publicAssetsBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowCloudFrontRead',
        principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
        actions: ['s3:GetObject'],
        resources: [props.publicAssetsBucket.arnForObjects('*')],
        conditions: {
          StringEquals: {
            'AWS:SourceArn': `arn:${Aws.PARTITION}:cloudfront::${Aws.ACCOUNT_ID}:distribution/*`,
          },
        },
      }),
    );

    this.assetsDistribution = new cloudfront.Distribution(this, 'Assets', {
      comment: `local-events-${props.envName} public event images`,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withBucketDefaults(props.publicAssetsBucket, {
          originAccessControlId: originAccessControl.originAccessControlId,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
    });

    this.assetsPublicBaseUrl = `https://${this.assetsDistribution.distributionDomainName}`;
    new CfnOutput(this, 'AssetsDistributionId', {
      value: this.assetsDistribution.distributionId,
    });
    new CfnOutput(this, 'AssetsPublicBaseUrl', { value: this.assetsPublicBaseUrl });
  }
}
