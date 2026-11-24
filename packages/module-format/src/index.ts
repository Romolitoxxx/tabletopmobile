import type { GameState, Player, RulesLevel as CoreRulesLevel } from '@tabletop/core';
import { z } from 'zod';

/** Rules level declared by a module manifest. */
export const RulesLevel = z.enum(['sandbox', 'assisted', 'full']);
export type RulesLevel = z.infer<typeof RulesLevel>;

// Compile-time check: the manifest levels must match the core ones.
const _sameLevels: [RulesLevel, CoreRulesLevel] extends [CoreRulesLevel, RulesLevel]
  ? true
  : never = true;
void _sameLevels;

/** Minimal module manifest; the full format will be defined later. */
export const ModuleManifest = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  rulesLevel: RulesLevel,
});
export type ModuleManifest = z.infer<typeof ModuleManifest>;

/** A module ready to start a game. */
export interface LoadedModule {
  manifest: ModuleManifest;
  /** Builds the table for the given players (before rules setup). */
  createState(players: Player[], maskKey: string): GameState;
  /** Resolves an asset reference to a URL the client can display. */
  assetUrl(ref: string): string;
}

/**
 * Loads modules from some source (bundled demo, file, URL, Tabletop
 * Simulator converter…). The concrete format will be defined later.
 */
export interface ModuleLoader {
  load(source: string): Promise<LoadedModule>;
}
