# Changelog

## 0.2.3

- README badges (npm version / weekly downloads / license / CI); dropped the "(draft)" label

## 0.2.2

- published to npm: `dsh plugin add dsh-ruleset`
- ships `docs/PREDICATE-PLAYBOOK.md` and `DEVELOPMENT.md` in the tarball

## 0.2.1

Community listing and documentation polish.

- **listed** in `awesome-dsh-plugin/awesome-dsh-plugin` under Security & Permissions (merged 2026-11-18, PR #16379)

- submitted to `awesome-dsh-plugin/awesome-dsh-plugin` (plugin-market index source) and `kejixiaoliang/awesome-dsh-plugins`
- READMEs list community submissions and the GitHub install command while npm publishing is unavailable

## 0.2.0

Rule authoring and verification, end to end.

- web panel (card grid, three columns: redline / hard / soft) with drag-and-drop re-tiering written back to `policy.yaml`
- one-sentence rule authoring: model picks the predicate, deterministic fallback when the model is unavailable, plus "explain this rule" (object / trigger / expectation / exception) via `ruleset_introspect`
- predicate set now 15: added `never`, `per-turn-cap`, `wal`, `bypass`, `approval-gated`, `permission-change`, `job-dangling`, `command-audit`, `change-gate`, `doc-refs`, `explain-first`
- red-line guard: `tools/pre-execute` returns `ask` for `sudo`, `chmod 777`, `curl | sh`, system-path writes and credential-shaped strings; hits logged to `.ruleset/guard.log`
- findings with lifecycle (`open/fixed/accepted/false_positive/superseded`); triaged findings subtract from hit counts and are never deleted; 15s incident merging; stable keys; 7-day supersede
- baseline significance: two-proportion z-test (`|z| < 1.96` = no meaningful change), per-rule direction shown in the panel
- injection fingerprinting: `.ruleset/injected.log` records every distinct injected rule text
- rule hygiene: duplicates, conflicts, rules without predicates, injected token cost
- ownership guarantees: `AGENTS.md` read-only; `policy.yaml` written only on explicit action, backed up to `.ruleset/backups/` with one-click rollback and export
- docs: `docs/PREDICATE-PLAYBOOK.md` (lessons that came from real false positives) injected as a short section and readable via `ruleset_playbook`
- 20 tests, including a plugin-load smoke test and guard behaviour tests; GitHub Actions on Node 22/24
- transport: HTTP routes are thin adapters over a single `service.js`; a `/ruleset` host command provides a fallback where routes are unavailable

## 0.1.0

- one policy file drives prompt injection and three-value checks
- 9 predicate types: regex, path-boundary, field-presence, sequence-order, count-threshold, requires, turn-condition, duration, metric
- policy validation on load (zero dependency); invalid policy → unknown, never falls back
- legacy split by file mtime; daily snapshot is out of scope for this package
- 12 tests: validation + predicate behaviour
- alignment vs a hand-written collector set: 8/10 identical, 2 differ in evidence granularity
