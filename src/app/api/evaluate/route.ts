import { NextResponse } from "next/server";
import { evaluateRules, normalizeSentence, rulesFallback } from "@/lib/evaluation";
import type { EvaluationRequest, EvaluationResult } from "@/types/game";

export const runtime = "nodejs";

type ChatPayload = {
  choices?: Array<{
    finish_reason?: unknown;
    message?: { content?: unknown; reasoning_content?: unknown };
    text?: unknown;
  }>;
  output_text?: unknown;
};

type ProviderEvaluation = Pick<EvaluationResult, "valid" | "confidence" | "reason" | "correctedSentence" | "relationshipSummary">;

const COMPLETION_TOKEN_BUDGETS = [800, 1600] as const;

function asRequest(input: unknown): EvaluationRequest {
  const value = input as Partial<EvaluationRequest>;
  return {
    sentence: typeof value.sentence === "string" ? value.sentence : "",
    inputMethod: value.inputMethod === "voice" ? "voice" : "text",
    targetWords: Array.isArray(value.targetWords) ? value.targetWords.filter((word): word is string => typeof word === "string") : [],
    gradeBand: value.gradeBand === "7-9" ? "7-9" : "5-6",
  };
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (typeof part === "string") return part;
    if (part && typeof part === "object") {
      const value = part as { text?: unknown; content?: unknown };
      return typeof value.text === "string" ? value.text : typeof value.content === "string" ? value.content : "";
    }
    return "";
  }).join("");
}

function extractAnswers(payload: ChatPayload): string[] {
  const choice = payload.choices?.[0];
  return [
    contentToText(choice?.message?.content),
    contentToText(choice?.text),
    contentToText(payload.output_text),
    contentToText(choice?.message?.reasoning_content),
  ].map((answer) => answer.trim()).filter((answer, index, answers) => Boolean(answer) && answers.indexOf(answer) === index);
}

function wasTruncated(payload: ChatPayload) {
  return payload.choices?.[0]?.finish_reason === "length";
}

function parseJsonAnswer(raw: string): Partial<EvaluationResult> {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try { return JSON.parse(cleaned) as Partial<EvaluationResult>; } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("AI evaluator returned unreadable JSON");
    return JSON.parse(cleaned.slice(start, end + 1)) as Partial<EvaluationResult>;
  }
}

function isCompleteAnswer(value: Partial<EvaluationResult>): value is ProviderEvaluation {
  return typeof value.valid === "boolean"
    && typeof value.confidence === "number"
    && Number.isFinite(value.confidence)
    && typeof value.reason === "string"
    && typeof value.correctedSentence === "string"
    && typeof value.relationshipSummary === "string";
}

