"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { abilityCopy, buildingImageForWord, fullVocabulary, recipes, registerVocabularyWords, unlockedRecipeTier, vocabularyById } from "@/data/content";
import { makeClassFolder, parseClassFolderExport, removeClassFolder, serializeClassFolder, serializeClassFolderCsv, updateClassFolder, type ClassFolder } from "@/lib/classroom-folders";
import { evaluateRules, evaluationCacheKey } from "@/lib/evaluation";
import { applyEvaluation, createMatch, coreWord, notePronunciation, summarize, tick, useAbility } from "@/lib/game-engine";
import { createClassroomLink, hydrateSharedWords, readClassroomLink, type ClassroomLearnerLevel, type ClassroomWordFocus } from "@/lib/classroom-link";
import { ILLUSTRATION_STYLE_VERSION, isGeneratedIllustration, PENDING_WORD_IMAGE } from "@/lib/illustration";
import { clearMatch, loadClassFolders, loadCustomWords, loadMatch, loadSettings, saveClassFolders, saveCustomWords, saveHistory, saveMatch, saveSettings } from "@/lib/storage";
import type { AbilityId, EvaluationResult, InputMethod, Level, MatchMode, MatchState, PlayerState, VocabularyWord } from "@/types/game";

type Phase = "setup" | "playing" | "finished";
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
const LEVEL_MAP: Record<LearnerLevel, Level[]> = { starter: ["L1"], developing: ["L1", "L2"], stretch: ["L2", "L3"], mixed: ["L1", "L2", "L3"] };
const FOCUS_WORD_IDS: Record<WordFocus, string[]> = {
  everyday: ["dumbbell", "treadmill", "kettle", "locker", "mat", "drawer", "shelf", "outlet", "bulb", "wardrobe", "pantry", "faucet", "countertop", "detergent", "cutlery", "napkin", "pastry", "beverage", "wallet", "receipt"],
  school: ["textbook", "assignment", "lecture", "syllabus", "workload", "tuition", "scholarship", "prerequisite", "plagiarism", "discipline", "adviser", "alumni", "auditorium", "cafeteria", "observatory", "committee"],
  community: ["commute", "intersection", "pedestrian", "pharmacy", "kiosk", "venue", "patron", "landlord", "dormitory", "maintenance", "extension", "souvenir", "luggage"],
  travel: ["luggage", "souvenir", "commute", "intersection", "pedestrian", "venue"],
  mixed: [],
};
const LEVEL_OPTIONS: { id: LearnerLevel; label: string; note: string }[] = [
  { id: "starter", label: "Starter", note: "Concrete, high-frequency words" },
  { id: "developing", label: "Developing", note: "Everyday and school vocabulary" },
  { id: "stretch", label: "Stretch", note: "More precise, academic language" },
];
const FOCUS_OPTIONS: { id: WordFocus; label: string }[] = [
  { id: "mixed", label: "All topics" },
  { id: "school", label: "School & study" },
  { id: "community", label: "Campus life" },
  { id: "everyday", label: "Daily life" },
  { id: "travel", label: "Travel" },
];

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

