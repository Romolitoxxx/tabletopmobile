import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SavedGame, TableInfo } from '@tabletop/core';

/** Everything needed to bring a table back after a restart (secrets included). */
export interface StoredTable {
  version: 1;
  code: string;
  gameName: string;
  moduleId: string;
  phase: TableInfo['phase'];
  seats: { playerId: string; name: string; color: string; token: string }[];
  nextSeat: number;
  /** The authoritative game, once started. */
  save: SavedGame | null;
  /** Last activity (ms since epoch): joins, leaves, actions. */
  lastActive: number;
}

/** Where tables survive server restarts. Only the server ever reads it. */
export interface TableStore {
  list(): StoredTable[];
  get(code: string): StoredTable | null;
  put(table: StoredTable): void;
  delete(code: string): void;
  close(): void;
}

export class MemoryTableStore implements TableStore {
  private readonly tables = new Map<string, string>();

  list(): StoredTable[] {
    return [...this.tables.values()].map((t) => JSON.parse(t) as StoredTable);
  }

  get(code: string): StoredTable | null {
    const t = this.tables.get(code);
    return t === undefined ? null : (JSON.parse(t) as StoredTable);
  }

  put(table: StoredTable): void {
    this.tables.set(table.code, JSON.stringify(table));
  }

  delete(code: string): void {
    this.tables.delete(code);
  }

  close(): void {}
}

/** SQLite file (Node's built-in `node:sqlite`): one JSON document per table. */
export class SqliteTableStore implements TableStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS tables (
        code TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        last_active INTEGER NOT NULL
      );
    `);
  }

  list(): StoredTable[] {
    const rows = this.db.prepare('SELECT data FROM tables').all() as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as StoredTable);
  }

  get(code: string): StoredTable | null {
    const row = this.db.prepare('SELECT data FROM tables WHERE code = ?').get(code) as
      { data: string } | undefined;
    return row ? (JSON.parse(row.data) as StoredTable) : null;
  }

  put(table: StoredTable): void {
    this.db
      .prepare(
        `INSERT INTO tables (code, data, last_active) VALUES (?, ?, ?)
         ON CONFLICT(code) DO UPDATE SET data = excluded.data, last_active = excluded.last_active`,
      )
      .run(table.code, JSON.stringify(table), table.lastActive);
  }

  delete(code: string): void {
    this.db.prepare('DELETE FROM tables WHERE code = ?').run(code);
  }

  close(): void {
    this.db.close();
  }
}
