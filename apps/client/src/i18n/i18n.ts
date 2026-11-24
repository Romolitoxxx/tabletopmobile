import { en, type MessageKey } from './en';
import { it } from './it';

export type Locale = 'it' | 'en';
export type { MessageKey };

const dictionaries: Record<Locale, Record<MessageKey, string>> = { en, it };

/** Picks the initial locale from the browser language. */
export function detectLocale(languages: readonly string[]): Locale {
  return languages.some((l) => l.toLowerCase().startsWith('it')) ? 'it' : 'en';
}

export class I18n {
  constructor(public locale: Locale) {}

  has(key: string): key is MessageKey {
    return key in en;
  }

  /** Translates a key, replacing `{name}` placeholders with params. */
  t(key: MessageKey, params: Record<string, string | number> = {}): string {
    const template = dictionaries[this.locale][key];
    return template.replace(/\{(\w+)\}/g, (_, name: string) =>
      name in params ? String(params[name]) : `{${name}}`,
    );
  }
}