export default function Home() {
  const [phase, setPhase] = useState<Phase>("setup");
  const [mode, setMode] = useState<MatchMode>("solo");
  const [names, setNames] = useState(["Maya", "Leo", "June", "Sam"]);
  const [learnerLevel, setLearnerLevel] = useState<LearnerLevel>("developing");
  const [wordFocus, setWordFocus] = useState<WordFocus>("mixed");
  const [durationMinutes, setDurationMinutes] = useState(8);
  const [customWords, setCustomWords] = useState<VocabularyWord[]>([]);
  const [illustrationBatch, setIllustrationBatch] = useState<{ current: number; total: number; failed: string[] } | null>(null);
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
  const [feedback, setFeedback] = useState<EvaluationResult | null>(null);
  const [pendingReview, setPendingReview] = useState<{ result: EvaluationResult; sentence: string; targets: string[] } | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<string | null>(null);
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(null);
  const [selectedFloor, setSelectedFloor] = useState(1);
  const [abilityTargetId, setAbilityTargetId] = useState("");
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const voiceActive = useRef(false);
  const voiceFinalText = useRef("");
  const voiceInterimText = useRef("");
  const voiceRestartTimer = useRef<number | null>(null);

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
    setMode("student");
    setStudentJoined(true);
    setStudentJoinNotice(linkedWords.length ? `${linkedWords.length} class words loaded. Add your name, then start.` : "Class settings loaded. Add your name, then start.");
    return true;
  }, []);

  const activePlayer = match?.players[match.activeSeat];
  const selectedLabels = selected.map((id) => vocabularyById[id]?.word).filter(Boolean).join(" + ");
  const selectionLimit = activePlayer?.hand.length || 4;
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

  useEffect(() => {
    if (!activePlayer) return;
    if (!selectedBuildingId || !activePlayer.structures.some((structure) => structure.id === selectedBuildingId)) {
      setSelectedBuildingId(activePlayer.structures[0]?.id || null);
      setSelectedFloor(1);
      setAbilityTargetId("");
    }
  }, [activePlayer?.id, activePlayer?.structures.length, selectedBuildingId]);

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
    if (settings) { setMode(settings.mode); setNames(settings.names.length ? settings.names : names); }
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

  useEffect(() => { if (storageReady) saveSettings({ mode, names }); }, [mode, names, storageReady]);

  useEffect(() => { if (storageReady) saveClassFolders(classFolders); }, [classFolders, storageReady]);

  useEffect(() => {
    if (phase !== "playing" || !match || match.status !== "playing") return;
    const timer = window.setInterval(() => setMatch((current) => current ? tick(current, 1) : current), 1000);
    return () => window.clearInterval(timer);
  }, [phase, match?.status]);

  useEffect(() => { if (match) saveMatch(match); }, [match]);

  useEffect(() => {
    if (match?.status === "finished" && phase === "playing") { saveHistory(match); setPhase("finished"); }
  }, [match, phase]);

  const importVocabulary = (raw: string) => {
    const parsed = parseImportedVocabulary(raw, [...fullVocabulary, ...customWords]);
    if (!parsed.length) { setStudioNotice("No new words found. Add one word per line, or use CSV with word, translation, and level columns."); return; }
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
    const link = createClassroomLink(window.location.origin, { learnerLevel, wordFocus, durationMinutes, customWords: wordsToShare });
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

  const generateIllustration = async (wordId: string) => {
    const target = customWords.find((item) => item.id === wordId);
    if (!target || generatingWordId) return;
    setGeneratingWordId(wordId);
    setStudioNotice(`Drawing ${target.word}… This can take up to two minutes.`);
    try {
      const response = await fetch("/api/generate-illustration", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ word: target.word, translation: target.chinese }), signal: AbortSignal.timeout(120000) });
      const payload = await response.json() as { image?: string; source?: string; message?: string };
      if (!response.ok || !payload.image) throw new Error("No illustration returned");
      const updated = payload.source === "ai"
        ? { ...target, image: payload.image, illustrationVersion: ILLUSTRATION_STYLE_VERSION }
        : { ...target, image: PENDING_WORD_IMAGE, illustrationVersion: undefined };
      registerVocabularyWords([updated]);
      setCustomWords((current) => current.map((item) => item.id === wordId ? updated : item));
      setStudioNotice(payload.message || `${target.word} is illustrated and ready for your next round.`);
    } catch (error) {
      setStudioNotice(error instanceof DOMException && error.name === "TimeoutError"
        ? "The illustration timed out after two minutes. No other word was used; try again when Agnes is less busy."
        : "The illustration could not be created. Check the local server and try again.");
    } finally { setGeneratingWordId(null); }
  };

  const generateIllustrationBatch = async () => {
    if (generatingWordId || illustrationBatch) return;
    const queue = customWords.filter((word) => !isGeneratedIllustration(word.image));
    if (!queue.length) { setStudioNotice("All your words already have illustrations."); return; }
    const failed: string[] = [];
    setIllustrationBatch({ current: 0, total: queue.length, failed });
    for (let index = 0; index < queue.length; index += 1) {
      const word = queue[index];
      setIllustrationBatch({ current: index + 1, total: queue.length, failed: [...failed] });
      setGeneratingWordId(word.id);
      setStudioNotice(`Drawing ${word.word} · ${index + 1} of ${queue.length}…`);
      try {
        const response = await fetch("/api/generate-illustration", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ word: word.word, translation: word.chinese }), signal: AbortSignal.timeout(120000) });
        const payload = await response.json() as { image?: string; source?: string; message?: string };
        if (!response.ok || !payload.image || payload.source !== "ai") throw new Error(payload.message || "No illustration returned");
        const updated = { ...word, image: payload.image, illustrationVersion: ILLUSTRATION_STYLE_VERSION };
        registerVocabularyWords([updated]);
        setCustomWords((current) => current.map((item) => item.id === word.id ? updated : item));
      } catch {
        failed.push(word.word);
        setStudioNotice(`${word.word} could not be illustrated. You can retry it below.`);
      } finally { setGeneratingWordId(null); }
    }
    setIllustrationBatch(null);
    setStudioNotice(failed.length ? `${queue.length - failed.length} illustrated. Retry: ${failed.join(", ")}.` : `${queue.length} illustrations are ready for your next round.`);
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
    if (explicitSetSelected && pool.length < 4) {
      const message = mode === "student" ? "This classroom link has fewer than four words. Ask your teacher to share a larger set." : "Add at least four words to this class folder before starting a round.";
      if (mode === "student") setStudentJoinNotice(message);
      else setFolderNotice(message);
      return;
    }
    const next = createMatch(mode, playerNames.length ? playerNames : ["Builder"], 17, pool, durationMinutes);
    stopVoice(); setVoiceStatus(null); setMatch(next); setPhase("playing"); setSelected([]); setSentence(""); setFeedback(null); setPendingReview(null); setSelectedBuildingId(null); setSelectedFloor(1); setAbilityTargetId("");
  };

  const finishMatch = () => { if (match) { stopVoice(); const finished = { ...match, status: "finished" as const, remainingSeconds: 0 }; saveHistory(finished); setMatch(finished); setPhase("finished"); } };

  const commitResult = (result: EvaluationResult, sentenceToCommit: string, targetsToCommit: string[], durationMs = 0) => {
    setFeedback(result);
    setMatch((current) => current ? applyEvaluation(current, sentenceToCommit, targetsToCommit, result, durationMs) : current);
    setPendingReview(null);
    setSelected([]);
    setSentence("");
    setVoiceStatus(null);
  };

  const evaluate = async () => {
    if (!match || !activePlayer || !selected.length || !sentence.trim() || isEvaluating) return;
    if (isListening) stopVoice();
    const request = { sentence, inputMethod, targetWords: selected.map((id) => vocabularyById[id]?.word || id), gradeBand: "7-9" as const };
    const instant = evaluateRules(request);
    if (instant) { setFeedback(instant); setMatch((current) => current ? applyEvaluation(current, sentence, selected, instant) : current); return; }
    const key = `${CACHE_PREFIX}${evaluationCacheKey(request)}`;
    const cached = window.localStorage.getItem(key);
    if (cached) {
      const result = JSON.parse(cached) as EvaluationResult;
      if (result.source === "ai") {
        if (result.confidence < 0.7) { setFeedback(result); setPendingReview({ result, sentence, targets: selected }); }
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
      if (result.source === "ai" && result.confidence < 0.7) { setFeedback(result); setPendingReview({ result, sentence, targets: selected }); } else commitResult(result, sentence, selected, performance.now() - started);
    } catch {
      const result: EvaluationResult = { valid: true, confidence: .5, reason: "Saved as a provisional practice sentence while the evaluator reconnects.", correctedSentence: sentence, relationshipSummary: "Your target words appeared together.", source: "rules-fallback", provisional: true };
      commitResult(result, sentence, selected, performance.now() - started);
    } finally { setIsEvaluating(false); }
  };

  const countPendingPractice = () => { if (!pendingReview) return; commitResult({ ...pendingReview.result, valid: true, reason: `${pendingReview.result.reason} Counted as practice while the evaluator is unsure.` }, pendingReview.sentence, pendingReview.targets); };
  const retryPending = () => { setPendingReview(null); setFeedback(null); };

  const selectedStructure = activePlayer?.structures.find((structure) => structure.id === selectedBuildingId) || activePlayer?.structures[0];
  const abilityNeedsTarget = selectedStructure?.ability === "social" || (selectedStructure?.ability === "exchange" && match?.mode === "local" && (match.players.length || 0) > 1);
  const useSelectedAbility = () => {
    if (!match || !activePlayer || !selectedStructure?.ability) return;
    if (abilityNeedsTarget && !abilityTargetId) return;
    const next = useAbility(match, activePlayer.id, selectedStructure.ability, abilityNeedsTarget ? abilityTargetId : undefined);
    if (next === match) return;
    setMatch(next);
    setAbilityTargetId("");
  };

  const speak = (word: string) => { if (typeof window !== "undefined" && "speechSynthesis" in window) { window.speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(word); utterance.rate = .78; window.speechSynthesis.speak(utterance); } setMatch((current) => current ? notePronunciation(current) : current); };

  const startVoice = () => {
    const SpeechRecognition = (window as Window & { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition || (window as Window & { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition;
    if (!SpeechRecognition) { setFeedback({ valid: false, confidence: 1, reason: "This browser does not provide speech recognition. Try Chrome or Safari, or type the sentence instead.", correctedSentence: "", relationshipSummary: "", source: "rules", provisional: false }); return; }

    if (voiceActive.current) return;
    voiceActive.current = true;
    voiceFinalText.current = "";
    voiceInterimText.current = "";
    setFeedback(null);
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
          setFeedback({ valid: false, confidence: 1, reason: "Microphone access is blocked. Allow microphone access for localhost:8000, then try again.", correctedSentence: "", relationshipSummary: "", source: "rules", provisional: false });
          return;
        }
        if (error === "audio-capture") {
          voiceActive.current = false;
          setIsListening(false);
          setVoiceStatus(null);
          setFeedback({ valid: false, confidence: 1, reason: "No microphone was found. Check your microphone and try again.", correctedSentence: "", relationshipSummary: "", source: "rules", provisional: false });
          return;
        }
        if (error === "network") {
          voiceActive.current = false;
          setIsListening(false);
          setVoiceStatus(null);
          setFeedback({ valid: false, confidence: 1, reason: "The browser's speech service is unavailable. Try Chrome or Safari on localhost:8000, or use typed input.", correctedSentence: voiceFinalText.current, relationshipSummary: "", source: "rules", provisional: false });
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
        setFeedback({ valid: false, confidence: 1, reason: "Voice input could not start. Allow microphone access for localhost:8000 and try again.", correctedSentence: "", relationshipSummary: "", source: "rules", provisional: false });
      }
    };
    startAttempt();
  };

  if (phase === "setup") return <Setup mode={mode} setMode={selectMode} names={names} setNames={setNames} learnerLevel={learnerLevel} setLearnerLevel={setLearnerLevel} wordFocus={wordFocus} setWordFocus={setWordFocus} durationMinutes={durationMinutes} setDurationMinutes={setDurationMinutes} startMatch={startMatch} studentLink={studentLink} setStudentLink={(value) => { setStudentLink(value); setStudentJoined(false); setStudentJoinNotice(null); }} studentJoined={studentJoined} studentJoinNotice={studentJoinNotice} onJoinTeacherLink={() => applyClassroomLink(studentLink)} shareUrl={shareUrl} shareNotice={shareNotice} onCreateStudentLink={createStudentLink} onCopyStudentLink={copyStudentLink} customWords={customWords} linkedClassWords={linkedClassWords} classFolders={classFolders} activeFolder={activeFolder} selectedLibraryIds={selectedLibraryIds} folderNameDraft={folderNameDraft} setFolderNameDraft={setFolderNameDraft} libraryQuery={libraryQuery} setLibraryQuery={setLibraryQuery} libraryLevel={libraryLevel} setLibraryLevel={setLibraryLevel} libraryTopic={libraryTopic} setLibraryTopic={setLibraryTopic} folderNotice={folderNotice} folderFileInputRef={folderFileInputRef} libraryWords={libraryWords} onSelectFolder={selectClassFolder} onNewFolder={startNewClassFolder} onCreateFolder={createClassFolder} onSaveFolder={saveActiveClassFolder} onDeleteFolder={deleteActiveClassFolder} onToggleLibraryWord={(id) => setSelectedLibraryIds((current) => current.includes(id) ? current.filter((wordId) => wordId !== id) : [...current, id])} onSelectVisibleWords={(ids) => setSelectedLibraryIds((current) => [...new Set([...current, ...ids])])} onClearVisibleWords={(ids) => setSelectedLibraryIds((current) => current.filter((id) => !ids.includes(id)))} onImportFolder={importClassFolder} onExportFolder={exportActiveClassFolder} studioDraft={studioDraft} setStudioDraft={setStudioDraft} studioNotice={studioNotice} importInputRef={importInputRef} onImport={importVocabulary} onImportFile={importFile} onGenerate={generateIllustration} onGenerateBatch={generateIllustrationBatch} onDelete={deleteCustomWord} generatingWordId={generatingWordId} illustrationBatch={illustrationBatch} />;
  if (phase === "finished" && match) return <Summary match={match} restart={() => { clearMatch(); setPhase("setup"); setMatch(null); }} />;
  if (!match || !activePlayer) return null;

  return <main className="app-shell"><Header /><div className="content">
    <div className="game-top"><div className="game-title"><div className="eyebrow">{match.mode === "student" ? "Student table" : match.mode === "solo" ? "Individual practice" : "Team rotation"}</div><h2>{activePlayer.name}'s turn</h2></div><div className={`timer ${match.remainingSeconds < 90 ? "warning" : ""}`}><span className="timer-dot" />{formatTime(match.remainingSeconds)}</div><button className="btn btn-ghost" onClick={finishMatch}>End round</button></div>
    {match.mode === "local" && <div className="player-tabs">{match.players.map((player, index) => <button key={player.id} className={`player-tab ${index === match.activeSeat ? "active" : ""}`} onClick={() => { stopVoice(); setVoiceStatus(null); setSelected([]); setSentence(""); setFeedback(null); setPendingReview(null); setSelectedBuildingId(null); setSelectedFloor(1); setAbilityTargetId(""); setMatch({ ...match, activeSeat: index }); }}>{player.name} · {player.score} pts</button>)}</div>}
    <div className="game-grid"><section className="panel workspace"><div className="workspace-head"><div><div className="eyebrow">Your word shelf</div><h3>Choose ingredients</h3><div className="subtle">Select one word for a focused build, or several words to make a richer sentence. Known recipes can hide inside a larger combination.</div></div><span className="pill">{selected.length}/{selectionLimit} selected</span></div>
      <div className="hand">{activePlayer.hand.map((id) => { const item = vocabularyById[id]; const familiarity = activePlayer.familiarity[id] || 0; const toggle = () => setSelected((current) => current.includes(id) ? current.filter((word) => word !== id) : current.length < selectionLimit ? [...current, id] : current); return <div key={id} className={`word-card ${selected.includes(id) ? "selected" : ""}`} role="button" tabIndex={0} onClick={toggle} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(); } }}><button className="speak" title={`Hear ${item.word}`} onClick={(event) => { event.stopPropagation(); speak(item.word); }}>🔊</button><img src={item.image} alt=""/><b>{item.word}</b><small>{item.chinese} · {item.level}</small><span className="familiarity" aria-label={`${familiarity} familiarity`}>{[0,1,2,3,4].map((dot) => <i key={dot} className={dot < Math.min(5, familiarity) ? "on" : ""} />)}</span></div>; })}</div>
      <div className="sentence-area"><div className="eyebrow">Make it meaningful</div><p className="subtle">Use <strong>{selectedLabels || "your selected words"}</strong> in a complete English sentence.</p><textarea className="sentence-box" value={sentence} onChange={(event) => { setSentence(event.target.value); setInputMethod("text"); setVoiceStatus(null); }} placeholder="Example: I bought a pastry, a cold beverage, and a textbook at the cafeteria." />{inputMethod === "voice" && <p className="voice-hint">Voice → text writes the transcript into this box. You can edit it before crafting.</p>}<div className="action-row"><button className="btn btn-primary" disabled={!selected.length || !sentence.trim() || isEvaluating} onClick={evaluate}>{isEvaluating ? "Checking…" : selected.length > 1 ? `Craft with ${selected.length} words` : "Build with this word"}</button><button className={`btn ${isListening ? "btn-coral" : "btn-mint"}`} aria-pressed={isListening} onClick={isListening ? stopVoice : startVoice}>{isListening ? "Listening… tap to stop" : "🎙 Voice → text"}</button><span className="microcopy">{voiceStatus || (inputMethod === "voice" ? "Voice transcript ready" : "Text input")} · select up to {selectionLimit} words</span></div>{feedback && <div className={`feedback ${feedback.valid ? "" : "bad"}`}><strong>{feedback.valid ? "✨ That works" : "Not quite yet"}</strong><p>{feedback.reason}</p>{feedback.relationshipSummary && <p className="subtle">{feedback.relationshipSummary}</p>}{feedback.provisional && <div className="provisional">Provisional practice result · semantic AI was unavailable or unsure.</div>}{pendingReview && <div className="action-row"><button className="btn btn-mint" onClick={countPendingPractice}>Count as practice</button><button className="btn btn-ghost" onClick={retryPending}>Edit and retry</button></div>}</div>}</div>
    </section><aside className="side-stack"><section className="panel side-card"><h3>Your world</h3><div className="score-row"><span>World score</span><span className="score">{activePlayer.score}</span></div><div className="score-row"><span>Recipes discovered</span><span className="score">{activePlayer.discoveredRecipes.length}/{recipes.length}</span></div><div className="score-row"><span>Core word</span><span className="score">{coreWord(activePlayer) ? vocabularyById[coreWord(activePlayer)]?.word : "—"}</span></div></section><section className="panel side-card"><h3>How to play</h3><p className="subtle">A single word grows familiarity. A meaningful pair unlocks a new place. Borrowing another player’s word helps both worlds learn. Open the campus map below to choose a floor and spend a building ability.</p>{match.lastInteraction && <div className="feedback interaction-feed"><strong>Campus message</strong><p>{match.lastInteraction}</p></div>}{match.previewWord && <div className="feedback"><strong>Next draw</strong><p>{vocabularyById[match.previewWord]?.word}</p></div>}</section></aside></div>
    <div className="campus-tools"><BuildingPanel player={activePlayer} match={match} selectedBuildingId={selectedBuildingId} selectedFloor={selectedFloor} targetPlayerId={abilityTargetId} onSelectBuilding={(id) => { setSelectedBuildingId(id); setSelectedFloor(1); setAbilityTargetId(""); }} onSelectFloor={setSelectedFloor} onSelectTarget={setAbilityTargetId} onUseAbility={useSelectedAbility} /><RecipeBook player={activePlayer} /></div>
  </div><div className="footer-note">Wordcraft Classroom · meaningful vocabulary practice at your learners’ level</div></main>;
}

