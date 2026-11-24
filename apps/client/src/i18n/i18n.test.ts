import { describe, expect, it as test } from 'vitest';
import { en } from './en';
import { detectLocale, I18n } from './i18n';
import { it } from './it';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('i18n', () => {
  test('Italian has the same keys and placeholders as English', () => {
    expect(Object.keys(it).sort()).toEqual(Object.keys(en).sort());
    for (const [key, value] of Object.entries(en)) {
      expect(placeholders(it[key as keyof typeof en]), key).toEqual(placeholders(value));
    }
  });

  test('translates with parameters', () => {
    const i = new I18n('it');
    expect(i.t('event.drew', { actor: 'Marco', count: 2, deck: 'Mazzo' })).toBe(
      'Marco ha pescato 2 carte da Mazzo',
    );
    i.locale = 'en';
    expect(i.t('event.rolled', { values: '4, 6' })).toBe('Roll: 4, 6');
  });

  test('detects the locale', () => {
    expect(detectLocale(['it-IT', 'en'])).toBe('it');
    expect(detectLocale(['de-DE'])).toBe('en');
  });
});
