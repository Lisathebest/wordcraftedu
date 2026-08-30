import type { MatchState, VocabularyWord } from "@/types/game";
import type { MatchMode } from "@/types/game";

const CURRENT_MATCH_KEY = "vocabulary-builder.current-match";
const HISTORY_KEY = "vocabulary-builder.match-history";
const SETTINGS_KEY = "vocabulary-builder.settings";
const CUSTOM_WORDS_KEY = "vocabulary-builder.custom-words";

export interface SavedSettings { mode: MatchMode; names: string[]; }

export function loadCustomWords(): VocabularyWord[] {
  if (typeof window === "undefined") return [];
  try { const raw = window.localStorage.getItem(CUSTOM_WORDS_KEY); return raw ? JSON.parse(raw) as VocabularyWord[] : []; } catch { return []; }
}

export function saveCustomWords(words: VocabularyWord[]) {
  if (typeof window !== "undefined") window.localStorage.setItem(CUSTOM_WORDS_KEY, JSON.stringify(words));
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
