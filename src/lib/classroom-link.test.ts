import { describe, expect, it } from "vitest";
import { compactSharedWords, createClassroomLink, hydrateSharedWords, readClassroomLink } from "@/lib/classroom-link";
import type { VocabularyWord } from "@/types/game";

const word: VocabularyWord = {
  id: "custom-compass", number: 1000, word: "compass", level: "L1", chinese: "指南针",
  collocations: ["a compass", "use a compass", "read a compass"], image: "https://example.com/compass.png",
  pronunciation: "/ˈkʌmpəs/", fallbackStructure: "Compass",
};

describe("classroom links", () => {
  it("round-trips lesson settings, Chinese translations, and remote illustrations", () => {
    const link = createClassroomLink("https://wordcraft.example", { learnerLevel: "developing", wordFocus: "mixed", durationMinutes: 12, customWords: [word] });
    const parsed = readClassroomLink(link);
    expect(parsed).toMatchObject({ learnerLevel: "developing", wordFocus: "mixed", durationMinutes: 12, customWords: [{ id: "custom-compass", word: "compass", chinese: "指南针", image: "https://example.com/compass.png" }] });
    expect(hydrateSharedWords(parsed!.customWords)[0].collocations).toEqual(["compass", "use compass", "learn compass"]);
  });

  it("preserves bundled word IDs in a shared class set", () => {
    const bundledWord = { ...word, id: "cafeteria", word: "cafeteria", image: "/vocab/cafeteria.png" };
    const link = createClassroomLink("https://wordcraft.example", { learnerLevel: "starter", wordFocus: "everyday", durationMinutes: 8, customWords: [bundledWord] });
    expect(readClassroomLink(link)?.customWords[0]).toMatchObject({ id: "cafeteria", image: "/vocab/cafeteria.png" });
  });

  it("drops data URIs and rejects malformed or tampered payloads", () => {
    expect(compactSharedWords([{ ...word, image: "data:image/png;base64,secret" }])[0].image).toBe("");
    expect(readClassroomLink("https://wordcraft.example/?classroom=not-json")).toBeNull();
    expect(readClassroomLink("https://wordcraft.example/?classroom=e30")).toBeNull();
  });
});
