import { describe, expect, it } from "vitest";
import { chineseVocabulary } from "@/data/chinese-vocabulary";
import { buildFallbackScaffold, detectChineseTense, verbForTense } from "@/lib/chinese-scaffold";

describe("Chinese learning data", () => {
  it("contains the planned number of minimal vocabulary records", () => {
    expect(chineseVocabulary.filter((word) => word.level === 1)).toHaveLength(45);
    expect(chineseVocabulary.filter((word) => word.level === 2)).toHaveLength(30);
    expect(chineseVocabulary.filter((word) => word.level === 3)).toHaveLength(30);
    expect(Object.keys(chineseVocabulary[0]).sort()).toEqual(["chinese", "id", "image", "level", "verbs", "word"]);
  });

  it("detects the three supported tense cues", () => {
    expect(detectChineseTense("我昨天看了一本书")).toBe("past");
    expect(detectChineseTense("我正在看书")).toBe("progressive");
    expect(detectChineseTense("我每天看书")).toBe("present");
    expect(verbForTense("take", "past")).toBe("took");
    expect(verbForTense("use", "progressive")).toBe("using");
  });

  it("only returns chunks for beginner mode", () => {
    const beginner = buildFallbackScaffold("我昨天看了一本书", ["zh-book"], "beginner");
    const independent = buildFallbackScaffold("我每天看书", ["zh-book"], "independent");
    expect(beginner).toMatchObject({ structureId: "past", recommendedVerbForm: "read" });
    expect(beginner.chunks?.join(" ")).toContain("book");
    expect(independent.chunks).toBeUndefined();
  });

  it("keeps all four selected words in the beginner scaffold", () => {
    const scaffold = buildFallbackScaffold("我每天使用书包、铅笔、钢笔和尺子", ["zh-schoolbag", "zh-pencil", "zh-pen", "zh-ruler"], "beginner");
    const sentence = scaffold.chunks?.join(" ").toLowerCase() || "";
    expect(sentence).toContain("schoolbag");
    expect(sentence).toContain("pencil");
    expect(sentence).toContain("pen");
    expect(sentence).toContain("ruler");
  });

  it("turns simple Chinese details into useful fallback words", () => {
    const scaffold = buildFallbackScaffold("我每天和朋友在公园看书", ["zh-book"], "independent");
    expect(scaffold.importantWords).toEqual(expect.arrayContaining([
      { word: "friend", chinese: "朋友" },
      { word: "park", chinese: "公园" },
      { word: "every day", chinese: "每天" },
    ]));
  });

  it("keeps necessary relationship words in the draggable sentence", () => {
    const scaffold = buildFallbackScaffold("打开门后看到这朵花别在鸭子头上真好看", ["zh-door", "zh-flower", "zh-duck"], "beginner");
    const sentence = scaffold.chunks?.join(" ").toLowerCase() || "";
    expect(sentence).toContain("after");
    expect(sentence).toContain("pretty");
    expect(sentence).toContain("duck's");
    expect(sentence).toContain("head");
  });
});
