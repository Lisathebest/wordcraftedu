"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from "react";
import { chineseLevelMeta, chineseVocabulary } from "@/data/chinese-vocabulary";
import { joiningWords, sentenceStructures, tenseHelp } from "@/data/chinese-reference";
import { BingoBoard } from "@/app/bingo-board";
import { FeedbackPanel } from "@/app/feedback-panel";
import { createBingoProgress, markBingoWords } from "@/lib/bingo";
import { buildFallbackScaffold } from "@/lib/chinese-scaffold";
import { loadHideImagesUntilClick, saveHideImagesUntilClick } from "@/lib/storage";
import { WordImagePreview } from "@/app/word-image-preview";
import type { ChineseLevel, ChinesePracticeMode, ChineseVocabularyWord, ScaffoldResponse } from "@/types/chinese-learning";
import type { BingoProgress } from "@/types/game";
import type { EvaluationResult } from "@/types/game";
import styles from "./zh.module.css";

type Phase = "setup" | "practice" | "summary";
type Chunk = { id: string; text: string };

const GOALS = [5, 10, 15] as const;
const RECOMMENDATION_KEY = "wordcraft.zh.recommended-level";

function SafeImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [currentSrc, setCurrentSrc] = useState(src);
  return <img className={className} src={currentSrc} alt={alt} onError={() => setCurrentSrc("/illustration-studio/pending-word.svg")} />;
}

function shuffle<T>(items: T[]) {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1));
    [next[index], next[swap]] = [next[swap], next[index]];
  }
  return next;
}

