import type { Level, VocabularyWord } from "@/types/game";

export const CLASS_FOLDER_EXPORT_VERSION = 1;
const MAX_FOLDER_NAME_LENGTH = 80;
const MAX_FOLDERS = 40;
const MAX_WORDS_PER_FOLDER = 120;

export interface ClassFolder {
  id: string;
  name: string;
  words: VocabularyWord[];
  createdAt: number;
  updatedAt: number;
}

type FolderExport = {
  version: number;
  name: string;
  words: unknown[];
  createdAt?: number;
  updatedAt?: number;
};

/** Normalize persisted folders so a malformed local file cannot break the teacher view. */
export function normalizeClassFolders(value: unknown): ClassFolder[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.slice(0, MAX_FOLDERS).flatMap((item, index) => {
    const folder = normalizeFolder(item, index);
    if (!folder || seen.has(folder.id)) return [];
    seen.add(folder.id);
    return [folder];
  });
}

export function makeClassFolder(name: string, words: VocabularyWord[], now = Date.now(), existingIds: readonly string[] = []): ClassFolder | null {
  const cleanName = cleanText(name, MAX_FOLDER_NAME_LENGTH);
  if (!cleanName) return null;
  const base = `class-${slugify(cleanName) || "folder"}`;
  const occupied = new Set(existingIds);
  let id = base;
  let suffix = 2;
  while (occupied.has(id)) id = `${base}-${suffix++}`;
  return { id, name: cleanName, words: cloneWords(words), createdAt: now, updatedAt: now };
}

export function updateClassFolder(folder: ClassFolder, name: string, words: VocabularyWord[], now = Date.now()): ClassFolder {
  return { ...folder, name: cleanText(name, MAX_FOLDER_NAME_LENGTH) || folder.name, words: cloneWords(words), updatedAt: now };
}

export function removeClassFolder(folders: ClassFolder[], folderId: string): ClassFolder[] {
  return folders.filter((folder) => folder.id !== folderId);
}

/** Export one class folder as a portable JSON file. API keys are never included. */
export function serializeClassFolder(folder: ClassFolder) {
  return JSON.stringify({
    version: CLASS_FOLDER_EXPORT_VERSION,
    name: folder.name,
    createdAt: folder.createdAt,
    updatedAt: folder.updatedAt,
    words: cloneWords(folder.words),
  }, null, 2);
}

export function serializeClassFolderCsv(folder: ClassFolder) {
  const rows = [["word", "translation", "level", "image"], ...folder.words.slice(0, MAX_WORDS_PER_FOLDER).map((word) => [word.word, word.chinese, word.level, word.image])];
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

export function parseClassFolderExport(raw: string, now = Date.now(), existingIds: readonly string[] = []): ClassFolder | null {
  try {
    const parsed = JSON.parse(raw) as FolderExport;
    if (!parsed || parsed.version !== CLASS_FOLDER_EXPORT_VERSION || !Array.isArray(parsed.words)) return null;
    const folder = makeClassFolder(parsed.name, normalizeWords(parsed.words), now, existingIds);
    if (!folder) return null;
    return {
      ...folder,
      createdAt: finiteTimestamp(parsed.createdAt, now),
      updatedAt: finiteTimestamp(parsed.updatedAt, now),
    };
  } catch {
    return null;
  }
}

function normalizeFolder(value: unknown, index: number): ClassFolder | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const name = cleanText(raw.name, MAX_FOLDER_NAME_LENGTH);
  const id = cleanId(raw.id) || `class-folder-${index + 1}`;
  const words = Array.isArray(raw.words) ? normalizeWords(raw.words) : [];
  if (!name) return null;
  const now = Date.now();
  return {
    id,
    name,
    words,
    createdAt: finiteTimestamp(raw.createdAt, now),
    updatedAt: finiteTimestamp(raw.updatedAt, now),
  };
}

function normalizeWords(value: unknown[]) {
  const seen = new Set<string>();
  return value.slice(0, MAX_WORDS_PER_FOLDER).flatMap((item, index) => {
    const word = normalizeWord(item, index);
    if (!word || seen.has(word.id)) return [];
    seen.add(word.id);
    return [word];
  });
}

function normalizeWord(value: unknown, index: number): VocabularyWord | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const word = cleanText(raw.word, 80);
  if (!word) return null;
  const id = cleanId(raw.id) || `custom-${slugify(word) || `word-${index + 1}`}`;
  const level = isLevel(raw.level) ? raw.level : "L1";
  const chinese = cleanText(raw.chinese, 120);
  const collocations = Array.isArray(raw.collocations) ? raw.collocations.filter((item): item is string => typeof item === "string").map((item) => cleanText(item, 120)).filter(Boolean).slice(0, 3) : [];
  while (collocations.length < 3) collocations.push(collocations.length === 0 ? word : collocations.length === 1 ? `use ${word}` : `learn ${word}`);
  const image = typeof raw.image === "string" ? raw.image.slice(0, 600_000) : "";
  return {
    id,
    number: finiteTimestamp(raw.number, 1000 + index),
    word,
    level,
    chinese,
    collocations: collocations as [string, string, string],
    image,
    ...(typeof raw.illustrationVersion === "number" ? { illustrationVersion: raw.illustrationVersion } : {}),
    pronunciation: cleanText(raw.pronunciation, 120) || `/${word}/`,
    fallbackStructure: cleanText(raw.fallbackStructure, 120) || word.replace(/^(.)/, (letter) => letter.toUpperCase()),
  };
}

function cloneWords(words: VocabularyWord[]) {
  return words.slice(0, MAX_WORDS_PER_FOLDER).map((word) => ({ ...word, collocations: [...word.collocations] as [string, string, string] }));
}

function isLevel(value: unknown): value is Level {
  return value === "L1" || value === "L2" || value === "L3";
}

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().replace(/[\r\n]/g, " ").slice(0, maxLength) : "";
}

function cleanId(value: unknown) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,80}$/i.test(value) ? value : "";
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 42);
}

function finiteTimestamp(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function csvCell(value: string) {
  const clean = value.replace(/[\r\n]/g, " ");
  return /[",]/.test(clean) ? `"${clean.replace(/"/g, '""')}"` : clean;
}
