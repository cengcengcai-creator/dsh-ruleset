# Changelog

## 0.1.0

- one policy file drives prompt injection and three-value checks
- 9 predicate types: regex, path-boundary, field-presence, sequence-order, count-threshold, requires, turn-condition, duration, metric
- policy validation on load (zero dependency); invalid policy → unknown, never falls back
- legacy split by file mtime; daily snapshot is out of scope for this package
- 12 tests: validation + predicate behaviour
- alignment vs a hand-written collector set: 8/10 identical, 2 differ in evidence granularity
