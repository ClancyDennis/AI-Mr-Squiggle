// Where the API key lives. Native (Tauri/iOS) will store it in the Keychain via
// a Rust command; in the browser / web it falls back to localStorage. The native
// commands don't exist yet — until they're added, every path uses the fallback,
// so the app behaves identically in-browser today and gains Keychain storage
// once the native side lands (no call-site changes needed).

const KEY_STORAGE = "drawassistant-api-key";

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

async function getNativeInvoke(): Promise<Invoke | null> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return null;
  try {
    const mod = await import("@tauri-apps/api/core");
    return mod.invoke as Invoke;
  } catch {
    return null;
  }
}

function readLocalFallback(): string {
  try {
    return window.localStorage.getItem(KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

export async function getStoredApiKey(): Promise<string> {
  const invoke = await getNativeInvoke();
  if (invoke) {
    try {
      const value = await invoke("keychain_get_api_key");
      // Only trust a non-empty Keychain value; an empty result means "not stored
      // yet", so fall back to the local store, which is the migration source on
      // the first native run.
      if (typeof value === "string" && value) return value;
    } catch {
      // fall through to the local fallback
    }
  }
  return readLocalFallback();
}

export async function setStoredApiKey(key: string): Promise<void> {
  const invoke = await getNativeInvoke();
  if (invoke) {
    try {
      await invoke("keychain_set_api_key", { key });
      // Now that it's safely in the Keychain, drop any plaintext fallback copy.
      try {
        window.localStorage.removeItem(KEY_STORAGE);
      } catch {
        // ignore
      }
      return;
    } catch {
      // fall through to the local fallback
    }
  }
  try {
    if (key) window.localStorage.setItem(KEY_STORAGE, key);
    else window.localStorage.removeItem(KEY_STORAGE);
  } catch {
    // storage unavailable; nothing else we can do
  }
}
