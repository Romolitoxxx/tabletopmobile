import { demoModule, stressModule } from './demo';
import type { LoadedModule, ModuleLoader } from './index';

/** Loads the modules bundled with the app (`builtin:<id>`). */
export class BuiltinModuleLoader implements ModuleLoader {
  private readonly modules = new Map<string, LoadedModule>(
    [demoModule, stressModule].map((m) => [m.manifest.id, m]),
  );

  async load(source: string): Promise<LoadedModule> {
    const id = source.startsWith('builtin:') ? source.slice('builtin:'.length) : source;
    const m = this.modules.get(id);
    if (!m) throw new Error(`Unknown module: ${source}`);
    return m;
  }

  list(): LoadedModule[] {
    return [...this.modules.values()];
  }
}
