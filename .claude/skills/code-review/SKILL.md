---
name: code-review
description: Review the current diff, or a PR number / branch / path target, for correctness bugs at the given effort level (low, medium, high, max). Ends with an action table listing only the files that need a change. Use when the user invokes /code-review or asks to review changes before merging.
argument-hint: [low|medium|high|max] [PR# | branch | path] [--fix] [--comment]
---

# Code Review (events)

Review a set of changes for bugs the author would want to know about before merging. This project version of /code-review follows the same recipe as the built-in one, plus events-specific checks, and it always ends with an action table: the files that need a change, what to change in each, and nothing else.

## Parse the arguments

`$ARGUMENTS` may contain, in any order:

- An effort level: `low`, `medium`, `high`, or `max`. If none is given, reuse the level from the last /code-review in this conversation, otherwise `medium`.
- A target: a GitHub PR number (e.g. `42`), a branch name, or a path. If none is given, review the working tree.
- `--fix`: after reporting, apply the confirmed findings to the working tree.
- `--comment`: after reporting, post each finding as an inline PR comment with `gh` (only valid when the target is a PR).
- `ultra`: a cloud multi-agent review that only the built-in skill can launch. Do not try to run it. Tell the user to run `/ultrareview`, which routes to the built-in, and stop.

## Step 1 — Collect the diff

Work from git, never from memory of earlier edits:

- Working tree (no target): `git diff` plus `git diff --cached`, plus untracked files from `git status --porcelain` (read them whole). If the working tree is clean, review the current branch against `main` instead (`git diff main...HEAD`) and say so.
- Branch target: `git diff main...<branch>`.
- PR target: `gh pr diff <number>` and `gh pr view <number> --json title,body,files`.
- Path target: `git diff -- <path>` plus `git diff --cached -- <path>`, falling back to `git diff main...HEAD -- <path>`.

Always also run `git diff --name-only` (same base and range) so you know the full set of files reviewed, and `wc -l` on every changed file that still exists so the file-length check in Step 2 has real numbers.

Exclude from review: anything under `backups/`, `.next/`, `.turbo/`, `dist/`, lockfiles (`pnpm-lock.yaml`), and generated token files unless the change is to the generator.

## Step 2 — Review

Read every changed hunk, and enough surrounding code (callers, siblings, the existing pattern the change imitates) to judge it. Look for correctness bugs: logic errors, unhandled edge cases, wrong types or unsafe casts, broken error handling, race conditions, regressions in behaviour the diff did not intend to change.

Calibrate to the effort level:

- `low` / `medium`: report only high-confidence findings. Fewer, better findings.
- `high` / `max`: broader coverage, including reuse, simplification and efficiency cleanups and findings you are less sure of, each labelled with its confidence.

Apply the events-specific checks the `code-reviewer` agent in `.claude/agents/code-reviewer.md` lists (in-memory filtering instead of a `where`, unbounded list reads, N+1 loops, read-decide-write without a transaction, missing auth guards compared to sibling routes, actor id taken from the body, literal hex colours, data-isolation boundary between `apps/data/*` and the platform). When the diff touches `apps/api`, read that file's "events-specific checks" section before reviewing.

File length is checked at every effort level, using the same rule as that agent: flag MINOR when the change grows a file past 500 lines and MAJOR past 800, and name the natural split (a route file by resource, a component by section, a helper module by concern). Do not flag pre-existing length the change did not add to. `packages/contracts/src/api.ts` and `entities.ts` are registries: note growth there, do not block on it.

Verify each candidate finding against the code before reporting it. Drop anything you cannot confirm at `low` / `medium`; at `high` / `max` keep plausible findings but mark them `PLAUSIBLE`.

## Step 3 — Report findings

If the `ReportFindings` tool is available, call it once with the verified findings, most severe first, and do not repeat them as prose. Otherwise, list them in markdown: one bullet per finding with `file:line`, a one-sentence defect statement, and the concrete failure scenario.

Then, if `--fix` was given, apply the confirmed findings with minimal targeted edits, re-run `pnpm typecheck` for the touched packages, and report what changed. If `--comment` was given, post each finding as an inline comment on the PR with `gh api` (one comment per finding, anchored to the file and line).

## Step 4 — Action table (always, last)

Finish every review with one markdown table that lists only the files that need a change: one row per finding, most severe first, then by path. Files with no findings do not appear. Columns:

| File | Severity | Change needed |
|---|---|---|

- `File`: repo-relative path with the line, as a clickable reference (`path/to/file.ts:42`).
- `Severity`: `blocker`, `major`, or `minor`, matching the finding.
- `Change needed`: one or two sentences saying what to change, concretely enough to act on without re-reading the finding: the edit to make, not a restatement of the defect.

After the table, give one line with the totals: number of files reviewed, number of files that need a change, and the number of findings by severity. If there are no findings, skip the table and write that one line only, stating that nothing needs to change. Nothing else follows.
