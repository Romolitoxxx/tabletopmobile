/**
 * Token bucket per client: `perSecond` messages a second on average, with a
 * burst of twice as many. Protects the server from a client flooding actions.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();

  constructor(
    private readonly perSecond: number,
    private readonly now: () => number,
  ) {}

  /** True if the client may send one more message now. */
  take(clientId: string): boolean {
    const capacity = this.perSecond * 2;
    const now = this.now();
    const b = this.buckets.get(clientId) ?? { tokens: capacity, at: now };
    b.tokens = Math.min(capacity, b.tokens + ((now - b.at) / 1000) * this.perSecond);
    b.at = now;
    const ok = b.tokens >= 1;
    if (ok) b.tokens -= 1;
    this.buckets.set(clientId, b);
    return ok;
  }

  forget(clientId: string): void {
    this.buckets.delete(clientId);
  }
}
