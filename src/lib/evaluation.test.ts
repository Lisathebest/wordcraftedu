import { describe, expect, it } from "vitest";
import { evaluateFast } from "@/lib/evaluation";

const baseRequest = {
  inputMethod: "text" as const,
  targetWords: ["beverage"],
  gradeBand: "7-9" as const,
};

describe("fast sentence evaluation", () => {
  it("accepts a structured sentence locally without a provisional result", () => {
    expect(evaluateFast({ ...baseRequest, sentence: "I drink a cold beverage." })).toMatchObject({
      valid: true,
      source: "rules",
      provisional: false,
    });
  });

  it("still rejects missing target words and obvious fragments", () => {
    expect(evaluateFast({ ...baseRequest, sentence: "I drink water." })).toMatchObject({ valid: false, source: "rules" });
    expect(evaluateFast({ ...baseRequest, sentence: "cold beverage" })).toMatchObject({ valid: false, source: "rules" });
  });
});
