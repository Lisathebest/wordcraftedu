import type { Level, VocabularyWord } from "@/types/game";

export type ClassroomLearnerLevel = "starter" | "developing" | "stretch" | "mixed";
export type ClassroomWordFocus = "everyday" | "school" | "community" | "travel" | "mixed";

export interface SharedVocabularyWord {
  id: string;
  word: string;
  chinese: string;
  level: Level;
  image: string;
}

export interface ClassroomLinkPayload {
  learnerLevel: ClassroomLearnerLevel;
  wordFocus: ClassroomWordFocus;
  durationMinutes: number;
  customWords: SharedVocabularyWord[];
}

const MAX_LINK_LENGTH = 32_000;
const MAX_SHARED_WORDS = 80;

/** Keep the share payload small; local and remote artwork is safe, data-URI images stay out of URLs. */
export function compactSharedWords(words: VocabularyWord[]): SharedVocabularyWord[] {
  return words.slice(0, MAX_SHARED_WORDS).map((word) => ({
    id: word.id,
    word: word.word,
    chinese: word.chinese,
    level: word.level,
    image: compactImage(word.image),
  }));
}

export function createClassroomLink(origin: string, payload: ClassroomLinkPayload) {
  const sharedWords = payload.customWords.slice(0, MAX_SHARED_WORDS).map((word) => ({
    ...word,
    image: compactImage(word.image),
  }));
  const compact = {
    v: 1,
    l: payload.learnerLevel,
    f: payload.wordFocus,
    d: payload.durationMinutes,
    w: sharedWords.map((word) => ({
      i: word.id,
      w: word.word,
      c: word.chinese,
      l: word.level,
      m: word.image,
    })),
  };
  const encoded = toBase64Url(JSON.stringify(compact));
  return `${origin.replace(/\/$/, "")}/?classroom=${encoded}`;
}

export function readClassroomLink(value: string): ClassroomLinkPayload | null {
  if (typeof value !== "string" || value.trim().length > MAX_LINK_LENGTH) return null;
  let encoded = "";
  try {
    const url = new URL(value.trim(), "https://wordcraft-classroom.invalid");
    encoded = url.searchParams.get("classroom") || "";
  } catch {
    return null;
  }
  if (!encoded) return null;

  try {
    const parsed = JSON.parse(fromBase64Url(encoded)) as Record<string, unknown>;
    if (parsed.v !== 1) return null;
    const learnerLevel = parsed.l;
    const wordFocus = parsed.f;
    const durationMinutes = Number(parsed.d);
    if (!isLearnerLevel(learnerLevel) || !isWordFocus(wordFocus) || ![5, 8, 12, 15].includes(durationMinutes)) return null;
    const customWords = Array.isArray(parsed.w) ? parsed.w.slice(0, MAX_SHARED_WORDS).flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const raw = item as Record<string, unknown>;
      const word = cleanText(raw.w, 80);
      if (!word) return [];
      const id = cleanId(raw.i) || `custom-${slugify(word)}`;
      const chinese = cleanText(raw.c, 120);
      const level = isLevel(raw.l) ? raw.l : "L1";
      const image = cleanImage(raw.m);
      return [{ id, word, chinese, level, image }];
    }) : [];
    return { learnerLevel, wordFocus, durationMinutes, customWords };
  } catch {
    return null;
  }
}

/** Rebuild the full local vocabulary shape from the compact share payload. */
export function hydrateSharedWords(words: SharedVocabularyWord[]): VocabularyWord[] {
  return words.map((word, index) => ({
    id: word.id,
    number: 1000 + index,
    word: word.word,
    level: word.level,
    chinese: word.chinese,
    collocations: [word.word, `use ${word.word}`, `learn ${word.word}`],
    image: word.image || "/illustration-studio/pending-word.svg",
    pronunciation: `/${word.word}/`,
    fallbackStructure: word.word.replace(/^(.)/, (letter) => letter.toUpperCase()),
  }));
}

function isLearnerLevel(value: unknown): value is ClassroomLearnerLevel {
  return value === "starter" || value === "developing" || value === "stretch" || value === "mixed";
}

function isWordFocus(value: unknown): value is ClassroomWordFocus {
  return value === "everyday" || value === "school" || value === "community" || value === "travel" || value === "mixed";
}

function isLevel(value: unknown): value is Level {
  return value === "L1" || value === "L2" || value === "L3";
}

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().replace(/[\r\n]/g, " ").slice(0, maxLength) : "";
}

function cleanId(value: unknown) {
  // Preserve both bundled word IDs (for example `cafeteria`) and teacher
  // IDs (`custom-my-word`) so linked class folders keep their recipes and
  // artwork when a student opens the shared URL.
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/i.test(value) ? value : "";
}

function cleanImage(value: unknown) {
  if (typeof value !== "string" || value.length > 600) return "";
  return /^(?:https?:\/\/|\/)/i.test(value) ? value : "";
}

function compactImage(value: string) {
  return /^(?:https?:\/\/|\/)\S*/i.test(value) && value.length <= 600 ? value : "";
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 42) || "word";
}

function toBase64Url(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(normalized);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
