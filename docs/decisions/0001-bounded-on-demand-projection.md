# Bounded on-demand usage projection

Status: accepted

## Decision

The Host opens its SQLite sidecar and registers the loopback RPC during plugin startup, but it does not list sessions or read history. The first RPC starts one shared reconciliation worker. Concurrent RPCs join that worker, and a request arriving during a pass requires a follow-up listing before any joined response can use the projection. Each worker epoch retains the maximum exclusive end among all unresolved queries and returns an immutable session/revision-less snapshot to those queries; a later narrow query cannot discard a wider query's live-session fold.

A query excludes sessions whose known `createdAt` is at or after the requested exclusive end. Missing, old-version, revision-less, or revision-changed sessions are read and folded before the response. An incomplete row for the current source revision is not reread until that revision changes. The worker lists sessions again after folding and repeats reconciliation when the source identity set changed. Only rows joined to a complete session record for the current projection version can answer the range.

Raw JSONL is scanned with `indexOf` and reduced as each newline is found. The JSONL backend's `resolveCurrentLog` path is the cold-read source so Host-unknown event types remain in the text; a validated handle read is the fallback. Route changes and final same-turn/same-step replacement happen before the time window is applied. Invalid and unknown records do not allocate a full event corpus and do not change the fold.

Source reads have configurable bounded concurrency and default to one. Replacements are committed in configurable batches of eight sessions by default. A successful batch is durable before the next batch is read; all rows for a changed session are deleted and replaced in the same transaction. A source failure commits an incomplete marker, removes stale steps, and omits that revision from the snapshot; the query still answers from remaining complete rows and does not reread that revision until the source revision changes. A batch write failure rolls back that batch, then deletes its session rows in a separate transaction before failing so the next query retries the write. Batch-local raw text, events, steps, and results become unreachable after commit.

SQLite uses WAL, `synchronous=NORMAL`, and a bounded busy timeout. A completed initial rebuild gets one controlled passive WAL checkpoint. The projection does not use `VACUUM` or `temp_store=MEMORY`. Disposal rejects new queries, lets active queries reach their safe completion point, and closes the database afterward.

## Consequences

The default startup cost is independent of history size. The first exact query can take longer because it owns any missing projection work. Later unchanged queries list revisions twice but read no session logs. Listing and SQLite failures are visible to the client as the existing generic RPC error. An unreadable session is omitted from the snapshot rather than failing the page; the RPC payload and successful response fields do not change.

The session log remains authoritative and the sidecar remains disposable. Revision-less live sessions are folded on every query. Deleted sessions are removed when the source listing no longer contains them. Current workspace titles are resolved at query time rather than treated as durable projection authority.

## Alternatives considered

An unconditional 32-day startup warmup made a default application start enumerate and read history, so it was rejected. An unbounded parallel rebuild reduced a cold benchmark time at the cost of large simultaneous raw/event/step retention and I/O pressure, so bounded reads and transactions were chosen. Falling back to a second full-corpus in-memory fold hid projection failures and repeated the most expensive work, so unreadable sessions stay incomplete instead of being folded as zero. Failing the whole query after one refused log made a Host vocabulary mismatch (`assistant/chunk`, renamed `tool/code-dispatch`) take down Settings → Usage, so the snapshot answers from complete rows.

## Synthetic performance check

Run `pnpm run benchmark:projection`. The harness generates data in a temporary directory; it never opens a DSH home or copies production logs. Its fixed workload contains 1,346 sessions and 83,883 final steps.

The correctness metrics are deterministic: the cold query reports 83,883 requests, performs 1,346 source reads, and observes peak read concurrency no greater than the configured value `1`; the warm query reports the same request count and performs zero additional source reads. Cold/warm milliseconds and heap delta are diagnostic because they depend on the host, Node version, and filesystem. A regression investigation should compare those values on the same machine rather than impose a cross-machine timing threshold.
