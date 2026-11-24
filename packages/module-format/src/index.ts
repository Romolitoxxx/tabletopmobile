import { z } from 'zod';

/** Rules level declared by a module manifest. */
export const RulesLevel = z.enum(['sandbox', 'assisted', 'full']);
export type RulesLevel = z.infer<typeof RulesLevel>;

/** Minimal module manifest; the full format will be defined later. */
export const ModuleManifest = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  rulesLevel: RulesLevel,
});
export type ModuleManifest = z.infer<typeof ModuleManifest>;
