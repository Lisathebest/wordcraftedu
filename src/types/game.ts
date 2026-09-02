export type Level = "L1" | "L2" | "L3";
export type MatchMode = "solo" | "local" | "student";
export type MatchStatus = "setup" | "playing" | "finished";
export type InputMethod = "text" | "voice";
export type AbilityId = "preview" | "shield" | "exchange" | "social";

export interface VocabularyWord {
  id: string;
  number: number;
  word: string;
  level: Level;
  chinese: string;
  collocations: [string, string, string];
  image: string;
  /** Prompt/style version used for the generated image; absent means it needs a redraw after a style change. */
  illustrationVersion?: number;
  pronunciation: string;
  fallbackStructure: string;
}

export interface Recipe {
  id: string;
  ingredients: [string, string];
  result: string;
  reward: number;
  discoveryText: string;
  /** Formula visibility tier in the recipe book. */
  unlockTier: 1 | 2 | 3;
  /** Supplied vocabulary art reused as the building illustration in the MVP. */
  buildingImage: string;
  ability?: AbilityId;
  /** The floor where the building's ability lives. */
  abilityFloor?: number;
}

export interface BuiltStructure {
  id: string;
  name: string;
  sourceWords: string[];
  level: number;
  /** A recipe/fallback image. Optional keeps saved matches from older builds readable. */
  image?: string;
  ability?: AbilityId;
  abilityFloor?: number;
  builtAt: number;
}

export interface PlayerState {
  id: string;
  name: string;
  hand: string[];
  familiarity: Record<string, number>;
  lastUsed: Record<string, number>;
  structures: BuiltStructure[];
  discoveredRecipes: string[];
  score: number;
  usedAbilities: AbilityId[];
  shieldActive: boolean;
}

export interface SubmissionRecord {
  id: string;
  playerId: string;
  sentence: string;
  targetWords: string[];
  valid: boolean;
  source: EvaluationResult["source"];
  feedback: string;
  createdAt: number;
}

export interface MatchMetrics {
  attempts: number;
  successfulCrafts: number;
  pronunciationUses: number;
  invalidRetries: number;
  evaluationTotalMs: number;
}

export interface MatchState {
  id: string;
  mode: MatchMode;
  players: PlayerState[];
  activeSeat: number;
  remainingSeconds: number;
  wordOwnership: Record<string, string>;
  drawPile: string[];
  submissions: SubmissionRecord[];
  status: MatchStatus;
  metrics: MatchMetrics;
  pronunciationPenalty: boolean;
  previewWord?: string;
  /** Short-lived feedback for local multiplayer ability interactions. */
  lastInteraction?: string;
}

export interface EvaluationRequest {
  sentence: string;
  inputMethod: InputMethod;
  targetWords: string[];
  gradeBand: "5-6" | "7-9";
}

export interface EvaluationResult {
  valid: boolean;
  confidence: number;
  reason: string;
  correctedSentence: string;
  relationshipSummary: string;
  source: "rules" | "ai" | "rules-fallback";
  provisional: boolean;
}

export interface MatchSummary {
  playerId: string;
  score: number;
  craftedStructures: BuiltStructure[];
  highestFamiliarityWord?: string;
  successfulUses: number;
  reviewItems: string[];
}
