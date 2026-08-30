# Vocabulary Builder

A local-first vocabulary crafting game for grades 5–9. Combine words in meaningful sentences, discover recipes, and grow a cozy campus world.

## Run locally

1. Install dependencies with `pnpm install`.
2. Run `pnpm dev` and open `http://localhost:8000` (or use the local browser shortcut).

No API key is required. Evaluation continues in clearly marked rules-only mode when the optional semantic evaluator is unavailable. For AI sentence evaluation, set `DEEPSEEK_API_KEY` (or `OPENAI_API_KEY`) in a server-side `.env.local`. The illustration studio uses the OpenAI Images API, so live GPT Image 2 generation requires a separate `OPENAI_API_KEY`; a DeepSeek key cannot authenticate OpenAI image requests. Never put either key in client-side code. Run `pnpm test` for the game-engine suite and `pnpm build` for a production check.

The teacher setup includes a word studio: upload CSV/TXT/JSON or paste one word per line, then generate a friendly pencil-and-dot-eyes illustration. The house style is fixed in the server prompt and uses three supplied reference drawings internally on every generation, so teachers do not need to choose a visual language. Without `OPENAI_API_KEY`, the studio shows the included compass demo so the lesson-planning flow remains testable.

In a match, select any number of words in your current hand (up to four) and use every selected word in one sentence. The campus map shows illustrated buildings, sequential tier-gated formulas, and selectable floors. Tier 2 opens only after every Tier 1 formula is built; built formulas turn green. Ability floors can preview a draw, protect an attempt, swap a word, or share familiarity with another local player. Voice → text uses the browser's speech-recognition API and automatically reconnects when a browser ends an idle session; the transcript is written into the sentence box for editing. If the browser asks for microphone access, allow it for the local site. Some embedded browsers do not expose a microphone, in which case the game explains the limitation and typed input remains available.
