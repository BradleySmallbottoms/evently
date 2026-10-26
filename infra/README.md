# infra

AWS CDK (TypeScript). One app, deployed per environment into its own AWS account, region
`eu-north-1` (Stockholm). A single EC2 test box is not these stacks — that compose file
lives in `deploy/test`.

```bash
pnpm --filter @local-events/infra synth -c env=dev
pnpm --filter @local-events/infra deploy -c env=dev -c imageTag=$(git rev-parse HEAD) --all
```

## Stacks

| Stack          | Contents                                                                           |
| -------------- | ---------------------------------------------------------------------------------- |
| `network`      | VPC (public / private / isolated), NAT                                             |
| `data`         | RDS PostgreSQL 16 (PostGIS extension), Valkey, S3, SQS + DLQ, secrets              |
| `services`     | ECR, ECS cluster, Fargate (api / admin-api / worker), public + admin ALB           |
| `data-workers` | ECR, Fargate task definition (256 CPU / 512 MiB), EventBridge Scheduler per source |
| `edge`         | CloudFront (origin access control) in front of the public assets bucket            |

Still planned: WAF on the public distribution, and an IP allowlist in front of admin.
Local object storage is Garage (`pnpm db:up`). Dev keys in Compose are local-only. See `.env.example`.

Scheduled ingestion uses EventBridge Scheduler → `EcsRunFargateTask` on the shared ECS
cluster. Each schedule passes `SOURCE_SLUG` via ECS `ContainerOverrides` (default: `visit-soderhamn`
every 6 hours). Add slugs via `KNOWN_DATA_WORKER_SOURCE_SLUGS` / `sourceSchedules` in
`DataWorkersStack`. Source API keys (e.g. `VISIT_SODERHAMN_API_KEY`, `TICKSTER_API_KEY`) must live in Secrets Manager
(`local-events/<env>/app`) and be mapped in the task definition when you wire them.

Non-prod API tasks set `CORS_ORIGINS=*` (reflect Origin; required with credentialed cookies) and
`INCLUDE_VERIFICATION_TOKEN=true` until SES sends verification links. Tighten both before prod.

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
