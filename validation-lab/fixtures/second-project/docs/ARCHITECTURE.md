# Architecture (as-is)

## Problem A — domain depends on infrastructure

`src/domain/pricing.ts` imports a concrete repository type instead of a port.
The declared hexagonal boundary points the wrong way.

## Problem B — use case is not a use case

`PostingService` combines validation, fee calculation and persistence, so the
application layer cannot be tested without a database double.

## Intended boundaries

```text
infra -> application -> domain
```

The dependency arrows currently run from domain back to infra.