type BuildingPanelProps = {
  player: PlayerState;
  match: MatchState;
  selectedBuildingId: string | null;
  selectedFloor: number;
  targetPlayerId: string;
  onSelectBuilding: (id: string) => void;
  onSelectFloor: (floor: number) => void;
  onSelectTarget: (id: string) => void;
  onUseAbility: () => void;
};

function BuildingPanel({ player, match, selectedBuildingId, selectedFloor, targetPlayerId, onSelectBuilding, onSelectFloor, onSelectTarget, onUseAbility }: BuildingPanelProps) {
  const selected = player.structures.find((structure) => structure.id === selectedBuildingId) || player.structures[0];
  const ability = selected?.ability;
  const abilityFloor = selected?.abilityFloor || 1;
  const targetRequired = ability === "social" || (ability === "exchange" && match.mode === "local" && match.players.length > 1);
  const targetPlayers = match.players.filter((candidate) => candidate.id !== player.id);
  const floorUnlocked = (floor: number) => Boolean(selected && floor <= Math.min(3, Math.max(1, selected.level)));
  const buildingImage = selected?.image?.startsWith("/buildings/") ? selected.image : buildingImageForWord[selected?.sourceWords[0] || ""] || selected?.image || vocabularyById[selected?.sourceWords[0] || ""]?.image;
  const used = ability ? player.usedAbilities.includes(ability) : false;

  return <section className="panel campus-panel building-panel">
    <div className="campus-panel-head"><div><div className="eyebrow">Campus map</div><h3>Walk inside your buildings</h3><p className="subtle">Choose a building, then choose a floor. Higher floors open as that building upgrades.</p></div><span className="pill">{player.structures.length} {player.structures.length === 1 ? "place" : "places"}</span></div>
    {player.structures.length === 0 ? <div className="empty-building"><span className="empty-building-icon">🏗️</span><div><b>Your campus is waiting for its first building.</b><p className="subtle">Use a word or a recipe above. The new place will appear here with an illustrated entrance.</p></div></div> : <>
      <div className="building-list">{player.structures.map((structure) => {
        const image = structure.image?.startsWith("/buildings/") ? structure.image : buildingImageForWord[structure.sourceWords[0]] || structure.image || vocabularyById[structure.sourceWords[0]]?.image;
        const active = structure.id === selected?.id;
        return <button key={structure.id} className={`building-tile ${active ? "active" : ""}`} onClick={() => onSelectBuilding(structure.id)}><img src={image} alt={`${structure.name} illustration`}/><span className="building-tile-copy"><b>{structure.name}</b><small>{structure.sourceWords.map((word) => vocabularyById[word]?.word || word).join(" + ")}</small></span><span className="building-level">Lv {structure.level}</span></button>;
      })}</div>
      {selected && <div className="building-console">
        <div className="building-hero"><img src={buildingImage} alt={`${selected.name} illustration`}/><div><div className="eyebrow">{selected.name}</div><h4>Level {selected.level} building</h4><p className="subtle">Formula: <strong>{selected.sourceWords.map((word) => vocabularyById[word]?.word || word).join(" + ")}</strong></p></div></div>
        <div className="floor-strip" aria-label={`${selected.name} floors`}>{[1, 2, 3].map((floor) => { const unlocked = floorUnlocked(floor); const isAbilityFloor = Boolean(ability && floor === abilityFloor); return <button key={floor} className={`floor-btn ${selectedFloor === floor ? "selected" : ""} ${isAbilityFloor ? "ability-floor" : ""}`} disabled={!unlocked} title={unlocked ? `Enter floor ${floor}` : `Upgrade to level ${floor} to unlock this floor`} onClick={() => onSelectFloor(floor)}><span className="floor-number">{unlocked ? floor : "🔒"}</span><span>{isAbilityFloor ? "Ability" : `Floor ${floor}`}</span></button>; })}</div>
        {ability && selectedFloor === abilityFloor && <div className="ability-console"><div><div className="eyebrow">Floor {abilityFloor} ability</div><b>{abilityCopy[ability].title}{used ? " · already used" : ""}</b><p className="subtle">{abilityCopy[ability].description}</p></div>{targetRequired && <label className="target-picker"><span>Choose a builder to interact with</span><select value={targetPlayerId} onChange={(event) => onSelectTarget(event.target.value)}><option value="">Select a player…</option>{targetPlayers.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}</select></label>}<button className="btn btn-mint" disabled={used || (targetRequired && !targetPlayerId) || (targetRequired && !targetPlayers.length)} onClick={onUseAbility}>{used ? "Ability spent" : targetRequired ? "Use on this builder" : "Use ability"}</button></div>}
      </div>}
    </>}
  </section>;
}