function parseAnyAnswer(answers: string[]): ProviderEvaluation | null {
  for (const answer of answers) {
    try {
      const parsed = parseJsonAnswer(answer);
      if (isCompleteAnswer(parsed)) return parsed;
    } catch { /* Try the next response field or retry the provider. */ }
  }
  return null;
}

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const input = asRequest(body);
  const rules = evaluateRules(input);
  if (rules) return NextResponse.json(rules);
  // Agnes is the primary provider for both text evaluation and illustration
  // generation. The other providers remain optional fallbacks for local use.
  const agnesApiKey = process.env.AGNES_API_KEY?.trim();
  const deepSeekApiKey = process.env.DEEPSEEK_API_KEY?.trim();
  const openAiApiKey = process.env.OPENAI_API_KEY?.trim();
  const useAgnes = Boolean(agnesApiKey);
  const useDeepSeek = !useAgnes && Boolean(deepSeekApiKey);
  const apiKey = agnesApiKey || deepSeekApiKey || openAiApiKey;
  if (!apiKey) return NextResponse.json(rulesFallback(input));

  const baseUrl = useAgnes
    ? (process.env.AGNES_BASE_URL || "https://apihub.agnes-ai.com/v1")
    : useDeepSeek
      ? (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com")
      : "https://api.openai.com/v1";
  const model = useAgnes
    ? (process.env.AGNES_TEXT_MODEL || "agnes-2.0-flash")
    : useDeepSeek
      ? (process.env.DEEPSEEK_MODEL || "deepseek-chat")
      : (process.env.OPENAI_MODEL || "gpt-4.1-mini");

  const started = Date.now();
  let receivedAnswer = false;
  try {
    let parsed: ProviderEvaluation | null = null;
    for (const [attempt, maxTokens] of COMPLETION_TOKEN_BUDGETS.entries()) {
      const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(30000),
        body: JSON.stringify({
          model,
          temperature: 0.1,
          max_tokens: maxTokens,
          // Agnes 2.0 Flash rejects the top-level response_format parameter.
          // The strict system instruction plus tolerant parsing below keeps the
          // same JSON contract without spending a request on a 400 response.
          ...(!useAgnes ? { response_format: { type: "json_object" } } : {}),
          messages: [
            { role: "system", content: "You check an English vocabulary-game sentence for grades 5-9. Return only one compact JSON object with exactly these fields: valid (boolean), confidence (number from 0 to 1), reason (one short supportive sentence), correctedSentence (string), and relationshipSummary (one short sentence explaining how the target words relate). valid must be true only when the sentence is complete, every target word makes sense, and the English has no word-form, subject-verb agreement, tense, article, preposition, pronoun, modal-verb, singular/plural, spelling, or sentence-structure error. Ignore only capitalization and missing final punctuation. For an invalid sentence, set valid to false, identify the most useful change in plain language, and provide a minimally corrected sentence. For a valid sentence, correctedSentence must exactly equal the submitted sentence. Write directly to a primary-school learner in friendly, everyday English. Keep reason and relationshipSummary under 15 words each. Never use technical language; avoid terms such as semantic, syntax, or morphology. Do not include markdown, commentary, or reasoning outside the JSON object." },
            { role: "user", content: JSON.stringify({ ...input, task: "Check the English sentence strictly and verify every target word is used meaningfully." }) },
          ],
        }),
      });
      if (!response.ok) throw new Error(`AI evaluator returned ${response.status}`);
      const payload = await response.json() as ChatPayload;
      const answers = extractAnswers(payload);
      if (answers.length) receivedAnswer = true;

      if (wasTruncated(payload) && attempt < COMPLETION_TOKEN_BUDGETS.length - 1) continue;
      if (!answers.length && attempt >= COMPLETION_TOKEN_BUDGETS.length - 1) throw new Error("AI evaluator returned no content");
      if (wasTruncated(payload) && attempt >= COMPLETION_TOKEN_BUDGETS.length - 1) throw new Error("AI evaluator response was truncated");
      parsed = parseAnyAnswer(answers);
      if (parsed) break;
      if (attempt >= COMPLETION_TOKEN_BUDGETS.length - 1) throw new Error("AI evaluator returned unreadable or incomplete JSON");
    }
    if (!parsed) throw new Error("AI evaluator returned no result");
    const correctedSentence = parsed.correctedSentence.trim() || input.sentence.trim();
    const correctionChangesMeaningfulText = normalizeSentence(correctedSentence) !== normalizeSentence(input.sentence);
    const result: EvaluationResult = {
      // A correction is direct evidence of a language error, even if the model
      // accidentally labels an understandable sentence as valid.
      valid: parsed.valid === true && !correctionChangesMeaningfulText,
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5)),
      reason: typeof parsed.reason === "string" ? parsed.reason : "The evaluator checked your sentence.",
      correctedSentence,
      relationshipSummary: typeof parsed.relationshipSummary === "string" ? parsed.relationshipSummary : "The target words were considered together.",
      source: "ai", provisional: false,
    };
    // Low-confidence results remain playable but are clearly marked as provisional.
    result.provisional = result.confidence < 0.7;
    return NextResponse.json(result, { headers: { "Server-Timing": `evaluation;dur=${Date.now() - started}` } });
  } catch (error) {
    console.error("Semantic evaluator failed", {
      provider: useAgnes ? "agnes" : useDeepSeek ? "deepseek" : "openai",
      model,
      receivedAnswer,
      error: error instanceof Error ? error.message : "Unknown evaluator error",
    });
    const reason = receivedAnswer
      ? "The semantic evaluator replied, but its answer format could not be read. Your sentence passed the instant checks and is counted provisionally."
      : "The semantic evaluator was unavailable before returning an answer. Your sentence passed the instant checks and is counted provisionally.";
    return NextResponse.json({ ...rulesFallback(input), reason });
  }
}
