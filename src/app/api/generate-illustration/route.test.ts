import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

function request() {
  return new Request("http://localhost/api/generate-illustration", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ word: "compass", translation: "direction finder" }),
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("illustration generation route", () => {
  it("uses the configured key with gpt-image-2 at the supplied image endpoint", async () => {
    vi.stubEnv("SWY_IMAGE_API_KEY", "test-key");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: "aGVsbG8=" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request());
    const result = await response.json();
    const [url, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body);

    expect(url).toBe("https://aiapi.swy168.com/v1/images/generations");
    expect(options.headers.Authorization).toBe("Bearer test-key");
    expect(body).toMatchObject({ model: "gpt-image-2", size: "1024x1024" });
    expect(body.prompt).toContain("do not add animal anatomy");
    expect(result).toMatchObject({ image: "data:image/png;base64,aGVsbG8=", source: "ai", provider: "swy", model: "gpt-image-2" });
  });

  it("keeps the pending placeholder if the provider fails", async () => {
    vi.stubEnv("SWY_IMAGE_API_KEY", "test-key");
    const fetchMock = vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(request());
    const result = await response.json();
    expect(response.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ source: "fallback", image: "/illustration-studio/pending-word.svg" });
    expect(result.message).toContain("HTTP 503");
  });

  it("does not retry a rejected key and surfaces the provider message", async () => {
    vi.stubEnv("SWY_IMAGE_API_KEY", "stale-key");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "invalid api key" } }), { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request());
    const result = await response.json();

    expect(response.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ source: "fallback", image: "/illustration-studio/pending-word.svg" });
    expect(result.message).toContain("HTTP 401");
    expect(result.message).toContain("invalid api key");
  });

  it("does not call a paid image endpoint when no key is configured", async () => {
    vi.stubEnv("SWY_IMAGE_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request());
    const result = await response.json();

    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.source).toBe("demo");
  });
});
