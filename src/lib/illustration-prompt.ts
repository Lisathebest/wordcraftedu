const ILLUSTRATION_STYLE_PROMPT = [
  "Use case: stylized-concept.",
  "Asset type: one standalone square vocabulary illustration for use inside an app.",
  "Scene/backdrop: a single uninterrupted warm-ivory background covering the entire canvas, with only a faint natural paper grain.",
  "Subject: exactly one immediately recognizable subject that literally matches the requested vocabulary meaning. Show the requested object, animal, person, place, or action itself; never replace it with an unrelated animal, mascot, or character.",
  "Style/medium: a gentle children's colored-pencil drawing with sparse graphite outlines, visible hand-drawn pencil texture, restrained pastel shading, tiny bean-shaped dot eyes when a face is appropriate, and small soft blush marks.",
  "Composition/framing: center the single subject, show it completely, and let it occupy about 55 to 70 percent of the square canvas with even breathing room and no other visual elements.",
  "Text: none. The final bitmap must contain zero words, letters, numbers, symbols, captions, labels, handwriting, signs, logos, signatures, or watermarks. Never print the vocabulary word or its translation.",
  "Constraints: no visible card, flashcard, poster, paper sheet, inset rectangle, border, frame, outline around the canvas, drop shadow, pedestal, badge, sticker, speech bubble, or decorative layout. The background must run cleanly to all four edges.",
  "Avoid: extra characters, unrelated props, busy scenery, photorealism, 3D rendering, glossy cartoon rendering, and copied reference-image content.",
].join(" ");

export function buildIllustrationPrompt(word: string, translation: string) {
  const exactMeaning = translation
    ? `Exact subject meaning: the English word “${word}” in the teacher-provided sense “${translation}”. Depict that exact meaning.`
    : `Exact subject meaning: the ordinary literal classroom meaning of the English word “${word}”. The subject must be identifiable without relying on written text.`;

  return [
    ILLUSTRATION_STYLE_PROMPT,
    exactMeaning,
    "Semantic lock: the requested subject must be the main drawing. Do not use a cute animal or mascot as a substitute for an object or concept.",
  ].join(" ");
}
