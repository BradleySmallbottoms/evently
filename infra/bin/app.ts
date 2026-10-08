import { App } from 'aws-cdk-lib';
import { NetworkStack } from '../lib/network-stack';

/**
 * One CDK app, deployed per environment (dev / staging / prod), each in its own AWS account.
 *   pnpm --filter @local-events/infra synth -c env=dev
 * Region: eu-north-1 (Stockholm).
 */
const app = new App();
const envName = (app.node.tryGetContext('env') as string | undefined) ?? 'dev';
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'eu-north-1' };
const prefix = `local-events-${envName}`;

new NetworkStack(app, `${prefix}-network`, { env, envName });

// Next stacks, added phase by phase (see docs/build-plan.md):
// DataStack        RDS PostgreSQL + PostGIS, ElastiCache Valkey, S3 buckets, SQS queues + DLQs
// ServicesStack    ECS cluster, Fargate services for api / admin-api / worker, ALBs
// DataWorkersStack Fargate task definitions + EventBridge Scheduler schedules per source
// EdgeStack        CloudFront + WAF (public), WAF IP allowlist (admin)