function localCheck(sentence: string, targets: ChineseVocabularyWord[]): EvaluationResult {
  const normalized = sentence.toLowerCase().replace(/[^a-z' -]/g, " ").replace(/\s+/g, " ").trim();
  const missing = targets.filter((target) => !new RegExp(`\\b${target.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?\\b`, "i").test(normalized));
  if (missing.length) return { valid: false, confidence: 1, reason: `句子里还需要用到 ${missing.map((word) => word.word).join(" 和 ")}。`, correctedSentence: "", relationshipSummary: "", source: "rules", provisional: false };
  if (normalized.split(" ").length < 4) return { valid: false, confidence: 1, reason: "再补充一些内容，让它成为完整的英文句子。", correctedSentence: "", relationshipSummary: "", source: "rules", provisional: false };
  return { valid: true, confidence: .62, reason: "句子包含了目标词，先把它计入本次练习。", correctedSentence: sentence.trim(), relationshipSummary: "AI 暂时不可用，你仍然可以继续学习。", source: "rules-fallback", provisional: true };
}

export default function ChineseLearningPage() {
  const [phase, setPhase] = useState<Phase>("setup");
  const [level, setLevel] = useState<ChineseLevel>(1);
  const [goal, setGoal] = useState<(typeof GOALS)[number]>(5);
  const [mode, setMode] = useState<ChinesePracticeMode>("beginner");
  const [recommendedLevel, setRecommendedLevel] = useState<ChineseLevel>(1);
  const [remaining, setRemaining] = useState<ChineseVocabularyWord[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [completed, setCompleted] = useState<ChineseVocabularyWord[]>([]);
  const [chineseSentence, setChineseSentence] = useState("");
  const [englishSentence, setEnglishSentence] = useState("");
  const [scaffold, setScaffold] = useState<ScaffoldResponse | null>(null);
  const [chunkBank, setChunkBank] = useState<Chunk[]>([]);
  const [arrangedChunks, setArrangedChunks] = useState<Chunk[]>([]);
  const [feedback, setFeedback] = useState<EvaluationResult | null>(null);
  const [loadingScaffold, setLoadingScaffold] = useState(false);
  const [checking, setChecking] = useState(false);
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [scaffoldOpen, setScaffoldOpen] = useState(false);
  const [firstTry, setFirstTry] = useState(true);
  const [firstTryWords, setFirstTryWords] = useState(0);
  const [bingoProgress, setBingoProgress] = useState<BingoProgress>(() => createBingoProgress([]));
  const [hideImagesUntilClick, setHideImagesUntilClick] = useState(false);
  const [imagePreviewWord, setImagePreviewWord] = useState<ChineseVocabularyWord | null>(null);
  const [revealedMeaningId, setRevealedMeaningId] = useState<string | null>(null);
  const meaningHoldTimer = useRef<number | null>(null);

  useEffect(() => {
    const saved = Number(window.localStorage.getItem(RECOMMENDATION_KEY));
    if (saved === 1 || saved === 2 || saved === 3) setRecommendedLevel(saved);
    setHideImagesUntilClick(loadHideImagesUntilClick());
    return () => {
      if (meaningHoldTimer.current !== null) window.clearTimeout(meaningHoldTimer.current);
    };
  }, []);

  const hand = remaining.slice(0, 4);
  const selectedWords = useMemo(() => selectedIds.map((id) => hand.find((word) => word.id === id)).filter((word): word is ChineseVocabularyWord => Boolean(word)), [selectedIds, hand]);
  const structure = scaffold ? sentenceStructures.find((item) => item.id === scaffold.structureId) : null;
  const assembledSentence = arrangedChunks.map((chunk) => chunk.text).join(" ");
  const progress = Math.min(completed.length, goal);
  const bingoWords = useMemo(() => [...completed, ...remaining], [completed, remaining]);

  const resetAttempt = () => {
    setSelectedIds([]);
    setChineseSentence("");
    setEnglishSentence("");
    setScaffold(null);
    setScaffoldOpen(false);
    setChunkBank([]);
    setArrangedChunks([]);
    setFeedback(null);
    setFirstTry(true);
  };

  const start = () => {
    const pool = chineseVocabulary.filter((word) => word.level === level);
    setRemaining(shuffle(pool));
    setCompleted([]);
    setFirstTryWords(0);
    setBingoProgress(createBingoProgress(pool.map((word) => word.id)));
    resetAttempt();
    setPhase("practice");
  };

  const toggleWord = (id: string) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length < 4 ? [...current, id] : current);
    setScaffold(null);
    setChunkBank([]);
    setArrangedChunks([]);
    setFeedback(null);
  };

  const clearMeaningHold = () => {
    if (meaningHoldTimer.current !== null) window.clearTimeout(meaningHoldTimer.current);
    meaningHoldTimer.current = null;
  };

  const startMeaningHold = (event: ReactPointerEvent<HTMLButtonElement>, wordId: string) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    clearMeaningHold();
    setRevealedMeaningId(null);
    meaningHoldTimer.current = window.setTimeout(() => {
      setRevealedMeaningId(wordId);
      meaningHoldTimer.current = null;
    }, 550);
  };

  const endMeaningHold = () => {
    clearMeaningHold();
    setRevealedMeaningId(null);
  };

  const speak = (word: string) => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = "en-US";
    utterance.rate = .82;
    window.speechSynthesis.speak(utterance);
  };

  const getScaffold = async () => {
    if (!selectedWords.length || !chineseSentence.trim() || loadingScaffold) return;
    setLoadingScaffold(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/generate-scaffold", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chineseSentence, targetWordIds: selectedIds, mode }) });
      const payload = await response.json() as ScaffoldResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "暂时不能生成提示。");
      setScaffold(payload);
      setScaffoldOpen(true);
      setChunkBank((payload.chunks || []).map((text, index) => ({ id: `${index}-${text}`, text })));
      setArrangedChunks([]);
      if (mode === "independent") setReferenceOpen(true);
    } catch (error) {
      // Keep the learning loop usable even if the route itself is unavailable.
      // The server normally returns this same deterministic fallback when an AI provider times out.
      const fallback = buildFallbackScaffold(chineseSentence, selectedIds, mode);
      setScaffold(fallback);
      setScaffoldOpen(true);
      setChunkBank((fallback.chunks || []).map((text, index) => ({ id: `${index}-${text}`, text })));
      setArrangedChunks([]);
      setFeedback({ valid: false, confidence: 1, reason: "AI 提示暂时不可用，已切换到基础词库提示。", correctedSentence: "", relationshipSummary: error instanceof Error ? error.message : "", source: "rules", provisional: false });
      if (mode === "independent") setReferenceOpen(true);
    } finally { setLoadingScaffold(false); }
  };

  const moveChunk = (chunk: Chunk, destination: "bank" | "answer", position?: number) => {
    setChunkBank((current) => current.filter((item) => item.id !== chunk.id));
    setArrangedChunks((current) => current.filter((item) => item.id !== chunk.id));
    if (destination === "bank") setChunkBank((current) => [...current, chunk]);
    else setArrangedChunks((current) => {
      const next = [...current];
      next.splice(position ?? next.length, 0, chunk);
      return next;
    });
  };

  const dragStart = (event: DragEvent, chunk: Chunk) => event.dataTransfer.setData("application/x-wordcraft-chunk", JSON.stringify(chunk));
  const dropChunk = (event: DragEvent, destination: "bank" | "answer", position?: number) => {
    event.preventDefault();
    try { moveChunk(JSON.parse(event.dataTransfer.getData("application/x-wordcraft-chunk")) as Chunk, destination, position); } catch { /* Ignore unrelated drops. */ }
  };

  const submitSentence = async () => {
    const sentence = (mode === "beginner" ? assembledSentence : englishSentence).trim();
    if (!sentence || !selectedWords.length || checking) return;
    setChecking(true);
    let result: EvaluationResult;
    try {
      const response = await fetch("/api/evaluate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sentence, inputMethod: "text", targetWords: selectedWords.map((word) => word.word), gradeBand: "4", feedbackLanguage: "zh-CN" }) });
      if (!response.ok) throw new Error("check unavailable");
      result = await response.json() as EvaluationResult;
    } catch { result = localCheck(sentence, selectedWords); }
    setFeedback(result);
    setChecking(false);
    if (!result.valid) { setFirstTry(false); return; }

    const newlyCompleted = selectedWords.filter((word) => !completed.some((item) => item.id === word.id));
    const nextCompleted = [...completed, ...newlyCompleted];
    const nextRemaining = remaining.filter((word) => !selectedIds.includes(word.id));
    if (firstTry) setFirstTryWords((count) => count + newlyCompleted.length);
    setCompleted(nextCompleted);
    setBingoProgress((current) => markBingoWords(current, selectedIds, nextRemaining.map((word) => word.id)));
    setRemaining(nextRemaining);
    window.setTimeout(() => {
      if (nextCompleted.length >= goal) {
        const accuracy = (firstTryWords + (firstTry ? newlyCompleted.length : 0)) / nextCompleted.length;
        if (goal >= 10) {
          const recommendation = accuracy >= .8 ? Math.min(3, level + 1) as ChineseLevel : level;
          window.localStorage.setItem(RECOMMENDATION_KEY, String(recommendation));
          setRecommendedLevel(recommendation);
        }
        setPhase("summary");
      } else resetAttempt();
    }, 650);
  };

  const useStructure = (pattern: string) => {
    setEnglishSentence(pattern);
    setReferenceOpen(false);
  };

  return <main className={styles.page} lang="zh-CN">
    <header className={styles.topbar}>
      <Link className={styles.brand} href="/zh" aria-label="Wordcraft 中文学习首页"><img src="/wordcraft-logo-transparent.png" alt="Wordcraft Classroom" /></Link>
      <nav className={styles.languageSwitch} aria-label="语言切换"><Link href="/">English</Link><span aria-current="page">中文练习</span></nav>
    </header>

    {phase === "setup" && <div className={styles.setupShell}>
      <section className={styles.hero}>
        <div><span className={styles.kicker}>给2-5年级学生的想象乐园</span><h1>先想中文，<br/><em>再搭一座英文句子桥。</em></h1><p>选词、写下想表达的意思，再用动词、时态和句型提示完成英文句子。用对词语，就能点亮 Bingo 格子。</p></div>
        <div className={styles.bridgePreview} aria-label="学习流程"><span>中文想法</span><i>→</i><span>语言提示</span><i>→</i><span>英文句子</span></div>
      </section>

      <section className={styles.setupCard} aria-labelledby="level-title">
        <div className={styles.sectionHeading}><div><span>第一步</span><h2 id="level-title">选择词汇 Level</h2></div><small>所有 Level 都可以自由选择</small></div>
        <div className={styles.levelGrid}>{([1, 2, 3] as ChineseLevel[]).map((item) => {
          const meta = chineseLevelMeta[item];
          const samples = chineseVocabulary.filter((word) => word.level === item && meta.examples.includes(word.word as never)).slice(0, 3);
          return <button key={item} className={`${styles.levelCard} ${level === item ? styles.active : ""}`} aria-pressed={level === item} onClick={() => setLevel(item)}>
            <span className={styles.levelTop}><b>{meta.title}</b>{recommendedLevel === item && <em>建议学习</em>}</span>
            <strong>{meta.note}</strong>
            <span className={styles.sampleArt}>{samples.map((word) => <SafeImage key={word.id} src={word.image} alt="" />)}</span>
            <span className={styles.examples}>{meta.examples.join(" · ")}</span>
            <small>{meta.count} 个词</small>
          </button>;
        })}</div>
      </section>

      <section className={styles.setupOptions}>
        <div><span className={styles.optionLabel}>第二步 · 这次学几个词？</span><div className={styles.segmented}>{GOALS.map((count) => <button key={count} className={goal === count ? styles.selected : ""} onClick={() => setGoal(count)}>{count} 个</button>)}</div></div>
        <div><span className={styles.optionLabel}>第三步 · 怎样完成句子？</span><div className={styles.modeGrid}><button className={mode === "beginner" ? styles.selected : ""} onClick={() => setMode("beginner")}><b>拖拽组句</b><small>系统给词块，我来排顺序</small></button><button className={mode === "independent" ? styles.selected : ""} onClick={() => setMode("independent")}><b>自己输入</b><small>参考提示，自己写完整英文</small></button></div></div>
      </section>
      <section className={styles.imageSetting} aria-labelledby="image-setting-title">
        <label><input type="checkbox" checked={hideImagesUntilClick} onChange={(event) => { const hidden = event.target.checked; setHideImagesUntilClick(hidden); saveHideImagesUntilClick(hidden); }} /><span><b id="image-setting-title">练习时隐藏图片</b><small>双击单词卡后再查看插画</small></span><i aria-hidden="true">▧</i></label>
      </section>
      <button className={styles.startButton} onClick={start}>开始学习 <span>→</span></button>
    </div>}

    {phase === "practice" && <div className={styles.practiceShell}>
      <section className={styles.progressBar}><button className={styles.backButton} onClick={() => setPhase("setup")} aria-label="返回练习设置"><span aria-hidden="true">←</span><small>返回</small></button><div><span>Level {level}</span><strong>已学 {progress} / {goal} 个词</strong></div><div className={styles.progressTrack}><i style={{ width: `${progress / goal * 100}%` }} /></div></section>

      <div className={styles.practiceGrid}>
        <section className={styles.workspace}>
          <div className={styles.stepHead}><span>1</span><div><h2>选一到四个词</h2><p>点词卡选中，最多可以一起练习四个词。<small>已选 {selectedIds.length} / 4</small></p></div></div>
          <div className={styles.wordGrid}>{hand.map((word) => { const meaningRevealed = revealedMeaningId === word.id; return <article key={word.id} className={`${styles.wordCard} ${selectedIds.includes(word.id) ? styles.wordSelected : ""}`}>
            <button className={styles.wordMain} onClick={(event) => { if (hideImagesUntilClick && event.detail > 1) return; toggleWord(word.id); }} onDoubleClick={() => { if (hideImagesUntilClick) setImagePreviewWord(word); }} aria-pressed={selectedIds.includes(word.id)} aria-label={`${word.word}。${meaningRevealed ? word.chinese : "中文释义已隐藏，长按显示。"}${hideImagesUntilClick ? "双击查看插画。" : ""}`} onPointerDown={(event) => startMeaningHold(event, word.id)} onPointerUp={endMeaningHold} onPointerCancel={endMeaningHold} onPointerLeave={endMeaningHold} onContextMenu={(event) => event.preventDefault()}>{hideImagesUntilClick ? <span className={styles.imageHidden} aria-hidden="true">▧</span> : <SafeImage src={word.image} alt="" />}<b>{word.word}</b><span className={`${styles.wordMeaning} ${meaningRevealed ? styles.meaningRevealed : styles.meaningHidden}`}>{meaningRevealed ? word.chinese : "长按显示中文释义"}</span></button>
            {typeof window !== "undefined" && "speechSynthesis" in window && <button className={styles.speakButton} aria-label={`播放 ${word.word} 的发音`} onClick={() => speak(word.word)}>🔊</button>}
            <div className={styles.verbHints}><small>常用动词</small><p>{word.verbs.join(" · ")}</p></div>
          </article>; })}</div>

          {mode === "independent" ? <details className={styles.optionalHelp} open={scaffoldOpen} onToggle={(event) => setScaffoldOpen(event.currentTarget.open)}>
            <summary><span>可选帮助</span><strong>需要英文提示？</strong><small>展开后写中文想法，获取句型、动词和时态建议</small></summary>
            <div className={styles.optionalHelpBody}>
              <textarea value={chineseSentence} onChange={(event) => { setChineseSentence(event.target.value); setScaffold(null); setFeedback(null); }} placeholder="例如：我昨天在图书馆看了一本书。" maxLength={180} />
              <button className={styles.supportButton} disabled={!selectedIds.length || !chineseSentence.trim() || loadingScaffold} onClick={getScaffold}>{loadingScaffold ? "正在搭桥…" : "帮我准备英文提示"}</button>
            </div>
          </details> : <div className={styles.bridgeStep}>
            <div className={styles.stepHead}><span>2</span><div><h2>先用中文想清楚</h2><p>句子里要包含你选中的词。</p></div></div>
            <textarea value={chineseSentence} onChange={(event) => { setChineseSentence(event.target.value); setScaffold(null); setFeedback(null); }} placeholder="例如：我昨天在图书馆看了一本书。" maxLength={180} />
            <button className={styles.supportButton} disabled={!selectedIds.length || !chineseSentence.trim() || loadingScaffold} onClick={getScaffold}>{loadingScaffold ? "正在搭桥…" : "帮我准备英文提示"}</button>
          </div>}

          {scaffold && (mode === "beginner" || scaffoldOpen) && <div className={styles.bridgeStep}>
            <div className={styles.stepHead}><span>3</span><div><h2>过桥，完成英文句子</h2><p>{scaffold.source === "ai" ? "AI 根据你的中文想法找出了动词和重要词。" : "先使用词库里的基础提示继续练习。"}</p></div></div>
            <div className={styles.scaffoldStrip}><div><small>可以用的动词</small><p>{scaffold.verbs.map((verb) => <button key={verb} onClick={() => setEnglishSentence((current) => `${current}${current ? " " : ""}${verb}`)}>{verb}</button>)}</p></div><div><small>本句推荐</small><strong>{scaffold.recommendedVerbForm}</strong></div><div><small>时态提示</small><span>{scaffold.tenseHint}</span></div></div>
            {scaffold.importantWords.length > 0 && <div className={styles.importantWords}><div><small>重要词</small><span>把中文里的细节变成英文表达，可选用，不必全部使用。</span></div><p>{scaffold.importantWords.map((hint) => <span key={`${hint.word}-${hint.chinese}`}><b>{hint.word}</b>{hint.chinese && <em>{hint.chinese}</em>}</span>)}</p></div>}
            <div className={styles.structureHint}><span>句型结构</span><code>{structure?.pattern}</code><button onClick={() => setReferenceOpen(true)}>打开参考卡</button></div>

            {mode === "beginner" ? <div className={styles.chunkBuilder}>
              <label>把词块排成一句话</label>
              <div className={styles.answerLine} onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropChunk(event, "answer")}>
                {arrangedChunks.length ? arrangedChunks.map((chunk, index) => <button key={chunk.id} draggable onDragStart={(event) => dragStart(event, chunk)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.stopPropagation(); dropChunk(event, "answer", index); }} onClick={() => moveChunk(chunk, "bank")}>{chunk.text}</button>) : <span>把下面的词块拖到这里，也可以直接点选</span>}
              </div>
              <div className={styles.chunkBank} onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropChunk(event, "bank")}>{chunkBank.map((chunk) => <button key={chunk.id} draggable onDragStart={(event) => dragStart(event, chunk)} onClick={() => moveChunk(chunk, "answer")}>{chunk.text}</button>)}</div>
            </div> : null}
            {mode === "beginner" && <div className={styles.submitRow}><button disabled={checking || !assembledSentence.trim()} onClick={submitSentence}>{checking ? "正在检查…" : "检查我的句子"}</button><span>{selectedWords.map((word) => word.word).join(" + ")}</span></div>}
            {mode === "beginner" && feedback && <div className={`${styles.feedback} ${feedback.valid ? styles.good : styles.bad}`} role="status"><strong>{feedback.valid ? "做到了！词格亮起来了…" : "再改一点点"}</strong><p>{feedback.reason}</p>{feedback.correctedSentence && !feedback.valid && <code>{feedback.correctedSentence}</code>}{feedback.relationshipSummary && <small>{feedback.relationshipSummary}</small>}</div>}
          </div>}
          {mode === "independent" && <div className={styles.bridgeStep}>
            <div className={styles.stepHead}><span>3</span><div><h2>直接写英文句子</h2><p>不需要中文提示，也可以直接开始造句。</p></div></div>
            <div className={styles.independentInput}><label htmlFor="english-sentence">写下完整英文句子</label><textarea id="english-sentence" value={englishSentence} onChange={(event) => { setEnglishSentence(event.target.value); setFeedback(null); }} placeholder="例如：I read a book in the library yesterday." /></div>
            <div className={styles.submitRow}><button disabled={checking || !englishSentence.trim()} onClick={submitSentence}>{checking ? "正在检查…" : "检查我的句子"}</button><span>{selectedWords.map((word) => word.word).join(" + ")}</span></div>
            {feedback && <div className={`${styles.feedback} ${feedback.valid ? styles.good : styles.bad}`} role="status"><strong>{feedback.valid ? "做到了！词格亮起来了…" : "再改一点点"}</strong><p>{feedback.reason}</p>{feedback.correctedSentence && !feedback.valid && <code>{feedback.correctedSentence}</code>}{feedback.relationshipSummary && <small>{feedback.relationshipSummary}</small>}</div>}
          </div>}
        </section>

        <aside className={`${styles.referenceSheet} ${referenceOpen ? styles.referenceOpen : ""}`} aria-label="组句参考卡">
          <div className={styles.referenceHeader}><div><span>参考卡</span><h2>组句参考卡</h2></div><button onClick={() => setReferenceOpen(false)} aria-label="关闭参考卡">×</button></div>
          <section><h3>句型结构</h3><p>点一下可以放进输入框。</p><div className={styles.structureList}>{sentenceStructures.map((item) => <button key={item.id} onClick={() => useStructure(item.pattern)}><code>{item.pattern}</code><small>{item.note}</small></button>)}</div></section>
          <section><h3>时态提示</h3>{tenseHelp.map((item) => <div className={styles.tenseRow} key={item.title}><b>{item.title}</b><span>{item.cue}</span><small>{item.example}</small></div>)}</section>
          <section><h3>连接词</h3><div className={styles.joiningList}>{joiningWords.map((item) => <span key={item.word}><b>{item.word}</b>{item.chinese}</span>)}</div></section>
        </aside>
      </div>

      <button className={styles.referenceFab} onClick={() => setReferenceOpen(true)}>打开参考卡</button>
      <BingoBoard progress={bingoProgress} words={bingoWords} language="zh" />
    </div>}

    {phase === "summary" && <div className={styles.summaryShell}>
      <span className={styles.kicker}>这次的句子桥搭好了</span><h1>你学会了 {progress} 个词。</h1><p>首次答对率 {Math.round(firstTryWords / Math.max(1, completed.length) * 100)}%。本轮完成 {bingoProgress.bingos} 条 Bingo，点亮整张卡 {bingoProgress.boardsCompleted} 次。系统建议下次学习 Level {recommendedLevel}。</p>
      <div className={styles.summaryWords}>{completed.slice(0, goal).map((word) => <article key={word.id}><SafeImage src={word.image} alt="" /><b>{word.word}</b><span>{word.chinese}</span></article>)}</div>
      <div className={styles.summaryActions}><button onClick={start}>再练一次</button><button onClick={() => setPhase("setup")}>重新选择 Level</button></div>
    </div>}
    {phase === "setup" && <FeedbackPanel language="zh" />}
    {hideImagesUntilClick && imagePreviewWord && <WordImagePreview item={imagePreviewWord} language="zh" onClose={() => setImagePreviewWord(null)} />}
  </main>;
}
