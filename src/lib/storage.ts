import type { MatchState, VocabularyWord } from "@/types/game";
import type { MatchMode } from "@/types/game";
import { normalizeClassFolders, type ClassFolder } from "@/lib/classroom-folders";
import { ILLUSTRATION_STYLE_VERSION, isGeneratedIllustration, normalizeImportedWordImage, PENDING_WORD_IMAGE } from "@/lib/illustration";

const CURRENT_MATCH_KEY = "vocabulary-builder.current-match";
const HISTORY_KEY = "vocabulary-builder.match-history";
const SETTINGS_KEY = "vocabulary-builder.settings";
const CUSTOM_WORDS_KEY = "vocabulary-builder.custom-words";
const CLASS_FOLDERS_KEY = "vocabulary-builder.class-folders";

export interface SavedSettings { mode: MatchMode; names: string[]; }

function normalizeStoredWord(word: VocabularyWord): VocabularyWord {
  const legacy = word.word.match(/^\s*([^,\uFF0C;]+?)\s*[,\uFF0C;]\s*(.*?)\s*[,\uFF0C;]\s*(L[123])\s*$/i);
  const normalized = legacy ? {
    ...word,
    word: legacy[1].trim(),
    chinese: word.chinese || legacy[2].trim(),
    level: legacy[3].toUpperCase() as VocabularyWord["level"],
    fallbackStructure: legacy[1].trim().replace(/^(.)/, (letter) => letter.toUpperCase()),
    image: normalizeImportedWordImage(word.image),
  } : { ...word, image: normalizeImportedWordImage(word.image) };
  if (isGeneratedIllustration(normalized.image) && normalized.illustrationVersion !== ILLUSTRATION_STYLE_VERSION) {
    return { ...normalized, image: PENDING_WORD_IMAGE, illustrationVersion: undefined };
  }
  return normalized;
}

export function loadCustomWords(): VocabularyWord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CUSTOM_WORDS_KEY);
    const parsed = raw ? JSON.parse(raw) as VocabularyWord[] : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeStoredWord);
  } catch { return []; }
}

export function saveCustomWords(words: VocabularyWord[]) {
  if (typeof window !== "undefined") window.localStorage.setItem(CUSTOM_WORDS_KEY, JSON.stringify(words));
}

export function loadClassFolders(): ClassFolder[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CLASS_FOLDERS_KEY);
    return normalizeClassFolders(raw ? JSON.parse(raw) : []);
  } catch { return []; }
}

export function saveClassFolders(folders: ClassFolder[]) {
  if (typeof window !== "undefined") window.localStorage.setItem(CLASS_FOLDERS_KEY, JSON.stringify(folders));
}

export function loadSettings(): SavedSettings | null {
  if (typeof window === "undefined") return null;
  try { const raw = window.localStorage.getItem(SETTINGS_KEY); return raw ? JSON.parse(raw) as SavedSettings : null; } catch { return null; }
}

export function saveSettings(settings: SavedSettings) {
  if (typeof window !== "undefined") window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function loadMatch(): MatchState | null {
  if (typeof window === "undefined") return null;
  try { const raw = window.localStorage.getItem(CURRENT_MATCH_KEY); return raw ? JSON.parse(raw) as MatchState : null; } catch { return null; }
}

export function saveMatch(state: MatchState) {
  if (typeof window !== "undefined") window.localStorage.setItem(CURRENT_MATCH_KEY, JSON.stringify(state));
}

export function clearMatch() {
  if (typeof window !== "undefined") window.localStorage.removeItem(CURRENT_MATCH_KEY);
}

export function saveHistory(state: MatchState) {
  if (typeof window === "undefined") return;
  try {
    const history = JSON.parse(window.localStorage.getItem(HISTORY_KEY) || "[]") as MatchState[];
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify([state, ...history].slice(0, 10)));
  } catch { /* Storage is optional; the match remains playable. */ }
}
