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
    expect(prompt).toContain("do not add animal anatomy");
    expect(prompt).toContain("fixed Wordcraft house style");
    expect(prompt).toContain("Face rule: when the subject can show a face, the face is required");
    expect(prompt).toContain("two solid black bean-shaped dot eyes");
    expect(prompt).toContain("simple cheerful flat color fills");
    expect(prompt).toContain("Do not make a realistic child");
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
