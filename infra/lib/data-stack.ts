import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import type { Construct } from 'constructs';

export interface DataStackProps extends StackProps {
  envName: string;
  vpc: ec2.Vpc;
  /** ECS tasks that may reach Postgres and Valkey. */
  appSecurityGroup: ec2.SecurityGroup;
}

/**
 * Shared data plane: RDS PostgreSQL (+ PostGIS extension), ElastiCache Valkey, S3, SQS.
 * Dev uses small single-AZ resources with destroyable retention.
 */
export class DataStack extends Stack {
  readonly db: rds.DatabaseInstance;
  readonly dbSecret: secretsmanager.ISecret;
  readonly dbSecurityGroup: ec2.SecurityGroup;
  readonly valkeySecurityGroup: ec2.SecurityGroup;
  readonly valkeyEndpoint: string;
  readonly valkeyPort: string;
  readonly publicAssetsBucket: s3.Bucket;
  readonly privateFilesBucket: s3.Bucket;
  readonly rawIngestionBucket: s3.Bucket;
  readonly domainEventsQueue: sqs.Queue;
  readonly domainEventsDlq: sqs.Queue;
  readonly appSecrets: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    const isProd = props.envName === 'prod';
    const removal = isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;
    const isolatedSubnets = props.vpc.selectSubnets({
      subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
    });
    const privateSubnets = props.vpc.selectSubnets({
      subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
    });

    this.dbSecurityGroup = new ec2.SecurityGroup(this, 'DbSg', {
      vpc: props.vpc,
      description: 'RDS PostgreSQL',
      allowAllOutbound: false,
    });
    this.dbSecurityGroup.addIngressRule(
      props.appSecurityGroup,
      ec2.Port.tcp(5432),
      'ECS tasks to Postgres',
    );

    this.db = new rds.DatabaseInstance(this, 'Postgres', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T4G,
        isProd ? ec2.InstanceSize.SMALL : ec2.InstanceSize.MICRO,
      ),
      vpc: props.vpc,
      vpcSubnets: isolatedSubnets,
      securityGroups: [this.dbSecurityGroup],
      credentials: rds.Credentials.fromGeneratedSecret('events', {
        secretName: `local-events/${props.envName}/db`,
      }),
      databaseName: 'events',
      multiAz: isProd,
      allocatedStorage: isProd ? 100 : 20,
      maxAllocatedStorage: isProd ? 500 : 50,
      storageEncrypted: true,
      deletionProtection: isProd,
      removalPolicy: removal,
      backupRetention: isProd ? Duration.days(14) : Duration.days(3),
      cloudwatchLogsExports: ['postgresql'],
    });
    this.dbSecret = this.db.secret!;

    this.valkeySecurityGroup = new ec2.SecurityGroup(this, 'ValkeySg', {
      vpc: props.vpc,
      description: 'ElastiCache Valkey',
      allowAllOutbound: false,
    });
    this.valkeySecurityGroup.addIngressRule(
      props.appSecurityGroup,
      ec2.Port.tcp(6379),
      'ECS tasks to Valkey',
    );

    const valkeySubnetGroup = new elasticache.CfnSubnetGroup(this, 'ValkeySubnets', {
      description: `local-events ${props.envName} valkey`,
      subnetIds: privateSubnets.subnetIds,
      cacheSubnetGroupName: `local-events-${props.envName}-valkey`,
    });

    // CreateCacheCluster rejects engine valkey. A one-node replication group is the
    // supported API, with failover off so there is no replica.
    const valkey = new elasticache.CfnReplicationGroup(this, 'Valkey', {
      replicationGroupDescription: `local-events ${props.envName} valkey`,
      engine: 'valkey',
      engineVersion: '8.0',
      cacheNodeType: 'cache.t4g.micro',
      numCacheClusters: 1,
      automaticFailoverEnabled: false,
      securityGroupIds: [this.valkeySecurityGroup.securityGroupId],
      cacheSubnetGroupName: valkeySubnetGroup.ref,
      replicationGroupId: `le-${props.envName}-valkey`,
    });
    valkey.addResourceDependency(valkeySubnetGroup);
    this.valkeyEndpoint = valkey.attrPrimaryEndPointAddress;
    this.valkeyPort = valkey.attrPrimaryEndPointPort;

    const bucketDefaults = {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: removal,
      autoDeleteObjects: !isProd,
    };

    this.publicAssetsBucket = new s3.Bucket(this, 'PublicAssets', {
      ...bucketDefaults,
      bucketName: undefined, // CloudFormation names it; EdgeStack puts CloudFront in front
    });

    this.privateFilesBucket = new s3.Bucket(this, 'PrivateFiles', {
      ...bucketDefaults,
    });

    this.rawIngestionBucket = new s3.Bucket(this, 'RawIngestion', {
      ...bucketDefaults,
      lifecycleRules: [{ expiration: Duration.days(30), id: 'expire-raw-payloads' }],
    });

    this.domainEventsDlq = new sqs.Queue(this, 'DomainEventsDlq', {
      retentionPeriod: Duration.days(14),
      removalPolicy: removal,
    });

    this.domainEventsQueue = new sqs.Queue(this, 'DomainEvents', {
      visibilityTimeout: Duration.seconds(60),
      retentionPeriod: Duration.days(4),
      deadLetterQueue: { queue: this.domainEventsDlq, maxReceiveCount: 5 },
      removalPolicy: removal,
    });

    this.appSecrets = new secretsmanager.Secret(this, 'AppSecrets', {
      secretName: `local-events/${props.envName}/app`,
      description: 'Session secret and other app credentials',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({}),
        generateStringKey: 'SESSION_SECRET',
        excludePunctuation: true,
        passwordLength: 48,
      },
      removalPolicy: removal,
    });

    new CfnOutput(this, 'DbSecretArn', { value: this.dbSecret.secretArn });
    new CfnOutput(this, 'AppSecretsArn', { value: this.appSecrets.secretArn });
    new CfnOutput(this, 'DomainEventsQueueUrl', { value: this.domainEventsQueue.queueUrl });
    new CfnOutput(this, 'PublicAssetsBucketName', { value: this.publicAssetsBucket.bucketName });
    new CfnOutput(this, 'PrivateFilesBucketName', { value: this.privateFilesBucket.bucketName });
    new CfnOutput(this, 'RawIngestionBucketName', { value: this.rawIngestionBucket.bucketName });
    new CfnOutput(this, 'ValkeyEndpoint', { value: this.valkeyEndpoint });
  }
}
