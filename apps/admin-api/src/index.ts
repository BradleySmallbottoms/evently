import { serve } from '@hono/node-server';
import { createApp } from './app';
import { initSentry } from './sentry';

initSentry('admin-api');

const port = Number(process.env.ADMIN_API_PORT ?? 3001);
serve({ fetch: createApp().fetch, port }, (info) => {
  console.log(`admin-api listening on http://localhost:${info.port}`);
});
