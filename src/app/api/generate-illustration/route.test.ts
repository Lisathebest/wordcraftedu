import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const imageRequest = {
  word: "compass",
  translation: "direction finder",
};

function request() {
  return new Request("http://localhost/api/generate-illustration", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(imageRequest),
  });
}

function imageResponse(url: string, status = 200) {
  return new Response(JSON.stringify({ data: [{ url, b64_json: null }] }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("illustration generation route", () => {
  beforeEach(() => {
    vi.stubEnv("AGNES_API_KEY", "test-key");
    vi.stubEnv("AGNES_BASE_URL", "https://example.test/v1");
    vi.stubEnv("AGNES_IMAGE_MODEL", "agnes-image-2.0-flash");
    vi.stubEnv("AGNES_IMAGE_FALLBACK_MODEL", "agnes-image-2.1-flash");
    vi.stubEnv("AGNES_IMAGE_RESPONSE_FORMAT", "url");
    vi.stubEnv("OPENAI_API_KEY", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses Agnes text-to-image without sending reference pixels", async () => {
    const fetchMock = vi.fn().mockResolvedValue(imageResponse("https://images.example/compass.png"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request());
    const result = await response.json();
    const providerRequest = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);

    expect(providerRequest.model).toBe("agnes-image-2.0-flash");
    expect(providerRequest.extra_body).toEqual({ response_format: "url" });
    expect(providerRequest.extra_body.image).toBeUndefined();
    expect(providerRequest.prompt).toContain("do not add animal anatomy");
    expect(result).toMatchObject({ image: "https://images.example/compass.png", source: "ai", provider: "agnes", model: "agnes-image-2.0-flash" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("tries the compatibility model when the configured Agnes model fails", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("temporarily unavailable", { status: 503 }))
      .mockResolvedValueOnce(imageResponse("https://images.example/compass-2.1.png"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request());
    const result = await response.json();
    const firstRequest = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    const secondRequest = JSON.parse(fetchMock.mock.calls[1][1]?.body as string);

    expect(firstRequest.model).toBe("agnes-image-2.0-flash");
    expect(secondRequest.model).toBe("agnes-image-2.1-flash");
    expect(result).toMatchObject({ source: "ai", provider: "agnes", model: "agnes-image-2.1-flash" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the pending placeholder when every provider fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request());
    const result = await response.json();

    expect(result).toMatchObject({ source: "fallback", image: "/illustration-studio/pending-word.svg" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
