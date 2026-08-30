"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { abilityCopy, buildingImageForWord, fullVocabulary, recipes, registerVocabularyWords, unlockedRecipeTier, vocabularyById } from "@/data/content";
import { evaluateRules, evaluationCacheKey } from "@/lib/evaluation";
import { applyEvaluation, createMatch, coreWord, notePronunciation, summarize, tick, useAbility } from "@/lib/game-engine";
import { clearMatch, loadCustomWords, loadMatch, loadSettings, saveCustomWords, saveHistory, saveMatch, saveSettings } from "@/lib/storage";
import type { AbilityId, EvaluationResult, InputMethod, MatchMode, MatchState, PlayerState, VocabularyWord } from "@/types/game";

type Phase = "setup" | "playing" | "finished";
type LearnerLevel = "starter" | "developing" | "stretch" | "mixed";
type WordFocus = "everyday" | "school" | "community" | "mixed";
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

export default function Home() {
  const [phase, setPhase] = useState<Phase>("setup");
  const [mode, setMode] = useState<MatchMode>("solo");
  const [names, setNames] = useState(["Maya", "Leo", "June", "Sam"]);
  const [learnerLevel, setLearnerLevel] = useState<LearnerLevel>("developing");
  const [wordFocus, setWordFocus] = useState<WordFocus>("school");
  const [durationMinutes, setDurationMinutes] = useState(8);
  const [customWords, setCustomWords] = useState<VocabularyWord[]>([]);
  const [studioDraft, setStudioDraft] = useState("");
  const [studioNotice, setStudioNotice] = useState<string | null>(null);
  const [generatingWordId, setGeneratingWordId] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
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

  const activePlayer = match?.players[match.activeSeat];
  const selectedLabels = selected.map((id) => vocabularyById[id]?.word).filter(Boolean).join(" + ");
  const selectionLimit = activePlayer?.hand.length || 4;

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
    const settings = loadSettings();
    if (settings) { setMode(settings.mode); setNames(settings.names.length ? settings.names : names); }
    const restored = loadMatch();
    if (restored?.status === "playing" && restored.remainingSeconds > 0) { setMatch(restored); setPhase("playing"); }
  }, []);

  useEffect(() => { saveCustomWords(customWords); }, [customWords]);

  useEffect(() => { saveSettings({ mode, names }); }, [mode, names]);

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

  const generateIllustration = async (wordId: string) => {
    const target = customWords.find((item) => item.id === wordId);
    if (!target || generatingWordId) return;
    setGeneratingWordId(wordId);
    setStudioNotice(`Drawing ${target.word}…`);
    try {
      const response = await fetch("/api/generate-illustration", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ word: target.word }) });
      const payload = await response.json() as { image?: string; source?: string; message?: string };
      if (!response.ok || !payload.image) throw new Error("No illustration returned");
      const updated = { ...target, image: payload.image };
      registerVocabularyWords([updated]);
      setCustomWords((current) => current.map((item) => item.id === wordId ? updated : item));
      setStudioNotice(payload.message || `${target.word} is illustrated and ready for your next round.`);
    } catch {
      setStudioNotice("The illustration could not be created. Check the local server and try again.");
    } finally { setGeneratingWordId(null); }
  };

  const startMatch = () => {
    const playerNames = mode === "solo" ? [names[0]] : names.filter(Boolean).slice(0, 4);
    const levelMap: Record<LearnerLevel, string[]> = { starter: ["L1"], developing: ["L1", "L2"], stretch: ["L2", "L3"], mixed: ["L1", "L2", "L3"] };
    const focusWords: Record<WordFocus, string[]> = {
      everyday: ["dumbbell", "treadmill", "kettle", "locker", "mat", "drawer", "shelf", "outlet", "bulb", "wardrobe", "pantry", "faucet", "countertop", "detergent", "cutlery", "napkin", "pastry", "beverage", "wallet", "receipt"],
      school: ["textbook", "assignment", "lecture", "syllabus", "workload", "tuition", "scholarship", "prerequisite", "plagiarism", "discipline", "adviser", "alumni", "auditorium", "cafeteria", "observatory", "committee"],
      community: ["commute", "intersection", "pedestrian", "pharmacy", "kiosk", "venue", "patron", "landlord", "dormitory", "maintenance", "extension", "souvenir", "luggage"],
      mixed: [],
    };
    const allowedLevels = levelMap[learnerLevel];
    let pool = fullVocabulary.filter((item) => allowedLevels.includes(item.level) && (wordFocus === "mixed" || focusWords[wordFocus].includes(item.id))).map((item) => item.id);
    pool = [...new Set([...pool, ...customWords.filter((item) => allowedLevels.includes(item.level)).map((item) => item.id)])];
    if (pool.length < (mode === "solo" ? 8 : 20)) pool = fullVocabulary.filter((item) => allowedLevels.includes(item.level)).map((item) => item.id);
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
    const request = { sentence, inputMethod, targetWords: selected, gradeBand: "7-9" as const };
    const instant = evaluateRules(request);
    if (instant) { setFeedback(instant); setMatch((current) => current ? applyEvaluation(current, sentence, selected, instant) : current); return; }
    const key = `${CACHE_PREFIX}${evaluationCacheKey(request)}`;
    const cached = window.localStorage.getItem(key);
    if (cached) { const result = JSON.parse(cached) as EvaluationResult; if (result.source === "ai" && result.confidence < 0.7) { setFeedback(result); setPendingReview({ result, sentence, targets: selected }); } else commitResult(result, sentence, selected); return; }
    setIsEvaluating(true);
    const started = performance.now();
    try {
      const response = await fetch("/api/evaluate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
      const result = await response.json() as EvaluationResult;
      window.localStorage.setItem(key, JSON.stringify(result));
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

  if (phase === "setup") return <Setup mode={mode} setMode={setMode} names={names} setNames={setNames} learnerLevel={learnerLevel} setLearnerLevel={setLearnerLevel} wordFocus={wordFocus} setWordFocus={setWordFocus} durationMinutes={durationMinutes} setDurationMinutes={setDurationMinutes} startMatch={startMatch} customWords={customWords} studioDraft={studioDraft} setStudioDraft={setStudioDraft} studioNotice={studioNotice} importInputRef={importInputRef} onImport={importVocabulary} onImportFile={importFile} onGenerate={generateIllustration} generatingWordId={generatingWordId} />;
  if (phase === "finished" && match) return <Summary match={match} restart={() => { clearMatch(); setPhase("setup"); setMatch(null); }} />;
  if (!match || !activePlayer) return null;

  return <main className="app-shell"><Header /><div className="content">
    <div className="game-top"><div className="game-title"><div className="eyebrow">{match.mode === "solo" ? "Individual practice" : "Team rotation"}</div><h2>{activePlayer.name}'s turn</h2></div><div className={`timer ${match.remainingSeconds < 90 ? "warning" : ""}`}><span className="timer-dot" />{formatTime(match.remainingSeconds)}</div><button className="btn btn-ghost" onClick={finishMatch}>End round</button></div>
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

function Header() { return <header className="topbar"><a className="brand" href="#"><span className="brand-mark">W</span><span className="brand-name">Wordcraft Classroom</span></a><span className="pill">Teacher-ready · no student accounts</span></header>; }

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
  customWords: VocabularyWord[];
  studioDraft: string;
  setStudioDraft: (value: string) => void;
  studioNotice: string | null;
  importInputRef: React.RefObject<HTMLInputElement | null>;
  onImport: (raw: string) => void;
  onImportFile: (file: File | undefined) => void;
  onGenerate: (wordId: string) => void;
  generatingWordId: string | null;
};

function Setup({ mode, setMode, names, setNames, learnerLevel, setLearnerLevel, wordFocus, setWordFocus, durationMinutes, setDurationMinutes, startMatch, customWords, studioDraft, setStudioDraft, studioNotice, importInputRef, onImport, onImportFile, onGenerate, generatingWordId }: SetupProps) {
  const levels: { id: LearnerLevel; label: string; note: string }[] = [{ id: "starter", label: "Starter", note: "Concrete, high-frequency words" }, { id: "developing", label: "Developing", note: "Everyday and school vocabulary" }, { id: "stretch", label: "Stretch", note: "More precise, academic language" }, { id: "mixed", label: "Mixed class", note: "A balanced range for differentiation" }];
  const focuses: { id: WordFocus; label: string }[] = [{ id: "everyday", label: "Everyday life" }, { id: "school", label: "School & study" }, { id: "community", label: "Community" }, { id: "mixed", label: "Mixed review" }];
  return <main className="app-shell"><Header /><div className="hero teacher-hero"><div className="hero-copy"><div className="eyebrow">Vocabulary practice for any English classroom</div><h1>Plan less.<br/><span>Make words stick.</span></h1><p>Set the level and focus in under a minute. Students then hear, use, combine, and revisit vocabulary through meaningful sentences.</p><div className="hero-proof"><span><b>54</b> ready-to-play words</span><span><b>4</b> adaptable levels</span><span><b>0</b> student logins</span></div></div><div className="hero-art lesson-card" aria-hidden="true"><div className="card-tape"/><small>TODAY'S WORD WORK</small><b>Say it.</b><b>Use it.</b><b>Build with it.</b><div className="teacher-mark">✓ meaningful context</div></div></div><div className="content"><div className="setup-grid teacher-setup"><section className="panel setup-card"><div className="eyebrow">Your lesson setup</div><h2>Make this game fit your class</h2><p>Choose what your learners need today. You can change everything again before the next round.</p><div className="setup-section"><label className="field-label">1 · How will students play?</label><div className="mode-row"><button className={`mode-btn ${mode === "solo" ? "active" : ""}`} onClick={() => setMode("solo")}><strong>Individual</strong><span>One learner or a projected class challenge.</span></button><button className={`mode-btn ${mode === "local" ? "active" : ""}`} onClick={() => setMode("local")}><strong>Teams / pairs</strong><span>Rotate 2–4 groups on one screen.</span></button></div></div><div className="setup-section"><label className="field-label">2 · Choose the language level</label><div className="choice-grid">{levels.map((level) => <button key={level.id} className={`choice-chip ${learnerLevel === level.id ? "active" : ""}`} onClick={() => setLearnerLevel(level.id)}><b>{level.label}</b><small>{level.note}</small></button>)}</div></div><div className="setup-section split-fields"><div><label className="field-label">3 · Vocabulary focus</label><select className="text-input" value={wordFocus} onChange={(event) => setWordFocus(event.target.value as WordFocus)}>{focuses.map((focus) => <option key={focus.id} value={focus.id}>{focus.label}</option>)}</select></div><div><label className="field-label">Round length</label><select className="text-input" value={durationMinutes} onChange={(event) => setDurationMinutes(Number(event.target.value))}>{[5,8,12,15].map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}</select></div></div><div className="setup-section"><label className="field-label">4 · {mode === "solo" ? "Learner or class name" : "Team names"}</label>{mode === "solo" ? <input className="text-input" value={names[0]} onChange={(event) => setNames([event.target.value, ...names.slice(1)])} /> : <div className="name-grid">{names.map((name, index) => <input className="text-input" key={index} value={name} placeholder={`Team ${index + 1}`} onChange={(event) => setNames(names.map((current, item) => item === index ? event.target.value : current))} />)}</div>}</div><button className="btn btn-primary start-lesson" onClick={startMatch}>Start vocabulary round <span>→</span></button></section><section className="panel feature-card teacher-guide"><div className="eyebrow">Built for real lessons</div><h3>Teach the word,<br/>then let them own it.</h3><div className="feature-list"><div className="feature"><span className="feature-icon">01</span><div><b>Input before output</b><small>Students can hear pronunciation and inspect the image before writing.</small></div></div><div className="feature"><span className="feature-icon">02</span><div><b>Context over recall</b><small>Every point comes from using vocabulary in a complete sentence.</small></div></div><div className="feature"><span className="feature-icon">03</span><div><b>Useful feedback</b><small>Corrections keep the learner moving without erasing their attempt.</small></div></div><div className="feature"><span className="feature-icon">04</span><div><b>Review you can see</b><small>The final shelf shows which words need another turn.</small></div></div></div><div className="teacher-tip"><b>Teacher tip</b><span>Project the game for whole-class modeling, then switch to teams for retrieval practice.</span></div></section></div><IllustrationStudio customWords={customWords} studioDraft={studioDraft} setStudioDraft={setStudioDraft} studioNotice={studioNotice} importInputRef={importInputRef} onImport={onImport} onImportFile={onImportFile} onGenerate={onGenerate} generatingWordId={generatingWordId} /></div><div className="footer-note">Works on one shared screen · type or speak · progress stays on this device</div></main>;
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
  generatingWordId: string | null;
};

function IllustrationStudio({ customWords, studioDraft, setStudioDraft, studioNotice, importInputRef, onImport, onImportFile, onGenerate, generatingWordId }: IllustrationStudioProps) {
  return <section className="panel illustration-studio">
    <div className="studio-heading"><div><div className="eyebrow">Teacher word studio · 词汇插画工作室</div><h2>Bring your own vocabulary to life</h2><p className="subtle">Import a list and make a friendly illustration for each new word. Your set stays on this device.</p></div><span className="studio-count">{customWords.length}<small>your words</small></span></div>
    <div className="studio-grid">
      <div className="import-column">
        <div className="studio-label">1 · Add your words</div>
        <div className="import-drop"><div className="import-icon">＋</div><div><b>Upload a vocabulary file</b><small>CSV / TXT / JSON · one word per line also works</small></div><input ref={importInputRef} className="visually-hidden" type="file" accept=".csv,.txt,.json,text/csv,text/plain,application/json" onChange={(event) => { onImportFile(event.target.files?.[0]); event.currentTarget.value = ""; }} /><button className="btn btn-ghost" onClick={() => importInputRef.current?.click()}>Choose file</button></div>
        <div className="paste-row"><textarea className="studio-textarea" value={studioDraft} onChange={(event) => setStudioDraft(event.target.value)} placeholder={"Or paste words here…\ncompass, 指南针, L1\ncurious, 好奇的, L2"} /><button className="btn btn-primary" disabled={!studioDraft.trim()} onClick={() => onImport(studioDraft)}>Add words</button></div>
        {studioNotice && <div className="studio-notice" role="status">{studioNotice}</div>}
        <div className="studio-label studio-label-spaced">Your imported set {customWords.length > 0 && <span>{customWords.length} ready</span>}</div>
        {customWords.length ? <div className="custom-word-list">{customWords.map((word) => { const isGenerated = word.image.startsWith("data:image") || word.image.startsWith("/illustration-studio/"); return <div className="custom-word-row" key={word.id}><img src={word.image} alt=""/><div className="custom-word-copy"><b>{word.word}</b><small>{word.chinese || "No translation"} · {word.level}</small></div><span className={`art-status ${isGenerated ? "ready" : "waiting"}`}>{isGenerated ? "Illustrated" : "Needs art"}</span><button className="btn btn-mint art-button" disabled={generatingWordId !== null} onClick={() => onGenerate(word.id)}>{generatingWordId === word.id ? "Drawing…" : isGenerated ? "Redraw" : "Generate art"}</button></div>; })}</div> : <div className="studio-empty"><span>✎</span><div><b>Your imported words will appear here.</b><small>Try the two sample lines above to see the full flow.</small></div></div>}
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
  const hasHeader = /(^|[,\t;])(?:word|vocabulary|term)([,\t;]|$)/i.test(first);
  if (!records.length) records = lines.slice(hasHeader ? 1 : 0).map((line) => { const fields = line.split(/[,\t;]/).map((field) => field.trim().replace(/^['"]|['"]$/g, "")); const levelField = fields.find((field) => /^l[123]$/i.test(field)); return { word: fields[0], translation: fields[1] && !/^l[123]$/i.test(fields[1]) ? fields[1] : "", level: levelField || "L1" }; });
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
    added.push({ id, number: 1000 + existing.length + added.length, word, level, chinese: translation, collocations: [word, `use ${word}`, `learn ${word}`], image: "/vocab/dumbbell.png", pronunciation: `/${word}/`, fallbackStructure: word[0].toUpperCase() + word.slice(1) });
    existingWords.add(word.toLowerCase());
    existingIds.add(id);
  });
  return added;
}

function slugify(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 42); }

function Summary({ match, restart }: { match: MatchState; restart: () => void }) { const summaries = useMemo(() => summarize(match).sort((a, b) => b.score - a.score), [match]); const winner = summaries[0]; return <main className="app-shell"><Header /><div className="content"><section className="panel summary"><div className="eyebrow">The campus is open</div><h2>Match complete.</h2>{winner && <div className="winner"><div className="eyebrow">Top builder</div><h3>{match.players.find((player) => player.id === winner.playerId)?.name} · {winner.score} points</h3><p className="subtle">Core word: <strong>{winner.highestFamiliarityWord || "still discovering"}</strong>. Every valid use is a small step toward fluency.</p></div>}<table className="summary-table"><thead><tr><th>Builder</th><th>Score</th><th>Places</th><th>Successful uses</th></tr></thead><tbody>{summaries.map((item) => <tr key={item.playerId}><td><strong>{match.players.find((player) => player.id === item.playerId)?.name}</strong></td><td>{item.score}</td><td>{item.craftedStructures.length}</td><td>{item.successfulUses}</td></tr>)}</tbody></table><h3>Review shelf</h3><p className="subtle">Words from attempts that need another look:</p><div className="review">{[...new Set(summaries.flatMap((item) => item.reviewItems))].map((id) => <span key={id}>{vocabularyById[id]?.word || id}</span>)}{!summaries.some((item) => item.reviewItems.length) && <span>Everything got a turn ✨</span>}</div><div className="action-row" style={{ marginTop: 28 }}><button className="btn btn-primary" onClick={restart}>Build another campus</button></div></section></div></main>; }

function formatTime(seconds: number) { return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }
