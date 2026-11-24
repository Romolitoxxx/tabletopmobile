import { defineProject } from 'vitest/config';

export default defineProject({ test: { name: 'module-format', include: ['src/**/*.test.ts'] } });