function RecipeBook({ player }: { player: PlayerState }) {
  const discovered = new Set(player.discoveredRecipes);
  const unlockedTier = unlockedRecipeTier(player.discoveredRecipes);
  const tierMessage = unlockedTier === 3 ? "Every formula tier is open." : unlockedTier === 1 ? "Tier 1 is open. Discover every Tier 1 formula to open Tier 2." : "Tier 2 is open. Discover every Tier 2 formula to open Tier 3.";
  return <section className="panel campus-panel recipe-panel"><div className="campus-panel-head"><div><div className="eyebrow">Builder's notebook</div><h3>Building formulas</h3><p className="subtle">{tierMessage} The next tier is previewed without opening it.</p></div><span className="pill">{player.discoveredRecipes.length}/{recipes.length} discovered</span></div><div className="formula-list">{recipes.map((recipe) => {
    const isDiscovered = discovered.has(recipe.id);
    const tierOpen = recipe.unlockTier <= unlockedTier;
    const open = tierOpen || isDiscovered;
    const preview = !open && recipe.unlockTier === unlockedTier + 1;
    const ingredientLabels = recipe.ingredients.map((word) => vocabularyById[word]?.word || word);
    const waitingOnTier = isDiscovered && !tierOpen;
    return <div className={`formula-row ${open ? "open" : preview ? "preview" : "locked"} ${isDiscovered ? "discovered" : ""}`} key={recipe.id}><img src={recipe.buildingImage} alt={open ? `${recipe.result} illustration` : "Locked building illustration"}/><div className="formula-copy"><div className="formula-meta"><span>Tier {recipe.unlockTier}</span>{isDiscovered ? <span className="discovered-tag">{waitingOnTier ? "Built · finish earlier tier" : "Built · open"}</span> : open ? <span className="available-tag">Available</span> : null}{preview && <span className="next-tag">Next tier preview</span>}</div>{open ? <><b>{recipe.result}</b><p>{ingredientLabels.join(" + ")}</p><small>{waitingOnTier ? "Built already; finish the earlier tier to open this tier." : recipe.discoveryText}</small></> : preview ? <><b>??? building</b><p>{ingredientLabels.join(" + ")}</p><small>{recipe.unlockTier === 2 ? "Finish every Tier 1 build to open this formula." : "Finish every Tier 2 build to open this formula."}</small></> : <><b>Locked formula</b><p>Complete the previous tier first.</p><small>Keep building and using words in context.</small></>}</div>{isDiscovered ? <span className="formula-check">BUILT ✓</span> : open ? <span className="formula-check">OPEN ↗</span> : <span className="formula-lock">{preview ? "◌" : "🔒"}</span>}</div>;
  })}</div></section>;
}

