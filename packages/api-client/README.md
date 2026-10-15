# @local-events/api-client

Typed client for the public API, generated from the OpenAPI document at `{API_PREFIX}/openapi.json`
(e.g. `/v1/openapi.json`). Paths in the document are unversioned; set `baseUrl` to include the
version prefix.

```bash
# From the repo root — exports the OpenAPI doc from createApp(), then regenerates types:
pnpm api-client:generate
```

```ts
import { createApiClient, throwIfError } from '@local-events/api-client';

const client = createApiClient({
  baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:13000/v1',
  credentials: 'include', // publisher cookie sessions on web
});

const { data, error, response } = await client.POST('/identities', {
  body: { platform: 'ios', locale: 'sv' },
});
const identity = throwIfError({ data, error, response });
```

Commit `openapi.json` and `src/schema.d.ts` whenever API routes change.
