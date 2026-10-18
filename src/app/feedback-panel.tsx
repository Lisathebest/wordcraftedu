"use client";

import { useState } from "react";
import styles from "./feedback-panel.module.css";

export function FeedbackPanel({ language }: { language: "en" | "zh" }) {
  const [hasOpened, setHasOpened] = useState(false);
  const isChinese = language === "zh";

  return <details className={styles.panel} onToggle={(event) => {
    if (event.currentTarget.open) setHasOpened(true);
  }}>
    <summary className={styles.summary}>
      <span className={styles.mark} aria-hidden="true">✎</span>
      <span className={styles.heading}>
        <span>{isChinese ? "帮我们扩充词库" : "VOCABULARY IDEAS"}</span>
        <strong>{isChinese ? "想学什么词？" : "Give us your feedback~"}</strong>
        <small>{isChinese ? "告诉我们你想要的词书、主题词表或单词 list" : "What word lists, themes, or vocabulary would you like to practice?"}</small>
      </span>
      <span className={styles.toggle} aria-hidden="true" />
    </summary>
    {hasOpened && <div className={styles.content}>
      <div className={styles.frame}>
        <iframe
          title={isChinese ? "词书和词表需求反馈表" : "Vocabulary list and word book feedback form"}
          src="https://wj.qq.com/s2/28250962/kne5/"
          width="100%"
          height="100%"
          loading="lazy"
          allowFullScreen
          sandbox="allow-same-origin allow-scripts allow-modals allow-downloads allow-forms allow-popups"
        />
      </div>
    </div>}
  </details>;
}
