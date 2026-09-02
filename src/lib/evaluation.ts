import { vocabularyById } from "@/data/content";
import type { EvaluationRequest, EvaluationResult } from "@/types/game";

export function normalizeSentence(sentence: string) {
  return sentence.toLowerCase().replace(/[“”‘’]/g, "'").replace(/[^a-z0-9' -]/g, " ").replace(/\s+/g, " ").trim();
}

export function containsWord(sentence: string, target: string) {
  const normalized = normalizeSentence(sentence);
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}(?:s|es|ed|ing)?\\b`, "i").test(normalized);
}

export function evaluateRules(request: EvaluationRequest): EvaluationResult | null {
  const sentence = normalizeSentence(request.sentence);
  if (!sentence) return invalid("Write or say a complete sentence.");
  const missing = request.targetWords.filter((target) => !containsWord(sentence, target));
  if (missing.length) return invalid(`Use ${missing.join(" and ")} in your sentence.`);
  const tokens = sentence.split(" ").filter(Boolean);
  if (tokens.length < 4 || request.targetWords.every((word) => tokens.includes(word)) && tokens.length <= request.targetWords.length + 1) {
    return invalid("Add more detail to make a complete, meaningful sentence.");
  }
  // Keep this instant check deliberately broad: it only guards obvious
  // fragments before the semantic evaluator runs. Include common irregular
  // verbs such as "put" so natural classroom sentences are not rejected.
  const hasVerb = /\b(?:is|are|was|were|be|am|have|has|had|do|does|did|go|went|use|buy|study|attend|apply|pay|visit|need|serve|drink|eat|submit|read|give|offer|provide|help|sell|open|close|learn|teach|cost|review|finish|complete|work|workout|carry|live|move|check|keep|ask|pack|manage|reduce|call|meet|win|join|cross|yield|cause|avoid|connect|train|wipe|pour|stock|organize|replace|burn|plug|grab|take|put|place|set|make|bring|get|find|show|look|seem|feel|become|turn|leave|come|walk|run|sit|stand|lie|wear|hold|write|speak|say|tell|think|know|want|like|love|build|draw|choose|select|create|save|share|start|stop|turn|play|follow|change|mean|include|contain|serve|mix|cook|wash|fill|carry)(?:s|ed|ing)?\b|\b(?:bought|studied|attended|applied|paid|visited|needed|served|drank|ate|submitted|read|gave|offered|provided|helped|sold|opened|closed|learned|taught|cost|reviewed|finished|completed|worked|carried|lived|moved|checked|kept|asked|packed|managed|reduced|called|met|won|joined|crossed|yielded|caused|avoided|connected|trained|wiped|poured|stocked|organized|replaced|burned|plugged|grabbed|took|put)\b/.test(sentence);
  if (!hasVerb) return invalid("Your sentence needs a clear action or state.");
  return null;
}

function invalid(reason: string): EvaluationResult {
  return { valid: false, confidence: 0.98, reason, correctedSentence: "", relationshipSummary: "", source: "rules", provisional: false };
}

export function rulesFallback(request: EvaluationRequest): EvaluationResult {
  const words = request.targetWords.map((id) => vocabularyById[id]?.word ?? id);
  return {
    valid: true, confidence: 0.62,
    reason: "Your sentence passed the instant checks. Semantic AI is unavailable, so this result is provisional.",
    correctedSentence: request.sentence.trim(),
    relationshipSummary: words.length > 1 ? `${words.join(" + ")} were used together.` : `${words[0]} was used in context.`,
    source: "rules-fallback", provisional: true,
  };
}

export function evaluationCacheKey(request: EvaluationRequest) {
  return `${normalizeSentence(request.sentence)}|${[...request.targetWords].sort().join(",")}|${request.gradeBand}`;
}
