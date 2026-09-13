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
type ProviderName = "agnes" | "deepseek" | "openai";
type EvaluatorProvider = {
  name: ProviderName;
  apiKey: string;
  baseUrl: string;
  model: string;
  supportsJsonMode: boolean;
};
type ProviderFailure = Error & { receivedAnswer: boolean };

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

function configuredProviders(): EvaluatorProvider[] {
  const agnesApiKey = process.env.AGNES_API_KEY?.trim();
  const deepSeekApiKey = process.env.DEEPSEEK_API_KEY?.trim();
  const openAiApiKey = process.env.OPENAI_API_KEY?.trim();
  const providers: Array<EvaluatorProvider | null> = [
    agnesApiKey ? {
      name: "agnes",
      apiKey: agnesApiKey,
      baseUrl: process.env.AGNES_BASE_URL || "https://apihub.agnes-ai.com/v1",
      model: process.env.AGNES_TEXT_MODEL || "agnes-2.0-flash",
      supportsJsonMode: false,
    } : null,
    deepSeekApiKey ? {
      name: "deepseek",
      apiKey: deepSeekApiKey,
      baseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
      model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
      supportsJsonMode: true,
    } : null,
    openAiApiKey ? {
      name: "openai",
      apiKey: openAiApiKey,
      baseUrl: "https://api.openai.com/v1",
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      supportsJsonMode: true,
    } : null,
  ];
  return providers.filter((provider): provider is EvaluatorProvider => provider !== null);
}

function providerFailure(message: string, receivedAnswer: boolean): ProviderFailure {
  const error = new Error(message) as ProviderFailure;
  error.receivedAnswer = receivedAnswer;
  return error;
}

function errorHadAnswer(error: unknown) {
  return Boolean(error && typeof error === "object" && (error as { receivedAnswer?: unknown }).receivedAnswer === true);
}

async function evaluateWithProvider(input: EvaluationRequest, provider: EvaluatorProvider): Promise<ProviderEvaluation> {
  let receivedAnswer = false;
  for (const [attempt, maxTokens] of COMPLETION_TOKEN_BUDGETS.entries()) {
    let response: Response;
    try {
      response = await fetch(`${provider.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.apiKey}` },
        signal: AbortSignal.timeout(30000),
        body: JSON.stringify({
          model: provider.model,
          temperature: 0.1,
          max_tokens: maxTokens,
          // Agnes 2.0 Flash rejects the top-level response_format parameter.
          // The strict system instruction plus tolerant parsing below keeps the
          // same JSON contract without spending a request on a 400 response.
          ...(provider.supportsJsonMode ? { response_format: { type: "json_object" } } : {}),
          messages: [
            { role: "system", content: "You check an English vocabulary-game sentence for grades 5-9. Return only one compact JSON object with exactly these fields: valid (boolean), confidence (number from 0 to 1), reason (one short supportive sentence), correctedSentence (string), and relationshipSummary (one short sentence explaining how the target words relate). valid must be true only when the sentence is complete, every target word makes sense, and the English has no word-form, subject-verb agreement, tense, article, preposition, pronoun, modal-verb, singular/plural, spelling, or sentence-structure error. Ignore only capitalization and missing final punctuation. For an invalid sentence, set valid to false, identify the most useful change in plain language, and provide a minimally corrected sentence. For a valid sentence, correctedSentence must exactly equal the submitted sentence. Write directly to a primary-school learner in friendly, everyday English. Keep reason and relationshipSummary under 15 words each. Never use technical language; avoid terms such as semantic, syntax, or morphology. Do not include markdown, commentary, or reasoning outside the JSON object." },
            { role: "user", content: JSON.stringify({ ...input, task: "Check the English sentence strictly and verify every target word is used meaningfully." }) },
          ],
        }),
      });
    } catch (error) {
      throw providerFailure(error instanceof Error ? error.message : "AI evaluator request failed", receivedAnswer);
    }

    if (!response.ok) throw providerFailure(`AI evaluator returned ${response.status}`, receivedAnswer);

    let payload: ChatPayload;
    try {
      payload = await response.json() as ChatPayload;
    } catch {
      throw providerFailure("AI evaluator returned invalid JSON", receivedAnswer);
    }
    const answers = extractAnswers(payload);
    if (answers.length) receivedAnswer = true;

    if (wasTruncated(payload) && attempt < COMPLETION_TOKEN_BUDGETS.length - 1) continue;
    if (!answers.length && attempt >= COMPLETION_TOKEN_BUDGETS.length - 1) throw providerFailure("AI evaluator returned no content", receivedAnswer);
    if (wasTruncated(payload) && attempt >= COMPLETION_TOKEN_BUDGETS.length - 1) throw providerFailure("AI evaluator response was truncated", receivedAnswer);
    const parsed = parseAnyAnswer(answers);
    if (parsed) return parsed;
    if (attempt >= COMPLETION_TOKEN_BUDGETS.length - 1) throw providerFailure("AI evaluator returned unreadable or incomplete JSON", receivedAnswer);
  }
  throw providerFailure("AI evaluator returned no result", receivedAnswer);
}

function toEvaluationResult(parsed: ProviderEvaluation, input: EvaluationRequest): EvaluationResult {
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
  return result;
}

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const input = asRequest(body);
  const rules = evaluateRules(input);
  if (rules) return NextResponse.json(rules);
  // Agnes is primary; any configured fallback is tried when it is rate-limited,
  // unavailable, or returns an answer that cannot be parsed.
  const providers = configuredProviders();
  if (!providers.length) return NextResponse.json(rulesFallback(input));

  const started = Date.now();
  let receivedAnswer = false;
  for (const provider of providers) {
    try {
      const parsed = await evaluateWithProvider(input, provider);
      return NextResponse.json(toEvaluationResult(parsed, input), { headers: { "Server-Timing": `evaluation;dur=${Date.now() - started}` } });
    } catch (error) {
      const providerReceivedAnswer = errorHadAnswer(error);
      receivedAnswer ||= providerReceivedAnswer;
      console.error("Semantic evaluator provider failed", {
        provider: provider.name,
        model: provider.model,
        receivedAnswer: providerReceivedAnswer,
        error: error instanceof Error ? error.message : "Unknown evaluator error",
      });
    }
  }

  const reason = receivedAnswer
    ? "The semantic evaluator replied, but its answer format could not be read. Your sentence passed the instant checks and is counted provisionally."
    : "The semantic evaluator was unavailable before returning an answer. Your sentence passed the instant checks and is counted provisionally.";
  return NextResponse.json({ ...rulesFallback(input), reason });
}
