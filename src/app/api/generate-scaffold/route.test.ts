import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/generate-scaffold", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

describe("Chinese scaffold route", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("returns a deterministic beginner fallback without a provider", async () => {
    vi.stubEnv("AGNES_API_KEY", "");
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    const response = await POST(request({ chineseSentence: "我昨天看了一本书", targetWordIds: ["zh-book"], mode: "beginner" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ source: "fallback", structureId: "past", recommendedVerbForm: "read" });
  });

  it("never returns answer chunks in independent mode", async () => {
    vi.stubEnv("AGNES_API_KEY", "key");
    vi.stubEnv("AGNES_BASE_URL", "https://example.test/v1");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ verbs: ["read", "open"], recommendedVerbForm: "read", tenseHint: "使用一般现在时。", structureId: "present", conjunctions: ["and"], importantWords: [{ word: "friend", chinese: "朋友" }], chunks: ["I", "read", "the", "book."] }) } }] }), { status: 200 })));
    const response = await POST(request({ chineseSentence: "我每天看书", targetWordIds: ["zh-book"], mode: "independent" }));
    const result = await response.json();
    expect(result.source).toBe("ai");
    expect(result.chunks).toBeUndefined();
    expect(result.importantWords).toEqual([{ word: "friend", chinese: "朋友" }]);
  });

  it("accepts up to four target words", async () => {
    vi.stubEnv("AGNES_API_KEY", "");
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    const response = await POST(request({
      chineseSentence: "我每天使用书包、铅笔、钢笔和尺子",
      targetWordIds: ["zh-schoolbag", "zh-pencil", "zh-pen", "zh-ruler"],
      mode: "beginner",
    }));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.chunks.join(" ")).toEqual(expect.stringContaining("schoolbag"));
    expect(result.chunks.join(" ")).toEqual(expect.stringContaining("pencil"));
    expect(result.chunks.join(" ")).toEqual(expect.stringContaining("pen"));
    expect(result.chunks.join(" ")).toEqual(expect.stringContaining("ruler"));
  });

  it("rejects more than four target words", async () => {
    const response = await POST(request({
      chineseSentence: "我每天学习这些词",
      targetWordIds: ["zh-book", "zh-pencil", "zh-pen", "zh-ruler", "zh-eraser"],
      mode: "beginner",
    }));
    expect(response.status).toBe(400);
  });
});
