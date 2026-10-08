import { runSource } from './run';

/**
 * Container entrypoint. EventBridge Scheduler starts one Fargate task per source with
 * SOURCE_SLUG set (or pass --source <slug> locally).
 *   pnpm --filter @local-events/data-workers dev -- --source example-fixture
 */
function sourceFromArgs(): string | undefined {
  const i = process.argv.indexOf('--source');
  return i >= 0 ? process.argv[i + 1] : process.env.SOURCE_SLUG;
}

const slug = sourceFromArgs();
if (!slug) {
  console.error('Missing source: pass --source <slug> or set SOURCE_SLUG');
  process.exit(2);
}

runSource(slug)
  .then((summary) => {
    console.log(JSON.stringify(summary, null, 2));
    if (summary.invalid.length > 0) process.exitCode = 1;
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
