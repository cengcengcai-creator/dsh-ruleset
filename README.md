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

Draft, but functional: **10 of 15 rules are expressible declaratively** — no collector code per rule, only policy.

- Alignment against a hand-written collector set: 8 rules identical, 2 differ only in evidence granularity (chat-level approvals, review scope). See `ALIGNMENT.md`.
- Policy is validated on load (`lib/validate.js`, zero dependency). Invalid policy → `null` → every rule reports `unknown`; it never falls back to some other policy.
- Tests: `npm test` (12 cases: validation + predicates).

## Contract

- `unknown` is never read as `pass`
- `expect: 0` rules: scanned samples with zero hits = `pass`; no samples = `unknown`
- Every verdict carries evidence (`seq`, file path) or explicitly says why it has none

## Layout

```
lib/index.js     wiring (inject + tool)
lib/policy.js    loader + mtime watch
lib/inject.js    system prompt section
lib/observe.js   ruleset_audit tool
lib/report.js    collectors + three-value evaluation
schema/          policy JSON Schema
examples/        example policy
```

## Origin / disclosure

This package was **developed by an AI agent** (DeepSeek Harness running as the primary actor), through real operation and correction against failures on one machine — not hand-authored as a prompt template. The same applies to the methodology repo it references. Use it as a starting point, not a certification.

The plugin does not ship a rulebook. The rules are the user's own `policy.yaml`; what ships here is the schema, the predicate executor and the evidence collection.


## If you only have AGENTS.md

Most people grow rules in `AGENTS.md` through conversation, not by writing a spec. The plugin handles that:

1. If `policy.yaml` exists → used as-is.
2. If it does not, but `AGENTS.md` does → rules are **extracted automatically as a draft**: injected into the prompt, but **never judged** (every rule reports `unknown` with "draft unconfirmed").
3. Neither → nothing is judged; the report says "no rule source" instead of guessing.

Promote a draft to real rules:

```bash
node scripts/extract.mjs AGENTS.md policy.draft.yaml   # 82 forced clauses → classified draft
# delete what you do not want, add observe.bind to the few that matter, rename to policy.yaml
```

A starter pack with 5 mechanically checkable rules ships in `examples/policy.starter.yaml`.

## Pluggable by design

- The plugin **never writes** to `AGENTS.md`, `policy.yaml`, or any user file. Everything is read at call time.
- Uninstalling restores the prompt exactly as it was: registration goes through `ctx.effect`, so it disposes with the plugin.
- Injection dedupes against `AGENTS.md`: if a rule's text already appears there, it is **not injected again** (reports show `N injected / M skipped`), and when the rules themselves came from `AGENTS.md` the inject layer turns itself off.

## Tools

- `ruleset_audit` — three-value report over the last N hours; also writes `.ruleset/report.json` (plugin state, not a user file) for UIs or external readers.
- `ruleset_init` — on explicit request only: extracts `AGENTS.md` into `.ruleset/policy.draft.yaml`. It never touches the real `policy.yaml` and refuses to overwrite an existing draft without `overwrite: true`.
