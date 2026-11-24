import { z } from 'zod';
import type { GameRecord } from '../app/game';

/** Summary shown in the list of saved games. */
export interface SaveSummary {
  id: string;
  name: string;
  moduleId: string;
  mode: GameRecord['mode'];
  players: string[];
  updatedAt: number;
}

export interface SaveStore {
  list(): Promise<SaveSummary[]>;
  get(id: string): Promise<GameRecord | null>;
  put(record: GameRecord): Promise<void>;
  delete(id: string): Promise<void>;
}

export function summarize(r: GameRecord): SaveSummary {
  return {
    id: r.id,
    name: r.name,
    moduleId: r.moduleId,
    mode: r.mode,
    players: r.save.initial.players.map((p) => p.name),
    updatedAt: r.updatedAt,
  };
}

const byRecent = (a: SaveSummary, b: SaveSummary) => b.updatedAt - a.updatedAt;

/** In-memory store, used in tests and when IndexedDB is unavailable. */
export class MemorySaveStore implements SaveStore {
  private readonly records = new Map<string, string>();

  async list(): Promise<SaveSummary[]> {
    return [...this.records.values()]
      .map((j) => summarize(JSON.parse(j) as GameRecord))
      .sort(byRecent);
  }

  async get(id: string): Promise<GameRecord | null> {
    const j = this.records.get(id);
    return j ? (JSON.parse(j) as GameRecord) : null;
  }

  async put(record: GameRecord): Promise<void> {
    this.records.set(record.id, JSON.stringify(record));
  }

  async delete(id: string): Promise<void> {
    this.records.delete(id);
  }
}

const DB_NAME = 'tabletop-mobile';
const DB_VERSION = 1;
const STORE = 'games';

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });
}

/** Games stored in IndexedDB (browser and Capacitor WebView). */
export class IndexedDbSaveStore implements SaveStore {
  private db: Promise<IDBDatabase> | null = null;

  constructor(private readonly factory: IDBFactory = indexedDB) {}

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const r = this.factory.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = () => {
        if (!r.result.objectStoreNames.contains(STORE))
          r.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error ?? new Error('Cannot open IndexedDB'));
    });
    return this.db;
  }

  private async store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    return (await this.open()).transaction(STORE, mode).objectStore(STORE);
  }

  async list(): Promise<SaveSummary[]> {
    const all = await request((await this.store('readonly')).getAll() as IDBRequest<GameRecord[]>);
    return all.map(summarize).sort(byRecent);
  }

  async get(id: string): Promise<GameRecord | null> {
    const r = await request(
      (await this.store('readonly')).get(id) as IDBRequest<GameRecord | undefined>,
    );
    return r ?? null;
  }

  async put(record: GameRecord): Promise<void> {
    // Stored as plain JSON data (structured clone of a JSON round trip).
    await request((await this.store('readwrite')).put(JSON.parse(JSON.stringify(record))));
  }

  async delete(id: string): Promise<void> {
    await request((await this.store('readwrite')).delete(id));
  }
}

/** Loose structural check of an imported file; the replay then validates the game itself. */
const ImportedRecord = z.object({
  format: z.literal('tabletop-local-game'),
  version: z.literal(1),
  id: z.string().min(1).max(200),
  name: z.string().max(200),
  moduleId: z.string().min(1),
  mode: z.enum(['solo', 'hotseat']),
  createdAt: z.number(),
  updatedAt: z.number(),
  activePlayerId: z.string(),
  save: z.object({
    format: z.literal('tabletop-save'),
    version: z.literal(1),
    rulesId: z.string(),
    undoPolicy: z.enum(['free', 'strict']),
    initial: z.looseObject({
      players: z.array(z.looseObject({ id: z.string(), name: z.string() })),
    }),
    log: z.array(z.unknown()),
    rng: z.object({ a: z.number(), b: z.number(), c: z.number(), d: z.number() }),
  }),
});

/** Parses an exported game file. Returns null if it is not one. */
export function parseExport(text: string): GameRecord | null {
  try {
    const r = ImportedRecord.safeParse(JSON.parse(text));
    return r.success ? (r.data as unknown as GameRecord) : null;
  } catch {
    return null;
  }
}

export function exportRecord(record: GameRecord): string {
  return JSON.stringify(record);
}
