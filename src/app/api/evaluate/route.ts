import { NextResponse } from "next/server";
import { evaluateRules, rulesFallback } from "@/lib/evaluation";
import type { EvaluationRequest, EvaluationResult } from "@/types/game";

export const runtime = "nodejs";

function asRequest(input: unknown): EvaluationRequest {
  const value = input as Partial<EvaluationRequest>;
  return {
    sentence: typeof value.sentence === "string" ? value.sentence : "",
    inputMethod: value.inputMethod === "voice" ? "voice" : "text",
    targetWords: Array.isArray(value.targetWords) ? value.targetWords.filter((word): word is string => typeof word === "string") : [],
    gradeBand: value.gradeBand === "7-9" ? "7-9" : "5-6",
  };
}

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const input = asRequest(body);
  const rules = evaluateRules(input);
  if (rules) return NextResponse.json(rules);
  const useDeepSeek = Boolean(process.env.DEEPSEEK_API_KEY);
  const apiKey = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json(rulesFallback(input));

  const started = Date.now();
  try {
    const response = await fetch(useDeepSeek ? (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com") + "/chat/completions" : "https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(7000),
      body: JSON.stringify({
        model: useDeepSeek ? (process.env.DEEPSEEK_MODEL || "deepseek-chat") : (process.env.OPENAI_MODEL || "gpt-4.1-mini"),
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You evaluate an English vocabulary game sentence for grades 5-9. Return only JSON with valid (boolean), confidence (0 to 1), reason (short supportive explanation), correctedSentence (string), and relationshipSummary (short explanation of how the target words relate). Accept understandable natural English; do not require perfect grammar. The sentence must use every target word in a meaningful context." },
          { role: "user", content: JSON.stringify({ ...input, task: "Evaluate semantic appropriateness and comprehensibility." }) },
        ],
      }),
    });
    if (!response.ok) throw new Error(`AI evaluator returned ${response.status}`);
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const raw = payload.choices?.[0]?.message?.content;
    if (!raw) throw new Error("AI evaluator returned no content");
    const parsed = JSON.parse(raw) as Partial<EvaluationResult>;
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
    return NextResponse.json({ ...rulesFallback(input), reason: "The semantic evaluator was unavailable. Your sentence passed the instant checks and is counted provisionally." });
  }
}
