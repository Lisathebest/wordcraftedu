import { describe, expect, it } from "vitest";
import { buildingImageForWord, fullVocabulary, recipes, unlockedRecipeTier } from "@/data/content";
import { evaluateRules, evaluationCacheKey } from "@/lib/evaluation";
import { applyEvaluation, coreWord, createMatch, recipeFor, tick, useAbility } from "@/lib/game-engine";
import type { EvaluationResult } from "@/types/game";

const valid: EvaluationResult = { valid: true, confidence: 1, reason: "Good.", correctedSentence: "", relationshipSummary: "Connected.", source: "rules-fallback", provisional: true };
const invalid: EvaluationResult = { ...valid, valid: false, reason: "Try again." };

describe("evaluation rules", () => {
  it("accepts inflected target words in a complete sentence", () => {
    expect(evaluateRules({ sentence: "We attended two lectures in the auditorium.", inputMethod: "text", targetWords: ["lecture", "auditorium"], gradeBand: "7-9" })).toBeNull();
    expect(evaluateRules({ sentence: "The scholarship reduces my pressure when buying a new textbook.", inputMethod: "text", targetWords: ["textbook", "scholarship"], gradeBand: "7-9" })).toBeNull();
  });
  it("rejects missing words and fragments instantly", () => {
    expect(evaluateRules({ sentence: "A pastry.", inputMethod: "text", targetWords: ["pastry", "beverage"], gradeBand: "5-6" })?.valid).toBe(false);
    expect(evaluateRules({ sentence: "cafeteria beverage", inputMethod: "text", targetWords: ["cafeteria", "beverage"], gradeBand: "5-6" })?.valid).toBe(false);
  });
  it("creates a stable cache key independent of ingredient order", () => {
    expect(evaluationCacheKey({ sentence: "I drank a beverage at the cafeteria.", inputMethod: "text", targetWords: ["beverage", "cafeteria"], gradeBand: "5-6" })).toBe(evaluationCacheKey({ sentence: "I drank a beverage at the cafeteria.", inputMethod: "text", targetWords: ["cafeteria", "beverage"], gradeBand: "5-6" }));
  });
});

describe("crafting engine", () => {
  it("keeps the normalized source catalog available alongside MVP content", () => {
    expect(fullVocabulary).toHaveLength(54);
    expect(fullVocabulary.every((item) => item.level && item.chinese && item.collocations.length === 3 && item.image && item.fallbackStructure)).toBe(true);
  });
  it("treats recipe ingredients as unordered", () => {
    expect(recipeFor(["auditorium", "lecture"])?.id).toBe("lecture-auditorium");
    expect(recipeFor(["textbook", "assignment", "lecture"])?.id).toBe("textbook-assignment");
    expect(recipes.length).toBeGreaterThanOrEqual(7);
    expect(recipes.find((recipe) => recipe.result === "Dining Hall")?.buildingImage).toBe("/buildings/dining-hall.png");
    expect(recipes.find((recipe) => recipe.result === "Dining Hall")?.ability).toBe("social");
    expect(Object.values(buildingImageForWord)).toHaveLength(12);
    expect(unlockedRecipeTier([])).toBe(1);
    expect(unlockedRecipeTier(recipes.filter((recipe) => recipe.unlockTier === 1).map((recipe) => recipe.id))).toBe(2);
    expect(unlockedRecipeTier(recipes.filter((recipe) => recipe.unlockTier <= 2).map((recipe) => recipe.id))).toBe(3);
  });
  it("awards a borrowed-word familiarity bonus to both players", () => {
    let state = createMatch("local", ["A", "B"], 4);
    const a = state.players[0];
    const b = state.players[1];
    a.hand = ["pastry", "lecture"]; b.hand = ["beverage", "textbook"];
    state.wordOwnership = { pastry: a.id, lecture: a.id, beverage: b.id, textbook: b.id };
    state = applyEvaluation(state, "I bought a pastry and a beverage.", ["pastry", "beverage"], valid);
    expect(state.players[0].familiarity.pastry).toBe(2);
    expect(state.players[0].familiarity.beverage).toBe(1);
    expect(state.players[1].familiarity.beverage).toBe(1);
  });
  it("consumes every selected word and rewards a larger sentence", () => {
    let state = createMatch("solo", ["A"], 4);
    const player = state.players[0];
    player.hand = ["textbook", "assignment", "lecture", "auditorium"];
    state.wordOwnership = Object.fromEntries(player.hand.map((id) => [id, player.id]));
    state.drawPile = state.drawPile.filter((id) => !player.hand.includes(id));
    state = applyEvaluation(state, "I completed my assignment in the textbook study space before the lecture in the auditorium.", player.hand, valid);
    expect(state.players[0].score).toBe(7); // recipe 4 + three extra ingredients
    expect(state.players[0].hand.some((id) => ["textbook", "assignment", "lecture", "auditorium"].includes(id))).toBe(false);
  });
  it("upgrades a repeated structure and resolves core-word ties by recency", () => {
    let state = createMatch("solo", ["A"], 2);
    state.players[0].hand = ["lecture", "auditorium"];
    state.wordOwnership = { lecture: state.players[0].id, auditorium: state.players[0].id };
    state = applyEvaluation(state, "I attended a lecture in the auditorium.", ["lecture", "auditorium"], valid);
    state.players[0].hand = ["lecture", "auditorium"];
    state = applyEvaluation(state, "The lecture hall hosted a lecture and an auditorium tour.", ["lecture", "auditorium"], valid);
    expect(state.players[0].structures[0].level).toBe(2);
    expect(coreWord(state.players[0])).toBe("auditorium");
  });
  it("lets a shield absorb one invalid penalty and ends at zero", () => {
    let state = createMatch("solo", ["A"], 3);
    const player = state.players[0]; player.hand = ["pharmacy"]; state.wordOwnership = { pharmacy: player.id }; player.structures.push({ id: "shield", name: "Pharmacy", sourceWords: ["pharmacy"], level: 1, ability: "shield", builtAt: Date.now() });
    state = useAbility(state, player.id, "shield");
    const before = player.score;
    state = applyEvaluation(state, "pharmacy", ["pharmacy"], invalid);
    expect(state.players[0].score).toBe(before);
    expect(state.players[0].shieldActive).toBe(false);
    state.pronunciationPenalty = true;
    state = applyEvaluation(state, "The pharmacy is open.", ["pharmacy"], valid);
    expect(state.pronunciationPenalty).toBe(false);
    expect(tick({ ...state, status: "playing", remainingSeconds: 1 }, 2).status).toBe("finished");
  });
  it("lets Dining Hall share familiarity with a chosen local player", () => {
    let state = createMatch("local", ["A", "B"], 5);
    const [a, b] = state.players;
    a.hand = ["cafeteria"]; b.hand = ["beverage"];
    state.wordOwnership = { cafeteria: a.id, beverage: b.id };
    a.structures.push({ id: "dining", name: "Dining Hall", sourceWords: ["cafeteria", "beverage"], level: 1, ability: "social", abilityFloor: 2, image: "/vocab/cafeteria.png", builtAt: Date.now() });
    state = useAbility(state, a.id, "social", b.id);
    expect(state.players[0].score).toBe(1);
    expect(state.players[1].familiarity.beverage).toBe(1);
    expect(state.lastInteraction).toContain("A");
    expect(state.players[0].usedAbilities).toContain("social");
  });
  it("can exchange a word with another local player", () => {
    let state = createMatch("local", ["A", "B"], 6);
    const [a, b] = state.players;
    a.hand = ["cafeteria"]; b.hand = ["beverage"];
    state.wordOwnership = { cafeteria: a.id, beverage: b.id };
    a.structures.push({ id: "kiosk", name: "Kiosk", sourceWords: ["kiosk"], level: 1, ability: "exchange", abilityFloor: 2, image: "/vocab/kiosk.png", builtAt: Date.now() });
    state = useAbility(state, a.id, "exchange", b.id);
    expect(state.players[0].hand).toEqual(["beverage"]);
    expect(state.players[1].hand).toEqual(["cafeteria"]);
    expect(state.wordOwnership).toEqual({ cafeteria: b.id, beverage: a.id });
  });
});
