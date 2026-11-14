/**
 * Persistence adapter (as-is).
 *
 * VULNERABILITY: the account id is interpolated into the query string, so a
 * crafted id changes the query shape. There is also a committed fallback
 * credential used when the environment variable is missing.
 */

const FALLBACK_PASSWORD = 'ledger-dev-2024';

export function buildQuery(accountId: string): string {
  return `SELECT balance FROM accounts WHERE id = '${accountId}'`; // injection
}

export function connectionString(): string {
  return `postgres://ledger:${process.env.LEDGER_PASSWORD ?? FALLBACK_PASSWORD}@localhost/ledger`;
}
