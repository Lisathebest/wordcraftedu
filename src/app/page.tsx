"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { fullVocabulary, registerVocabularyWords, vocabularyById } from "@/data/content";
import { chineseVocabulary } from "@/data/chinese-vocabulary";
import { makeClassFolder, parseClassFolderExport, removeClassFolder, serializeClassFolder, serializeClassFolderCsv, updateClassFolder, type ClassFolder } from "@/lib/classroom-folders";
import { evaluateFast, evaluateRules, evaluationCacheKey } from "@/lib/evaluation";
import { applyEvaluation, createMatch, notePronunciation, recordGrammarMistake, summarize, tick } from "@/lib/game-engine";
import { createClassroomLink, hydrateSharedWords, readClassroomLink, type ClassroomLearnerLevel, type ClassroomWordFocus } from "@/lib/classroom-link";
import { ILLUSTRATION_STYLE_VERSION, isGeneratedIllustration, PENDING_WORD_IMAGE } from "@/lib/illustration";
import { clearMatch, loadClassFolders, loadCustomWords, loadHideImagesUntilClick, loadMatch, loadSettings, saveClassFolders, saveCustomWords, saveHideImagesUntilClick, saveHistory, saveMatch, saveSettings } from "@/lib/storage";
import type { EvaluationResult, InputMethod, LanguageCheckMode, Level, MatchMode, MatchState, VocabularyWord } from "@/types/game";
import { BingoBoard } from "@/app/bingo-board";
import { FeedbackPanel } from "@/app/feedback-panel";
import { WordImagePreview } from "@/app/word-image-preview";

type Phase = "setup" | "playing" | "finished";
type SentenceCheckMode = "auto" | "table";
type LearnerLevel = ClassroomLearnerLevel;
type WordFocus = ClassroomWordFocus;
type SpeechResultLike = ArrayLike<{ transcript: string; confidence?: number }> & { isFinal?: boolean };
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: { results: ArrayLike<SpeechResultLike>; resultIndex?: number }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

const CACHE_PREFIX = "vocabulary-builder.evaluation.";
const ILLUSTRATION_REQUEST_TIMEOUT_MS = 195000;
const ILLUSTRATION_BATCH_CONCURRENCY = 3;
const ILLUSTRATION_ESTIMATE_MS = 60000;
const LEVEL_MAP: Record<LearnerLevel, Level[]> = { starter: ["L1"], developing: ["L1", "L2"], stretch: ["L2", "L3"], mixed: ["L1", "L2", "L3"] };
const FOCUS_WORD_IDS: Record<WordFocus, string[]> = {
  everyday: ["dumbbell", "treadmill", "kettle", "locker", "mat", "drawer", "shelf", "outlet", "bulb", "wardrobe", "pantry", "faucet", "countertop", "detergent", "cutlery", "napkin", "pastry", "beverage", "wallet", "receipt"],
  school: ["textbook", "assignment", "lecture", "syllabus", "workload", "tuition", "scholarship", "prerequisite", "plagiarism", "discipline", "adviser", "alumni", "auditorium", "cafeteria", "observatory", "committee"],
  community: ["commute", "intersection", "pedestrian", "pharmacy", "kiosk", "venue", "patron", "landlord", "dormitory", "maintenance", "extension", "souvenir", "luggage"],
  travel: ["luggage", "souvenir", "commute", "intersection", "pedestrian", "venue"],
  mixed: [],
};
const LEVEL_OPTIONS: { id: LearnerLevel; label: string; note: string }[] = [
  { id: "starter", label: "L1", note: "Foundational vocabulary" },
  { id: "developing", label: "L2", note: "Everyday + school vocabulary" },
  { id: "stretch", label: "L3", note: "More precise, academic vocabulary" },
  { id: "mixed", label: "Mix", note: "All levels mixed together" },
];
const FOCUS_OPTIONS: { id: WordFocus; label: string }[] = [
  { id: "mixed", label: "All topics" },
  { id: "school", label: "School & study" },
  { id: "community", label: "Campus life" },
  { id: "everyday", label: "Daily life" },
  { id: "travel", label: "Travel" },
];
const COMMON_VERBS_BY_WORD = new Map(chineseVocabulary.map((item) => [item.word.toLowerCase(), item.verbs] as const));

type IllustrationBatchState = {
  total: number;
  processed: number;
  completed: number;
  failed: string[];
  active: string[];
  startedAt: number;
  estimatedDoneAt: number;
};

function defaultLessonVocabulary(learnerLevel: LearnerLevel, wordFocus: WordFocus, minimumWords = 8) {
  const allowedLevels = LEVEL_MAP[learnerLevel];
  let words = fullVocabulary.filter((item) => allowedLevels.includes(item.level) && (wordFocus === "mixed" || FOCUS_WORD_IDS[wordFocus].includes(item.id)));
  if (words.length < minimumWords) words = fullVocabulary.filter((item) => allowedLevels.includes(item.level));
  return words;
}

function uniqueVocabularyWords(words: VocabularyWord[]) {
  const seen = new Set<string>();
  return words.filter((word) => {
    if (seen.has(word.id)) return false;
    seen.add(word.id);
    return true;
  });
}

