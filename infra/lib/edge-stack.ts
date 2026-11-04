import { fileURLToPath } from 'node:url';
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';

export interface EdgeStackProps extends StackProps {
  envName: string;
  /** Public event images. The bucket stays private. CloudFront reads it through the optimizer. */
  publicAssetsBucket: s3.IBucket;
}

const optimizerEntry = fileURLToPath(new URL('../image-optimizer/index.ts', import.meta.url));

/**
 * CloudFront in front of a Lambda that resizes public images.
 * WAF (and the admin IP allowlist) stay a later change: a CloudFront WAF must live in us-east-1.
 * The function URL requires IAM, and only this distribution may call it.
 */
export class EdgeStack extends Stack {
  readonly assetsDistribution: cloudfront.Distribution;
  readonly assetsPublicBaseUrl: string;

  constructor(scope: Construct, id: string, props: EdgeStackProps) {
    super(scope, id, props);

    const optimizerLogs = new logs.LogGroup(this, 'ImageOptimizerLogs', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const optimizer = new nodejs.NodejsFunction(this, 'ImageOptimizer', {
      description: 'Resize public event images to WebP',
      entry: optimizerEntry,
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 1536,
      timeout: Duration.seconds(20),
      logGroup: optimizerLogs,
      environment: { BUCKET_NAME: props.publicAssetsBucket.bucketName },
      bundling: {
        externalModules: ['@aws-sdk/*'],
        nodeModules: ['sharp'],
        commandHooks: {
          beforeBundling: () => [],
          beforeInstall: () => [],
          afterBundling: (_inputDir, outputDir) => [
            `npm install --prefix ${outputDir} --cpu=arm64 --os=linux --libc=glibc sharp`,
          ],
        },
      },
    });
    props.publicAssetsBucket.grantRead(optimizer);

    const functionUrl = optimizer.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
    });

    const cachePolicy = new cloudfront.CachePolicy(this, 'ImageCache', {
      cachePolicyName: `local-events-${props.envName}-image-cache`,
      comment: 'Cache one resized image per width and quality',
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.allowList('w', 'q'),
      headerBehavior: cloudfront.CacheHeaderBehavior.none(),
      cookieBehavior: cloudfront.CacheCookieBehavior.none(),
      defaultTtl: Duration.days(1),
      maxTtl: Duration.days(365),
      minTtl: Duration.seconds(0),
      enableAcceptEncodingGzip: false,
      enableAcceptEncodingBrotli: false,
    });
    const originRequestPolicy = new cloudfront.OriginRequestPolicy(this, 'ImageOriginRequest', {
      originRequestPolicyName: `local-events-${props.envName}-image-origin`,
      queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.allowList('w', 'q'),
      headerBehavior: cloudfront.OriginRequestHeaderBehavior.none(),
      cookieBehavior: cloudfront.OriginRequestCookieBehavior.none(),
    });

    this.assetsDistribution = new cloudfront.Distribution(this, 'Assets', {
      comment: `local-events-${props.envName} public event images`,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: origins.FunctionUrlOrigin.withOriginAccessControl(functionUrl),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
        cachePolicy,
        originRequestPolicy,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS,
      },
    });

    this.assetsPublicBaseUrl = `https://${this.assetsDistribution.distributionDomainName}`;
    new CfnOutput(this, 'AssetsDistributionId', {
      value: this.assetsDistribution.distributionId,
    });
    new CfnOutput(this, 'AssetsPublicBaseUrl', { value: this.assetsPublicBaseUrl });
  }
}
