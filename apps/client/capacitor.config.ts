import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // Reverse-domain id of the app on the stores. Change it before the first
  // store release: it cannot be changed afterwards.
  appId: 'app.tabletopmobile',
  appName: 'Tabletop Mobile',
  webDir: 'dist',
  ios: {
    // The page handles safe areas itself (viewport-fit=cover + env()).
    contentInset: 'never',
  },
  plugins: {
    SystemBars: {
      // Edge-to-edge on Android; safe areas come as CSS variables/env().
      insetsHandling: 'css',
      initialViewportFitValueHint: 'cover',
      style: 'DARK',
    },
  },
};

export default config;
