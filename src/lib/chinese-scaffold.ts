import { sentenceStructures } from "@/data/chinese-reference";
import { chineseVocabularyById } from "@/data/chinese-vocabulary";
import type { ChinesePracticeMode, ScaffoldResponse, ScaffoldWordHint } from "@/types/chinese-learning";

export type ScaffoldTense = "present" | "past" | "progressive";

const irregularPast: Record<string, string> = {
  buy: "bought", catch: "caught", drink: "drank", eat: "ate", feed: "fed", find: "found",
  fly: "flew", have: "had", hear: "heard", hold: "held", leave: "left", make: "made",
  read: "read", ride: "rode", see: "saw", sit: "sat", sleep: "slept", take: "took",
  teach: "taught", throw: "threw", wear: "wore", write: "wrote",
};

export function detectChineseTense(sentence: string): ScaffoldTense {
  if (/(昨天|上周|上个|以前|刚才|去年)/.test(sentence)) return "past";
  if (/(现在|正在|此刻|这会儿)/.test(sentence)) return "progressive";
  return "present";
}

function splitVerb(verb: string) {
  const [head, ...rest] = verb.split(" ");
  return { head, tail: rest.length ? ` ${rest.join(" ")}` : "" };
}

function regularPast(verb: string) {
  if (verb.endsWith("e")) return `${verb}d`;
  if (/[^aeiou]y$/.test(verb)) return `${verb.slice(0, -1)}ied`;
  return `${verb}ed`;
}

function progressive(verb: string) {
  if (verb.endsWith("ie")) return `${verb.slice(0, -2)}ying`;
  if (verb.endsWith("e") && !verb.endsWith("ee")) return `${verb.slice(0, -1)}ing`;
  return `${verb}ing`;
}

export function verbForTense(verb: string, tense: ScaffoldTense) {
  const { head, tail } = splitVerb(verb);
  if (tense === "past") return `${irregularPast[head] || regularPast(head)}${tail}`;
  if (tense === "progressive") return `${progressive(head)}${tail}`;
  return verb;
}

function conjunctionsFor(sentence: string) {
  const result: string[] = [];
  if (sentence.includes("因为")) result.push("because");
  if (sentence.includes("但是") || sentence.includes("可是")) result.push("but");
  if (sentence.includes("然后")) result.push("then");
  if (sentence.includes("所以")) result.push("so");
  if (sentence.includes("和") || sentence.includes("也")) result.push("and");
  return [...new Set([...result, "and", "because", "then"])].slice(0, 3);
}

const importantWordCues: Array<{ cue: RegExp; hint: ScaffoldWordHint }> = [
  { cue: /朋友|同学/, hint: { word: "friend", chinese: "朋友" } },
  { cue: /老师/, hint: { word: "teacher", chinese: "老师" } },
  { cue: /家里|家中|在家/, hint: { word: "home", chinese: "家" } },
  { cue: /学校/, hint: { word: "school", chinese: "学校" } },
  { cue: /公园/, hint: { word: "park", chinese: "公园" } },
  { cue: /图书馆/, hint: { word: "library", chinese: "图书馆" } },
  { cue: /教室/, hint: { word: "classroom", chinese: "教室" } },
  { cue: /房间/, hint: { word: "room", chinese: "房间" } },
  { cue: /外面/, hint: { word: "outside", chinese: "外面" } },
  { cue: /里面|屋里/, hint: { word: "inside", chinese: "里面" } },
  { cue: /开心|高兴|快乐/, hint: { word: "happy", chinese: "开心" } },
  { cue: /大大的|很大/, hint: { word: "big", chinese: "大" } },
  { cue: /小小的|很小/, hint: { word: "small", chinese: "小" } },
  { cue: /一起/, hint: { word: "together", chinese: "一起" } },
  { cue: /之后|以后|后/, hint: { word: "after", chinese: "之后" } },
  { cue: /头上|头顶|脑袋上/, hint: { word: "head", chinese: "头上" } },
  { cue: /好看|漂亮|美丽/, hint: { word: "pretty", chinese: "好看" } },
];

function importantWordsFor(sentence: string, tense: ScaffoldTense) {
  const result = importantWordCues.filter(({ cue }) => cue.test(sentence)).map(({ hint }) => hint);
  if (tense === "past") result.push({ word: "yesterday", chinese: "昨天" });
  if (tense === "progressive") result.push({ word: "now", chinese: "现在" });
  if (tense === "present" && /每天|经常|通常/.test(sentence)) result.push({ word: "every day", chinese: "每天" });
  return result.filter((hint, index, all) => all.findIndex((item) => item.word === hint.word) === index).slice(0, 5);
}

function shuffleStable(items: string[]) {
  if (items.length < 4) return [...items].reverse();
  return [...items.slice(1), items[0]].reverse();
}

export function buildFallbackScaffold(chineseSentence: string, targetWordIds: string[], mode: ChinesePracticeMode): ScaffoldResponse {
  const targets = targetWordIds.map((id) => chineseVocabularyById[id]).filter(Boolean).slice(0, 4);
  const verbs = [...new Set(targets.flatMap((word) => word.verbs))].slice(0, 3);
  const baseVerb = verbs[0] || "use";
  const tense = detectChineseTense(chineseSentence);
  const recommendedVerbForm = verbForTense(baseVerb, tense);
  const structureId = tense === "past" ? "past" : tense === "progressive" ? "progressive" : "present";
  const nouns = targets.map((target) => `the ${target.word}`);
  const object = nouns.join(" and ") || "the word";
  const hasHeadRelation = /头上|头顶|脑袋上/.test(chineseSentence)
    && targets.some((target) => target.word === "flower")
    && targets.some((target) => target.word === "duck");
  const hasAfterDoor = /打开门后|开门后|门后|之后|以后/.test(chineseSentence)
    && targets.some((target) => target.word === "door");
  const hasPretty = /好看|漂亮|美丽/.test(chineseSentence);
  const doorVerb = targets.flatMap((target) => target.verbs).find((verb) => verb === "open") || "open";
  const seeVerb = targets.flatMap((target) => target.verbs).find((verb) => verb === "see") || "see";
  const flowerPhrase = `the ${hasPretty ? "pretty " : ""}flower`;
  const visualSentence = hasHeadRelation
    ? `${hasAfterDoor ? `After I ${doorVerb} the door, ` : ""}I ${seeVerb} ${flowerPhrase} on the duck's head.`
    : null;
  const sentence = visualSentence || (tense === "past"
    ? `I ${recommendedVerbForm} ${object} yesterday.`
    : tense === "progressive"
      ? `I am ${recommendedVerbForm} ${object} now.`
      : `I ${recommendedVerbForm} ${object} every day.`);
  const tenseHint = tense === "past"
    ? "你写到了过去的时间，建议使用一般过去时。"
    : tense === "progressive"
      ? "你写到了“现在”或“正在”，建议使用现在进行时。"
      : "没有明显的过去或正在提示，先用一般现在时最清楚。";

  return {
    verbs,
    recommendedVerbForm,
    tenseHint,
    structureId,
    conjunctions: conjunctionsFor(chineseSentence),
    importantWords: importantWordsFor(chineseSentence, tense),
    ...(mode === "beginner" ? { chunks: shuffleStable(sentence.split(" ")) } : {}),
    source: "fallback",
  };
}

export function isKnownStructure(id: string) {
  return sentenceStructures.some((structure) => structure.id === id);
}
