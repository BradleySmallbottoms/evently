# Import scan

A data-worker insert saves a new event as `pending_scan` with no publisher. Organizer keys and
the organizer name are stored on `meta.import`. Public responses omit that block.

EventBridge runs the data-workers task every 5 minutes with `JOB=event-scan`. Locally:

```bash
pnpm --filter @local-events/data-workers dev -- --job event-scan
pnpm --filter @local-events/data-workers dev -- --job event-scan --event <event-id>
pnpm --filter @local-events/data-workers dev -- --job event-scan --limit 1
```

`--event` claims that one `pending_scan` row when its lease is free. `--limit` claims that many rows instead of the default five. The scheduled task sets neither, so it keeps the batch of five.

The job claims rows whose lease is free and passes that batch to the prompt runner
in one call. Each row carries the event text and the organizer keys. The runner loads publisher
and duplicate candidates itself. The chat runner walks the batch one event at a time. With no
`CHAT_PROVIDER` it calls local Ollama. `CHAT_PROVIDER=chatgpt` uses `OPENAI_API_KEY`.
`CHAT_PROVIDER=claude` uses `ANTHROPIC_API_KEY`.

For each event the Ollama runner:

1. Loads publisher candidates and chooses one from alias, email, website, and nearby name, or
   asks the worker to create a temporary publisher.
2. Loads nearby events and looks for a duplicate (distance, 30 minutes, then id, event link, any
   link, or title).
3. Approves the content. This step always approves until a later prompt can reject harmful, spam,
   or adult content.
4. Asks the configured chat model for up to five catalog tags scored above 90 when the event has no tags yet.

The worker writes the publisher, tags, and `meta.possibleDuplicate`, then sets the status.
A duplicate ranked over 90 as another showing also stores `meta.possibleOccasionGroupId` on the
scanned event and on each of those duplicates. An `occasionGroupId` already on one of them is
reused. Otherwise an existing `possibleOccasionGroupId` is reused, and a new id is created only
when none is set. Public responses omit the field.

| Result | Status |
| --- | --- |
| Possible duplicate | `in_review` |
| Content scan does not approve | `in_review` |
| Temporary publisher, unverified publisher, or source trust `review` | `in_review` |
| Approved, verified, not temporary, source trust `auto_publish` | `published` |

`published` enqueues `event.published` and schedules the publisher's import reminders as approved.
`in_review` schedules those reminders as pending when the publisher is verified and a plan is set.
A model failure releases the lease and leaves that row `pending_scan`. The other rows in the batch
still finish.

```mermaid
sequenceDiagram
  participant Scheduler as EventBridge
  participant Job as data-workers event-scan
  participant Runner as Prompt runner
  participant DB as Postgres

  Scheduler->>Job: JOB=event-scan
  Job->>DB: claim pending_scan rows
  Job->>Runner: scan(batch of event data and organizer keys)
  Runner->>DB: load publisher and duplicate candidates
  Runner-->>Job: publisher, duplicate, approval, tags
  Job->>DB: set publisher, tags, in_review or published
  Job->>DB: enqueue event.published when published
```
