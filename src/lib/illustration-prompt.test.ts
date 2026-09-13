import { describe, expect, it } from "vitest";
import { buildIllustrationPrompt } from "@/lib/illustration-prompt";

describe("illustration prompt", () => {
  it("locks the requested meaning and forbids card furniture and text", () => {
    const prompt = buildIllustrationPrompt("compass", "direction finder");

    expect(prompt).toContain("teacher-provided meaning or translation “direction finder”");
    expect(prompt).toContain("may be written in any language");
    expect(prompt).toContain("zero words, letters, numbers");
    expect(prompt).toContain("no visible card, flashcard, poster, paper sheet");
    expect(prompt).toContain("never replace it with an unrelated animal");
    expect(prompt).not.toContain("Create a single vocabulary flashcard illustration");
  });

  it("requires an unlabelled literal subject when no translation is supplied", () => {
    const prompt = buildIllustrationPrompt("dog", "");

    expect(prompt).toContain("ordinary literal classroom meaning");
    expect(prompt).toContain("No teacher meaning or translation was provided");
    expect(prompt).toContain("identifiable without relying on written text");
    expect(prompt).toContain("occupy about 55 to 70 percent");
    expect(prompt).not.toContain("puppy");
  });
});
