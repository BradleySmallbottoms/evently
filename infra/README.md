# infra

AWS CDK (TypeScript). One app, deployed per environment into its own AWS account, region
`eu-north-1` (Stockholm).

```bash
pnpm --filter @local-events/infra synth -c env=dev
pnpm --filter @local-events/infra deploy -c env=dev -c imageTag=$(git rev-parse HEAD) --all
```

## Stacks

| Stack        | Contents                                                                 |
| ------------ | ------------------------------------------------------------------------ |
| `network`    | VPC (public / private / isolated), NAT                                   |
| `data`       | RDS PostgreSQL 16 (PostGIS extension), Valkey, S3, SQS + DLQ, secrets    |
| `services`   | ECR, ECS cluster, Fargate (api / admin-api / worker), public + admin ALB |

Still planned: `DataWorkersStack` (EventBridge schedules), `EdgeStack` (CloudFront + WAF).

## First-time AWS setup

1. Bootstrap the account: `pnpm --filter @local-events/infra exec cdk bootstrap aws://ACCOUNT/eu-north-1`
2. Create a GitHub Actions OIDC role that can deploy CDK + push to ECR; store its ARN as the
   repository secret `AWS_DEPLOY_ROLE_ARN_DEV` and attach the `dev` GitHub Environment.
3. Push to `main` (or run **Deploy dev** manually). CI builds images, deploys stacks, and uploads
   CDK outputs (ALB URLs, bucket names, secret ARNs).
4. Enable PostGIS on the new RDS instance once (one-off):
   `CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS pgcrypto;`
5. Run migrations against RDS (from a machine that can reach it, or a one-off ECS task):
   `DATABASE_URL=... pnpm db:migrate`

`local/init.sql` enables those extensions for the local Docker database.
