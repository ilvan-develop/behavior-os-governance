# Security notes (as-is)

## Vulnerability 1 — hardcoded credential

`src/server.js` contains `const ADMIN_TOKEN = "orbit-admin-2023"` and compares
it with `==`. The token is committed, never rotated and grants admin access.

## Vulnerability 2 — injection

The `/search` handler interpolates `req.query.q` directly into the in-memory
query object and into a log line, so a crafted value can escape the intended
filter and is written unescaped.

## Mitigations expected

- secret loaded from the environment, never committed
- constant-time comparison
- parameterised query builder
- structured logging with escaping
