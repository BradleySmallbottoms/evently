import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';
import type { DataStack } from './data-stack';

export interface ServicesStackProps extends StackProps {
  envName: string;
  vpc: ec2.Vpc;
  appSecurityGroup: ec2.SecurityGroup;
  data: DataStack;
  /** Container image tag pushed by CI (defaults to latest). */
  imageTag?: string;
}

/**
 * ECS Fargate services for the public API, admin API and SQS worker, plus ALBs and ECR repos.
 * CloudFront / WAF land in a later EdgeStack.
 */
export class ServicesStack extends Stack {
  readonly cluster: ecs.Cluster;
  readonly apiRepository: ecr.Repository;
  readonly adminApiRepository: ecr.Repository;
  readonly workerRepository: ecr.Repository;
  readonly apiLoadBalancer: elbv2.ApplicationLoadBalancer;
  readonly adminApiLoadBalancer: elbv2.ApplicationLoadBalancer;

  constructor(scope: Construct, id: string, props: ServicesStackProps) {
    super(scope, id, props);

    const isProd = props.envName === 'prod';
    const removal = isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;
    const imageTag = props.imageTag ?? 'latest';
    const privateSubnets = {
      subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
    };
    // Import as immutable so ALB target registration cannot add ingress rules that
    // reference this stack's ALB SGs back onto NetworkStack (cross-stack cycle).
    // Ports 3000/3001 are already opened from the VPC CIDR on AppSg itself.
    const tasksSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
      this,
      'TasksSg',
      props.appSecurityGroup.securityGroupId,
      { mutable: false },
    );

    this.cluster = new ecs.Cluster(this, 'Cluster', {
      vpc: props.vpc,
      containerInsightsV2: isProd
        ? ecs.ContainerInsights.ENABLED
        : ecs.ContainerInsights.DISABLED,
      clusterName: `local-events-${props.envName}`,
    });

    this.apiRepository = new ecr.Repository(this, 'ApiRepo', {
      repositoryName: `local-events/${props.envName}/api`,
      removalPolicy: removal,
      emptyOnDelete: !isProd,
      lifecycleRules: [{ maxImageCount: isProd ? 20 : 10 }],
    });
    this.adminApiRepository = new ecr.Repository(this, 'AdminApiRepo', {
      repositoryName: `local-events/${props.envName}/admin-api`,
      removalPolicy: removal,
      emptyOnDelete: !isProd,
      lifecycleRules: [{ maxImageCount: isProd ? 20 : 10 }],
    });
    this.workerRepository = new ecr.Repository(this, 'WorkerRepo', {
      repositoryName: `local-events/${props.envName}/worker`,
      removalPolicy: removal,
      emptyOnDelete: !isProd,
      lifecycleRules: [{ maxImageCount: isProd ? 20 : 10 }],
    });

