# Changelog

## Unreleased

- Add a plugin-owned SQLite usage projection keyed by session revision. The first build still scans the historical corpus, but later windows read only indexed final usage samples and changed sessions are rebuilt individually across restarts.
- Keep source logs authoritative: same-step replacement semantics are folded before time filtering, failed rebuilds remove stale rows, and current workspace names are resolved at query time.

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
