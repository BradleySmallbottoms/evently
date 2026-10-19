import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Schedule, ScheduleExpression, ScheduleTargetInput } from 'aws-cdk-lib/aws-scheduler';
import { EcsRunFargateTask } from 'aws-cdk-lib/aws-scheduler-targets';
import type { Construct } from 'constructs';
import type { DataStack } from './data-stack';

/** Slugs with a `data_sources` row and an adapter in data-workers. */
export const KNOWN_DATA_WORKER_SOURCE_SLUGS = [
  'visit-soderhamn',
  'glada-hudik',
  'destination-halsingland',
  'ics-feed',
] as const;

export type KnownDataWorkerSourceSlug = (typeof KNOWN_DATA_WORKER_SOURCE_SLUGS)[number];

export interface DataWorkerSourceSchedule {
  slug: string;
  /** EventBridge Scheduler expression (defaults to every 6 hours). */
  schedule?: ScheduleExpression;
}

export interface DataWorkersStackProps extends StackProps {
  envName: string;
  vpc: ec2.Vpc;
  appSecurityGroup: ec2.SecurityGroup;
  data: DataStack;
  cluster: ecs.ICluster;
  taskRole: iam.IRole;
  /** Container image tag pushed by CI (defaults to latest). */
  imageTag?: string;
  /**
   * Per-source schedules. Defaults to {@link KNOWN_DATA_WORKER_SOURCE_SLUGS} at a 6-hour rate.
   */
  sourceSchedules?: DataWorkerSourceSchedule[];
}

const DATA_WORKERS_CONTAINER_NAME = 'data-workers';

export function defaultDataWorkerScheduleExpression(_slug: string): ScheduleExpression {
  return ScheduleExpression.rate(Duration.hours(6));
}

/**
 * EventBridge Scheduler → ECS RunTask for ingestion adapters (`apps/data-workers`).
 * Reuses the services stack cluster and task role (SQS, S3). The execution role lives here so
 * its ECR pull policy does not point back at the services stack.
 */
export class DataWorkersStack extends Stack {
  readonly repository: ecr.Repository;
  readonly taskDefinition: ecs.FargateTaskDefinition;

  constructor(scope: Construct, id: string, props: DataWorkersStackProps) {
    super(scope, id, props);

    const isProd = props.envName === 'prod';
    const removal = isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;
    const imageTag = props.imageTag ?? 'latest';
    const privateSubnets = {
      subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
    };
    const tasksSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
      this,
      'TasksSg',
      props.appSecurityGroup.securityGroupId,
      { mutable: false },
    );

    this.repository = new ecr.Repository(this, 'DataWorkersRepo', {
      repositoryName: `local-events/${props.envName}/data-workers`,
      removalPolicy: removal,
      emptyOnDelete: !isProd,
      lifecycleRules: [{ maxImageCount: isProd ? 20 : 10 }],
    });

    const logRetention = isProd ? logs.RetentionDays.ONE_MONTH : logs.RetentionDays.ONE_WEEK;
    const dbSecret = props.data.dbSecret;

    const secrets: Record<string, ecs.Secret> = {
      DB_HOST: ecs.Secret.fromSecretsManager(dbSecret, 'host'),
      DB_PORT: ecs.Secret.fromSecretsManager(dbSecret, 'port'),
      DB_USER: ecs.Secret.fromSecretsManager(dbSecret, 'username'),
      DB_PASSWORD: ecs.Secret.fromSecretsManager(dbSecret, 'password'),
      DB_NAME: ecs.Secret.fromSecretsManager(dbSecret, 'dbname'),
    };

    const environment: Record<string, string> = {
      NODE_ENV: 'production',
      AWS_REGION: Stack.of(this).region,
      DOMAIN_EVENTS_QUEUE_URL: props.data.domainEventsQueue.queueUrl,
      PUBLIC_ASSETS_BUCKET: props.data.publicAssetsBucket.bucketName,
      PRIVATE_FILES_BUCKET: props.data.privateFilesBucket.bucketName,
      RAW_INGESTION_BUCKET: props.data.rawIngestionBucket.bucketName,
      SENTRY_ENVIRONMENT: props.envName,
    };

    const executionRole = new iam.Role(this, 'ExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });
    props.data.dbSecret.grantRead(executionRole);

    this.taskDefinition = new ecs.FargateTaskDefinition(this, 'DataWorkersTask', {
      cpu: 256,
      memoryLimitMiB: 512,
      taskRole: props.taskRole,
      executionRole,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });

    this.taskDefinition.addContainer(DATA_WORKERS_CONTAINER_NAME, {
      image: ecs.ContainerImage.fromEcrRepository(this.repository, imageTag),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'data-workers', logRetention }),
      environment,
      secrets,
    });

    const sourceSchedules: DataWorkerSourceSchedule[] =
      props.sourceSchedules ?? KNOWN_DATA_WORKER_SOURCE_SLUGS.map((slug) => ({ slug }));

    new Schedule(this, 'PublisherScan', {
      scheduleName: `local-events-${props.envName}-publisher-scan`.slice(0, 64),
      description: 'Look up pending_scan publishers',
      schedule: ScheduleExpression.rate(Duration.minutes(5)),
      target: new EcsRunFargateTask(props.cluster, {
        taskDefinition: this.taskDefinition,
        vpcSubnets: privateSubnets,
        securityGroups: [tasksSecurityGroup],
        assignPublicIp: false,
        input: ScheduleTargetInput.fromObject({
          ContainerOverrides: [
            {
              Name: DATA_WORKERS_CONTAINER_NAME,
              Environment: [{ Name: 'JOB', Value: 'publisher-scan' }],
            },
          ],
        }),
      }),
    });

    new Schedule(this, 'ImportScan', {
      scheduleName: `local-events-${props.envName}-import-scan`.slice(0, 64),
      description: 'Scan pending_scan imports with the prompt runner',
      schedule: ScheduleExpression.rate(Duration.minutes(5)),
      target: new EcsRunFargateTask(props.cluster, {
        taskDefinition: this.taskDefinition,
        vpcSubnets: privateSubnets,
        securityGroups: [tasksSecurityGroup],
        assignPublicIp: false,
        input: ScheduleTargetInput.fromObject({
          ContainerOverrides: [
            {
              Name: DATA_WORKERS_CONTAINER_NAME,
              Environment: [{ Name: 'JOB', Value: 'event-scan' }],
            },
          ],
        }),
      }),
    });

    for (const { slug, schedule } of sourceSchedules) {
      const safeId = slug.replace(/[^a-zA-Z0-9]/g, '');
      const expression = schedule ?? defaultDataWorkerScheduleExpression(slug);

      new Schedule(this, `Ingest${safeId}`, {
        scheduleName: `local-events-${props.envName}-ingest-${slug}`.slice(0, 64),
        description: `Run data-workers adapter for source ${slug}`,
        schedule: expression,
        target: new EcsRunFargateTask(props.cluster, {
          taskDefinition: this.taskDefinition,
          vpcSubnets: privateSubnets,
          securityGroups: [tasksSecurityGroup],
          assignPublicIp: false,
          input: ScheduleTargetInput.fromObject({
            ContainerOverrides: [
              {
                Name: DATA_WORKERS_CONTAINER_NAME,
                Environment: [{ Name: 'SOURCE_SLUG', Value: slug }],
              },
            ],
          }),
        }),
      });
    }

    new CfnOutput(this, 'DataWorkersRepositoryUri', {
      value: this.repository.repositoryUri,
    });
    new CfnOutput(this, 'DataWorkersTaskDefinitionArn', {
      value: this.taskDefinition.taskDefinitionArn,
    });
  }
}