function Header() { return <header className="topbar"><a className="brand" href="#"><span className="brand-mark">W</span><span className="brand-name">Wordcraft Classroom</span></a><span className="pill">For teachers &amp; active students</span></header>; }

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
  onGenerateBatch: () => void;
  onDelete: (wordId: string) => void;
  generatingWordId: string | null;
  illustrationBatch: { current: number; total: number; failed: string[] } | null;
};

function Setup({ mode, setMode, names, setNames, learnerLevel, setLearnerLevel, wordFocus, setWordFocus, durationMinutes, setDurationMinutes, startMatch, studentLink, setStudentLink, studentJoined, studentJoinNotice, onJoinTeacherLink, shareUrl, shareNotice, onCreateStudentLink, onCopyStudentLink, customWords, linkedClassWords, classFolders, activeFolder, selectedLibraryIds, folderNameDraft, setFolderNameDraft, libraryQuery, setLibraryQuery, libraryLevel, setLibraryLevel, libraryTopic, setLibraryTopic, folderNotice, folderFileInputRef, libraryWords, onSelectFolder, onNewFolder, onCreateFolder, onSaveFolder, onDeleteFolder, onToggleLibraryWord, onSelectVisibleWords, onClearVisibleWords, onImportFolder, onExportFolder, studioDraft, setStudioDraft, studioNotice, importInputRef, onImport, onImportFile, onGenerate, onGenerateBatch, onDelete, generatingWordId, illustrationBatch }: SetupProps) {
  const levels = LEVEL_OPTIONS;
  const focuses = FOCUS_OPTIONS;
  const studentMode = mode === "student";
  const focusLabel = focuses.find((focus) => focus.id === wordFocus)?.label || "your teacher's focus";

  return <main className="app-shell"><Header />
    <div className="hero teacher-hero">
      <div className="hero-copy"><div className="eyebrow">Vocabulary practice for any English classroom</div><h1>Plan less.<br/><span>Make words stick.</span></h1><p>Teachers set the words. Students hear, use, combine, and revisit them through meaningful sentences.</p><div className="hero-proof"><span><b>54</b> ready-to-play words</span><span><b>3</b> adaptable levels</span><span><b>1</b> classroom link</span></div></div>
      <div className="hero-art lesson-card" role="img" aria-label="A teacher shares one classroom link with student tables"><div className="lesson-card-kicker">ONE LINK · MANY TABLES</div><div className="share-flow"><div className="share-node"><span className="share-avatar teacher-avatar">T</span><div><b>Teacher</b><small>sets the words</small></div></div><span className="share-arrow" aria-hidden="true">→</span><div className="share-node"><span className="share-avatar student-avatar">S</span><div><b>Student Table</b><small>learns at their pace</small></div></div></div><div className="lesson-card-rule"/><p className="lesson-card-caption">One classroom link · every learner has a seat</p></div>
    </div>
    <div className="content"><div className={`setup-grid teacher-setup ${studentMode ? "student-setup" : ""}`}><section className="panel setup-card"><div className="eyebrow">Your lesson setup</div><h2>{studentMode ? "Join a teacher's table" : "Make this game fit your class"}</h2><p>{studentMode ? "Paste the link your teacher shared. Your words and level will load on this device." : activeFolder ? `Using the ${activeFolder.name} folder. Change its words below when you are ready.` : "Choose a language level and round length, then save a class folder or use the initial word bank."}</p>
      <div className="setup-section"><label className="field-label">1 · How will students play?</label><div className="mode-row"><button className={`mode-btn ${mode === "solo" ? "active" : ""}`} onClick={() => setMode("solo")}><strong>Individual</strong><span>One learner or a projected class challenge.</span></button><button className={`mode-btn ${mode === "local" ? "active" : ""}`} onClick={() => setMode("local")}><strong>Teams / pairs</strong><span>Rotate 2–4 groups on one screen.</span></button><button className={`mode-btn ${mode === "student" ? "active" : ""}`} onClick={() => setMode("student")}><strong>Student Table</strong><span>Join your teacher's words with a link.</span></button></div></div>
      {studentMode ? <div className="student-join-panel"><div className="eyebrow">Student Table</div><h3>Join your teacher's vocabulary</h3><p className="subtle">Paste the classroom link your teacher copied for you. It brings in the same class words, level, and round length.</p><div className="student-join-row"><label className="visually-hidden" htmlFor="teacher-classroom-link">Teacher classroom link</label><input id="teacher-classroom-link" className="text-input" value={studentLink} onChange={(event) => setStudentLink(event.target.value)} placeholder="Paste your teacher's classroom link"/><button className="btn btn-mint" disabled={!studentLink.trim()} onClick={onJoinTeacherLink}>Join classroom</button></div>{studentJoinNotice && <p className={`student-join-notice ${studentJoined ? "success" : "error"}`} role="status">{studentJoinNotice}</p>}</div> : <><div className="setup-section"><label className="field-label">2 · Choose the language level</label><div className="choice-grid">{levels.map((level) => <button key={level.id} className={`choice-chip ${learnerLevel === level.id ? "active" : ""}`} onClick={() => setLearnerLevel(level.id)}><b>{level.label}</b><small>{level.note}</small></button>)}</div></div><div className="setup-section round-length-section"><div className="round-length-field"><label className="field-label" htmlFor="round-length">3 · Round length</label><select id="round-length" className="text-input" value={durationMinutes} onChange={(event) => setDurationMinutes(Number(event.target.value))}>{[5,8,12,15].map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}</select></div></div><details className="advanced-section"><summary className="advanced-toggle"><span className="advanced-toggle-copy"><b>Advanced options</b><small>{wordFocus === "mixed" ? "Optional topic filter for the initial word bank" : `Initial word bank: ${focusLabel}`}</small></span><span className="advanced-chevron" aria-hidden="true">⌄</span></summary><div className="advanced-options"><label className="field-label" htmlFor="vocabulary-focus">Topic</label><select id="vocabulary-focus" className="text-input" value={wordFocus} onChange={(event) => setWordFocus(event.target.value as WordFocus)}>{focuses.map((focus) => <option key={focus.id} value={focus.id}>{focus.label}</option>)}</select><p className="advanced-caption">Use this only when you want to narrow the initial Wordcraft word bank by topic. Saved class folders use the words you select below.</p></div></details></>}
      {!studentMode && <div className="setup-section lesson-folder-section"><label className="field-label" htmlFor="lesson-folder">4 · Class folder for this round</label><select id="lesson-folder" className="text-input" value={activeFolder?.id || "initial"} onChange={(event) => event.target.value === "initial" ? onNewFolder() : onSelectFolder(event.target.value)}><option value="initial">Initial Wordcraft word bank</option>{classFolders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name} · {folder.words.length} words</option>)}</select><small className="subtle">Pick a saved class set, or use the initial testing bank. Manage folders below.</small></div>}
      <div className="setup-section"><label className="field-label">{studentMode ? "2 · Your name" : "5 · " + (mode === "solo" ? "Learner or class name" : "Team names")}</label>{studentMode ? <input className="text-input" value={names[0]} onChange={(event) => setNames([event.target.value, ...names.slice(1)])} placeholder="Your name" /> : mode === "solo" ? <input className="text-input" value={names[0]} onChange={(event) => setNames([event.target.value, ...names.slice(1)])} /> : <div className="name-grid">{names.map((name, index) => <input className="text-input" key={index} value={name} placeholder={`Team ${index + 1}`} onChange={(event) => setNames(names.map((current, item) => item === index ? event.target.value : current))} />)}</div>}</div>
      {studentMode && studentJoined && <div className="student-ready"><span>✓</span><div><b>Ready for {focusLabel}</b><small>{linkedClassWords.length ? `${linkedClassWords.length} class words` : "Class word bank"} · {durationMinutes} minutes</small></div></div>}
      <div className="teacher-actions"><button className="btn btn-primary start-lesson" disabled={studentMode && !studentJoined} onClick={startMatch}>{studentMode ? "Start student table" : "Start vocabulary round"}<span>→</span></button>{!studentMode && <button className="share-link-trigger" onClick={onCreateStudentLink}>🔗 Get student link</button>}</div>
      {!studentMode && shareUrl && <div className="share-link-panel" aria-live="polite"><div><b>Student link ready</b><small>Students can open this link or paste it into Student Table.</small></div><div className="share-link-row"><label className="visually-hidden" htmlFor="student-share-link">Student classroom link</label><input id="student-share-link" className="share-link-input" value={shareUrl} readOnly onFocus={(event) => event.currentTarget.select()} /><button className="btn btn-mint" onClick={onCopyStudentLink}>Copy</button></div>{shareNotice && <p className="share-link-notice" role="status">{shareNotice}</p>}</div>}
      </section>{!studentMode && <section className="panel feature-card teacher-guide"><div className="eyebrow">For every learner</div><h3>Teachers set the pace.<br/>Students make it theirs.</h3><div className="feature-list"><div className="feature"><span className="feature-icon">01</span><div><b>Teacher sets the words</b><small>Build a focused set and share one classroom link.</small></div></div><div className="feature"><span className="feature-icon">02</span><div><b>Students join instantly</b><small>Each learner gets a personal table with no account.</small></div></div><div className="feature"><span className="feature-icon">03</span><div><b>Context over recall</b><small>Use complete sentences to make every word stick.</small></div></div><div className="feature"><span className="feature-icon">04</span><div><b>Review you can see</b><small>Every table shows which words need another turn.</small></div></div></div><div className="teacher-tip"><b>Teacher tip</b><span>Project the teacher view, then let students open their own Student Table.</span></div></section>}</div>{!studentMode && <><ClassFolderStudio classFolders={classFolders} activeFolder={activeFolder} selectedLibraryIds={selectedLibraryIds} folderNameDraft={folderNameDraft} setFolderNameDraft={setFolderNameDraft} libraryQuery={libraryQuery} setLibraryQuery={setLibraryQuery} libraryLevel={libraryLevel} setLibraryLevel={setLibraryLevel} libraryTopic={libraryTopic} setLibraryTopic={setLibraryTopic} folderNotice={folderNotice} folderFileInputRef={folderFileInputRef} libraryWords={libraryWords} onSelectFolder={onSelectFolder} onNewFolder={onNewFolder} onCreateFolder={onCreateFolder} onSaveFolder={onSaveFolder} onDeleteFolder={onDeleteFolder} onToggleLibraryWord={onToggleLibraryWord} onSelectVisibleWords={onSelectVisibleWords} onClearVisibleWords={onClearVisibleWords} onImportFolder={onImportFolder} onExportFolder={onExportFolder} /><IllustrationStudio customWords={customWords} studioDraft={studioDraft} setStudioDraft={setStudioDraft} studioNotice={studioNotice} importInputRef={importInputRef} onImport={onImport} onImportFile={onImportFile} onGenerate={onGenerate} onGenerateBatch={onGenerateBatch} onDelete={onDelete} generatingWordId={generatingWordId} illustrationBatch={illustrationBatch} /></>}</div><div className="footer-note">Teachers share the words · students practice on their own table · no accounts needed</div></main>;
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
  const renderWord = (word: VocabularyWord) => <label className={`library-word ${selectedLibraryIds.includes(word.id) ? "selected" : ""}`} key={word.id}><input type="checkbox" checked={selectedLibraryIds.includes(word.id)} onChange={() => onToggleLibraryWord(word.id)} /><span><b>{word.word}</b><small>{word.chinese || "No translation"} · {word.level}</small></span></label>;

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
  onGenerateBatch: () => void;
  onDelete: (wordId: string) => void;
  generatingWordId: string | null;
  illustrationBatch: { current: number; total: number; failed: string[] } | null;
};

