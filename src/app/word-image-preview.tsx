"use client";

import { useState } from "react";
import styles from "./word-image-preview.module.css";

export type WordImagePreviewItem = {
  word: string;
  chinese: string;
  image: string;
};

export function WordImagePreview({
  item,
  language,
  onClose,
}: {
  item: WordImagePreviewItem;
  language: "en" | "zh";
  onClose: () => void;
}) {
  const [zoomed, setZoomed] = useState(false);
  const titleId = `word-image-title-${item.word.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
  const closeLabel = language === "zh" ? "关闭插画" : "Close illustration";
  const zoomLabel = language === "zh"
    ? zoomed ? "还原插画大小" : "放大插画"
    : zoomed ? "Reset illustration size" : "Enlarge illustration";

  return <div className={styles.backdrop} role="presentation" onClick={onClose}>
    <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
      <button className={styles.close} type="button" aria-label={closeLabel} autoFocus onClick={onClose}>×</button>
      <div className={styles.imageStage}>
        <button className={`${styles.zoomableImage} ${zoomed ? styles.zoomed : ""}`} type="button" aria-label={zoomLabel} aria-pressed={zoomed} onClick={() => setZoomed((current) => !current)}>
          <img src={item.image} alt={language === "zh" ? `${item.word} 插画` : `${item.word} illustration`} />
        </button>
      </div>
      <small className={styles.zoomHint}>{language === "zh" ? "停留或点击图片可放大 · 再点还原" : "Hover or tap to enlarge · tap again to reset"}</small>
      <h2 id={titleId}>{item.word}</h2>
      <p>{item.chinese}</p>
    </section>
  </div>;
}
