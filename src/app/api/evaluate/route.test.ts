import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const evaluationRequest = {
  sentence: "I drank a beverage in the cafeteria.",
  inputMethod: "text",
  targetWords: ["beverage", "cafeteria"],
  gradeBand: "7-9",
};

function request() {
  return new Request("http://localhost/api/evaluate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(evaluationRequest),
  });
}

function providerResponse(content: string, finishReason: string) {
  return new Response(JSON.stringify({
    choices: [{ finish_reason: finishReason, message: { content } }],
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("semantic evaluation route", () => {
  beforeEach(() => {
    vi.stubEnv("AGNES_API_KEY", "test-key");
    vi.stubEnv("AGNES_BASE_URL", "https://example.test/v1");
    vi.stubEnv("AGNES_TEXT_MODEL", "agnes-test");
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses a completion budget large enough for reasoning plus the JSON answer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(providerResponse(JSON.stringify({
      valid: true,
      confidence: 0.94,
      reason: "The sentence is clear and natural.",
      correctedSentence: evaluationRequest.sentence,
      relationshipSummary: "The beverage is consumed in the cafeteria.",
    }), "stop"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request());
    const result = await response.json();
    const providerRequest = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    const systemPrompt = providerRequest.messages[0].content as string;

    expect(providerRequest.max_tokens).toBe(800);
    expect(systemPrompt).toContain("primary-school learner");
    expect(systemPrompt).toContain("Never use technical language");
    expect(systemPrompt).toContain("under 15 words each");
    expect(systemPrompt).toContain("valid must be true only when");
    expect(systemPrompt).toContain("subject-verb agreement");
    expect(JSON.parse(providerRequest.messages[1].content).task).toBe("Check the English sentence strictly and verify every target word is used meaningfully.");
    expect(result).toMatchObject({ valid: true, confidence: 0.94, source: "ai", provisional: false });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("retries with a larger budget when Agnes reports a truncated completion", async () => {
    const truncated = "{\"valid\":true,\"confidence\":0.9,\"reason\":\"Clear\",\"correctedSentence\":\"I drank a beverage in the cafeteria.\",\"relationshipSummary\":\"The beverage";
    const complete = JSON.stringify({
      valid: true,
      confidence: 0.9,
      reason: "The sentence is clear.",
      correctedSentence: evaluationRequest.sentence,
      relationshipSummary: "The beverage is consumed in the cafeteria.",
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(providerResponse(truncated, "length"))
      .mockResolvedValueOnce(providerResponse(complete, "stop"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request());
    const result = await response.json();
    const firstProviderRequest = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    const secondProviderRequest = JSON.parse(fetchMock.mock.calls[1][1]?.body as string);

    expect(firstProviderRequest.max_tokens).toBe(800);
    expect(secondProviderRequest.max_tokens).toBe(1600);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ valid: true, confidence: 0.9, source: "ai", provisional: false });
  });

  it("retries when a completed Agnes response is not valid JSON", async () => {
    const complete = JSON.stringify({
      valid: true,
      confidence: 0.91,
      reason: "The sentence is correct.",
      correctedSentence: evaluationRequest.sentence,
      relationshipSummary: "The beverage is consumed in the cafeteria.",
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(providerResponse("I will check the sentence now.", "stop"))
      .mockResolvedValueOnce(providerResponse(complete, "stop"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request());
    const result = await response.json();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ valid: true, confidence: 0.91, source: "ai", provisional: false });
  });

  it("rejects a sentence whenever Agnes supplies a meaningful correction", async () => {
    const fetchMock = vi.fn().mockResolvedValue(providerResponse(JSON.stringify({
      valid: true,
      confidence: 0.92,
      reason: "Change go to goes.",
      correctedSentence: "She goes to school every day.",
      relationshipSummary: "School names the place she attends.",
    }), "stop"));
    vi.stubGlobal("fetch", fetchMock);
    const grammarRequest = new Request("http://localhost/api/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...evaluationRequest, sentence: "She go to school every day.", targetWords: ["school"] }),
    });

    const response = await POST(grammarRequest);
    const result = await response.json();

    expect(result).toMatchObject({ valid: false, correctedSentence: "She goes to school every day.", source: "ai" });
  });

  it("can parse valid JSON from a secondary Agnes response field", async () => {
    const answer = JSON.stringify({
      valid: true,
      confidence: 0.9,
      reason: "The sentence is correct.",
      correctedSentence: evaluationRequest.sentence,
      relationshipSummary: "The beverage is consumed in the cafeteria.",
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: "not json", reasoning_content: answer } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request());
    const result = await response.json();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ valid: true, source: "ai", provisional: false });
  });
});