function IllustrationStudio({ customWords, studioDraft, setStudioDraft, studioNotice, importInputRef, onImport, onImportFile, onGenerate, onGenerateBatch, onDelete, generatingWordId, illustrationBatch }: IllustrationStudioProps) {
  return <section className="panel illustration-studio">
    <div className="studio-heading"><div><div className="eyebrow">Teacher word studio · 词汇插画工作室</div><h2>Bring your own vocabulary to life</h2><p className="subtle">Add your words, then make the whole set ready in one pass. Your set stays on this device.</p></div><div className="studio-count-wrap"><span className="studio-count">{customWords.length}<small>your words</small></span><button className="btn btn-primary batch-button" disabled={!customWords.some((word) => !isGeneratedIllustration(word.image)) || illustrationBatch !== null} onClick={onGenerateBatch}>{illustrationBatch ? `Drawing ${illustrationBatch.current} of ${illustrationBatch.total}` : "Generate all missing art"}</button></div></div>
    <div className="studio-grid">
      <div className="import-column">
        <div className="studio-label">1 · Add your words</div>
        <div className="import-drop"><div className="import-icon">＋</div><div><b>Upload a vocabulary file</b><small>CSV / TXT / JSON · one word per line also works</small></div><input ref={importInputRef} className="visually-hidden" type="file" accept=".csv,.txt,.json,text/csv,text/plain,application/json" onChange={(event) => { onImportFile(event.target.files?.[0]); event.currentTarget.value = ""; }} /><button className="btn btn-ghost" onClick={() => importInputRef.current?.click()}>Choose file</button></div>
        <div className="paste-row"><textarea className="studio-textarea" value={studioDraft} onChange={(event) => setStudioDraft(event.target.value)} placeholder={"Or paste words here…\ncompass, 指南针, L1\ncurious, 好奇的, L2"} /><button className="btn btn-primary" disabled={!studioDraft.trim()} onClick={() => onImport(studioDraft)}>Add words</button></div>
        {studioNotice && <div className="studio-notice" role="status">{studioNotice}</div>}
        <div className="studio-label studio-label-spaced">Your imported set {customWords.length > 0 && <span>{customWords.filter((word) => isGeneratedIllustration(word.image)).length}/{customWords.length} illustrated</span>}</div>
        {customWords.length ? <div className="custom-word-list">{customWords.map((word) => { const isGenerated = isGeneratedIllustration(word.image); const active = generatingWordId === word.id; return <div className={`custom-word-row ${active ? "is-drawing" : ""}`} key={word.id}><img src={word.image || PENDING_WORD_IMAGE} alt=""/><div className="custom-word-copy"><b>{word.word}</b><small>{word.chinese || "No translation"} · {word.level}</small></div><span className={`art-status ${isGenerated ? "ready" : "waiting"}`}>{active ? "Drawing…" : isGenerated ? "Illustrated" : "Needs art"}</span><button className="btn btn-mint art-button" disabled={generatingWordId !== null} onClick={() => onGenerate(word.id)}>{active ? "Drawing…" : isGenerated ? "Redraw" : "Generate art"}</button><button className="delete-word" aria-label={`Delete ${word.word}`} disabled={generatingWordId !== null} onClick={() => onDelete(word.id)}>Delete</button></div>; })}</div> : <div className="studio-empty"><span>✎</span><div><b>Start by adding your words.</b><small>Use CSV, TXT, or JSON, or paste one word per line. Then generate the missing art for the set.</small></div></div>}
      </div>
    </div>
  </section>;
}