    const taskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });
    props.data.domainEventsQueue.grantSendMessages(taskRole);
    props.data.domainEventsQueue.grantConsumeMessages(taskRole);
    props.data.publicAssetsBucket.grantReadWrite(taskRole);
    props.data.privateFilesBucket.grantReadWrite(taskRole);
    props.data.rawIngestionBucket.grantReadWrite(taskRole);
    props.data.dbSecret.grantRead(taskRole);
    props.data.appSecrets.grantRead(taskRole);

    const executionRole = new iam.Role(this, 'ExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AmazonECSTaskExecutionRolePolicy',
        ),
      ],
    });
    props.data.dbSecret.grantRead(executionRole);
    props.data.appSecrets.grantRead(executionRole);

    const logRetention = isProd ? logs.RetentionDays.ONE_MONTH : logs.RetentionDays.ONE_WEEK;
    const dbSecret = props.data.dbSecret;
    const appSecrets = props.data.appSecrets;

    const commonSecrets: Record<string, ecs.Secret> = {
      SESSION_SECRET: ecs.Secret.fromSecretsManager(appSecrets, 'SESSION_SECRET'),
      DB_HOST: ecs.Secret.fromSecretsManager(dbSecret, 'host'),
      DB_PORT: ecs.Secret.fromSecretsManager(dbSecret, 'port'),
      DB_USER: ecs.Secret.fromSecretsManager(dbSecret, 'username'),
      DB_PASSWORD: ecs.Secret.fromSecretsManager(dbSecret, 'password'),
      DB_NAME: ecs.Secret.fromSecretsManager(dbSecret, 'dbname'),
    };

    const commonEnvironment: Record<string, string> = {
      NODE_ENV: 'production',
      AWS_REGION: Stack.of(this).region,
      VALKEY_URL: `redis://${props.data.valkeyEndpoint}:${props.data.valkeyPort}`,
      DOMAIN_EVENTS_QUEUE_URL: props.data.domainEventsQueue.queueUrl,
      PUBLIC_ASSETS_BUCKET: props.data.publicAssetsBucket.bucketName,
      PRIVATE_FILES_BUCKET: props.data.privateFilesBucket.bucketName,
      RAW_INGESTION_BUCKET: props.data.rawIngestionBucket.bucketName,
      SENTRY_ENVIRONMENT: props.envName,
      // Reflect request Origin until EdgeStack pins known web hosts (credentials CORS).
      ...(props.envName !== 'prod' ? { CORS_ORIGINS: '*', INCLUDE_VERIFICATION_TOKEN: 'true' } : {}),
    };

    const cpu = isProd ? 512 : 256;
    const memoryMiB = isProd ? 1024 : 512;

    // --- Public API ---
    const apiAlbSg = new ec2.SecurityGroup(this, 'ApiAlbSg', {
      vpc: props.vpc,
      description: 'Public API ALB',
      allowAllOutbound: true,
    });
    apiAlbSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'HTTP');

    this.apiLoadBalancer = new elbv2.ApplicationLoadBalancer(this, 'ApiAlb', {
      vpc: props.vpc,
      internetFacing: true,
      securityGroup: apiAlbSg,
    });

    const apiTask = new ecs.FargateTaskDefinition(this, 'ApiTask', {
      cpu,
      memoryLimitMiB: memoryMiB,
      taskRole,
      executionRole,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });
    apiTask.addContainer('api', {
      image: ecs.ContainerImage.fromEcrRepository(this.apiRepository, imageTag),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'api', logRetention }),
      environment: { ...commonEnvironment, API_PORT: '3000' },
      secrets: commonSecrets,
      portMappings: [{ containerPort: 3000 }],
      healthCheck: {
        command: [
          'CMD-SHELL',
          'node -e "fetch(\'http://127.0.0.1:3000/health\').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"',
        ],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        retries: 3,
        startPeriod: Duration.seconds(40),
      },
    });

    const apiService = new ecs.FargateService(this, 'ApiService', {
      cluster: this.cluster,
      serviceName: `local-events-${props.envName}-api`,
      taskDefinition: apiTask,
      desiredCount: 1,
      securityGroups: [tasksSecurityGroup],
      vpcSubnets: privateSubnets,
      assignPublicIp: false,
      circuitBreaker: { rollback: true },
    });

    const apiListener = this.apiLoadBalancer.addListener('Http', { port: 80, open: true });
    apiListener.addTargets('Api', {
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [apiService],
      healthCheck: {
        path: '/health',
        healthyHttpCodes: '200',
        interval: Duration.seconds(30),
      },
      deregistrationDelay: Duration.seconds(30),
    });

    // --- Admin API ---
    const adminAlbSg = new ec2.SecurityGroup(this, 'AdminAlbSg', {
      vpc: props.vpc,
      description: 'Admin API ALB (WAF IP allowlist added in EdgeStack)',
      allowAllOutbound: true,
    });
    adminAlbSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'HTTP');

    this.adminApiLoadBalancer = new elbv2.ApplicationLoadBalancer(this, 'AdminApiAlb', {
      vpc: props.vpc,
      internetFacing: true,
      securityGroup: adminAlbSg,
    });

    const adminTask = new ecs.FargateTaskDefinition(this, 'AdminApiTask', {
      cpu,
      memoryLimitMiB: memoryMiB,
      taskRole,
      executionRole,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });
    adminTask.addContainer('admin-api', {
      image: ecs.ContainerImage.fromEcrRepository(this.adminApiRepository, imageTag),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'admin-api', logRetention }),
      environment: { ...commonEnvironment, ADMIN_API_PORT: '3001' },
      secrets: commonSecrets,
      portMappings: [{ containerPort: 3001 }],
      healthCheck: {
        command: [
          'CMD-SHELL',
          'node -e "fetch(\'http://127.0.0.1:3001/health\').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"',
        ],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        retries: 3,
        startPeriod: Duration.seconds(40),
      },
    });

    const adminService = new ecs.FargateService(this, 'AdminApiService', {
      cluster: this.cluster,
      serviceName: `local-events-${props.envName}-admin-api`,
      taskDefinition: adminTask,
      desiredCount: 1,
      securityGroups: [tasksSecurityGroup],
      vpcSubnets: privateSubnets,
      assignPublicIp: false,
      circuitBreaker: { rollback: true },
    });

    const adminListener = this.adminApiLoadBalancer.addListener('Http', { port: 80, open: true });
    adminListener.addTargets('AdminApi', {
      port: 3001,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [adminService],
      healthCheck: {
        path: '/health',
        healthyHttpCodes: '200',
        interval: Duration.seconds(30),
      },
      deregistrationDelay: Duration.seconds(30),
    });

    // --- Worker ---
    const workerTask = new ecs.FargateTaskDefinition(this, 'WorkerTask', {
      cpu,
      memoryLimitMiB: memoryMiB,
      taskRole,
      executionRole,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });
    workerTask.addContainer('worker', {
      image: ecs.ContainerImage.fromEcrRepository(this.workerRepository, imageTag),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'worker', logRetention }),
      environment: commonEnvironment,
      secrets: commonSecrets,
    });

    new ecs.FargateService(this, 'WorkerService', {
      cluster: this.cluster,
      serviceName: `local-events-${props.envName}-worker`,
      taskDefinition: workerTask,
      desiredCount: 1,
      securityGroups: [tasksSecurityGroup],
      vpcSubnets: privateSubnets,
      assignPublicIp: false,
      circuitBreaker: { rollback: true },
    });

    new CfnOutput(this, 'ApiUrl', {
      value: `http://${this.apiLoadBalancer.loadBalancerDnsName}`,
    });
    new CfnOutput(this, 'AdminApiUrl', {
      value: `http://${this.adminApiLoadBalancer.loadBalancerDnsName}`,
    });
    new CfnOutput(this, 'ApiRepositoryUri', { value: this.apiRepository.repositoryUri });
    new CfnOutput(this, 'AdminApiRepositoryUri', {
      value: this.adminApiRepository.repositoryUri,
    });
    new CfnOutput(this, 'WorkerRepositoryUri', { value: this.workerRepository.repositoryUri });
    new CfnOutput(this, 'ClusterName', { value: this.cluster.clusterName });
  }
}
