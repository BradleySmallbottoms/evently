import { serve } from '@hono/node-server';
import { createApp } from './app';

const port = Number(process.env.API_PORT ?? 3000);
serve({ fetch: createApp().fetch, port }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`);
});
