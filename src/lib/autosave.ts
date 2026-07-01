// Best-effort autosave of the live canvas so a reload restores work in progress.
// Raster-only (mirrors the original feature); vector strokes are not restored, so
// a restored drawing is visible and vision-drivable but not described as SVG text
// until the user draws again.

const AUTOSAVE_STORAGE_KEY = "drawassistant-autosave";
export const AUTOSAVE_DEBOUNCE_MS = 700;

export type AutosaveSnapshot = { imageDataUrl: string; background: string };

export function loadAutosave(): AutosaveSnapshot | null {
  try {
    const raw = window.localStorage.getItem(AUTOSAVE_STORAGE_KEY);
    if (!raw) return null;
    const record = JSON.parse(raw) as Record<string, unknown> | null;
    if (!record || typeof record.imageDataUrl !== "string") return null;
    return {
      imageDataUrl: record.imageDataUrl,
      background: typeof record.background === "string" ? record.background : "#fff8e8",
    };
  } catch {
    return null;
  }
}

export function saveAutosave(snapshot: AutosaveSnapshot): void {
  try {
    window.localStorage.setItem(AUTOSAVE_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // best-effort; explicit saves would surface quota failures
  }
}
