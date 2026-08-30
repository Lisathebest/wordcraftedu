import { abilityFloorForWord, abilityForWord, buildingImageForWord, recipes, vocabulary, vocabularyById } from "@/data/content";
import type { AbilityId, EvaluationResult, MatchMode, MatchState, MatchSummary, PlayerState, Recipe } from "@/types/game";

const MATCH_SECONDS = 8 * 60;
const HAND_SIZE = 4;

export function recipeFor(words: string[]): Recipe | undefined {
  if (words.length < 2) return undefined;
  const available = new Set(words);
  return recipes
    .filter((recipe) => recipe.ingredients.every((ingredient) => available.has(ingredient)))
    .sort((left, right) => right.reward - left.reward)[0];
}

function makePlayer(id: string, name: string): PlayerState {
  return { id, name, hand: [], familiarity: {}, lastUsed: {}, structures: [], discoveredRecipes: [], score: 0, usedAbilities: [], shieldActive: false };
}

export function createMatch(mode: MatchMode, names: string[], seed = 7, wordPool = vocabulary.map((word) => word.id), durationMinutes = 8): MatchState {
  const players = (mode === "solo" ? [names[0] || "Builder"] : names).map((name, index) => makePlayer(`p${index + 1}`, name || `Player ${index + 1}`));
  const usablePool = wordPool.length >= HAND_SIZE * players.length ? wordPool : vocabulary.map((word) => word.id);
  const shuffled = seededShuffle(usablePool, seed);
  const wordOwnership: Record<string, string> = {};
  for (let round = 0; round < HAND_SIZE; round++) {
    for (const player of players) {
      const next = shuffled.shift();
      if (next) { player.hand.push(next); wordOwnership[next] = player.id; }
    }
  }
  return {
    id: `match-${Date.now()}`, mode, players, activeSeat: 0, remainingSeconds: durationMinutes * 60 || MATCH_SECONDS,
    wordOwnership, drawPile: shuffled, submissions: [], status: "playing",
    metrics: { attempts: 0, successfulCrafts: 0, pronunciationUses: 0, invalidRetries: 0, evaluationTotalMs: 0 },
    pronunciationPenalty: false,
  };
}

export function tick(state: MatchState, seconds = 1): MatchState {
  if (state.status !== "playing") return state;
  const remainingSeconds = Math.max(0, state.remainingSeconds - seconds);
  return { ...state, remainingSeconds, status: remainingSeconds === 0 ? "finished" : state.status };
}

export function notePronunciation(state: MatchState): MatchState {
  return { ...state, pronunciationPenalty: true, metrics: { ...state.metrics, pronunciationUses: state.metrics.pronunciationUses + 1 } };
}

export function applyEvaluation(state: MatchState, sentence: string, targets: string[], evaluation: EvaluationResult, durationMs = 0): MatchState {
  const next = structuredClone(state);
  const player = next.players[next.activeSeat];
  next.metrics.attempts++;
  next.metrics.evaluationTotalMs += durationMs;
  next.submissions.unshift({ id: `s-${Date.now()}-${next.metrics.attempts}`, playerId: player.id, sentence, targetWords: targets, valid: evaluation.valid, source: evaluation.source, feedback: evaluation.reason, createdAt: Date.now() });
  if (!evaluation.valid) {
    if (player.shieldActive) player.shieldActive = false;
    else player.score = Math.max(0, player.score - 1);
    next.metrics.invalidRetries++;
    next.pronunciationPenalty = false;
    return next;
  }

  const now = Date.now();
  targets.forEach((wordId, targetIndex) => {
    const ownerId = next.wordOwnership[wordId];
    const owner = next.players.find((candidate) => candidate.id === ownerId);
    const gain = ownerId === player.id || next.mode === "solo" ? 2 : 1;
    player.familiarity[wordId] = (player.familiarity[wordId] || 0) + gain;
    player.lastUsed[wordId] = now + targetIndex;
    if (owner && owner.id !== player.id) {
      owner.familiarity[wordId] = (owner.familiarity[wordId] || 0) + 1;
      owner.lastUsed[wordId] = now + targetIndex;
    }
  });

  const recipe = recipeFor(targets);
  let reward = (recipe?.reward ?? 2) + Math.max(0, targets.length - 1);
  if (state.pronunciationPenalty) reward = Math.max(1, reward - 1);
  player.score += reward;
  if (recipe) {
    next.metrics.successfulCrafts++;
    if (!player.discoveredRecipes.includes(recipe.id)) player.discoveredRecipes.push(recipe.id);
    upsertStructure(player, recipe.result, recipe.ingredients, recipe.ability, recipe.buildingImage, recipe.abilityFloor);
  } else if (targets.length === 1) {
    const item = vocabularyById[targets[0]];
    upsertStructure(player, item.fallbackStructure, targets, abilityForWord[item.id], buildingImageForWord[item.id] || item.image, abilityFloorForWord[item.id]);
  }
  next.pronunciationPenalty = false;
  if (next.mode === "local") next.activeSeat = (next.activeSeat + 1) % next.players.length;
  rotateHand(next, player, targets);
  return next;
}

