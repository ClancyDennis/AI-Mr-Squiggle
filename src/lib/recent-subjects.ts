// Rolling memory of what the squiggle recently became, so the small on-device
// model doesn't reveal a whale every session. Stored per device in localStorage.
const RECENT_SUBJECTS_STORAGE_KEY = "drawassistant-recent-subjects";
const RECENT_SUBJECTS_LIMIT = 10;

export function loadRecentSubjects(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_SUBJECTS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
  } catch {
    return [];
  }
}

export function rememberSubject(subject: string) {
  const trimmed = subject.trim();
  if (!trimmed) return;

  try {
    const next = [trimmed, ...loadRecentSubjects().filter((item) => !subjectsOverlap(item, trimmed))].slice(
      0,
      RECENT_SUBJECTS_LIMIT,
    );
    window.localStorage.setItem(RECENT_SUBJECTS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable (private mode, quota) — repetition guard just degrades.
  }
}

// "a leaping cat" and "cat" should count as the same subject.
export function subjectsOverlap(a: string, b: string): boolean {
  const wordsA = subjectWords(a);
  const wordsB = subjectWords(b);
  return wordsA.some((word) => wordsB.includes(word));
}

const FILLER_WORDS = new Set(["a", "an", "the", "of", "with", "and", "very", "big", "small", "little", "tiny", "huge"]);

function subjectWords(subject: string): string[] {
  return subject
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => word.length > 2 && !FILLER_WORDS.has(word));
}
