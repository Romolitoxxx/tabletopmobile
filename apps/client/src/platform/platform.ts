import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { Share } from '@capacitor/share';

// Everything that differs between browser, Android and iOS lives here, so
// the rest of the client stays platform-independent.

export const isNative = (): boolean => Capacitor.isNativePlatform();

/** Small persistent settings (Preferences: native storage, localStorage on the web). */
export const settings = {
  async get(key: string): Promise<string | null> {
    try {
      return (await Preferences.get({ key })).value;
    } catch {
      return null;
    }
  },
  async set(key: string, value: string): Promise<void> {
    try {
      await Preferences.set({ key, value });
    } catch {
      // Not remembered: harmless.
    }
  },
};

/**
 * Hands a text file to the user: the share sheet on Android/iOS (save to
 * Files, send by mail/chat…), a download in the browser.
 */
export async function shareTextFile(filename: string, text: string, title: string): Promise<void> {
  if (isNative()) {
    const written = await Filesystem.writeFile({
      path: filename,
      data: text,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });
    await Share.share({ title, files: [written.uri] });
    return;
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface LifecycleHandlers {
  /** Android back button/gesture. Return true if handled. */
  onBack(): boolean;
  /** App going to the background (save now). */
  onPause(): void;
}

/** Native event sent by MainActivity (Android) for the back button/gesture. */
export const NATIVE_BACK_EVENT = 'tabletopback';

export function listenLifecycle(h: LifecycleHandlers): void {
  const back = (): void => {
    let handled: boolean;
    try {
      handled = h.onBack();
    } catch (err) {
      console.error('back handler failed', err);
      handled = true; // never leave the app because of a bug
    }
    if (!handled && isNative()) void App.minimizeApp();
  };
  if (!isNative()) {
    // In the browser, Escape behaves like the Android back button.
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        back();
      }
    });
    return;
  }
  // Android: MainActivity intercepts the back button and fires this event.
  document.addEventListener(NATIVE_BACK_EVENT, back);
  App.addListener('pause', () => h.onPause()).catch(() => {});
}
