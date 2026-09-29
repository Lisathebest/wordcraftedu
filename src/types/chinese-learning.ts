export type ChineseLevel = 1 | 2 | 3;
export type ChinesePracticeMode = "beginner" | "independent";

export type ChineseVocabularyWord = {
  id: string;
  word: string;
  chinese: string;
  level: ChineseLevel;
  image: string;
  verbs: string[];
};

export type ScaffoldRequest = {
  chineseSentence: string;
  targetWordIds: string[];
  mode: ChinesePracticeMode;
};

export type ScaffoldWordHint = {
  word: string;
  chinese: string;
};

export type ScaffoldResponse = {
  verbs: string[];
  recommendedVerbForm: string;
  tenseHint: string;
  structureId: string;
  conjunctions: string[];
  importantWords: ScaffoldWordHint[];
  chunks?: string[];
  source?: "ai" | "fallback";
};