function upsertStructure(player: PlayerState, name: string, words: string[], ability?: AbilityId, image?: string, abilityFloor?: number) {
  const existing = player.structures.find((structure) => structure.name === name);
  if (existing) {
    existing.level = Math.min(4, existing.level + 1);
    if (!existing.image || existing.image.startsWith("/vocab/")) existing.image = image;
    existing.abilityFloor ||= abilityFloor;
  } else {
    player.structures.push({ id: `${player.id}-${name.toLowerCase().replace(/\s/g, "-")}`, name, sourceWords: words, level: 1, image, ability, abilityFloor, builtAt: Date.now() });
  }
}

function rotateHand(state: MatchState, player: PlayerState, usedWords: string[]) {
  usedWords.forEach((usedWord) => {
    const index = player.hand.indexOf(usedWord);
    if (index < 0) return;
    const nextWord = state.drawPile.shift();
    if (nextWord) {
      delete state.wordOwnership[usedWord];
      player.hand[index] = nextWord;
      state.wordOwnership[nextWord] = player.id;
      state.drawPile.push(usedWord);
    }
  });
}

export function useAbility(state: MatchState, playerId: string, ability: AbilityId, targetPlayerId?: string): MatchState {
  const next = structuredClone(state);
  const player = next.players.find((candidate) => candidate.id === playerId);
  if (!player || player.usedAbilities.includes(ability) || !player.structures.some((structure) => structure.ability === ability)) return state;
  if (ability === "preview") next.previewWord = next.drawPile[0];
  if (ability === "shield") player.shieldActive = true;
  if (ability === "exchange") {
    const target = targetPlayerId ? next.players.find((candidate) => candidate.id === targetPlayerId) : undefined;
    if (target && target.id !== player.id && player.hand.length && target.hand.length) {
      const offered = player.hand[0];
      const received = target.hand[0];
      player.hand[0] = received;
      target.hand[0] = offered;
      next.wordOwnership[received] = player.id;
      next.wordOwnership[offered] = target.id;
      next.lastInteraction = `${player.name} swapped ${vocabularyById[offered]?.word || offered} with ${target.name}.`;
    } else if (next.drawPile.length && player.hand.length) {
      const old = player.hand[0];
      const fresh = next.drawPile.shift()!;
      player.hand[0] = fresh;
      delete next.wordOwnership[old];
      next.wordOwnership[fresh] = player.id;
      next.drawPile.push(old);
    } else return state;
  }
  if (ability === "social") {
    const target = targetPlayerId ? next.players.find((candidate) => candidate.id === targetPlayerId) : undefined;
    if (!target || target.id === player.id) return state;
    const sharedWord = coreWord(player) || player.hand[0] || target.hand[0];
    const targetWord = target.hand[0] || sharedWord;
    if (targetWord) {
      target.familiarity[targetWord] = (target.familiarity[targetWord] || 0) + 1;
      target.lastUsed[targetWord] = Date.now();
    }
    player.score += 1;
    next.lastInteraction = `${player.name} shared ${vocabularyById[targetWord || ""]?.word || "a familiar word"} with ${target.name}.`;
  }
  player.usedAbilities.push(ability);
  return next;
}

export function coreWord(player: PlayerState) {
  return Object.keys(player.familiarity).sort((a, b) => (player.familiarity[b] - player.familiarity[a]) || ((player.lastUsed[b] || 0) - (player.lastUsed[a] || 0)))[0];
}

export function summarize(state: MatchState): MatchSummary[] {
  return state.players.map((player) => ({
    playerId: player.id, score: player.score, craftedStructures: player.structures,
    highestFamiliarityWord: coreWord(player),
    successfulUses: state.submissions.filter((submission) => submission.playerId === player.id && submission.valid).length,
    reviewItems: state.submissions.filter((submission) => submission.playerId === player.id && !submission.valid).flatMap((submission) => submission.targetWords).filter((word, index, all) => all.indexOf(word) === index),
  }));
}

function seededShuffle<T>(items: T[], seed: number) {
  const result = [...items];
  let value = seed;
  for (let index = result.length - 1; index > 0; index--) {
    value = (value * 9301 + 49297) % 233280;
    const target = Math.floor((value / 233280) * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}
