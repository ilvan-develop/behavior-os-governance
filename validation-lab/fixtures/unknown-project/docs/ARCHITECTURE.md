# Architecture (as-is)

## Problem 1 — cyclic dependency

`server.js` imports `pricing.js`, which imports `server.js` to read a global
configuration object. The cycle makes startup order fragile and hides the real
dependency direction.

## Problem 2 — business logic inside the HTTP layer

`server.js` performs discount calculation, stock reservation and persistence
inside the route handlers. There is no domain layer, so the rules cannot be
tested without booting HTTP.

## Intended boundaries

```text
http -> domain -> persistence
```

The repository violates that direction in both directions.
