import { NextResponse } from "next/server";
import { PENDING_WORD_IMAGE } from "@/lib/illustration";
import { buildIllustrationPrompt } from "@/lib/illustration-prompt";

export const runtime = "nodejs";

const fallbackImage = PENDING_WORD_IMAGE;

type ImageResult = { b64_json?: string | null; url?: string | null };
type ImagePayload = { data?: ImageResult[] };
const IMAGE_API_BASE_URL = "https://aiapi.swy168.com/v1";
const IMAGE_MODEL = "gpt-image-2";
const IMAGE_REQUEST_TIMEOUT_MS = 180000;

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
  throw new Error("Image provider returned no usable image (check its response format).");
}

async function generateImage(word: string, translation: string, apiKey: string) {
  const response = await fetch(`${IMAGE_API_BASE_URL}/images/generations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: IMAGE_MODEL,
      prompt: buildIllustrationPrompt(word, translation),
      size: "1024x1024",
    }),
    signal: AbortSignal.timeout(IMAGE_REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Image provider rejected the request (HTTP ${response.status}). Check the key's model access and image endpoint.`);
  return imageFromPayload(await response.json() as ImagePayload);
}

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const input = body as { word?: unknown; translation?: unknown };
  const word = cleanWord(input.word);
  const translation = cleanTranslation(input.translation);
  if (!word) return NextResponse.json({ error: "A vocabulary word is required." }, { status: 400 });

  const apiKey = process.env.SWY_IMAGE_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({ image: fallbackImage, source: "demo", message: "No image provider is configured. Add SWY_IMAGE_API_KEY to generate this word's illustration." });
  }

  try {
    const image = await generateImage(word, translation, apiKey);
    return NextResponse.json({ image, source: "ai", provider: "swy", model: IMAGE_MODEL });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown provider error";
    console.error("Illustration generation failed", { detail });
    const message = detail.startsWith("Image provider")
      ? detail
      : "Could not reach the image provider. Check the Vercel function logs and try again.";
    return NextResponse.json({ image: fallbackImage, source: "fallback", message });
  }
}
