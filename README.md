# Vocabulary Builder

A local-first vocabulary crafting game for grades 5–9. Combine words in meaningful sentences, discover recipes, and grow a cozy campus world.

## Run locally

1. Install dependencies with `pnpm install`.
2. Run `pnpm dev` and open `http://localhost:8000` (or use the local browser shortcut).

Production classroom: https://wordcraft-classroom.pocketbay.app

No API key is required. Evaluation continues in clearly marked rules-only mode when the optional semantic evaluator is unavailable. For AI sentence evaluation and live illustration generation, set `AGNES_API_KEY` in a server-side `.env.local`; Agnes is used first with `agnes-2.0-flash` for text and `agnes-image-2.0-flash` for images. `DEEPSEEK_API_KEY` and `OPENAI_API_KEY` remain optional fallbacks. Never put keys in client-side code. Run `pnpm test` for the game-engine suite and `pnpm build` for a production check.

The teacher setup includes a word studio: upload CSV/TXT/JSON or paste one word per line, then generate a friendly pencil-and-dot-eyes illustration. The house style is fixed in a server-side prompt; reference pixels are not sent to the image model, so their objects and labels cannot bleed into a new word. A neutral pencil placeholder is shown until an image is generated, so one word never inherits another word's artwork.

In a match, select any number of words in your current hand (up to four) and use every selected word in one sentence. The campus map shows illustrated buildings, sequential tier-gated formulas, and selectable floors. Tier 2 opens only after every Tier 1 formula is built; built formulas turn green. Ability floors can preview a draw, protect an attempt, swap a word, or share familiarity with another local player. Voice → text uses the browser's speech-recognition API and automatically reconnects when a browser ends an idle session; the transcript is written into the sentence box for editing. If the browser asks for microphone access, allow it for the local site. Some embedded browsers do not expose a microphone, in which case the game explains the limitation and typed input remains available.

Teachers can click **Get student link** beneath **Start vocabulary round**. The link carries the selected level, optional topic focus, duration, and imported words; students open it directly or choose **Student Table** and paste it. Each student starts an independent table, so no student account or shared login is needed. The setup defaults to three language levels — Starter, Developing, and Stretch — while topic filtering is tucked into **Advanced options** for teachers using the initial Wordcraft word bank.

Teachers can create a folder for each class, choose words from the built-in Wordcraft word bank or **My imported words**, and save the set for later. Active folders can be exported as JSON or CSV and imported on another device. A folder round uses only the words selected in that folder; when no folder is active, the starter/testing bank is used and teacher words stay out of the pool.
