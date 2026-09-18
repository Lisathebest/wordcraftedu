const ILLUSTRATION_STYLE_PROMPT = [
  "Use case: stylized-concept.",
  "Asset type: one standalone square vocabulary illustration for use inside an app.",
  "Scene/backdrop: a single uninterrupted warm-ivory background covering the entire canvas, with only a faint natural paper grain.",
  "Subject: exactly one immediately recognizable subject that literally matches the requested vocabulary meaning. Show the requested object, animal, person, place, or action itself; never replace it with an unrelated animal, mascot, or character.",
  "For an inanimate object, draw the object itself and do not add animal anatomy, fur, ears, whiskers, paws, a tail, or a separate animal. For an abstract or adjective word, use one simple human pose or action that clearly expresses the meaning.",
  "Style/medium: the fixed Wordcraft house style is a cute hand-drawn crayon-and-marker doodle, like a children's sticker illustration. Use a thick, slightly uneven black or charcoal ink contour, simple cheerful flat color fills, visible rough crayon texture, very little shading, two solid black bean-shaped dot eyes on the subject when a face is appropriate, a tiny curved mouth, and two small soft pink blush dots. Keep the drawing charmingly simple and graphic.",
  "Composition/framing: center the single subject, show it completely, and let it occupy about 55 to 70 percent of the square canvas with even breathing room and no other visual elements.",
  "Text: none. The final bitmap must contain zero words, letters, numbers, symbols, captions, labels, handwriting, signs, logos, signatures, or watermarks. Never print the vocabulary word or its translation.",
  "Constraints: no visible card, flashcard, poster, paper sheet, inset rectangle, border, frame, outline around the canvas, drop shadow, pedestal, badge, sticker, speech bubble, or decorative layout. The background must run cleanly to all four edges.",
  "Avoid: extra characters, unrelated props, busy scenery, photorealistic people, realistic anatomy, soft realistic painted portraits, cinematic lighting, 3D rendering, glossy cartoon rendering, and copied reference-image content. Do not make a realistic child or a realistic product illustration.",
].join(" ");

export function buildIllustrationPrompt(word: string, translation: string) {
  const exactMeaning = translation
    ? `Exact subject meaning: the English vocabulary word “${word}”, using the teacher-provided meaning or translation “${translation}”. The gloss may be written in any language; use it only as semantic guidance and never reproduce it as text. Depict that exact meaning.`
    : `Exact subject meaning: the ordinary literal classroom meaning of the English word “${word}”. No teacher meaning or translation was provided, so rely on the English word itself. The subject must be identifiable without relying on written text.`;

  return [
    ILLUSTRATION_STYLE_PROMPT,
    exactMeaning,
    "Semantic lock: the requested subject must be the main drawing while preserving this exact bean-eyed doodle style. Never use a cute animal or mascot as a substitute for an object or concept.",
  ].join(" ");
}
