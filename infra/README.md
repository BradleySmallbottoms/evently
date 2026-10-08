# infra

AWS CDK (TypeScript). One app, deployed per environment into its own AWS account, region
`eu-north-1` (Stockholm).

```bash
pnpm --filter @local-events/infra synth -c env=dev
pnpm --filter @local-events/infra deploy -c env=dev --all
```

Only the network stack exists so far. The planned stacks are listed in `bin/app.ts`; the target
architecture is in `docs/project-description.md` → AWS infrastructure.

`local/init.sql` enables PostGIS, pg_trgm and pgcrypto for the local Docker database.
