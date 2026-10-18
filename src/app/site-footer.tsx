import styles from "./site-footer.module.css";

export function SiteFooter() {
  return <footer className={styles.footer}>
    <a className={styles.wordmark} href="/" aria-label="Wordcraft Classroom home">
      <span className={styles.mark} aria-hidden="true">W</span>
      <span><strong>WORDCRAFT CLASSROOM</strong><small>Words grow into worlds.</small></span>
    </a>
    <nav className={styles.links} aria-label="Contact and other projects">
      <a href="mailto:lisa.feng_28@tsinglan.org">lisa.feng_28@tsinglan.org</a>
      <a href="https://boardgamefilter.vercel.app/" target="_blank" rel="noreferrer">Boardgame Filter <span aria-hidden="true">↗</span></a>
    </nav>
  </footer>;
}
