import { NextResponse } from "next/server";
import { evaluateRules, rulesFallback } from "@/lib/evaluation";
import type { EvaluationRequest, EvaluationResult } from "@/types/game";

export const runtime = "nodejs";

type ChatPayload = {
  choices?: Array<{ message?: { content?: unknown; reasoning_content?: unknown }; text?: unknown }>;
  output_text?: unknown;
};

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
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 300,
        // Agnes 2.0 Flash rejects the top-level response_format parameter.
        // The strict system instruction plus tolerant parsing below keeps the
        // same JSON contract without spending a request on a 400 response.
        ...(!useAgnes ? { response_format: { type: "json_object" } } : {}),
        messages: [
          { role: "system", content: "You evaluate an English vocabulary game sentence for grades 5-9. Return only JSON with valid (boolean), confidence (0 to 1), reason (short supportive explanation), correctedSentence (string), and relationshipSummary (short explanation of how the target words relate). Accept understandable natural English; do not require perfect grammar. The sentence must use every target word in a meaningful context." },
          { role: "user", content: JSON.stringify({ ...input, task: "Evaluate semantic appropriateness and comprehensibility." }) },
        ],
      }),
    });
    if (!response.ok) throw new Error(`AI evaluator returned ${response.status}`);
    const payload = await response.json() as ChatPayload;
    const raw = extractAnswer(payload);
    if (!raw) throw new Error("AI evaluator returned no content");
    receivedAnswer = true;
    const parsed = parseJsonAnswer(raw);
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
  } catch {
    const reason = receivedAnswer
      ? "The semantic evaluator replied, but its answer format could not be read. Your sentence passed the instant checks and is counted provisionally."
      : "The semantic evaluator was unavailable before returning an answer. Your sentence passed the instant checks and is counted provisionally.";
    return NextResponse.json({ ...rulesFallback(input), reason });
  }
}
