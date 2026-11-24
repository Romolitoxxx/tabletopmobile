import { CORE_VERSION } from '@tabletop/core';

// Placeholder entry point; the PixiJS table arrives in milestone 3.
const root = document.querySelector<HTMLDivElement>('#app');
if (root) root.textContent = `Tabletop Mobile — core ${CORE_VERSION}`;
