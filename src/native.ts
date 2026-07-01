// Thin wrappers over the native Tauri plugins, each with a browser fallback so
// the same calls work in the dev browser and in the iOS app. Plugins are
// imported lazily so the web build never pulls native code at startup.

export function isNative(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// Open a URL in the system browser (Safari on iOS) rather than the app webview.
export async function openExternal(url: string): Promise<void> {
  if (isNative()) {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
      return;
    } catch {
      // fall through to web behavior
    }
  }
  window.open(url, "_blank", "noopener");
}

export async function readClipboardText(): Promise<string> {
  if (isNative()) {
    try {
      const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
      return (await readText()) ?? "";
    } catch {
      // fall through to web behavior
    }
  }
  return (await navigator.clipboard.readText()) ?? "";
}

// Subscribe to deep links (drawassistant://…), including the one that cold-starts
// the app. Returns an unsubscribe function. No-op in the browser.
export async function onDeepLink(handler: (url: string) => void): Promise<() => void> {
  if (!isNative()) return () => {};
  try {
    const dl = await import("@tauri-apps/plugin-deep-link");
    const current = await dl.getCurrent().catch(() => null);
    if (current) current.forEach(handler);
    return await dl.onOpenUrl((urls) => urls.forEach(handler));
  } catch {
    return () => {};
  }
}
