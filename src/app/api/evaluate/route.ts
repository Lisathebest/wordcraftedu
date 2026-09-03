import { NextResponse } from "next/server";
import { evaluateRules, rulesFallback } from "@/lib/evaluation";
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

function extractAnswer(payload: ChatPayload): string {
  const choice = payload.choices?.[0];
  return contentToText(choice?.message?.content)
    || contentToText(choice?.message?.reasoning_content)
    || contentToText(choice?.text)
    || contentToText(payload.output_text);
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
    let parsed: Partial<EvaluationResult> | null = null;
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
            { role: "system", content: "You evaluate an English vocabulary game sentence for grades 5-9. Return only compact JSON with valid (boolean), confidence (0 to 1), reason (one short supportive sentence), correctedSentence (string), and relationshipSummary (one short sentence explaining how the target words relate). Write directly to a primary-school learner using friendly, everyday English. Keep reason and relationshipSummary under 15 words each. Say clearly what works or what the learner should change. Never use technical language such as semantic, semantically, appropriate, comprehensible, coherence, grammatical, grammar, syntax, or contextually. Do not include markdown or reasoning. Accept understandable natural English; do not require perfect grammar. The sentence must use every target word in a way that makes sense." },
            { role: "user", content: JSON.stringify({ ...input, task: "Check whether the sentence is clear and every target word makes sense in it." }) },
          ],
        }),
      });
      if (!response.ok) throw new Error(`AI evaluator returned ${response.status}`);
      const payload = await response.json() as ChatPayload;
      const raw = extractAnswer(payload);
      if (raw) receivedAnswer = true;

      if (wasTruncated(payload) && attempt < COMPLETION_TOKEN_BUDGETS.length - 1) continue;
      if (!raw) throw new Error("AI evaluator returned no content");
      if (wasTruncated(payload)) throw new Error("AI evaluator response was truncated");
      parsed = parseJsonAnswer(raw);
      break;
    }
    if (!parsed) throw new Error("AI evaluator returned no result");
    const result: EvaluationResult = {
      valid: parsed.valid === true,
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5)),
      reason: typeof parsed.reason === "string" ? parsed.reason : "The evaluator checked your sentence.",
      correctedSentence: typeof parsed.correctedSentence === "string" ? parsed.correctedSentence : input.sentence,
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
