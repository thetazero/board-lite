# Design rules

Tests for relationships between tuning numbers that should hold whatever the exact numbers are: "a basic production building pays back in 4 to 5 rounds", not "a Quarry costs 11". They read every number from `src/data.ts`, so a retune that keeps the rules passes, and one that breaks a rule fails with the rule's number and the numbers that broke it. A rule can be broken on purpose; the failure is a flag to look, then change the numbers or the rule.

`npm test` runs them with the other tests. The rules, and where they came from, are in issue #222.

Payback is a building's cost divided by what it makes each round, counting every basic resource (stone, timber, crystal, livestock) as 1. Gold isn't counted yet: a cost with gold fails, asking how it should count.

To add a rule: add a `test('rule N: …')` to `rules.test.ts` that finds the buildings it is about by their data (class, `per`, `basic`), never by a hard-coded number, and on failure lists each building that broke it with its numbers. A rule whose meaning is still open can take `{ todo: '<why>' }`: it runs and reports, but doesn't fail the run.
