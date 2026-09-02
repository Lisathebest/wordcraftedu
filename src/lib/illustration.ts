export const PENDING_WORD_IMAGE = "/illustration-studio/pending-word.svg";
export const ILLUSTRATION_STYLE_VERSION = 2;

/** True only for an illustration created by the studio, not a vocabulary placeholder. */
export function isGeneratedIllustration(image: string) {
  return image.startsWith("data:image/")
    || image.startsWith("/illustration-studio/") && image !== PENDING_WORD_IMAGE
    || /^https?:\/\//i.test(image);
}

/** Migrate the old imported-word default so no new word inherits the dumbbell art. */
export function normalizeImportedWordImage(image: unknown) {
  if (typeof image !== "string" || !image.trim() || image === "/vocab/dumbbell.png") return PENDING_WORD_IMAGE;
  return image;
}
