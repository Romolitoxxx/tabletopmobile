import { describe, expect, it } from 'vitest';
import { normalizeCode, normalizeServer, onlineErrorCode } from './online';

describe('online helpers', () => {
  it('turns what the user typed into a WebSocket URL', () => {
    expect(normalizeServer(' 192.168.1.5:2567 ')).toBe('ws://192.168.1.5:2567');
    expect(normalizeServer('wss://games.example.org/')).toBe('wss://games.example.org');
    expect(normalizeServer('https://games.example.org')).toBe('wss://games.example.org');
    expect(normalizeServer('http://localhost:2567')).toBe('ws://localhost:2567');
  });

  it('normalizes table codes', () => {
    expect(normalizeCode(' ab-c 2d ')).toBe('ABC2D');
  });

  it('maps server errors to translated codes', () => {
    expect(onlineErrorCode(new Error('started'))).toBe('started');
    expect(onlineErrorCode(new Error('room "XYZ" not found'))).toBe('not_found');
    expect(onlineErrorCode(new TypeError('Failed to fetch'))).toBe('unreachable');
  });
});
