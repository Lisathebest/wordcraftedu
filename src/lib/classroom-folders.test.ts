import { describe, expect, it } from "vitest";
import { makeClassFolder, normalizeClassFolders, parseClassFolderExport, removeClassFolder, serializeClassFolder, serializeClassFolderCsv } from "@/lib/classroom-folders";
import type { VocabularyWord } from "@/types/game";

const compass: VocabularyWord = {
  id: "custom-compass", number: 1000, word: "compass", level: "L1", chinese: "指南针",
  collocations: ["a compass", "use a compass", "read a compass"], image: "/illustration-studio/pending-word.svg",
  pronunciation: "/ˈkʌmpəs/", fallbackStructure: "Compass",
};

describe("class folders", () => {
  it("creates and round-trips a named word set", () => {
    const folder = makeClassFolder("Grade 7 · Monday", [compass], 1700000000000);
    expect(folder).not.toBeNull();
    const parsed = parseClassFolderExport(serializeClassFolder(folder!), 1700000001000, [folder!.id]);
    expect(parsed).toMatchObject({ name: "Grade 7 · Monday", words: [{ id: "custom-compass", word: "compass", chinese: "指南针" }] });
    expect(parsed!.id).not.toBe(folder!.id);
  });

  it("keeps folder IDs unique and escapes CSV cells", () => {
    const first = makeClassFolder("Grade 7", [compass], 1);
    const second = makeClassFolder("Grade 7", [compass], 2, [first!.id]);
    expect(second!.id).toBe("class-grade-7-2");
    expect(serializeClassFolderCsv({ ...first!, words: [{ ...compass, chinese: "指南针, tool" }] })).toContain('"指南针, tool"');
    expect(normalizeClassFolders([{ id: "broken", name: "", words: [] }, first])).toHaveLength(1);
  });

  it("deletes only the chosen folder", () => {
    const first = makeClassFolder("Grade 7", [compass], 1)!;
    const second = makeClassFolder("Grade 8", [compass], 2, [first.id])!;
    expect(removeClassFolder([first, second], first.id)).toEqual([second]);
  });
});
