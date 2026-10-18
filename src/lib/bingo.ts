import type { BingoProgress } from "@/types/game";

const MAX_BINGO_SIZE = 3;

function uniqueWords(wordIds: string[]) {
  return [...new Set(wordIds.filter(Boolean))];
}

function boardSize(wordCount: number) {
  return wordCount ? Math.min(MAX_BINGO_SIZE, Math.floor(Math.sqrt(wordCount))) : 0;
}

function shuffle<T>(items: T[]) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
  }
  return shuffled;
}

function drawCards(wordIds: string[], size: number, previousWordIds: string[] = []) {
  const pool = uniqueWords(wordIds);
  const count = size * size;
  if (!count) return [];

  const shuffled = shuffle(pool);
  const selected = shuffled.slice(0, count);
  const previous = new Set(previousWordIds);
  const freshWord = shuffled.find((wordId) => !previous.has(wordId));
  if (selected.length === count && freshWord && selected.every((wordId) => previous.has(wordId))) {
    selected[count - 1] = freshWord;
  }

  return shuffle(selected).map((wordId) => ({ wordId, lit: false }));
}

export function createBingoProgress(wordIds: string[]): BingoProgress {
  const pool = uniqueWords(wordIds);
  const size = boardSize(pool.length);
  return { size, cards: drawCards(pool, size), bingos: 0, boardsCompleted: 0 };
}

function bingoLines(size: number) {
  if (size < 1) return [];
  const lines: number[][] = [];
  for (let row = 0; row < size; row++) lines.push(Array.from({ length: size }, (_, column) => row * size + column));
  for (let column = 0; column < size; column++) lines.push(Array.from({ length: size }, (_, row) => row * size + column));
  lines.push(Array.from({ length: size }, (_, index) => index * size + index));
  lines.push(Array.from({ length: size }, (_, index) => index * size + (size - index - 1)));

  const unique = new Map<string, number[]>();
  for (const line of lines) unique.set([...line].sort((left, right) => left - right).join(","), line);
  return [...unique.values()];
}

function completedLineCount(progress: BingoProgress) {
  return bingoLines(progress.size).filter((line) => line.every((index) => progress.cards[index]?.lit)).length;
}

/** Lights words from a valid sentence, then deals a fresh random board when every square is lit. */
export function markBingoWords(progress: BingoProgress, usedWordIds: string[], nextBoardPool: string[]): BingoProgress {
  const used = new Set(usedWordIds);
  const cards = progress.cards.map((card) => card.lit || !used.has(card.wordId) ? card : { ...card, lit: true });
  const marked: BingoProgress = { ...progress, cards };
  const newBingos = Math.max(0, completedLineCount(marked) - completedLineCount(progress));
  const fullBoard = cards.length > 0 && cards.every((card) => card.lit);

  if (!fullBoard) return { ...marked, bingos: progress.bingos + newBingos };

  const nextPool = uniqueWords(nextBoardPool);
  const nextSize = boardSize(nextPool.length);
  return {
    size: nextSize,
    cards: drawCards(nextPool, nextSize, cards.map((card) => card.wordId)),
    bingos: progress.bingos + newBingos,
    boardsCompleted: progress.boardsCompleted + 1,
  };
}
