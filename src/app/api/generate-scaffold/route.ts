import { NextResponse } from "next/server";
import { buildFallbackScaffold, isKnownStructure } from "@/lib/chinese-scaffold";
import { chineseVocabularyById } from "@/data/chinese-vocabulary";
import type { ChinesePracticeMode, ScaffoldResponse, ScaffoldWordHint } from "@/types/chinese-learning";

export const runtime = "nodejs";

type Provider = { apiKey: string; baseUrl: string; model: string; jsonMode: boolean };

function providers(): Provider[] {
  const values: Array<Provider | null> = [
    process.env.DEEPSEEK_CHINESE_API_KEY?.trim() ? { apiKey: process.env.DEEPSEEK_CHINESE_API_KEY.trim(), baseUrl: process.env.DEEPSEEK_CHINESE_BASE_URL || process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com", model: process.env.DEEPSEEK_CHINESE_MODEL || process.env.DEEPSEEK_MODEL || "deepseek-chat", jsonMode: true } : null,
    process.env.AGNES_API_KEY?.trim() ? { apiKey: process.env.AGNES_API_KEY.trim(), baseUrl: process.env.AGNES_BASE_URL || "https://apihub.agnes-ai.com/v1", model: process.env.AGNES_TEXT_MODEL || "agnes-2.0-flash", jsonMode: false } : null,
    process.env.OPENAI_API_KEY?.trim() ? { apiKey: process.env.OPENAI_API_KEY.trim(), baseUrl: "https://api.openai.com/v1", model: process.env.OPENAI_MODEL || "gpt-4.1-mini", jsonMode: true } : null,
  ];
  return values.filter((value): value is Provider => value !== null);
}

function readJson(content: unknown) {
  if (typeof content !== "string") return null;
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try { return JSON.parse(cleaned) as Partial<ScaffoldResponse>; } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try { return JSON.parse(cleaned.slice(start, end + 1)) as Partial<ScaffoldResponse>; } catch { return null; }
  }
}

function cleanImportantWords(value: unknown, fallback: ScaffoldWordHint[], targetWords: string[]) {
  if (!Array.isArray(value)) return fallback;
  const targetSet = new Set(targetWords.map((word) => word.toLowerCase()));
  const hints = value.map((item): ScaffoldWordHint | null => {
    if (typeof item === "string") {
      const word = item.trim().slice(0, 40);
      return word ? { word, chinese: "" } : null;
    }
    if (!item || typeof item !== "object") return null;
    const record = item as { word?: unknown; chinese?: unknown };
    const word = typeof record.word === "string" ? record.word.trim().slice(0, 40) : "";
    if (!word) return null;
    return { word, chinese: typeof record.chinese === "string" ? record.chinese.trim().slice(0, 24) : "" };
  }).filter((item): item is ScaffoldWordHint => item !== null).filter((item) => !targetSet.has(item.word.toLowerCase()));
  const unique = hints.filter((hint, index, all) => all.findIndex((item) => item.word.toLowerCase() === hint.word.toLowerCase()) === index);
  return unique.length ? unique.slice(0, 5) : fallback;
}

function cleanAiResult(value: Partial<ScaffoldResponse>, fallback: ScaffoldResponse, mode: ChinesePracticeMode, targetWords: string[]): ScaffoldResponse | null {
  if (!Array.isArray(value.verbs) || typeof value.recommendedVerbForm !== "string" || typeof value.tenseHint !== "string" || typeof value.structureId !== "string" || !isKnownStructure(value.structureId)) return null;
  const verbs = value.verbs.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim().slice(0, 40)).slice(0, 3);
  const conjunctions = Array.isArray(value.conjunctions) ? value.conjunctions.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean).slice(0, 3) : fallback.conjunctions;
  const importantWords = cleanImportantWords(value.importantWords, fallback.importantWords, targetWords);
  if (!verbs.length) return null;
  const chunks = mode === "beginner" && Array.isArray(value.chunks)
    ? value.chunks.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()).slice(0, 24)
    : undefined;
  if (mode === "beginner" && (!chunks?.length || !targetWords.every((word) => chunks.join(" ").toLowerCase().includes(word.toLowerCase())))) return null;
  return {
    verbs,
    recommendedVerbForm: value.recommendedVerbForm.trim().slice(0, 60),
    tenseHint: value.tenseHint.trim().slice(0, 120),
    structureId: value.structureId,
    conjunctions,
    importantWords,
    ...(chunks ? { chunks } : {}),
    source: "ai",
  };
}

async function askProvider(provider: Provider, chineseSentence: string, targets: Array<{ word: string; chinese: string; verbs: string[] }>, mode: ChinesePracticeMode, fallback: ScaffoldResponse) {
  const response = await fetch(`${provider.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.apiKey}` },
    // The deterministic Reference Sheet fallback should arrive quickly for a
    // learner even when an external evaluator is unavailable.
    signal: AbortSignal.timeout(8000),
    body: JSON.stringify({
      model: provider.model,
      temperature: 0.15,
      max_tokens: 700,
      ...(provider.jsonMode ? { response_format: { type: "json_object" } } : {}),
      messages: [
        { role: "system", content: "你为中国小学四年级学生提供英文组句支架。只返回 JSON：verbs(string[2-3])、recommendedVerbForm(string)、tenseHint(简短中文)、structureId(string)、conjunctions(string[])、importantWords({word:string,chinese:string}[])。importantWords 从学生的中文想法中提取 2-5 个有助于表达想象力的简单英文词，可以是人物、地点、形容词、时间或副词，不要重复目标词；只给词语，不要组成完整答案。入门模式额外返回 chunks(string[])。structureId 只能是 have, like, this-is, is, can-see, use-to, there-is, present, past, progressive。不要解释语法术语，不要在进阶模式提供完整句子。入门模式的 chunks 必须组成一个自然、简单、包含全部目标词的英文句子。" },
        { role: "user", content: JSON.stringify({ chineseSentence, targets, mode, safeFallback: fallback }) },
      ],
    }),
  });
  if (!response.ok) throw new Error(`provider ${response.status}`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
  return readJson(payload.choices?.[0]?.message?.content);
}

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "请求格式不正确。" }, { status: 400 }); }
  const input = body as { chineseSentence?: unknown; targetWordIds?: unknown; mode?: unknown };
  const chineseSentence = typeof input.chineseSentence === "string" ? input.chineseSentence.trim().slice(0, 180) : "";
  const mode: ChinesePracticeMode = input.mode === "independent" ? "independent" : "beginner";
  const rawIds = Array.isArray(input.targetWordIds) ? input.targetWordIds.filter((id): id is string => typeof id === "string") : [];
  const ids = rawIds.slice(0, 4);
  const targets = ids.map((id) => chineseVocabularyById[id]).filter(Boolean);
  if (!chineseSentence) return NextResponse.json({ error: "请先写下你想表达的中文句子。" }, { status: 400 });
  if (rawIds.length > 4 || !targets.length || targets.length !== ids.length) return NextResponse.json({ error: "请选择一到四个词卡。" }, { status: 400 });

  const fallback = buildFallbackScaffold(chineseSentence, ids, mode);
  for (const provider of providers()) {
    try {
      const raw = await askProvider(provider, chineseSentence, targets.map(({ word, chinese, verbs }) => ({ word, chinese, verbs })), mode, fallback);
      const result = raw && cleanAiResult(raw, fallback, mode, targets.map((target) => target.word));
      if (result) return NextResponse.json(result);
    } catch (error) {
      console.error("Chinese scaffold provider failed", error instanceof Error ? error.message : "Unknown error");
    }
  }
  return NextResponse.json(fallback);
}
