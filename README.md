# dsh-ruleset (draft)

**Behavioral rule compliance for DSH — one policy file drives both prompt injection and evidence-backed three-value checks.**

> Audits **agent behavior**, not plugin quality. For plugin conformance, see `PerryLink/dsh-standards` (ENTRY/FLOW/BOOST).

## Relationship to the methodology

The four-tier enforcement model (interception / exit gate / detection / prompt-only) and the "detectable is not blocked" rule live in [`agent-rule-enforcement`](https://github.com/cengcengcai-creator/agent-rule-enforcement). **This package is the detection tier**: it measures behaviour against logs and never claims to block anything.

Interop: `lib/export.js` emits a generic JSONL event log (`ts` / `session` / `tool` / `ok` / `checkpoint` / `outcome`), which `audit_events.py` from that repo consumes directly. Verified: 1,138 events → 40 task segments → `long_task_without_checkpoint` 15/40.

## Why

Most rule plugins inject text. Most audit plugins measure tooling. Neither answers: *did the agent follow the rules it was told?*

`dsh-ruleset` keeps one source of truth (`policy.yaml`):

1. **inject** — rule text into the system prompt, hot-reloaded on file change
2. **observe** — rule-by-rule verdicts: `pass` / `violation` / `unknown`, each pointing back to a `seq` or file

Contract: **`unknown` is never read as `pass`** (no data source or too few samples stays `unknown`).

## Install

```bash
# from GitHub (works today)
dsh plugin --profile web add github:cengcengcai-creator/dsh-ruleset

# from npm (once published)
dsh plugin --profile web add dsh-ruleset
```

## Status

Functional, self-hosted, no npm account needed — install straight from GitHub.

What it does today:

1. **Write rules in one sentence** — a model turns it into a predicate you can adjust (`/api/dsh-ruleset/parse`, deterministic fallback included).
2. **Three tiers** — redline / hard / soft, injected in that order so hard rules are not buried.
3. **Judge behaviour** — 15 predicate types over native DSH events (approvals, sandbox modes, jobs, turns, file writes), never regex-guessing what the platform already records.
4. **Gate red lines** — a `tools/pre-execute` guard returns `ask` for `sudo`, `chmod 777`, `curl | sh`, system-path writes, credential-shaped strings. Hits are logged to `.ruleset/guard.log`.
5. **Keep findings honest** — per-finding lifecycle (`open/fixed/accepted/false_positive/superseded`), false positives subtract from hit counts and are never deleted.
6. **Compare against a baseline** — two-proportion z-test (ported from OpenClaw's `audit-verdict.py`); `|z| < 1.96` is reported as "no meaningful change" instead of red.
7. **Verify what reached the model** — every distinct injected rule text is fingerprinted into `.ruleset/injected.log`.
8. **Own nothing** — `AGENTS.md` is read-only; `policy.yaml` is written only on explicit user action, always after a backup; one-click rollback and export are built in.

Rule hygiene (`/api/dsh-ruleset/hygiene`): duplicates, conflicts, rules without predicates, token cost.

Tests: `npm test` — 20 cases (validation, predicates, extraction, dedupe, plugin-load smoke, guard behaviour).

Known limits: no hot reload (host restart required), client-side slot props are not inspectable, model judging is advisory only (not calibrated with kappa yet).

## Community listings

Submitted (review pending):

1. [awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/16379) — the large curated list that also serves as a plugin-market index (category: `security`)
2. [kejixiaoliang/awesome-dsh-plugins](https://github.com/kejixiaoliang/awesome-dsh-plugins/pull/223) — category: health checks / diagnostics / audit

Not on npm yet; install from GitHub until it is:

```bash
dsh plugin --profile web add github:cengcengcai-creator/dsh-ruleset
```
