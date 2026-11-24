/** Serializable state of the sfc32 generator. */
export interface RngState {
  a: number;
  b: number;
  c: number;
  d: number;
}

/** cyrb128: hashes a string seed into four 32-bit words. */
function cyrb128(str: string): RngState {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return { a: h1 >>> 0, b: h2 >>> 0, c: h3 >>> 0, d: h4 >>> 0 };
}

/**
 * Deterministic random generator owned by the host. Its state is secret while
 * the game is running and is never part of a player view.
 */
export class Rng {
  private s: RngState;

  constructor(state: RngState) {
    this.s = { ...state };
  }

  static fromSeed(seed: string): Rng {
    const rng = new Rng(cyrb128(seed));
    for (let i = 0; i < 15; i++) rng.nextUint32(); // warm up
    return rng;
  }

  getState(): RngState {
    return { ...this.s };
  }

  setState(state: RngState): void {
    this.s = { ...state };
  }

  nextUint32(): number {
    let { a, b, c, d } = this.s;
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    this.s = { a: a >>> 0, b: b >>> 0, c: c >>> 0, d: d >>> 0 };
    return t >>> 0;
  }

  /** Uniform integer in [0, maxExclusive), without modulo bias. */
  int(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0 || maxExclusive > 0x100000000) {
      throw new RangeError(`Invalid range: ${maxExclusive}`);
    }
    const limit = 0x100000000 - (0x100000000 % maxExclusive);
    let x = this.nextUint32();
    while (x >= limit) x = this.nextUint32();
    return x % maxExclusive;
  }

  /** Returns a shuffled copy (Fisher–Yates). */
  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const tmp = out[i]!;
      out[i] = out[j]!;
      out[j] = tmp;
    }
    return out;
  }
}
