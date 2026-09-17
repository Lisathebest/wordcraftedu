import { NextResponse } from "next/server";
import { PENDING_WORD_IMAGE } from "@/lib/illustration";
import { buildIllustrationPrompt } from "@/lib/illustration-prompt";

export const runtime = "nodejs";

const fallbackImage = PENDING_WORD_IMAGE;

type ImageResult = { b64_json?: string | null; url?: string | null };
type ImagePayload = { data?: ImageResult[] };
const IMAGE_API_BASE_URL = (process.env.SWY_IMAGE_BASE_URL?.trim() || "https://aiapi.swy168.com/v1").replace(/\/+$/, "");
const IMAGE_MODEL = process.env.SWY_IMAGE_MODEL?.trim() || "gpt-image-2";
const IMAGE_REQUEST_TIMEOUT_MS = 180000;
const IMAGE_MAX_ATTEMPTS = 3;

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

/** Read the provider's own error message so the 401 is actionable instead of opaque. */
async function providerErrorDetail(response: Response) {
  try {
    const text = (await response.text()).trim();
    if (!text) return "";
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
      const nested = typeof parsed.error === "string" ? parsed.error : parsed.error?.message;
      return (nested || parsed.message || text).replace(/\s+/g, " ").slice(0, 300);
    } catch {
      return text.replace(/\s+/g, " ").slice(0, 300);
    }
  } catch {
    return "";
  }
}

function retryDelayMs(attempt: number) {
  return 1500 * attempt;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function generateImage(word: string, translation: string, apiKey: string) {
  const body = JSON.stringify({
    model: IMAGE_MODEL,
    prompt: buildIllustrationPrompt(word, translation),
    size: "1024x1024",
  });

  let lastDetail = "";
  for (let attempt = 1; attempt <= IMAGE_MAX_ATTEMPTS; attempt += 1) {
    const response = await fetch(`${IMAGE_API_BASE_URL}/images/generations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(IMAGE_REQUEST_TIMEOUT_MS),
    });

    if (response.ok) return imageFromPayload(await response.json() as ImagePayload);

    const detail = await providerErrorDetail(response);

    // 401/403 are configuration problems: retrying the same request cannot help.
    if (response.status === 401 || response.status === 403) {
      const hint = response.status === 401
        ? "The key was rejected (HTTP 401). Update SWY_IMAGE_API_KEY in Vercel with the current key and redeploy, then confirm the key has access to this image model."
        : `The key is not allowed to use this image model (HTTP 403). Grant access to "${IMAGE_MODEL}" or set SWY_IMAGE_MODEL to a model the key can use.`;
      throw new Error(`${hint}${detail ? ` Provider said: ${detail}` : ""}`);
    }

    lastDetail = detail;

    // Only retry transient upstream failures (5xx, 408, 429).
    const isTransient = response.status >= 500 || response.status === 408 || response.status === 429;
    if (!isTransient || attempt === IMAGE_MAX_ATTEMPTS) {
      throw new Error(`Image provider rejected the request (HTTP ${response.status}) after ${attempt} attempt(s). Check the key's model access and image endpoint.${detail ? ` Provider said: ${detail}` : ""}`);
    }

    await sleep(retryDelayMs(attempt));
  }

  throw new Error(`Image provider request failed.${lastDetail ? ` Provider said: ${lastDetail}` : ""}`);
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
    console.error("Illustration generation failed", { detail, baseUrl: IMAGE_API_BASE_URL, model: IMAGE_MODEL });
    const message = detail.startsWith("Image provider") || detail.startsWith("The key")
      ? detail
      : "Could not reach the image provider. Check the Vercel function logs and try again.";
    return NextResponse.json({ image: fallbackImage, source: "fallback", message });
  }
}
