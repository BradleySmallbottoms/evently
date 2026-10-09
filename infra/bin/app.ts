import { App } from 'aws-cdk-lib';
import { DataStack } from '../lib/data-stack';
import { NetworkStack } from '../lib/network-stack';
import { ServicesStack } from '../lib/services-stack';

/**
 * One CDK app, deployed per environment (dev / staging / prod), each in its own AWS account.
 *   pnpm --filter @local-events/infra synth -c env=dev
 *   pnpm --filter @local-events/infra deploy -c env=dev -c imageTag=$SHA --all
 * Region: eu-north-1 (Stockholm).
 */
const app = new App();
const envName = (app.node.tryGetContext('env') as string | undefined) ?? 'dev';
const imageTag = (app.node.tryGetContext('imageTag') as string | undefined) ?? 'latest';
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'eu-north-1' };
const prefix = `local-events-${envName}`;

const network = new NetworkStack(app, `${prefix}-network`, { env, envName });
const data = new DataStack(app, `${prefix}-data`, {
  env,
  envName,
  vpc: network.vpc,
  appSecurityGroup: network.appSecurityGroup,
});
new ServicesStack(app, `${prefix}-services`, {
  env,
  envName,
  vpc: network.vpc,
  appSecurityGroup: network.appSecurityGroup,
  data,
  imageTag,
});

// Next stacks (see docs/build-plan.md):
// DataWorkersStack Fargate task definitions + EventBridge Scheduler schedules per source
// EdgeStack        CloudFront + WAF (public), WAF IP allowlist (admin)
