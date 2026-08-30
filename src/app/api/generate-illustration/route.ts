import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const fallbackImage = "/illustration-studio/compass-sample.png";
// Keep the house style deterministic. These three supplied drawings are always
// attached as internal references; teachers do not need to pick a visual language.
const REFERENCE_IDS = ["dumbbell", "kettle", "textbook"] as const;
const STYLE_PROMPT = [
  "Use the Wordcraft Classroom house style every time: sparse graphite pencil outlines, visible rough hand-drawn pencil texture, restrained colored-pencil shading, tiny bean-shaped dot eyes, and small soft blush marks.",
  "Center one friendly, immediately recognizable subject on warm-white paper with generous negative space and a clean classroom flashcard composition.",
  "No lettering, labels, watermark, people, hands, photorealism, 3D rendering, glossy cartoon finish, or busy background.",
].join(" ");

function cleanWord(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/[^a-zA-Z0-9 '\u2019-]/g, "").slice(0, 80) : "";
}

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const input = body as { word?: unknown };
  const word = cleanWord(input.word);
  if (!word) return NextResponse.json({ error: "A vocabulary word is required." }, { status: 400 });

  // The studio remains explorable without a key. A teacher can still preview the
  // approved visual direction, then enable the live generator when ready.
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ image: fallbackImage, source: "demo", message: "Demo preview shown. Add OPENAI_API_KEY to generate a new illustration." });
  }

  try {
    const form = new FormData();
    form.append("model", process.env.OPENAI_IMAGE_MODEL || "gpt-image-2");
    form.append("size", "1024x1024");
    form.append("quality", "medium");
    form.append("prompt", [
      STYLE_PROMPT,
      `Create a single vocabulary flashcard illustration for the English word “${word}”.`,
      "Keep the subject friendly, clear, and useful for a classroom word card.",
    ].join(" "));

    for (const id of REFERENCE_IDS) {
      const filePath = path.join(process.cwd(), "public", "vocab", `${id}.png`);
      const bytes = await readFile(filePath);
      form.append("image[]", new Blob([bytes], { type: "image/png" }), `${id}.png`);
    }

    const response = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new Error("Image generation failed");
    const payload = await response.json() as { data?: Array<{ b64_json?: string; url?: string }> };
    const generated = payload.data?.[0];
    if (generated?.b64_json) return NextResponse.json({ image: `data:image/png;base64,${generated.b64_json}`, source: "ai" });
    if (generated?.url) return NextResponse.json({ image: generated.url, source: "ai" });
    throw new Error("Image generation returned no image");
  } catch {
    return NextResponse.json({ image: fallbackImage, source: "fallback", message: "The generator is unavailable right now. The demo preview is ready; try again when your image key is connected." });
  }
}
