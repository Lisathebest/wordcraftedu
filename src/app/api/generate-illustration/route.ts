import { NextResponse } from "next/server";
import { PENDING_WORD_IMAGE } from "@/lib/illustration";
import { buildIllustrationPrompt } from "@/lib/illustration-prompt";

export const runtime = "nodejs";

const fallbackImage = PENDING_WORD_IMAGE;

type ImageResult = { b64_json?: string | null; url?: string | null };
type ImagePayload = { data?: ImageResult[] };

function cleanWord(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/[^a-zA-Z0-9 '\u2019-]/g, "").slice(0, 80) : "";
}

function cleanTranslation(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/[\r\n]/g, " ").slice(0, 120) : "";
}

function imageFromPayload(payload: ImagePayload) {
  const generated = payload.data?.[0];
  if (generated?.b64_json) return generated.b64_json.startsWith("data:") ? generated.b64_json : `data:image/png;base64,${generated.b64_json}`;
  if (generated?.url) return generated.url;
  throw new Error("Image generation returned no image");
}

async function generateWithAgnes(word: string, translation: string, apiKey: string) {
  const baseUrl = (process.env.AGNES_BASE_URL || "https://apihub.agnes-ai.com/v1").replace(/\/+$/, "");
  const model = process.env.AGNES_IMAGE_MODEL || "agnes-image-2.0-flash";
  const responseFormat = process.env.AGNES_IMAGE_RESPONSE_FORMAT === "b64_json" ? "b64_json" : "url";
  const response = await fetch(`${baseUrl}/images/generations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt: buildIllustrationPrompt(word, translation),
      size: "1024x1024",
      ...(responseFormat === "b64_json" ? { return_base64: true } : {}),
      extra_body: { response_format: responseFormat },
    }),
    signal: AbortSignal.timeout(180000),
  });
  if (!response.ok) throw new Error(`Agnes image generation failed (${response.status})`);
  return imageFromPayload(await response.json() as ImagePayload);
}

async function generateWithOpenAi(word: string, translation: string, apiKey: string) {
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-2",
      size: "1024x1024",
      quality: "medium",
      prompt: buildIllustrationPrompt(word, translation),
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`OpenAI image generation failed (${response.status})`);
  return imageFromPayload(await response.json() as ImagePayload);
}

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const input = body as { word?: unknown; translation?: unknown };
  const word = cleanWord(input.word);
  const translation = cleanTranslation(input.translation);
  if (!word) return NextResponse.json({ error: "A vocabulary word is required." }, { status: 400 });

  // Agnes is preferred when configured. OpenAI remains a compatible fallback for
  // deployments that already have an OpenAI image key.
  const agnesApiKey = process.env.AGNES_API_KEY?.trim();
  const openAiApiKey = process.env.OPENAI_API_KEY?.trim();
  if (!agnesApiKey && !openAiApiKey) {
    return NextResponse.json({ image: fallbackImage, source: "demo", message: "No image provider is configured. Add AGNES_API_KEY to generate this word's illustration." });
  }

  try {
    if (agnesApiKey) {
      const image = await generateWithAgnes(word, translation, agnesApiKey);
      return NextResponse.json({ image, source: "ai", provider: "agnes" });
    }
    if (openAiApiKey) {
      const image = await generateWithOpenAi(word, translation, openAiApiKey);
      return NextResponse.json({ image, source: "ai", provider: "openai" });
    }
    throw new Error("No image provider configured");
  } catch {
    return NextResponse.json({ image: fallbackImage, source: "fallback", message: "The generator is unavailable right now. This word was not replaced with another image; check the API key and try again." });
  }
}
