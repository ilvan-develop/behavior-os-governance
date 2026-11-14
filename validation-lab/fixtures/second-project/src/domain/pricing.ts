/**
 * Known defects for the lab (different architecture, similar weaknesses).
 *
 * BUG-A: roundToCents() uses toFixed(2) on a float and then parses it back,
 *        so 1.005 becomes 1.00 instead of 1.01.
 * BUG-B: applyFee() applies the fee before the minimum check, so a zero-value
 *        transfer still charges the fee.
 * BUG-C: the posting use case reads the balance and writes the new balance in
 *        two separate calls, so concurrent posts can lose an update.
 */

export function roundToCents(value: number): number {
  return Number.parseFloat(value.toFixed(2)); // BUG-A
}

export function applyFee(amount: number, fee: number, minimum = 100): number {
  const charged = amount + fee; // BUG-B: fee applied before the minimum check
  if (amount < minimum) return charged;
  return charged;
}

export class PostingService {
  constructor(
    private readonly repository: {
      read(id: string): Promise<number>;
      write(id: string, v: number): Promise<void>;
    },
  ) {}

  async post(accountId: string, delta: number): Promise<number> {
    const balance = await this.repository.read(accountId);
    const next = balance + delta; // BUG-C: no compare-and-set
    await this.repository.write(accountId, next);
    return next;
  }
}
