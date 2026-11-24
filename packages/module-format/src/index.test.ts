import { describe, expect, it } from 'vitest';
import { ModuleManifest } from './index';

describe('ModuleManifest', () => {
  it('accepts a valid manifest', () => {
    const m = { id: 'demo', name: 'Demo', version: '1.0.0', rulesLevel: 'sandbox' };
    expect(ModuleManifest.parse(m)).toEqual(m);
  });

  it('rejects an unknown rules level', () => {
    const m = { id: 'demo', name: 'Demo', version: '1.0.0', rulesLevel: 'magic' };
    expect(ModuleManifest.safeParse(m).success).toBe(false);
  });
});