function downloadFile(filename: string, contents: string, mimeType: string) {
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function randomMatchSeed() {
  return Math.floor(Math.random() * 233280);
}

function newSubmissionId() {
  return `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatBatchRemaining(estimatedDoneAt: number, now: number) {
  const remainingMs = estimatedDoneAt - now;
  if (remainingMs <= 30000) return "any moment";
  const minutes = Math.ceil(remainingMs / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}h${rest ? ` ${rest}m` : ""}`;
}

function formatBatchEstimate(total: number) {
  if (!total) return "—";
  const concurrency = Math.min(ILLUSTRATION_BATCH_CONCURRENCY, total);
  const batches = Math.ceil(total / concurrency);
  const minutes = Math.max(1, Math.ceil((batches * ILLUSTRATION_ESTIMATE_MS) / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}h${rest ? ` ${rest}m` : ""}`;
}

function formatBatchClock(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(timestamp);
}

export default function Home() {
  const [phase, setPhase] = useState<Phase>("setup");
  const [mode, setMode] = useState<MatchMode>("solo");
  const [names, setNames] = useState(["Maya", "Leo", "June", "Sam"]);
  const [learnerLevel, setLearnerLevel] = useState<LearnerLevel>("developing");
  const [wordFocus, setWordFocus] = useState<WordFocus>("mixed");
  const [durationMinutes, setDurationMinutes] = useState(8);
  const [languageCheckMode, setLanguageCheckMode] = useState<LanguageCheckMode>("fast");
  const [hideImagesUntilClick, setHideImagesUntilClick] = useState(false);
  const [customWords, setCustomWords] = useState<VocabularyWord[]>([]);
  const [illustrationBatch, setIllustrationBatch] = useState<IllustrationBatchState | null>(null);
  const [batchReminderArmed, setBatchReminderArmed] = useState(false);
  // Teacher-owned imports stay in `customWords`. Words received through a
  // classroom URL live only in this student-session state so they never leak
  // into the teacher's library or the starter/testing bank on this device.
  const [linkedClassWords, setLinkedClassWords] = useState<VocabularyWord[]>([]);
  const [classFolders, setClassFolders] = useState<ClassFolder[]>([]);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [selectedLibraryIds, setSelectedLibraryIds] = useState<string[]>([]);
  const [folderNameDraft, setFolderNameDraft] = useState("");
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryLevel, setLibraryLevel] = useState<Level | "all">("all");
  const [libraryTopic, setLibraryTopic] = useState<WordFocus | "all">("all");
  const [folderNotice, setFolderNotice] = useState<string | null>(null);
  const [studioDraft, setStudioDraft] = useState("");
  const [studioNotice, setStudioNotice] = useState<string | null>(null);
  const [generatingWordId, setGeneratingWordId] = useState<string | null>(null);
  const [studentLink, setStudentLink] = useState("");
  const [studentJoinNotice, setStudentJoinNotice] = useState<string | null>(null);
  const [studentJoined, setStudentJoined] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const folderFileInputRef = useRef<HTMLInputElement | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [match, setMatch] = useState<MatchState | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [sentence, setSentence] = useState("");
  const [inputMethod, setInputMethod] = useState<InputMethod>("text");
  const [revealedDefinitions, setRevealedDefinitions] = useState<Set<string>>(() => new Set());
  const [imagePreviewWord, setImagePreviewWord] = useState<VocabularyWord | null>(null);
  const [feedback, setFeedback] = useState<EvaluationResult | null>(null);
  const [feedbackSubmissionId, setFeedbackSubmissionId] = useState<string | null>(null);
  const [pendingReview, setPendingReview] = useState<{ result: EvaluationResult; sentence: string; targets: string[] } | null>(null);
  const [sentenceCheckMode, setSentenceCheckMode] = useState<SentenceCheckMode>("auto");
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<string | null>(null);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const voiceActive = useRef(false);
  const voiceFinalText = useRef("");
  const voiceInterimText = useRef("");
  const voiceRestartTimer = useRef<number | null>(null);
  const batchReminderArmedRef = useRef(false);
  const sentenceInputRef = useRef<HTMLTextAreaElement | null>(null);
  const definitionHoldTimer = useRef<number | null>(null);

  const selectMode = (nextMode: MatchMode) => {
    setMode(nextMode);
    if (nextMode !== "student") {
      setStudentJoined(false);
      setStudentJoinNotice(null);
    }
  };

  const applyClassroomLink = useCallback((rawLink: string) => {
    const payload = readClassroomLink(rawLink);
    if (!payload) {
      setStudentJoined(false);
      setStudentJoinNotice("That link is not a valid Wordcraft Classroom link. Ask your teacher to copy it again.");
      return false;
    }
    const linkedWords = hydrateSharedWords(payload.customWords);
    if (linkedWords.length) registerVocabularyWords(linkedWords);
    setLinkedClassWords(linkedWords);
    setActiveFolderId(null);
    setSelectedLibraryIds([]);
    setFolderNameDraft("");
    setLearnerLevel(payload.learnerLevel);
    setWordFocus(payload.wordFocus);
    setDurationMinutes(payload.durationMinutes);
    setLanguageCheckMode(payload.languageCheckMode);
    setMode("student");
    setStudentJoined(true);
    setStudentJoinNotice(linkedWords.length ? `${linkedWords.length} class words loaded. Add your name, then start.` : "Class settings loaded. Add your name, then start.");
    return true;
  }, []);

  const activePlayer = match?.players[match.activeSeat];
  const selectedLabels = selected.map((id) => vocabularyById[id]?.word).filter(Boolean).join(" + ");
  const selectionLimit = 4;
  const activeFolder = classFolders.find((folder) => folder.id === activeFolderId) || null;
  const libraryWords = useMemo(() => uniqueVocabularyWords([
    ...fullVocabulary,
    ...customWords,
    ...classFolders.flatMap((folder) => folder.words),
  ]), [customWords, classFolders]);
  const selectedFolderWords = libraryWords.filter((word) => selectedLibraryIds.includes(word.id));

  const stopVoice = useCallback(() => {
    voiceActive.current = false;
    if (voiceRestartTimer.current !== null) window.clearTimeout(voiceRestartTimer.current);
    voiceRestartTimer.current = null;
    try { recognition.current?.stop(); } catch { /* the browser may already have ended the session */ }
    setIsListening(false);
  }, []);

  useEffect(() => () => stopVoice(), [stopVoice]);

  const clearDefinitionHold = useCallback(() => {
    if (definitionHoldTimer.current !== null) window.clearTimeout(definitionHoldTimer.current);
    definitionHoldTimer.current = null;
  }, []);

  useEffect(() => () => clearDefinitionHold(), [clearDefinitionHold]);
  useEffect(() => setRevealedDefinitions(new Set()), [activePlayer?.id, match?.id]);

  useEffect(() => {
    const savedWords = loadCustomWords();
    if (savedWords.length) { registerVocabularyWords(savedWords); setCustomWords(savedWords); }
    const savedFolders = loadClassFolders();
    if (savedFolders.length) {
      registerVocabularyWords(savedFolders.flatMap((folder) => folder.words));
      setClassFolders(savedFolders);
      setActiveFolderId(savedFolders[0].id);
      setSelectedLibraryIds(savedFolders[0].words.map((word) => word.id));
      setFolderNameDraft(savedFolders[0].name);
    }
    const settings = loadSettings();
    if (settings) { setMode(settings.mode); setNames(settings.names.length ? settings.names : names); setLanguageCheckMode(settings.languageCheckMode === "ai" ? "ai" : "fast"); }
    setHideImagesUntilClick(loadHideImagesUntilClick());
    const restored = loadMatch();
    if (restored?.status === "playing" && restored.remainingSeconds > 0) { setMatch(restored); setPhase("playing"); }
    setStorageReady(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !window.location.search.includes("classroom=")) return;
    const incomingLink = window.location.href;
    setStudentLink(incomingLink);
    applyClassroomLink(incomingLink);
  }, [applyClassroomLink]);

  useEffect(() => { if (storageReady) saveCustomWords(customWords); }, [customWords, storageReady]);

  useEffect(() => { if (storageReady) saveSettings({ mode, names, languageCheckMode }); }, [mode, names, languageCheckMode, storageReady]);

  useEffect(() => { if (storageReady) saveClassFolders(classFolders); }, [classFolders, storageReady]);

  useEffect(() => {
    if (phase !== "playing" || !match || match.status !== "playing") return;
    const timer = window.setInterval(() => setMatch((current) => current ? tick(current, 1) : current), 1000);
    return () => window.clearInterval(timer);
  }, [phase, match?.status]);

  // A new round replaces the long setup page with the game view. Reset the
  // document scroll after that transition so learners land at the word shelf.
  useEffect(() => {
    if (phase === "playing") window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [phase]);

  useEffect(() => { if (match) saveMatch(match); }, [match]);

  useEffect(() => {
    if (!illustrationBatch) return;
    const previousTitle = document.title;
    document.title = `${illustrationBatch.processed}/${illustrationBatch.total} drawing · Wordcraft`;
    return () => { document.title = previousTitle; };
  }, [illustrationBatch]);

  useEffect(() => {
    if (match?.status === "finished" && phase === "playing") { saveHistory(match); setPhase("finished"); }
  }, [match, phase]);

  const importVocabulary = (raw: string) => {
    const parsed = parseImportedVocabulary(raw, [...fullVocabulary, ...customWords]);
    if (!parsed.length) { setStudioNotice("No new words found. Add one word per line, or use CSV with word, optional meaning/translation, and level columns."); return; }
    registerVocabularyWords(parsed);
    setCustomWords((current) => [...current, ...parsed]);
    setStudioDraft("");
    setStudioNotice(`${parsed.length} ${parsed.length === 1 ? "word is" : "words are"} ready. Generate an illustration for any word when you are ready.`);
  };

  const importFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => importVocabulary(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => setStudioNotice("That file could not be read. Try a UTF-8 CSV or TXT file.");
    reader.readAsText(file);
  };

  const selectClassFolder = (folderId: string) => {
    const folder = classFolders.find((item) => item.id === folderId);
    if (!folder) return;
    setActiveFolderId(folder.id);
    setSelectedLibraryIds(folder.words.map((word) => word.id));
    setFolderNameDraft(folder.name);
    setFolderNotice(`${folder.name} selected. Choose more words or save changes.`);
  };

  const startNewClassFolder = () => {
    setActiveFolderId(null);
    setSelectedLibraryIds([]);
    setFolderNameDraft("");
    setFolderNotice("Choose words below, name the class, then create its folder.");
  };

  const createClassFolder = () => {
    const folder = makeClassFolder(folderNameDraft, selectedFolderWords, Date.now(), classFolders.map((item) => item.id));
    if (!folder) {
      setFolderNotice("Give this class folder a name first.");
      return;
    }
    const next = [...classFolders, folder];
    setClassFolders(next);
    setActiveFolderId(folder.id);
    setSelectedLibraryIds(folder.words.map((word) => word.id));
    setFolderNameDraft(folder.name);
    setFolderNotice(`${folder.name} saved with ${folder.words.length} words.`);
  };

  const saveActiveClassFolder = () => {
    if (!activeFolder) return;
    const updated = updateClassFolder(activeFolder, folderNameDraft, selectedFolderWords);
    setClassFolders((current) => current.map((folder) => folder.id === updated.id ? updated : folder));
    setFolderNameDraft(updated.name);
    setFolderNotice(`${updated.name} updated with ${updated.words.length} words.`);
  };

  const deleteActiveClassFolder = () => {
    if (!activeFolder) return;
    const deleted = activeFolder;
    const importedWords = deleted.words.filter((word) => !fullVocabulary.some((builtIn) => builtIn.id === word.id));
    if (importedWords.length) setCustomWords((current) => uniqueVocabularyWords([...current, ...importedWords]));
    setClassFolders((current) => removeClassFolder(current, deleted.id));
    setActiveFolderId(null);
    setSelectedLibraryIds([]);
    setFolderNameDraft("");
    setShareUrl(null);
    setShareNotice(null);
    setFolderNotice(`${deleted.name} deleted. Imported words remain in My imported words.`);
  };

  const importClassFolder = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const imported = parseClassFolderExport(typeof reader.result === "string" ? reader.result : "", Date.now(), classFolders.map((item) => item.id));
      if (!imported) {
        setFolderNotice("That folder file could not be read. Choose a Wordcraft JSON export.");
        return;
      }
      registerVocabularyWords(imported.words);
      const importedTeacherWords = imported.words.filter((word) => !fullVocabulary.some((builtIn) => builtIn.id === word.id));
      if (importedTeacherWords.length) setCustomWords((current) => uniqueVocabularyWords([...current, ...importedTeacherWords]));
      setClassFolders((current) => [...current, imported]);
      setActiveFolderId(imported.id);
      setSelectedLibraryIds(imported.words.map((word) => word.id));
      setFolderNameDraft(imported.name);
      setFolderNotice(`${imported.name} imported with ${imported.words.length} words.`);
    };
    reader.onerror = () => setFolderNotice("That folder file could not be read. Try the JSON file exported here.");
    reader.readAsText(file);
  };

  const exportActiveClassFolder = (format: "json" | "csv") => {
    if (!activeFolder) return;
    const safeName = activeFolder.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "class-folder";
    const extension = format === "json" ? "json" : "csv";
    const contents = format === "json" ? serializeClassFolder(activeFolder) : serializeClassFolderCsv(activeFolder);
    downloadFile(`${safeName}.${extension}`, contents, format === "json" ? "application/json" : "text/csv;charset=utf-8");
    setFolderNotice(`${activeFolder.name} exported as ${extension.toUpperCase()}.`);
  };

  const createStudentLink = async () => {
    if (activeFolder && activeFolder.words.length < 4) {
      setFolderNotice("Add at least four words to this class folder before sharing it.");
      return;
    }
    const wordsToShare = activeFolder ? activeFolder.words : defaultLessonVocabulary(learnerLevel, wordFocus, mode === "local" ? 20 : 8);
    const link = createClassroomLink(window.location.origin, { learnerLevel, wordFocus, durationMinutes, languageCheckMode, customWords: wordsToShare });
    setShareUrl(link);
    try {
      await navigator.clipboard.writeText(link);
      setShareNotice("Student link copied. Send it to your class.");
    } catch {
      setShareNotice("Student link ready. Copy it from the box below.");
    }
  };

  const copyStudentLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareNotice("Student link copied. Send it to your class.");
    } catch {
      setShareNotice("Select the link and copy it manually.");
    }
  };

  const fetchIllustration = async (target: VocabularyWord) => {
    const response = await fetch("/api/generate-illustration", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ word: target.word, translation: target.chinese }), signal: AbortSignal.timeout(ILLUSTRATION_REQUEST_TIMEOUT_MS) });
    const payload = await response.json() as { image?: string; source?: string; message?: string };
    if (!response.ok || payload.source !== "ai" || !payload.image) throw new Error(payload.message || "No illustration returned");
    return { ...target, image: payload.image, illustrationVersion: ILLUSTRATION_STYLE_VERSION };
  };

  const saveIllustration = (updated: VocabularyWord) => {
    registerVocabularyWords([updated]);
    setCustomWords((current) => current.map((item) => item.id === updated.id ? updated : item));
    setClassFolders((current) => current.map((folder) => ({ ...folder, words: folder.words.map((item) => item.id === updated.id ? { ...item, image: updated.image, illustrationVersion: ILLUSTRATION_STYLE_VERSION } : item) })));
  };

  const requestBatchReminder = async () => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setStudioNotice("This browser cannot send desktop notifications. Keep this tab open and check the progress card here.");
      return;
    }
    try {
      const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      if (permission === "granted") {
        batchReminderArmedRef.current = true;
        setBatchReminderArmed(true);
        setStudioNotice("Reminder on. I’ll notify you when the batch is ready; completed images are saved as they arrive.");
      } else {
        setStudioNotice("Notifications are blocked. The progress card will keep showing the estimated finish time.");
      }
    } catch {
      setStudioNotice("Notifications are unavailable here. The progress card will keep showing the estimated finish time.");
    }
  };

  const notifyBatchComplete = (completed: number, failed: string[]) => {
    if (!batchReminderArmedRef.current || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    try {
      new Notification("Wordcraft illustrations ready", {
        body: failed.length ? `${completed} ready. ${failed.length} still need attention.` : `${completed} illustrations are ready for your next round.`,
        icon: "/wordcraft-logo.png",
      });
    } catch {
      // Some browsers allow permission but still block a notification in an embedded tab.
    }
  };

  const generateIllustration = async (wordId: string) => {
    const target = customWords.find((item) => item.id === wordId);
    if (!target || generatingWordId || illustrationBatch) return;
    setGeneratingWordId(wordId);
    setStudioNotice(`Drawing ${target.word}… This can take up to one minute.`);
    try {
      saveIllustration(await fetchIllustration(target));
      setStudioNotice(`${target.word} is illustrated and ready for your next round.`);
    } catch (error) {
      setStudioNotice(error instanceof DOMException && error.name === "TimeoutError"
        ? "The illustration timed out. Please try again."
        : error instanceof Error ? error.message : "The illustration could not be created.");
    } finally { setGeneratingWordId(null); }
  };

  const generateIllustrationBatch = async (wordIds?: string[]) => {
    if (generatingWordId || illustrationBatch) return;
    const selectedIds = wordIds ? new Set(wordIds) : null;
    const queue = customWords.filter((word) => selectedIds ? selectedIds.has(word.id) : !isGeneratedIllustration(word.image));
    if (!queue.length) {
      setStudioNotice(selectedIds ? "Choose at least one word to redraw." : "All your words already have illustrations.");
      return;
    }
    const isSelectedRedraw = selectedIds !== null;
    batchReminderArmedRef.current = false;
    setBatchReminderArmed(false);
    const failed: string[] = [];
    const failureDetails: string[] = [];
    const active = new Set<string>();
    let completed = 0;
    let nextIndex = 0;
    const startedAt = Date.now();
    const concurrency = Math.min(ILLUSTRATION_BATCH_CONCURRENCY, queue.length);
    const updateBatchProgress = () => {
      const processed = completed + failed.length;
      const elapsed = Date.now() - startedAt;
      const averagePerImage = processed ? Math.max(elapsed / processed, 15000) : ILLUSTRATION_ESTIMATE_MS;
      const remaining = queue.length - processed;
      const estimatedDoneAt = remaining ? Date.now() + Math.ceil(remaining / concurrency) * averagePerImage : Date.now();
      setIllustrationBatch({ total: queue.length, processed, completed, failed: [...failed], active: [...active], startedAt, estimatedDoneAt });
    };

    updateBatchProgress();
    setStudioNotice(isSelectedRedraw
      ? `Redrawing ${queue.length} selected ${queue.length === 1 ? "illustration" : "illustrations"}. Up to ${concurrency} at once.`
      : `Batch started: drawing up to ${concurrency} illustrations at once. You can switch tabs while it runs.`);

    const runWorker = async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= queue.length) return;
        const word = queue[index];
        active.add(word.id);
        updateBatchProgress();
        try {
          saveIllustration(await fetchIllustration(word));
          completed += 1;
        } catch (error) {
          failed.push(word.word);
          failureDetails.push(error instanceof Error ? error.message : "The illustration could not be created.");
        } finally {
          active.delete(word.id);
          updateBatchProgress();
        }
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => runWorker()));
    setIllustrationBatch(null);
    const remaining = queue.length - completed - failed.length;
    const detail = failureDetails[0] ? ` First issue: ${failureDetails[0]}` : "";
    setStudioNotice(failed.length
      ? `${completed} illustrated. ${failed.length} failed${remaining ? `, ${remaining} still waiting` : ""}. Retry the ${isSelectedRedraw ? "selected" : "missing"} art when you are ready.${detail}`
      : isSelectedRedraw
        ? `${completed} selected ${completed === 1 ? "illustration was" : "illustrations were"} redrawn and saved.`
        : `${completed} illustrations are ready for your next round.`);
    notifyBatchComplete(completed, failed);
    batchReminderArmedRef.current = false;
    setBatchReminderArmed(false);
  };

  const deleteCustomWord = (wordId: string) => {
    const word = customWords.find((item) => item.id === wordId);
    setCustomWords((current) => current.filter((item) => item.id !== wordId));
    if (word) setStudioNotice(`${word.word} removed from your imported set. Class folders keep their own copy.`);
  };

  const startMatch = () => {
    if (mode === "student" && !studentJoined) {
      setStudentJoinNotice("Paste your teacher's link first, then join the classroom.");
      return;
    }
    const playerNames = mode === "solo" || mode === "student" ? [names[0]] : names.filter(Boolean).slice(0, 4);
    const selectedSet = mode === "student" ? linkedClassWords : activeFolder?.words || [];
    const explicitSetSelected = mode === "student" || Boolean(activeFolder);
    let pool = explicitSetSelected
      ? [...new Set(selectedSet.map((item) => item.id))]
      : defaultLessonVocabulary(learnerLevel, wordFocus, mode === "local" ? 20 : 8).map((item) => item.id);
    if (explicitSetSelected && pool.length < 1) {
      const message = mode === "student" ? "This classroom link has no words yet. Ask your teacher to share a vocabulary set." : "Add at least one word to this class folder before starting a round.";
      if (mode === "student") setStudentJoinNotice(message);
      else setFolderNotice(message);
      return;
    }
    const next = createMatch(mode, playerNames.length ? playerNames : ["Builder"], randomMatchSeed(), pool, durationMinutes);
    stopVoice(); setVoiceStatus(null); setMatch(next); setPhase("playing"); setSelected([]); setSentence(""); setFeedback(null); setFeedbackSubmissionId(null); setPendingReview(null); setSentenceCheckMode("auto");
  };

  const finishMatch = () => { if (match) { stopVoice(); const finished = { ...match, status: "finished" as const, remainingSeconds: 0 }; saveHistory(finished); setMatch(finished); setPhase("finished"); } };

  const commitResult = (result: EvaluationResult, sentenceToCommit: string, targetsToCommit: string[], durationMs = 0) => {
    const submissionId = newSubmissionId();
    setFeedback(result);
    setFeedbackSubmissionId(submissionId);
    setMatch((current) => current ? applyEvaluation(current, sentenceToCommit, targetsToCommit, result, durationMs, submissionId) : current);
    setPendingReview(null);
    if (result.valid) {
      setSelected([]);
      setSentence("");
      setVoiceStatus(null);
    }
  };

  const evaluate = async () => {
    if (!match || !activePlayer || !selected.length || !sentence.trim() || isEvaluating) return;
    if (isListening) stopVoice();
    const request = { sentence, inputMethod, targetWords: selected.map((id) => vocabularyById[id]?.word || id), gradeBand: "7-9" as const };
    if (languageCheckMode === "fast") {
      commitResult(evaluateFast(request), sentence, selected);
      return;
    }
    const instant = evaluateRules(request);
    if (instant) {
      const submissionId = newSubmissionId();
      setFeedback(instant);
      setFeedbackSubmissionId(submissionId);
      setMatch((current) => current ? applyEvaluation(current, sentence, selected, instant, 0, submissionId) : current);
      return;
    }
    const key = `${CACHE_PREFIX}${evaluationCacheKey(request)}`;
    const cached = window.localStorage.getItem(key);
    if (cached) {
      const result = JSON.parse(cached) as EvaluationResult;
      if (result.source === "ai") {
        if (result.confidence < 0.7) { setFeedback(result); setFeedbackSubmissionId(null); setPendingReview({ result, sentence, targets: selected }); }
        else commitResult(result, sentence, selected);
        return;
      }
      // Rules-only fallbacks are transient. Remove the old cached result so a
      // newly repaired/configured AI provider gets another chance.
      window.localStorage.removeItem(key);
    }
    setIsEvaluating(true);
    const started = performance.now();
    try {
      const response = await fetch("/api/evaluate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
      const result = await response.json() as EvaluationResult;
      if (result.source === "ai") window.localStorage.setItem(key, JSON.stringify(result));
      if (result.provisional) { setFeedback(result); setFeedbackSubmissionId(null); setPendingReview({ result, sentence, targets: selected }); } else commitResult(result, sentence, selected, performance.now() - started);
    } catch {
      const result: EvaluationResult = { valid: true, confidence: .5, reason: "Saved as a provisional practice sentence while the evaluator reconnects.", correctedSentence: sentence, relationshipSummary: "Your target words appeared together.", source: "rules-fallback", provisional: true };
      setFeedback(result);
      setFeedbackSubmissionId(null);
      setPendingReview({ result, sentence, targets: selected });
    } finally { setIsEvaluating(false); }
  };

  const approveByTable = () => {
    if (!match || match.mode !== "local" || !activePlayer || !selected.length || !sentence.trim() || isEvaluating) return;
    if (isListening) stopVoice();
    const result: EvaluationResult = {
      valid: true,
      confidence: 1,
      reason: "Your tablemates approved this sentence. Nice work!",
      correctedSentence: sentence,
      relationshipSummary: "The group agreed that the selected words work together.",
      source: "rules",
      provisional: false,
    };
    commitResult(result, sentence, selected);
  };

  const countPendingPractice = () => { if (!pendingReview) return; commitResult({ ...pendingReview.result, valid: true, reason: `${pendingReview.result.reason} Counted as practice while the evaluator is unsure.` }, pendingReview.sentence, pendingReview.targets); };
  const retryPending = () => { setPendingReview(null); setFeedback(null); setFeedbackSubmissionId(null); };

  const speak = (word: string) => { if (typeof window !== "undefined" && "speechSynthesis" in window) { window.speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(word); utterance.rate = .78; window.speechSynthesis.speak(utterance); } setMatch((current) => current ? notePronunciation(current) : current); };

  const startDefinitionHold = (event: ReactPointerEvent<HTMLDivElement>, wordId: string) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    clearDefinitionHold();
    setRevealedDefinitions(new Set());
    definitionHoldTimer.current = window.setTimeout(() => {
      setRevealedDefinitions(new Set([wordId]));
      definitionHoldTimer.current = null;
    }, 550);
  };

  const endDefinitionHold = () => {
    clearDefinitionHold();
    setRevealedDefinitions(new Set());
  };

  const startVoice = () => {
    const SpeechRecognition = (window as Window & { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition || (window as Window & { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition;
    if (!SpeechRecognition) { setFeedback({ valid: false, confidence: 1, reason: "This browser does not provide speech recognition. Try Chrome or Safari, or type the sentence instead.", correctedSentence: "", relationshipSummary: "", source: "rules", provisional: false }); setFeedbackSubmissionId(null); return; }

    if (voiceActive.current) return;
    voiceActive.current = true;
    voiceFinalText.current = "";
    voiceInterimText.current = "";
    setFeedback(null);
    setFeedbackSubmissionId(null);
    setVoiceStatus("Listening… your words will appear in the sentence box.");
    setInputMethod("voice");

    // Some browsers stop SpeechRecognition after a short pause. Recreate the session
    // while the user is still in listening mode so a one-second stop does not discard
    // the sentence in progress.
    let startAttempt: () => void;
    startAttempt = () => {
      if (!voiceActive.current) return;
      const instance = new SpeechRecognition();
      recognition.current = instance;
      instance.lang = "en-US";
      // Single-utterance mode works in more browsers; onend immediately starts the
      // next utterance while preserving the transcript collected so far.
      instance.continuous = false;
      instance.interimResults = true;
      instance.maxAlternatives = 1;
      instance.onresult = (event) => {
        let interim = "";
        const startIndex = event.resultIndex || 0;
        for (let index = startIndex; index < event.results.length; index++) {
          const result = event.results[index];
          const transcript = result?.[0]?.transcript?.trim() || "";
          if (!transcript) continue;
          if (result?.isFinal) voiceFinalText.current = `${voiceFinalText.current} ${transcript}`.trim();
          else interim = `${interim} ${transcript}`.trim();
        }
        voiceInterimText.current = interim;
        const nextSentence = `${voiceFinalText.current} ${interim}`.trim();
        if (nextSentence) setSentence(nextSentence);
        setInputMethod("voice");
        setVoiceStatus("Sentence captured — keep speaking or tap to stop.");
      };
      instance.onerror = (event) => {
        const error = event.error;
        if (error === "not-allowed" || error === "service-not-allowed") {
          voiceActive.current = false;
          setIsListening(false);
          setVoiceStatus(null);
          setFeedback({ valid: false, confidence: 1, reason: "Microphone access is blocked. Allow microphone access for localhost:8000, then try again.", correctedSentence: "", relationshipSummary: "", source: "rules", provisional: false }); setFeedbackSubmissionId(null);
          return;
        }
        if (error === "audio-capture") {
          voiceActive.current = false;
          setIsListening(false);
          setVoiceStatus(null);
          setFeedback({ valid: false, confidence: 1, reason: "No microphone was found. Check your microphone and try again.", correctedSentence: "", relationshipSummary: "", source: "rules", provisional: false }); setFeedbackSubmissionId(null);
          return;
        }
        if (error === "network") {
          voiceActive.current = false;
          setIsListening(false);
          setVoiceStatus(null);
          setFeedback({ valid: false, confidence: 1, reason: "The browser's speech service is unavailable. Try Chrome or Safari on localhost:8000, or use typed input.", correctedSentence: voiceFinalText.current, relationshipSummary: "", source: "rules", provisional: false }); setFeedbackSubmissionId(null);
          return;
        }
        // no-speech and aborted are normal when a browser closes an idle recognition
        // session. onend will restart it while voiceActive remains true.
        if (voiceActive.current) setVoiceStatus("Still listening — say the whole sentence, then tap stop.");
      };
      instance.onend = () => {
        // Safari and embedded Chromium often end with only an interim result.
        // Keep that draft instead of making the learner start over.
        if (voiceInterimText.current) {
          voiceFinalText.current = `${voiceFinalText.current} ${voiceInterimText.current}`.trim();
          voiceInterimText.current = "";
          setSentence(voiceFinalText.current);
        }
        if (!voiceActive.current) { setIsListening(false); return; }
        setIsListening(true);
        setVoiceStatus("Reconnecting the microphone…");
        voiceRestartTimer.current = window.setTimeout(() => {
          voiceRestartTimer.current = null;
          if (!voiceActive.current) return;
          startAttempt();
        }, 120);
      };
      try {
        instance.start();
        setIsListening(true);
      } catch {
        voiceActive.current = false;
        setIsListening(false);
        setVoiceStatus(null);
        setFeedback({ valid: false, confidence: 1, reason: "Voice input could not start. Allow microphone access for localhost:8000 and try again.", correctedSentence: "", relationshipSummary: "", source: "rules", provisional: false }); setFeedbackSubmissionId(null);
      }
    };
    startAttempt();
  };

  if (phase === "setup") return <Setup mode={mode} setMode={selectMode} names={names} setNames={setNames} learnerLevel={learnerLevel} setLearnerLevel={setLearnerLevel} wordFocus={wordFocus} setWordFocus={setWordFocus} durationMinutes={durationMinutes} setDurationMinutes={setDurationMinutes} languageCheckMode={languageCheckMode} setLanguageCheckMode={setLanguageCheckMode} hideImagesUntilClick={hideImagesUntilClick} onHideImagesUntilClickChange={(hidden) => { setHideImagesUntilClick(hidden); saveHideImagesUntilClick(hidden); }} startMatch={startMatch} studentLink={studentLink} setStudentLink={(value) => { setStudentLink(value); setStudentJoined(false); setStudentJoinNotice(null); }} studentJoined={studentJoined} studentJoinNotice={studentJoinNotice} onJoinTeacherLink={() => applyClassroomLink(studentLink)} shareUrl={shareUrl} shareNotice={shareNotice} onCreateStudentLink={createStudentLink} onCopyStudentLink={copyStudentLink} customWords={customWords} linkedClassWords={linkedClassWords} classFolders={classFolders} activeFolder={activeFolder} selectedLibraryIds={selectedLibraryIds} folderNameDraft={folderNameDraft} setFolderNameDraft={setFolderNameDraft} libraryQuery={libraryQuery} setLibraryQuery={setLibraryQuery} libraryLevel={libraryLevel} setLibraryLevel={setLibraryLevel} libraryTopic={libraryTopic} setLibraryTopic={setLibraryTopic} folderNotice={folderNotice} folderFileInputRef={folderFileInputRef} libraryWords={libraryWords} onSelectFolder={selectClassFolder} onNewFolder={startNewClassFolder} onCreateFolder={createClassFolder} onSaveFolder={saveActiveClassFolder} onDeleteFolder={deleteActiveClassFolder} onToggleLibraryWord={(id) => setSelectedLibraryIds((current) => current.includes(id) ? current.filter((wordId) => wordId !== id) : [...current, id])} onSelectVisibleWords={(ids) => setSelectedLibraryIds((current) => [...new Set([...current, ...ids])])} onClearVisibleWords={(ids) => setSelectedLibraryIds((current) => current.filter((id) => !ids.includes(id)))} onImportFolder={importClassFolder} onExportFolder={exportActiveClassFolder} studioDraft={studioDraft} setStudioDraft={setStudioDraft} studioNotice={studioNotice} importInputRef={importInputRef} onImport={importVocabulary} onImportFile={importFile} onGenerate={generateIllustration} onGenerateBatch={generateIllustrationBatch} onRequestBatchReminder={requestBatchReminder} batchReminderArmed={batchReminderArmed} onDelete={deleteCustomWord} generatingWordId={generatingWordId} illustrationBatch={illustrationBatch} />;
  if (phase === "finished" && match) return <Summary match={match} restart={() => { clearMatch(); setPhase("setup"); setMatch(null); }} />;
  if (!match || !activePlayer) return null;

  const currentAttempt = feedbackSubmissionId ? match.submissions.find((submission) => submission.id === feedbackSubmissionId) : null;

  return <><main className="app-shell"><Header /><div className="content">
    <div className="game-top"><div className="game-title"><div className="eyebrow">{match.mode === "student" ? "Student table" : match.mode === "solo" ? "Individual practice" : "Team rotation"}</div><h2>{activePlayer.name}'s turn</h2></div><div className={`timer ${match.remainingSeconds < 90 ? "warning" : ""}`}><span className="timer-dot" />{formatTime(match.remainingSeconds)}</div><button className="btn btn-ghost" onClick={finishMatch}>End round</button></div>
    {match.mode === "local" && <div className="player-tabs">{match.players.map((player, index) => <button key={player.id} className={`player-tab ${index === match.activeSeat ? "active" : ""}`} onClick={() => { stopVoice(); setVoiceStatus(null); setSelected([]); setSentence(""); setFeedback(null); setFeedbackSubmissionId(null); setPendingReview(null); setSentenceCheckMode("auto"); setMatch({ ...match, activeSeat: index }); }}>{player.name} · {player.bingo.bingos} Bingo</button>)}</div>}
    <div className="game-grid"><section className="panel workspace"><div className="workspace-head"><div><div className="eyebrow">Your word shelf</div><h3>Choose your words</h3><div className="subtle">Choose words and use them in a complete English sentence to light the matching squares. Press and hold to reveal a meaning; double-click to view a hidden picture.</div><div className="bingo-speed-tip"><span aria-hidden="true">⚡</span><p>Want to get Bingo faster? Use as many selected words as you can in one correct sentence to clear more words from your shelf and light multiple squares at once.</p></div></div><span className="pill">{selected.length}/{selectionLimit} selected</span></div>
      {!activePlayer.hand.length && <div className="hand-empty">No words left on your shelf. Your Bingo board shows the words you used this round.</div>}
      <div className="hand">{activePlayer.hand.map((id) => {
        const item = vocabularyById[id];
        const commonVerbs = COMMON_VERBS_BY_WORD.get(item.word.toLowerCase());
        const usefulCollocations = item.collocations.filter((phrase) => phrase.toLowerCase() !== item.word.toLowerCase() && !/^(use|learn)\s+/i.test(phrase));
        const familiarity = activePlayer.familiarity[id] || 0;
        const definitionRevealed = revealedDefinitions.has(id);
        const toggle = () => setSelected((current) => current.includes(id) ? current.filter((word) => word !== id) : current.length < selectionLimit ? [...current, id] : current);
        return <div key={id} className={`word-card ${selected.includes(id) ? "selected" : ""}`} role="button" tabIndex={0}
          aria-label={`${item.word}. ${hideImagesUntilClick ? "Picture hidden. Double-click to view picture. " : ""}${definitionRevealed ? `${item.chinese}, ${item.level}` : "Meaning hidden. Press and hold to reveal."}`}
          onClick={(event) => { if (hideImagesUntilClick && event.detail > 1) return; toggle(); }}
          onDoubleClick={() => { if (hideImagesUntilClick) setImagePreviewWord(item); }}
          onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(); } }}
          onPointerDown={(event) => startDefinitionHold(event, id)} onPointerUp={endDefinitionHold} onPointerCancel={endDefinitionHold} onPointerLeave={endDefinitionHold} onContextMenu={(event) => event.preventDefault()}>
          <button className="speak" title={`Hear ${item.word}`} onClick={(event) => { event.stopPropagation(); speak(item.word); }} onDoubleClick={(event) => event.stopPropagation()}>🔊</button>
          {hideImagesUntilClick ? <span className="word-image-hidden" aria-hidden="true">▧</span> : <img src={item.image} alt=""/>}
          <b>{item.word}</b>
          <small className={`word-definition ${definitionRevealed ? "revealed" : "hidden"}`}>{definitionRevealed ? `${item.chinese} · ${item.level}` : "Press and hold to reveal"}</small>
          <span className="familiarity" aria-label={`${familiarity} familiarity`}>{[0,1,2,3,4].map((dot) => <i key={dot} className={dot < Math.min(5, familiarity) ? "on" : ""} />)}</span>
          {commonVerbs && <details className="word-card-hints" onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onPointerUp={(event) => event.stopPropagation()}><summary>Common verbs</summary><p>{commonVerbs.join(" · ")}</p></details>}
          {usefulCollocations.length > 0 && <details className="word-card-hints word-card-collocations" onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onPointerUp={(event) => event.stopPropagation()}><summary>Common collocations</summary><p>{usefulCollocations.join(" · ")}</p></details>}
        </div>;
      })}</div>
      <div className="sentence-area">
        <div className="sentence-heading-row"><div><div className="eyebrow">Make it meaningful</div><p className="subtle">Use <strong>{selectedLabels || "your selected words"}</strong> in a complete English sentence.</p></div><span className={`lesson-check-pill ${sentenceCheckMode === "table" ? "table" : languageCheckMode}`}>{sentenceCheckMode === "table" ? "✓ Table approval" : languageCheckMode === "ai" ? "✦ AI Language Check" : "⚡ Fast Check"}</span></div>
        <textarea ref={sentenceInputRef} className="sentence-box" value={sentence} onChange={(event) => { setSentence(event.target.value); setInputMethod("text"); setVoiceStatus(null); }} placeholder="Example: I bought a pastry, a cold beverage, and a textbook at the cafeteria." />
        {inputMethod === "voice" && <p className="voice-hint">Voice → text writes the transcript into this box. You can edit it before submitting.</p>}
        {match.mode === "local" && <div className="check-mode" role="group" aria-label="Choose who checks the sentence"><div className="check-mode-heading"><span className="eyebrow">Team check</span><small>Choose how this table approves the sentence.</small></div><div className="check-mode-options"><button type="button" className={`check-mode-option ${sentenceCheckMode === "auto" ? "active" : ""}`} aria-pressed={sentenceCheckMode === "auto"} disabled={isEvaluating} onClick={() => setSentenceCheckMode("auto")}><span>{languageCheckMode === "ai" ? "✦ AI check" : "⚡ Fast check"}</span><small>{languageCheckMode === "ai" ? "Grammar + meaning review" : "Instant structure check"}</small></button><button type="button" className={`check-mode-option ${sentenceCheckMode === "table" ? "active" : ""}`} aria-pressed={sentenceCheckMode === "table"} disabled={isEvaluating} onClick={() => setSentenceCheckMode("table")}><span>✓ Table approves</span><small>Friends decide together</small></button></div>{sentenceCheckMode === "table" && <p className="check-mode-note">Everyone at the table agrees this sentence works, then pass it together.</p>}</div>}
        <div className="action-row"><button className="btn btn-primary" disabled={!selected.length || !sentence.trim() || isEvaluating} onClick={sentenceCheckMode === "table" ? approveByTable : evaluate}>{isEvaluating ? "AI checking · ~25 sec…" : sentenceCheckMode === "table" ? "Pass with table approval" : selected.length > 1 ? `Use ${selected.length} words` : "Use this word"}</button><button className={`btn ${isListening ? "btn-coral" : "btn-mint"}`} aria-pressed={isListening} onClick={isListening ? stopVoice : startVoice}>{isListening ? "Listening… tap to stop" : "🎙 Voice → text"}</button><span className="microcopy">{voiceStatus || (inputMethod === "voice" ? "Voice transcript ready" : "Text input")} · select up to {selectionLimit} words</span></div>
        {isEvaluating && <div className="ai-wait" role="status" aria-live="polite"><span className="ai-wait-spinner" aria-hidden="true"/><div><strong>AI Language Check is reading the whole sentence.</strong><small>This usually takes about 25 seconds. Keep this page open.</small></div></div>}
        {feedback && <div className={`feedback ${feedback.valid ? "" : "bad"}`}><strong>{feedback.valid ? "✨ That works" : "Not quite yet"}</strong><p>{feedback.reason}</p>{!feedback.valid && !pendingReview && currentAttempt && <div className="grammar-mistake-row"><button className="btn btn-ghost" disabled={Boolean(currentAttempt.grammarMistake)} onClick={() => setMatch((current) => current ? recordGrammarMistake(current, currentAttempt.id) : current)}>{currentAttempt.grammarMistake ? "✓ Grammar mistake recorded" : "＋ Record grammar mistake"}</button><span>Type it again above when you are ready.</span></div>}{feedback.relationshipSummary && <p className="subtle">{feedback.relationshipSummary}</p>}{feedback.provisional && <div className="provisional">Could not complete the AI check · count it as practice or edit and retry.</div>}{pendingReview && <div className="action-row"><button className="btn btn-mint" onClick={countPendingPractice}>Count as practice</button><button className="btn btn-ghost" onClick={retryPending}>Edit and retry</button></div>}</div>}
      </div>
    </section><aside className="side-stack"><BingoBoard progress={activePlayer.bingo} words={[...new Set([...match.players.flatMap((player) => player.hand), ...match.drawPile])].map((id) => vocabularyById[id]).filter((word): word is VocabularyWord => Boolean(word))} /></aside></div>
  </div><div className="footer-note">Wordcraft Classroom · meaningful vocabulary practice at your learners’ level</div></main>{hideImagesUntilClick && imagePreviewWord && <WordImagePreview item={imagePreviewWord} language="en" onClose={() => setImagePreviewWord(null)} />}</>;
}

function Header() { return <header className="topbar"><a className="brand" href="/" aria-label="Wordcraft Classroom home"><span className="brand-logo-frame"><img className="brand-logo" src="/wordcraft-logo-transparent.png" alt="Wordcraft Classroom" /></span></a><div className="topbar-tools"><span className="pill">For teachers &amp; active students</span><nav className="language-switch" aria-label="Language switch"><span aria-current="page">English</span><a href="/zh">中文</a></nav></div></header>; }

type SetupProps = {
  mode: MatchMode;
  setMode: (mode: MatchMode) => void;
  names: string[];
  setNames: (names: string[]) => void;
  learnerLevel: LearnerLevel;
  setLearnerLevel: (level: LearnerLevel) => void;
  wordFocus: WordFocus;
  setWordFocus: (focus: WordFocus) => void;
  durationMinutes: number;
  setDurationMinutes: (minutes: number) => void;
  languageCheckMode: LanguageCheckMode;
  setLanguageCheckMode: (mode: LanguageCheckMode) => void;
  hideImagesUntilClick: boolean;
  onHideImagesUntilClickChange: (hidden: boolean) => void;
  startMatch: () => void;
  studentLink: string;
  setStudentLink: (value: string) => void;
  studentJoined: boolean;
  studentJoinNotice: string | null;
  onJoinTeacherLink: () => void;
  shareUrl: string | null;
  shareNotice: string | null;
  onCreateStudentLink: () => void;
  onCopyStudentLink: () => void;
  customWords: VocabularyWord[];
  linkedClassWords: VocabularyWord[];
  classFolders: ClassFolder[];
  activeFolder: ClassFolder | null;
  selectedLibraryIds: string[];
  folderNameDraft: string;
  setFolderNameDraft: (value: string) => void;
  libraryQuery: string;
  setLibraryQuery: (value: string) => void;
  libraryLevel: Level | "all";
  setLibraryLevel: (value: Level | "all") => void;
  libraryTopic: WordFocus | "all";
  setLibraryTopic: (value: WordFocus | "all") => void;
  folderNotice: string | null;
  folderFileInputRef: React.RefObject<HTMLInputElement | null>;
  libraryWords: VocabularyWord[];
  onSelectFolder: (id: string) => void;
  onNewFolder: () => void;
  onCreateFolder: () => void;
  onSaveFolder: () => void;
  onDeleteFolder: () => void;
  onToggleLibraryWord: (id: string) => void;
  onSelectVisibleWords: (ids: string[]) => void;
  onClearVisibleWords: (ids: string[]) => void;
  onImportFolder: (file: File | undefined) => void;
  onExportFolder: (format: "json" | "csv") => void;
  studioDraft: string;
  setStudioDraft: (value: string) => void;
  studioNotice: string | null;
  importInputRef: React.RefObject<HTMLInputElement | null>;
  onImport: (raw: string) => void;
  onImportFile: (file: File | undefined) => void;
  onGenerate: (wordId: string) => void;
  onGenerateBatch: (wordIds?: string[]) => void;
  onRequestBatchReminder: () => void | Promise<void>;
  batchReminderArmed: boolean;
  onDelete: (wordId: string) => void;
  generatingWordId: string | null;
  illustrationBatch: IllustrationBatchState | null;
};

function Setup({ mode, setMode, names, setNames, learnerLevel, setLearnerLevel, wordFocus, setWordFocus, durationMinutes, setDurationMinutes, languageCheckMode, setLanguageCheckMode, hideImagesUntilClick, onHideImagesUntilClickChange, startMatch, studentLink, setStudentLink, studentJoined, studentJoinNotice, onJoinTeacherLink, shareUrl, shareNotice, onCreateStudentLink, onCopyStudentLink, customWords, linkedClassWords, classFolders, activeFolder, selectedLibraryIds, folderNameDraft, setFolderNameDraft, libraryQuery, setLibraryQuery, libraryLevel, setLibraryLevel, libraryTopic, setLibraryTopic, folderNotice, folderFileInputRef, libraryWords, onSelectFolder, onNewFolder, onCreateFolder, onSaveFolder, onDeleteFolder, onToggleLibraryWord, onSelectVisibleWords, onClearVisibleWords, onImportFolder, onExportFolder, studioDraft, setStudioDraft, studioNotice, importInputRef, onImport, onImportFile, onGenerate, onGenerateBatch, onRequestBatchReminder, batchReminderArmed, onDelete, generatingWordId, illustrationBatch }: SetupProps) {
  const levels = LEVEL_OPTIONS;
  const focuses = FOCUS_OPTIONS;
  const studentMode = mode === "student";
  const focusLabel = focuses.find((focus) => focus.id === wordFocus)?.label || "your teacher's focus";
  const startNewClassFolder = onNewFolder;
  const createClassFolder = onCreateFolder;
  const saveActiveClassFolder = onSaveFolder;
  const deleteActiveClassFolder = onDeleteFolder;
  const importClassFolder = onImportFolder;
  const exportActiveClassFolder = onExportFolder;

  return <main className="app-shell"><Header />
    <div className="hero teacher-hero">
      <div className="hero-copy"><div className="eyebrow">Vocabulary practice for any English classroom</div><h1>Plan less.<br/><span>Make words stick.</span></h1><p>Teachers set the words. Students hear, use, combine, and revisit them through meaningful sentences.</p><div className="hero-proof"><span><b>54</b> ready-to-play words</span><span><b>3</b> adaptable levels</span><span><b>1</b> classroom link</span></div></div>
      <section className="hero-art round-guide" aria-labelledby="round-guide-title">
        <div className="round-guide-kicker"><span>How to play</span><span>one timed round</span></div>
        <h2 id="round-guide-title">Turn class words into a Bingo card.</h2>
        <ol className="round-guide-steps">
          <li><span className="round-guide-number">1</span><div><b>Pick</b><small>Choose 1–4 words from your shelf.</small></div></li>
          <li><span className="round-guide-number">2</span><div><b>Make a sentence</b><small>Type or say one clear sentence using every chosen word.</small></div></li>
          <li><span className="round-guide-number">3</span><div><b>Play Bingo</b><small>A correct sentence lights matching words. Complete a line, then fill the full card to get a new one.</small></div></li>
        </ol>
        <div className="round-guide-win"><span aria-hidden="true">★</span><div><b>How to win</b><small>When time runs out, the player with the most Bingo lines wins. Solo rounds show your Bingo total and saved review words.</small></div></div>
      </section>
    </div>
    <div className="content"><div className={`setup-grid teacher-setup ${studentMode ? "student-setup" : ""}`}><section className="panel setup-card"><div className="eyebrow">Your lesson setup</div><h2>{studentMode ? "Join a teacher's table" : "Make this game fit your class"}</h2><p>{studentMode ? "Paste the link your teacher shared. Your words and level will load on this device." : activeFolder ? `Using the ${activeFolder.name} folder. Change its words below when you are ready.` : "Choose a language level and round length, then save a class folder or use the initial word bank."}</p>
      <div className="setup-section"><label className="field-label">1 · How will students play?</label><div className="mode-row"><button className={`mode-btn ${mode === "solo" ? "active" : ""}`} onClick={() => setMode("solo")}><strong>Individual</strong><span>One learner or a projected class challenge.</span></button><button className={`mode-btn ${mode === "local" ? "active" : ""}`} onClick={() => setMode("local")}><strong>Teams / pairs</strong><span>Rotate 2–4 groups on one screen.</span></button><button className={`mode-btn ${mode === "student" ? "active" : ""}`} onClick={() => setMode("student")}><strong>Student Table</strong><span>Join your teacher's words with a link.</span></button></div></div>
      {studentMode ? <div className="student-join-panel"><div className="eyebrow">Student Table</div><h3>Join your teacher's vocabulary</h3><p className="subtle">Paste the classroom link your teacher copied for you. It brings in the same class words, level, round length, and sentence check.</p><div className="student-join-row"><label className="visually-hidden" htmlFor="teacher-classroom-link">Teacher classroom link</label><input id="teacher-classroom-link" className="text-input" value={studentLink} onChange={(event) => setStudentLink(event.target.value)} placeholder="Paste your teacher's classroom link"/><button className="btn btn-mint" disabled={!studentLink.trim()} onClick={onJoinTeacherLink}>Join classroom</button></div>{studentJoinNotice && <p className={`student-join-notice ${studentJoined ? "success" : "error"}`} role="status">{studentJoinNotice}</p>}</div> : <><div className="setup-section"><label className="field-label">2 · Choose the language level</label><div className="choice-grid">{levels.map((level) => <button key={level.id} className={`choice-chip ${learnerLevel === level.id ? "active" : ""}`} onClick={() => setLearnerLevel(level.id)}><b>{level.label}</b><small>{level.note}</small></button>)}</div></div><div className="setup-section round-length-section"><div className="round-length-field"><label className="field-label" htmlFor="round-length">3 · Round length</label><select id="round-length" className="text-input" value={durationMinutes} onChange={(event) => setDurationMinutes(Number(event.target.value))}>{[5,8,12,15].map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}</select></div></div><details className="advanced-section"><summary className="advanced-toggle"><span className="advanced-toggle-copy"><b>Advanced options</b><small>{wordFocus === "mixed" ? "Optional topic filter for the initial word bank" : `Initial word bank: ${focusLabel}`}</small></span><span className="advanced-chevron" aria-hidden="true">⌄</span></summary><div className="advanced-options"><label className="field-label" htmlFor="vocabulary-focus">Topic</label><select id="vocabulary-focus" className="text-input" value={wordFocus} onChange={(event) => setWordFocus(event.target.value as WordFocus)}>{focuses.map((focus) => <option key={focus.id} value={focus.id}>{focus.label}</option>)}</select><p className="advanced-caption">Use this only when you want to narrow the initial Wordcraft word bank by topic. Saved class folders use the words you select below.</p></div></details></>}
      <section className="setup-section image-visibility-section" aria-labelledby="image-visibility-title"><div className="field-label" id="image-visibility-title">Optional · Word pictures</div><label className="image-visibility-choice"><input type="checkbox" checked={hideImagesUntilClick} onChange={(event) => onHideImagesUntilClickChange(event.target.checked)} /><span><b>Hide pictures during play</b><small>Double-click a word card to view its picture.</small></span><span className="image-visibility-icon" aria-hidden="true">▧</span></label></section>
      <fieldset className="setup-section language-check-section"><legend className="field-label">{studentMode ? "2" : "4"} · What should this round focus on?</legend><div className="language-check-grid"><button type="button" className={`language-check-card fast ${languageCheckMode === "fast" ? "active" : ""}`} aria-pressed={languageCheckMode === "fast"} onClick={() => setLanguageCheckMode("fast")}><span className="check-card-top"><span className="check-card-icon" aria-hidden="true">⚡</span><span><small>Fast Check</small><strong>Familiarize Word Meaning</strong></span><em>Instant</em></span><span className="check-card-focus">Recognize the word meaning and use it in a simple sentence pattern.</span><span className="check-card-fact good"><b>Advantage</b> Very fast feedback and smoother gameplay.</span><span className="check-card-fact tradeoff"><b>Drawback</b> Checks basic structure and target words, not deep grammar or natural word use.</span></button><button type="button" className={`language-check-card ai ${languageCheckMode === "ai" ? "active" : ""}`} aria-pressed={languageCheckMode === "ai"} onClick={() => setLanguageCheckMode("ai")}><span className="check-card-top"><span className="check-card-icon" aria-hidden="true">✦</span><span><small>AI Language Check</small><strong>Grammar &amp; Word Use</strong></span><em>About 25 seconds</em></span><span className="check-card-focus">Use the word correctly in context and build grammatically correct sentences.</span><span className="check-card-fact good"><b>Advantage</b> Checks grammar, meaning, and natural word use with detailed feedback.</span><span className="check-card-fact tradeoff"><b>Drawback</b> Takes longer while AI analyzes the whole sentence.</span></button></div></fieldset>
      {!studentMode && <div className="setup-section lesson-folder-section"><label className="field-label" htmlFor="lesson-folder">5 · Class folder for this round</label><select id="lesson-folder" className="text-input" value={activeFolder?.id || "initial"} onChange={(event) => event.target.value === "initial" ? onNewFolder() : onSelectFolder(event.target.value)}><option value="initial">Initial Wordcraft word bank</option>{classFolders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name} · {folder.words.length} words</option>)}</select><small className="subtle">Pick a saved class set, or use the initial testing bank. Manage folders below.</small></div>}
      <div className="setup-section"><label className="field-label">{studentMode ? "3 · Your name" : "6 · " + (mode === "solo" ? "Learner or class name" : "Team names")}</label>{studentMode ? <input className="text-input" value={names[0]} onChange={(event) => setNames([event.target.value, ...names.slice(1)])} placeholder="Your name" /> : mode === "solo" ? <input className="text-input" value={names[0]} onChange={(event) => setNames([event.target.value, ...names.slice(1)])} /> : <div className="name-grid">{names.map((name, index) => <input className="text-input" key={index} value={name} placeholder={`Team ${index + 1}`} onChange={(event) => setNames(names.map((current, item) => item === index ? event.target.value : current))} />)}</div>}</div>
      {studentMode && studentJoined && <div className="student-ready"><span>✓</span><div><b>Ready for {focusLabel}</b><small>{linkedClassWords.length ? `${linkedClassWords.length} class words` : "Class word bank"} · {durationMinutes} minutes · {languageCheckMode === "ai" ? "AI Language Check" : "Fast Check"}</small></div></div>}
      <div className="teacher-actions"><button className="btn btn-primary start-lesson" disabled={studentMode && !studentJoined} onClick={startMatch}>{studentMode ? "Start student table" : "Start vocabulary round"}<span>→</span></button><p className="round-random-note"><span aria-hidden="true">↻</span> Words reshuffle each time you start a round.</p>{!studentMode && <button className="share-link-trigger" onClick={onCreateStudentLink}>🔗 Get student link</button>}</div>
      {!studentMode && shareUrl && <div className="share-link-panel" aria-live="polite"><div><b>Student link ready</b><small>Students can open this link or paste it into Student Table.</small></div><div className="share-link-row"><label className="visually-hidden" htmlFor="student-share-link">Student classroom link</label><input id="student-share-link" className="share-link-input" value={shareUrl} readOnly onFocus={(event) => event.currentTarget.select()} /><button className="btn btn-mint" onClick={onCopyStudentLink}>Copy</button></div>{shareNotice && <p className="share-link-notice" role="status">{shareNotice}</p>}</div>}
      </section>{!studentMode && <section className="panel feature-card teacher-guide"><div className="eyebrow">For every learner</div><h3>Teachers set the pace.<br/>Students make it theirs.</h3><div className="feature-list"><div className="feature"><span className="feature-icon">01</span><div><b>Teacher sets the words</b><small>Build a focused set and share one classroom link.</small></div></div><div className="feature"><span className="feature-icon">02</span><div><b>Students join instantly</b><small>Each learner gets a personal table with no account.</small></div></div><div className="feature"><span className="feature-icon">03</span><div><b>Context over recall</b><small>Use complete sentences to make every word stick.</small></div></div><div className="feature"><span className="feature-icon">04</span><div><b>Review you can see</b><small>Every table shows which words need another turn.</small></div></div></div><div className="teacher-tip"><b>Teacher tip</b><span>Project the teacher view, then let students open their own Student Table.</span></div></section>}</div>{!studentMode && <><ClassFolderStudio classFolders={classFolders} activeFolder={activeFolder} selectedLibraryIds={selectedLibraryIds} folderNameDraft={folderNameDraft} setFolderNameDraft={setFolderNameDraft} libraryQuery={libraryQuery} setLibraryQuery={setLibraryQuery} libraryLevel={libraryLevel} setLibraryLevel={setLibraryLevel} libraryTopic={libraryTopic} setLibraryTopic={setLibraryTopic} folderNotice={folderNotice} folderFileInputRef={folderFileInputRef} libraryWords={libraryWords} onSelectFolder={onSelectFolder} onNewFolder={startNewClassFolder} onCreateFolder={createClassFolder} onSaveFolder={saveActiveClassFolder} onDeleteFolder={deleteActiveClassFolder} onToggleLibraryWord={onToggleLibraryWord} onSelectVisibleWords={onSelectVisibleWords} onClearVisibleWords={onClearVisibleWords} onImportFolder={importClassFolder} onExportFolder={exportActiveClassFolder} /><IllustrationStudio customWords={customWords} studioDraft={studioDraft} setStudioDraft={setStudioDraft} studioNotice={studioNotice} importInputRef={importInputRef} onImport={onImport} onImportFile={onImportFile} onGenerate={onGenerate} onGenerateBatch={onGenerateBatch} onRequestBatchReminder={onRequestBatchReminder} batchReminderArmed={batchReminderArmed} onDelete={onDelete} generatingWordId={generatingWordId} illustrationBatch={illustrationBatch} /></>}</div><FeedbackPanel language="en" /><div className="footer-note">Teachers share the words · students practice on their own table · no accounts needed</div></main>;
}

type ClassFolderStudioProps = {
  classFolders: ClassFolder[];
  activeFolder: ClassFolder | null;
  selectedLibraryIds: string[];
  folderNameDraft: string;
  setFolderNameDraft: (value: string) => void;
  libraryQuery: string;
  setLibraryQuery: (value: string) => void;
  libraryLevel: Level | "all";
  setLibraryLevel: (value: Level | "all") => void;
  libraryTopic: WordFocus | "all";
  setLibraryTopic: (value: WordFocus | "all") => void;
  folderNotice: string | null;
  folderFileInputRef: React.RefObject<HTMLInputElement | null>;
  libraryWords: VocabularyWord[];
  onSelectFolder: (id: string) => void;
  onNewFolder: () => void;
  onCreateFolder: () => void;
  onSaveFolder: () => void;
  onDeleteFolder: () => void;
  onToggleLibraryWord: (id: string) => void;
  onSelectVisibleWords: (ids: string[]) => void;
  onClearVisibleWords: (ids: string[]) => void;
  onImportFolder: (file: File | undefined) => void;
  onExportFolder: (format: "json" | "csv") => void;
};

function ClassFolderStudio({ classFolders, activeFolder, selectedLibraryIds, folderNameDraft, setFolderNameDraft, libraryQuery, setLibraryQuery, libraryLevel, setLibraryLevel, libraryTopic, setLibraryTopic, folderNotice, folderFileInputRef, libraryWords, onSelectFolder, onNewFolder, onCreateFolder, onSaveFolder, onDeleteFolder, onToggleLibraryWord, onSelectVisibleWords, onClearVisibleWords, onImportFolder, onExportFolder }: ClassFolderStudioProps) {
  const [deleteFolderId, setDeleteFolderId] = useState<string | null>(null);
  useEffect(() => setDeleteFolderId(null), [activeFolder?.id]);
  const query = libraryQuery.trim().toLowerCase();
  const isBuiltIn = (word: VocabularyWord) => fullVocabulary.some((builtIn) => builtIn.id === word.id);
  const visible = (word: VocabularyWord) => {
    const matchesSearch = !query || `${word.word} ${word.chinese}`.toLowerCase().includes(query);
    const matchesLevel = libraryLevel === "all" || word.level === libraryLevel;
    // Imported words have no topic metadata, so keep them visible while a
    // teacher filters the built-in bank by topic.
    const matchesTopic = !isBuiltIn(word) || libraryTopic === "all" || libraryTopic === "mixed" || FOCUS_WORD_IDS[libraryTopic].includes(word.id);
    return matchesSearch && matchesLevel && matchesTopic;
  };
  const builtInWords = libraryWords.filter((word) => isBuiltIn(word) && visible(word));
  const teacherWords = libraryWords.filter((word) => !isBuiltIn(word) && visible(word));
  const visibleIds = [...builtInWords, ...teacherWords].map((word) => word.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedLibraryIds.includes(id));
  const toggleVisible = () => allVisibleSelected ? onClearVisibleWords(visibleIds) : onSelectVisibleWords(visibleIds);
    const renderWord = (word: VocabularyWord) => <label className={`library-word ${selectedLibraryIds.includes(word.id) ? "selected" : ""}`} key={word.id}><input type="checkbox" checked={selectedLibraryIds.includes(word.id)} onChange={() => onToggleLibraryWord(word.id)} /><span><b>{word.word}</b><small>{word.chinese || "No meaning provided"} · {word.level}</small></span></label>;

  return <section className="panel class-library">
    <div className="library-heading"><div><div className="eyebrow">Teacher library · 班级词汇文件夹</div><h2>Keep each class set in its own folder</h2><p className="subtle">Choose from the {fullVocabulary.length}-word bank or your imported words. Saved class folders stay separate from the starter testing set.</p></div><span className="library-count">{classFolders.length}<small>folders</small></span></div>
    <div className="folder-steps" aria-label="How to add words to a class folder"><div className="folder-step"><span className="folder-step-number">1</span><div><b>Pick a folder</b><small>Open a saved folder or start a new one.</small></div></div><div className="folder-step"><span className="folder-step-number">2</span><div><b>Name it</b><small>Enter the class name in the field below.</small></div></div><div className="folder-step"><span className="folder-step-number">3</span><div><b>Choose words</b><small>Check words from either list.</small></div></div><div className="folder-step"><span className="folder-step-number">4</span><div><b>Create or save</b><small>Use Create folder or Save changes.</small></div></div></div>
    <div className="folder-toolbar"><div className="folder-name-field"><label className="field-label" htmlFor="class-folder-name">Class folder name</label><input id="class-folder-name" className="text-input" value={folderNameDraft} onChange={(event) => setFolderNameDraft(event.target.value)} placeholder="e.g. Grade 7 · Monday" /><small className="folder-name-help">Name it, then click Create folder.</small></div><div className="folder-open-field"><label className="field-label" htmlFor="saved-class-folder">Open saved folder</label><select id="saved-class-folder" className="text-input" value={activeFolder?.id || ""} onChange={(event) => event.target.value ? onSelectFolder(event.target.value) : onNewFolder()}><option value="">{classFolders.length ? "Start a new folder" : "No saved folders yet"}</option>{classFolders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name} · {folder.words.length} words</option>)}</select></div><div className="folder-actions"><button className="btn btn-primary" onClick={onCreateFolder}>{activeFolder ? "Create another folder" : "Create folder"}</button><button className="btn btn-ghost" disabled={!activeFolder} onClick={onSaveFolder}>Save changes</button><button className="btn btn-danger" disabled={!activeFolder} onClick={() => setDeleteFolderId(activeFolder?.id || null)}>Delete folder</button><button className="btn btn-ghost" onClick={onNewFolder}>New folder</button><input ref={folderFileInputRef} className="visually-hidden" type="file" accept="application/json,.json" onChange={(event) => { onImportFolder(event.target.files?.[0]); event.currentTarget.value = ""; }} /><button className="btn btn-ghost" onClick={() => folderFileInputRef.current?.click()}>Import JSON</button></div></div>
    {activeFolder && deleteFolderId === activeFolder.id && <div className="folder-delete-confirm" role="alert"><div><b>Delete {activeFolder.name}?</b><small>This removes the folder from this device. Words in My imported words are not deleted.</small></div><div className="folder-delete-actions"><button className="btn btn-danger" onClick={() => { setDeleteFolderId(null); onDeleteFolder(); }}>Delete permanently</button><button className="btn btn-ghost" onClick={() => setDeleteFolderId(null)}>Cancel</button></div></div>}
    <div className="folder-shelf" aria-label="Saved class folders">{classFolders.length ? classFolders.map((folder) => <button key={folder.id} className={`folder-card ${activeFolder?.id === folder.id ? "active" : ""}`} onClick={() => onSelectFolder(folder.id)}><span className="folder-icon">▰</span><span><b>{folder.name}</b><small>{folder.words.length} words · updated {new Date(folder.updatedAt).toLocaleDateString()}</small></span><span className="folder-arrow">{activeFolder?.id === folder.id ? "OPEN" : "↗"}</span></button>) : <div className="folder-empty"><span>▱</span><div><b>No class folders yet.</b><small>Create one after choosing words below. Your starter testing words remain untouched.</small></div></div>}</div>
    <div className="library-picker"><div className="library-picker-head"><div><div className="studio-label">Choose words for {activeFolder ? activeFolder.name : "a new class folder"}</div><p className="subtle">Selected words are the only words used in that folder's round.</p></div><strong>{selectedLibraryIds.length} selected</strong></div><div className="library-filters"><label className="visually-hidden" htmlFor="library-search">Search word bank</label><input id="library-search" className="text-input" value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} placeholder="Search the word bank…" /><label className="visually-hidden" htmlFor="library-level">Filter by level</label><select id="library-level" className="text-input" value={libraryLevel} onChange={(event) => setLibraryLevel(event.target.value as Level | "all")}><option value="all">All levels</option><option value="L1">L1 · Starter</option><option value="L2">L2 · Developing</option><option value="L3">L3 · Stretch</option></select><label className="visually-hidden" htmlFor="library-topic">Filter by topic</label><select id="library-topic" className="text-input" value={libraryTopic} onChange={(event) => setLibraryTopic(event.target.value as WordFocus | "all")}><option value="all">All topics</option>{FOCUS_OPTIONS.filter((focus) => focus.id !== "mixed").map((focus) => <option key={focus.id} value={focus.id}>{focus.label}</option>)}</select><button className="btn btn-ghost" disabled={!visibleIds.length} onClick={toggleVisible}>{allVisibleSelected ? "Clear visible" : "Select visible"}</button></div><div className="library-columns"><div className="library-source"><div className="library-source-head"><div><b>Wordcraft word bank</b><small>{fullVocabulary.length} starter/testing words · never mixed into teacher folders automatically</small></div><span>{builtInWords.length}</span></div><div className="library-word-list">{builtInWords.length ? builtInWords.map(renderWord) : <small className="library-empty-note">No bank words match this search.</small>}</div></div><div className="library-source teacher-source"><div className="library-source-head"><div><b>My imported words</b><small>{libraryWords.filter((word) => !fullVocabulary.some((builtIn) => builtIn.id === word.id)).length} teacher words · imported or received in a folder</small></div><span>{teacherWords.length}</span></div><div className="library-word-list">{teacherWords.length ? teacherWords.map(renderWord) : <small className="library-empty-note">Imported words stay available for every topic.</small>}</div></div></div></div>
    {folderNotice && <p className="folder-notice" role="status">{folderNotice}</p>}
    {activeFolder && <div className="folder-export"><div><b>{activeFolder.name}</b><small>{activeFolder.words.length} words saved in this folder. Export it for another device or keep it as a backup.</small></div><div className="folder-export-actions"><button className="btn btn-mint" onClick={() => onExportFolder("json")}>Export JSON</button><button className="btn btn-ghost" onClick={() => onExportFolder("csv")}>Export CSV</button></div></div>}
  </section>;
}

type IllustrationStudioProps = {
  customWords: VocabularyWord[];
  studioDraft: string;
  setStudioDraft: (value: string) => void;
  studioNotice: string | null;
  importInputRef: React.RefObject<HTMLInputElement | null>;
  onImport: (raw: string) => void;
  onImportFile: (file: File | undefined) => void;
  onGenerate: (wordId: string) => void;
  onGenerateBatch: (wordIds?: string[]) => void;
  onRequestBatchReminder: () => void | Promise<void>;
  batchReminderArmed: boolean;
  onDelete: (wordId: string) => void;
  generatingWordId: string | null;
  illustrationBatch: IllustrationBatchState | null;
};

function IllustrationStudio({ customWords, studioDraft, setStudioDraft, studioNotice, importInputRef, onImport, onImportFile, onGenerate, onGenerateBatch, onRequestBatchReminder, batchReminderArmed, onDelete, generatingWordId, illustrationBatch }: IllustrationStudioProps) {
  const [selectedWordIds, setSelectedWordIds] = useState<string[]>([]);
  const [batchClock, setBatchClock] = useState(() => Date.now());
  const selectedWords = customWords.filter((word) => selectedWordIds.includes(word.id));
  const allWordsSelected = customWords.length > 0 && selectedWords.length === customWords.length;
  const isBusy = Boolean(generatingWordId || illustrationBatch);

  const toggleAllWords = () => setSelectedWordIds(allWordsSelected ? [] : customWords.map((word) => word.id));
  const toggleWord = (wordId: string, checked: boolean) => setSelectedWordIds((current) => (
    checked ? [...new Set([...current, wordId])] : current.filter((id) => id !== wordId)
  ));

  useEffect(() => {
    if (!illustrationBatch) return;
    setBatchClock(Date.now());
    const timer = window.setInterval(() => setBatchClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [Boolean(illustrationBatch)]);

  const missingCount = customWords.filter((word) => !isGeneratedIllustration(word.image)).length;
  const progressPercent = illustrationBatch ? Math.round((illustrationBatch.processed / illustrationBatch.total) * 100) : 0;
  const activeWords = illustrationBatch?.active.map((id) => customWords.find((word) => word.id === id)?.word).filter(Boolean) || [];

  return <section className="panel illustration-studio">
    <div className="studio-heading"><div><div className="eyebrow">Teacher word studio · 词汇插画工作室</div><h2>Bring your own vocabulary to life</h2><p className="subtle">Add your words, then make the whole set ready in one pass. Your set stays on this device.</p></div><div className="studio-count-wrap"><span className="studio-count">{customWords.length}<small>your words</small></span><div className="batch-action"><button className="btn btn-primary batch-button" disabled={!missingCount || illustrationBatch !== null || generatingWordId !== null} onClick={() => onGenerateBatch()}>{illustrationBatch ? `${illustrationBatch.processed}/${illustrationBatch.total} processed` : "Generate all missing art"}</button><small className="batch-estimate-hint">{illustrationBatch ? "Live estimate shown below" : missingCount ? `Estimated ${formatBatchEstimate(missingCount)} · up to ${Math.min(ILLUSTRATION_BATCH_CONCURRENCY, missingCount)} at once` : "All imported words are illustrated"}</small></div></div></div>
    {illustrationBatch && <div className="batch-progress-panel" aria-live="polite" aria-label="Illustration batch progress">
      <div className="batch-progress-header"><div><b>Batch drawing in progress</b><small>Each image can take up to 1 minute. Three images can render at once, and results save as they arrive.</small></div><div className="batch-progress-score"><strong>{progressPercent}%</strong><span>{illustrationBatch.completed} ready{illustrationBatch.failed.length ? ` · ${illustrationBatch.failed.length} failed` : ""}</span></div></div>
      <div className="batch-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={illustrationBatch.total} aria-valuenow={illustrationBatch.processed} aria-label={`${illustrationBatch.processed} of ${illustrationBatch.total} illustrations processed`}><span style={{ width: `${progressPercent}%` }} /></div>
      <div className="batch-progress-meta"><span>{activeWords.length ? `Drawing ${activeWords.slice(0, 2).join(" · ")}${activeWords.length > 2 ? ` +${activeWords.length - 2}` : ""}` : "Finishing the last saved results…"}</span><span>预计 {formatBatchRemaining(illustrationBatch.estimatedDoneAt, batchClock)} · around {formatBatchClock(illustrationBatch.estimatedDoneAt)}</span></div>
      <div className="batch-progress-actions">{batchReminderArmed ? <span className="batch-reminder-active">🔔 Desktop reminder on</span> : <button className="btn btn-mint batch-reminder-button" onClick={onRequestBatchReminder}>🔔 Remind me when ready</button>}<small className="batch-progress-note">Keep this tab open; you can switch tabs. Closing it stops the queue.</small></div>
    </div>}
    <div className="studio-grid">
      <div className="import-column">
        <div className="studio-label">1 · Add your words</div>
        <div className="import-drop"><div className="import-icon">＋</div><div><b>Upload a vocabulary file</b><small>CSV / TXT / JSON · optional meaning/translation · one word per line also works</small></div><input ref={importInputRef} className="visually-hidden" type="file" accept=".csv,.txt,.json,text/csv,text/plain,application/json" onChange={(event) => { onImportFile(event.target.files?.[0]); event.currentTarget.value = ""; }} /><button className="btn btn-ghost" onClick={() => importInputRef.current?.click()}>Choose file</button></div>
        <div className="paste-row"><textarea className="studio-textarea" value={studioDraft} onChange={(event) => setStudioDraft(event.target.value)} placeholder={"Or paste words here…\ncompass, direction finder, L1\ncurious, interested in learning, L2"} /><button className="btn btn-primary" disabled={!studioDraft.trim()} onClick={() => onImport(studioDraft)}>Add words</button></div>
        {studioNotice && <div className="studio-notice" role="status">{studioNotice}</div>}
        <div className="studio-label studio-label-spaced">Your imported set {customWords.length > 0 && <span>{customWords.filter((word) => isGeneratedIllustration(word.image)).length}/{customWords.length} illustrated</span>}</div>
        {customWords.length ? <>
          <div className="studio-selection-bar">
            <div className="studio-selection-copy"><span className="studio-selection-mark" aria-hidden="true">✦</span><span><b>{selectedWords.length ? `${selectedWords.length} selected` : "Select words to redraw"}</b><small>Choose several at once; existing pictures will be replaced.</small></span></div>
            <div className="studio-selection-actions">
              <button className="btn btn-ghost studio-select-all" type="button" disabled={isBusy} onClick={toggleAllWords}>{allWordsSelected ? "Clear selection" : "Select all"}</button>
              <button className="btn btn-mint studio-redraw-selected" type="button" disabled={!selectedWords.length || isBusy} onClick={() => onGenerateBatch(selectedWords.map((word) => word.id))}>Redraw selected{selectedWords.length ? ` · ${selectedWords.length}` : ""}</button>
            </div>
          </div>
          <div className="custom-word-list">{customWords.map((word) => { const isGenerated = isGeneratedIllustration(word.image); const active = generatingWordId === word.id || Boolean(illustrationBatch?.active.includes(word.id)); return <div className={`custom-word-row ${selectedWordIds.includes(word.id) ? "is-selected" : ""} ${active ? "is-drawing" : ""}`} key={word.id}><label className="custom-word-select"><input type="checkbox" aria-label={`Select ${word.word} for redraw`} checked={selectedWordIds.includes(word.id)} disabled={isBusy} onChange={(event) => toggleWord(word.id, event.target.checked)} /></label><img src={word.image || PENDING_WORD_IMAGE} alt=""/><div className="custom-word-copy"><b>{word.word}</b><small>{word.chinese || "No meaning provided"} · {word.level}</small></div><span className={`art-status ${isGenerated ? "ready" : "waiting"}`}>{active ? "Drawing…" : isGenerated ? "Illustrated" : "Needs art"}</span><button className="btn btn-mint art-button" disabled={isBusy} onClick={() => onGenerate(word.id)}>{active ? "Drawing…" : isGenerated ? "Redraw" : "Generate art"}</button><button className="delete-word" aria-label={`Delete ${word.word}`} disabled={isBusy} onClick={() => onDelete(word.id)}>Delete</button></div>; })}</div>
        </> : <div className="studio-empty"><span>✎</span><div><b>Start by adding your words.</b><small>Use CSV, TXT, or JSON, or paste one word per line. Then generate the missing art for the set.</small></div></div>}
      </div>
    </div>
  </section>;
}

function parseImportedVocabulary(raw: string, existing: VocabularyWord[]): VocabularyWord[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  let records: Array<{ word?: unknown; translation?: unknown; meaning?: unknown; definition?: unknown; gloss?: unknown; chinese?: unknown; level?: unknown }> = [];
  if (trimmed.startsWith("[")) {
    try { const parsed = JSON.parse(trimmed); if (Array.isArray(parsed)) records = parsed.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object")); } catch { records = []; }
  }
  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const first = lines[0]?.toLowerCase() || "";
  const hasHeader = /(^|[,\uFF0C\t;])(?:word|vocabulary|term)([,\uFF0C\t;]|$)/i.test(first);
  if (!records.length) records = lines.slice(hasHeader ? 1 : 0).map((line) => { const fields = line.split(/[,\uFF0C\t;]/).map((field) => field.trim().replace(/^['"]|['"]$/g, "")); const levelField = fields.find((field) => /^l[123]$/i.test(field)); return { word: fields[0], translation: fields[1] && !/^l[123]$/i.test(fields[1]) ? fields[1] : "", level: levelField || "L1" }; });
  const existingWords = new Set(existing.map((item) => item.word.toLowerCase()));
  const existingIds = new Set(existing.map((item) => item.id));
  const added: VocabularyWord[] = [];
  records.forEach((record, index) => {
    const word = typeof record.word === "string" ? record.word.trim() : "";
    if (!word || existingWords.has(word.toLowerCase())) return;
    const base = slugify(word) || `word-${index + 1}`;
    let id = `custom-${base}`;
    let suffix = 2;
    while (existingIds.has(id)) id = `custom-${base}-${suffix++}`;
    const level = typeof record.level === "string" && /^l[123]$/i.test(record.level) ? record.level.toUpperCase() as VocabularyWord["level"] : "L1";
    const translation = [record.translation, record.meaning, record.definition, record.gloss, record.chinese].find((value): value is string => typeof value === "string") || "";
    added.push({ id, number: 1000 + existing.length + added.length, word, level, chinese: translation, collocations: [word, `use ${word}`, `learn ${word}`], image: PENDING_WORD_IMAGE, pronunciation: `/${word}/`, fallbackStructure: word[0].toUpperCase() + word.slice(1) });
    existingWords.add(word.toLowerCase());
    existingIds.add(id);
  });
  return added;
}

function slugify(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 42); }

function Summary({ match, restart }: { match: MatchState; restart: () => void }) {
  const summaries = useMemo(() => summarize(match), [match]);
  const rankedPlayers = useMemo(() => [...match.players].sort((left, right) => (right.bingo?.bingos || 0) - (left.bingo?.bingos || 0) || (right.bingo?.boardsCompleted || 0) - (left.bingo?.boardsCompleted || 0)), [match.players]);
  const winner = rankedPlayers[0];
  const grammarMistakes = match.submissions.filter((submission) => submission.grammarMistake);

  return <main className="app-shell"><Header /><div className="content"><section className="panel summary">
    <div className="eyebrow">Round complete</div><h2>Bingo results.</h2>
    {winner && <div className="winner"><div className="eyebrow">Most Bingo lines</div><h3>{winner.name} · {winner.bingo?.bingos || 0} Bingos</h3><p className="subtle">Cleared {winner.bingo?.boardsCompleted || 0} full boards. Every correct sentence helped light the next square.</p></div>}
    <table className="summary-table"><thead><tr><th>Player</th><th>Bingo lines</th><th>Boards cleared</th><th>Correct sentences</th></tr></thead><tbody>{rankedPlayers.map((player) => <tr key={player.id}><td><strong>{player.name}</strong></td><td>{player.bingo?.bingos || 0}</td><td>{player.bingo?.boardsCompleted || 0}</td><td>{match.submissions.filter((submission) => submission.playerId === player.id && submission.valid).length}</td></tr>)}</tbody></table>
    <section className="grammar-summary" aria-labelledby="grammar-mistakes-title"><div className="summary-section-head"><div><h3 id="grammar-mistakes-title">Grammar mistakes</h3><p className="subtle">Sentences you chose to save. Type them again next time.</p></div><span className="summary-count">{grammarMistakes.length}</span></div>
      {grammarMistakes.length ? <div className="grammar-mistake-list">{grammarMistakes.map((mistake) => { const learner = match.players.find((player) => player.id === mistake.playerId)?.name || "Learner"; const targets = mistake.targetWords.map((id) => vocabularyById[id]?.word || id).join(" + "); return <article className="grammar-mistake-card" key={mistake.id}><div className="grammar-mistake-meta"><strong>{learner}</strong><span>{targets}</span></div><p className="grammar-mistake-sentence">“{mistake.sentence}”</p><small>{mistake.feedback}</small></article>; })}</div> : <div className="grammar-empty">No grammar mistakes recorded this round. Keep practising.</div>}
    </section>
    <h3>Words marked for review</h3><p className="subtle">Words from the grammar mistakes you chose to save:</p><div className="review">{[...new Set(summaries.flatMap((item) => item.reviewItems))].map((id) => <span key={id}>{vocabularyById[id]?.word || id}</span>)}{!summaries.some((item) => item.reviewItems.length) && <span>Everything got a turn ✨</span>}</div>
    <div className="action-row" style={{ marginTop: 28 }}><button className="btn btn-primary" onClick={restart}>Play another round</button></div>
  </section></div></main>;
}

function formatTime(seconds: number) { return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }
