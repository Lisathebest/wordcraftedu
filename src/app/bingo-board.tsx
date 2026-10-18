import type { BingoProgress } from "@/types/game";
import styles from "./bingo-board.module.css";

type BingoWord = { id: string; word: string; image?: string };

export function BingoBoard({
  progress,
  words,
  language = "en",
}: {
  progress: BingoProgress;
  words: BingoWord[];
  language?: "en" | "zh";
}) {
  const labels = language === "zh"
    ? { title: "单词 Bingo", description: "在正确的英文句子里用到词卡中的词，就能点亮对应格子。横行、竖列和对角线都算一个 Bingo。", lines: "Bingo 数", boards: "完成卡片", lit: "已点亮", next: "全格点亮后，下一张卡会从本轮剩余词汇中随机抽取。", empty: "当前词库没有可用词汇，添加词汇后就能开始 Bingo。" }
    : { title: "Vocabulary Bingo", description: "Choose words from your shelf and use them in correct sentences to light the matching squares. Every row, column, or diagonal makes a Bingo line.", lines: "Bingo lines", boards: "Boards cleared", lit: "lit", next: "Light every square to shuffle a fresh board from this round's vocabulary.", empty: "This word set has no available words. Add vocabulary to start a Bingo board." };
  const wordById = new Map(words.map((word) => [word.id, word]));
  const totalSquares = progress.cards.length;
  const litSquares = progress.cards.filter((card) => card.lit).length;

  return <section className={`${styles.panel} ${language === "zh" ? styles.zh : ""}`} aria-label={labels.title}>
    <header className={styles.header}>
      <div className={styles.headingCopy}>
        <div className={styles.kicker}><span className={styles.stamp} aria-hidden="true">✦</span><span>{labels.title}</span><span className={styles.boardSize}>{progress.size ? `${progress.size} × ${progress.size}` : "—"}</span></div>
        <h3>{language === "zh" ? "用句子点亮词格" : "Your sentence lights it up!"}</h3>
        <p>{labels.description}</p>
      </div>
      <div className={styles.totals} aria-label={language === "zh" ? "本轮 Bingo 统计" : "Round Bingo totals"} aria-live="polite">
        <div className={styles.lineTotal}><span className={styles.totalIcon} aria-hidden="true">✦</span><strong>{progress.bingos}</strong><span>{labels.lines}</span></div>
        <i aria-hidden="true">·</i>
        <div className={styles.boardTotal}><span className={styles.totalIcon} aria-hidden="true">🏆</span><strong>{progress.boardsCompleted}</strong><span>{labels.boards}</span></div>
      </div>
    </header>

    {totalSquares ? <div className={styles.grid} role="grid" aria-label={language === "zh" ? `${progress.size}乘${progress.size}单词 Bingo 卡` : `${progress.size} by ${progress.size} vocabulary Bingo board`} style={{ gridTemplateColumns: `repeat(${progress.size}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${progress.size}, minmax(0, 1fr))` }}>
      {progress.cards.map((card, index) => {
        const word = wordById.get(card.wordId);
        const cellLabel = `${word?.word || card.wordId}${card.lit ? (language === "zh" ? "，已点亮" : ", lit") : (language === "zh" ? "，未点亮" : ", not lit")}`;
        return <div className={`${styles.cell} ${card.lit ? styles.cellLit : ""}`} data-tone={index % 6} role="gridcell" aria-label={cellLabel} key={`${card.wordId}-${index}`}>
          {word?.image ? <img className={styles.wordIcon} src={word.image} alt="" aria-hidden="true" loading="lazy" /> : <span className={styles.iconPlaceholder} aria-hidden="true">✦</span>}
          {card.lit && <span className={styles.check} aria-hidden="true">✓</span>}
          <span className={styles.word}>{word?.word || card.wordId}</span>
        </div>;
      })}
    </div> : <div className={styles.empty}>{labels.empty}</div>}

    <footer className={styles.footer}>
      <span>{litSquares}/{totalSquares} {labels.lit}</span>
      <span>{totalSquares ? `${language === "zh" ? `第 ${progress.boardsCompleted + 1} 张` : `Board ${progress.boardsCompleted + 1}`} · ${labels.next}` : labels.empty}</span>
    </footer>
  </section>;
}