function parseImportedVocabulary(raw: string, existing: VocabularyWord[]): VocabularyWord[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  let records: Array<{ word?: unknown; translation?: unknown; chinese?: unknown; level?: unknown }> = [];
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
    const translation = typeof record.translation === "string" ? record.translation : typeof record.chinese === "string" ? record.chinese : "";
    added.push({ id, number: 1000 + existing.length + added.length, word, level, chinese: translation, collocations: [word, `use ${word}`, `learn ${word}`], image: PENDING_WORD_IMAGE, pronunciation: `/${word}/`, fallbackStructure: word[0].toUpperCase() + word.slice(1) });
    existingWords.add(word.toLowerCase());
    existingIds.add(id);
  });
  return added;
}

function slugify(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 42); }

function Summary({ match, restart }: { match: MatchState; restart: () => void }) { const summaries = useMemo(() => summarize(match).sort((a, b) => b.score - a.score), [match]); const winner = summaries[0]; return <main className="app-shell"><Header /><div className="content"><section className="panel summary"><div className="eyebrow">The campus is open</div><h2>Match complete.</h2>{winner && <div className="winner"><div className="eyebrow">Top builder</div><h3>{match.players.find((player) => player.id === winner.playerId)?.name} · {winner.score} points</h3><p className="subtle">Core word: <strong>{winner.highestFamiliarityWord || "still discovering"}</strong>. Every valid use is a small step toward fluency.</p></div>}<table className="summary-table"><thead><tr><th>Builder</th><th>Score</th><th>Places</th><th>Successful uses</th></tr></thead><tbody>{summaries.map((item) => <tr key={item.playerId}><td><strong>{match.players.find((player) => player.id === item.playerId)?.name}</strong></td><td>{item.score}</td><td>{item.craftedStructures.length}</td><td>{item.successfulUses}</td></tr>)}</tbody></table><h3>Review shelf</h3><p className="subtle">Words from attempts that need another look:</p><div className="review">{[...new Set(summaries.flatMap((item) => item.reviewItems))].map((id) => <span key={id}>{vocabularyById[id]?.word || id}</span>)}{!summaries.some((item) => item.reviewItems.length) && <span>Everything got a turn ✨</span>}</div><div className="action-row" style={{ marginTop: 28 }}><button className="btn btn-primary" onClick={restart}>Build another campus</button></div></section></div></main>; }

function formatTime(seconds: number) { return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }
