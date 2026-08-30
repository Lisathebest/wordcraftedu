import type { Recipe, VocabularyWord } from "@/types/game";
import fullCatalog from "../../data/vocabulary.json";

/** The complete normalized source catalog (54 records). The MVP uses the curated subset below. */
export const fullVocabulary = fullCatalog as VocabularyWord[];

const word = (
  number: number,
  level: VocabularyWord["level"],
  id: string,
  chinese: string,
  collocations: [string, string, string],
  pronunciation: string,
  fallbackStructure: string,
): VocabularyWord => ({
  id, number, level, word: id, chinese, collocations,
  image: `/vocab/${id}.png`, pronunciation, fallbackStructure,
});

export const curatedVocabulary: VocabularyWord[] = [
  word(11, "L1", "cafeteria", "自助食堂", ["campus cafeteria", "cafeteria food", "grab a bite at the cafeteria"], "/ˌkæfəˈtɪəriə/", "Cafeteria"),
  word(12, "L1", "textbook", "教科书", ["required textbook", "digital textbook", "review the textbook"], "/ˈtekstbʊk/", "Book Nook"),
  word(13, "L1", "assignment", "作业", ["homework assignment", "submit an assignment", "assignment due date"], "/əˈsaɪnmənt/", "Homework Desk"),
  word(15, "L1", "lecture", "讲座；课", ["attend a lecture", "lecture hall", "take notes during the lecture"], "/ˈlektʃər/", "Lecture Lawn"),
  word(26, "L2", "auditorium", "礼堂", ["campus auditorium", "gather in the auditorium", "main auditorium"], "/ˌɔːdɪˈtɔːriəm/", "Auditorium"),
  word(28, "L2", "tuition", "学费", ["pay tuition fees", "college tuition", "tuition increase"], "/tjuˈɪʃən/", "Tuition Office"),
  word(29, "L2", "scholarship", "奖学金", ["apply for a scholarship", "full scholarship", "win a scholarship"], "/ˈskɒlərʃɪp/", "Scholarship Garden"),
  word(33, "L2", "beverage", "饮料", ["hot or cold beverage", "beverage option", "complimentary beverage"], "/ˈbevərɪdʒ/", "Drink Cart"),
  word(45, "L3", "pastry", "糕点", ["fresh pastry", "pastry shop", "French pastry"], "/ˈpeɪstri/", "Bakery Stall"),
  word(44, "L3", "observatory", "天文台", ["astronomical observatory", "visit an observatory", "observatory deck"], "/əbˈzɜːrvətɔːri/", "Observatory"),
  word(52, "L3", "pharmacy", "药房", ["campus pharmacy", "local pharmacy", "pharmacy prescription"], "/ˈfɑːrməsi/", "Pharmacy"),
  word(54, "L3", "kiosk", "小亭；服务台", ["information kiosk", "news kiosk", "interactive kiosk"], "/ˈkiːɒsk/", "Kiosk"),
];

/** All supplied words are playable; teachers narrow this catalog during lesson setup. */
export const vocabulary: VocabularyWord[] = fullVocabulary;

export const vocabularyById = Object.fromEntries(vocabulary.map((item) => [item.id, item]));

/** Add teacher-created words to the in-memory catalog so the existing game loop can use them. */
export function registerVocabularyWords(words: VocabularyWord[]) {
  for (const item of words) {
    const existingIndex = vocabulary.findIndex((candidate) => candidate.id === item.id);
    if (existingIndex >= 0) vocabulary[existingIndex] = item;
    else vocabulary.push(item);
    vocabularyById[item.id] = item;
  }
}

export const recipes: Recipe[] = [
  { id: "lecture-auditorium", ingredients: ["lecture", "auditorium"], result: "Lecture Hall", reward: 4, discoveryText: "Ideas need a place to gather.", unlockTier: 1, buildingImage: "/buildings/lecture-hall.png", abilityFloor: 2 },
  { id: "textbook-assignment", ingredients: ["textbook", "assignment"], result: "Study Center", reward: 4, discoveryText: "Books and practice create a study hub.", unlockTier: 1, buildingImage: "/buildings/study-center.png" },
  { id: "cafeteria-beverage", ingredients: ["cafeteria", "beverage"], result: "Dining Hall", reward: 4, discoveryText: "The campus has a new place to refuel.", unlockTier: 1, buildingImage: "/buildings/dining-hall.png", ability: "social", abilityFloor: 1 },
  { id: "tuition-scholarship", ingredients: ["tuition", "scholarship"], result: "Financial Aid Office", reward: 5, discoveryText: "Support opens the door to education.", unlockTier: 2, buildingImage: "/buildings/financial-aid-office.png" },
  { id: "pastry-beverage", ingredients: ["pastry", "beverage"], result: "Campus Café", reward: 5, discoveryText: "A perfect study-break pairing.", unlockTier: 2, buildingImage: "/buildings/campus-cafe.png" },
  { id: "pharmacy-kiosk", ingredients: ["pharmacy", "kiosk"], result: "Wellness Kiosk", reward: 5, discoveryText: "Quick help is now around the corner.", unlockTier: 2, buildingImage: "/buildings/wellness-kiosk.png", ability: "shield", abilityFloor: 2 },
  { id: "observatory-lecture", ingredients: ["observatory", "lecture"], result: "Astronomy Center", reward: 5, discoveryText: "Curiosity reaches beyond the classroom.", unlockTier: 3, buildingImage: "/buildings/astronomy-center.png", ability: "preview", abilityFloor: 3 },
];

/** A tier opens only after every recipe in the previous tier has been built. */
export function unlockedRecipeTier(discoveredRecipeIds: readonly string[]): 1 | 2 | 3 {
  const discovered = new Set(discoveredRecipeIds);
  const complete = (tier: number) => recipes.filter((recipe) => recipe.unlockTier <= tier).every((recipe) => discovered.has(recipe.id));
  if (complete(2)) return 3;
  if (complete(1)) return 2;
  return 1;
}

export const abilityForWord: Partial<Record<string, Recipe["ability"]>> = {
  observatory: "preview", pharmacy: "shield", kiosk: "exchange",
};

export const abilityFloorForWord: Partial<Record<string, number>> = {
  observatory: 3, pharmacy: 2, kiosk: 2,
};

/** Building art used for one-word fallback structures and migration of old matches. */
export const buildingImageForWord: Partial<Record<string, string>> = {
  cafeteria: "/buildings/dining-hall.png",
  beverage: "/buildings/campus-cafe.png",
  pastry: "/buildings/campus-cafe.png",
  textbook: "/buildings/study-center.png",
  assignment: "/buildings/study-center.png",
  lecture: "/buildings/lecture-hall.png",
  auditorium: "/buildings/lecture-hall.png",
  tuition: "/buildings/financial-aid-office.png",
  scholarship: "/buildings/financial-aid-office.png",
  pharmacy: "/buildings/wellness-kiosk.png",
  kiosk: "/buildings/wellness-kiosk.png",
  observatory: "/buildings/astronomy-center.png",
};

export const abilityCopy = {
  preview: { title: "Future Sight", description: "Preview the next word in the draw pile." },
  shield: { title: "Second Chance", description: "Cancel the penalty from your next invalid attempt." },
  exchange: { title: "Word Swap", description: "Exchange one word with another builder." },
  social: { title: "Word Feast", description: "Share a familiar word with another builder for a small learning boost." },
} as const;
