# @local-events/api-client

Typed client for the public API, generated from `/v1/openapi.json`.

```bash
# From the repo root — exports the OpenAPI doc from createApp(), then regenerates types:
pnpm api-client:generate
```

```ts
import { createApiClient, throwIfError } from '@local-events/api-client';

const client = createApiClient({
  baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000',
  credentials: 'include', // publisher cookie sessions on web
});

const { data, error, response } = await client.POST('/v1/identities', {
  body: { platform: 'ios', locale: 'sv' },
});
const identity = throwIfError({ data, error, response });
```

Commit `openapi.json` and `src/schema.d.ts` whenever API routes change.
