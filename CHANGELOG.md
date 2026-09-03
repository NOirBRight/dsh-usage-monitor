# Changelog
## [0.2.11] - 2026-09-03

### Changed

- DSH compatibility declarations cover the verified Alpha.4 and rc.1 runtimes.
- Unknown runtimes warn once and use the normal best-effort mount path; only reproduced failures may be blocklisted.


## 0.2.4

- Make the usage projection on-demand: startup only opens the sidecar and registers RPC, while the first query performs exact revision reconciliation without a full-corpus fallback.
- Fold raw JSONL incrementally, bound source reads to one by default, and commit replacements in eight-session batches so completed work survives later interruption.
- Fail exact queries after relevant source or SQLite errors, exclude incomplete or old-version rows, re-list revisions before responding, and wait for active work before closing the database.
- Configure the sidecar for WAL, `synchronous=NORMAL`, and a bounded busy timeout; add a synthetic 1,346-session / 83,883-step benchmark.

## 0.2.2

- Widen Host peer ranges to `>=0.1.0-rc.6 <0.1.1 || >=0.1.1-rc.1 <1.0.0`

## 0.2.1

- Ignore conversation DOM mutations when patching the Settings → Usage nav icon. Keep watching `document.body` so a dynamically mounted settings dialog still gets the glyph.

## 0.2.0

- Add a plugin-owned SQLite usage projection keyed by session revision. The first build still scans the historical corpus, but later windows read only indexed final usage samples and changed sessions are rebuilt individually across restarts.
- Keep source logs authoritative: same-step replacement semantics are folded before time filtering, failed rebuilds remove stale rows, current workspace names are resolved at query time, and concurrent refreshes recheck revisions before responding.
- Preserve the existing createdAt eligibility rule for historical windows.

## 0.1.2

- Fix Settings → Usage hanging on "Reading session logs..." on large homes:
  - Raise the fold cache above the default corpus working set so a second query stops re-reading every log (the LRU cascaded below the old 512-entry cap).
  - Fold sessions through the backend's raw-artifact read first; logs carrying event types unknown to this build no longer fail their read (a failed read is never cached, so those sessions were re-read on every query and silently missing from the charts).
  - Recover cache revisions by stat-ing located artifacts when the backend snapshot listing rejects.

## 0.1.1

- Redesign chart tooltips with compact values, percentages, bucket totals, and cumulative totals
- Add localized daily and weekly tooltip labels

## 0.1.0

- Settings → Usage dashboard from session-log token usage
- Tiles, stacked chart, and a breakdown table by provider, model, or workspace
