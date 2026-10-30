import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import styles from "./journey.module.css";

export const metadata: Metadata = {
  title: "Making Wordcraft | Wordcraft Classroom",
  description: "Lisa Feng's journey from a wooden-block vocabulary game to Wordcraft Classroom, and the game mechanics and teaching ideas behind it.",
};

const milestones = [
  {
    stage: "The starting point",
    title: "Could learning a word feel more like playing with it?",
    copy: "While I was preparing for the TOEFL, I'd memorize an everyday word, then still miss it when I heard it or hesitate when it was time to use it. Repeating the list wasn't much fun either. I wanted to help middle-school students get used to TOEFL vocabulary by actually playing with the words.",
  },
  {
    stage: "The physical prototype",
    title: "MAT meant three blocks",
    copy: "I made vocabulary cards with cartoon illustrations and phrases that went with each word, then added wooden blocks. The letters in your word set your number of blocks: MAT meant M-A-T, so you got three. You could stack them into any little building you liked. I wanted the words to have somewhere to go after players learned them.",
  },
  {
    stage: "Learning from players",
    title: "The fun part exposed a real gap",
    copy: "On your turn, you could make a sentence with your own word and play it safe, or connect your word to another player's and try to take one of their blocks. The sentence had to make sense, and a successful steal let you stack their block on your own. I added little defenses too: buried blocks were safe under a new block, two sticks could make a grab trickier, and a lucky number on the die could protect your building for a turn. When a tower fell, its owner switched to a new word card. At scoring time, you counted the other players' blocks on your building. People enjoyed the game, and our playtests showed me a gap: knowing what a word meant didn't always mean knowing how to pronounce it or use it naturally.",
  },
  {
    stage: "Finding a digital version",
    title: "The tower didn't need to be on screen",
    copy: "When I started moving the game online, I didn't want to draw a giant block tower on screen. Without the feel of stacking and grabbing real blocks, a digital tower lost the part that made it satisfying and felt too childish for the game I had in mind. I kept the heart of the idea: use a word in a sentence to move the game forward. I led the website's development with Codex as a helper. The classroom version now gives accepted sentences a visible payoff through Vocabulary Bingo, with feedback and pronunciation audio close at hand.",
  },
];

const originalTurn = [
  {
    label: "Pick a card",
    title: "Your letters set your blocks",
    copy: "Each card had a word, a cartoon picture, and useful pairings. Draw MAT, and you get three blocks: one for each letter. Stack them into any shape you like.",
  },
  {
    label: "Make a sentence",
    title: "Play it safe, or go for a steal",
    copy: "Use your own word in a sentence and you won't lose points. Bring another player's word into a successful sentence, and you can take one of their blocks for your building.",
  },
  {
    label: "Protect your building",
    title: "Stack, shield, and roll",
    copy: "A new block covered the one underneath, making buried blocks safe from steals. Players also had two sticks for trickier grabs. If a player rolled your lucky number, your building was safe for that turn. If it toppled, you switched to a fresh word card.",
  },
];

const designElements = [
  {
    element: "Vocabulary Bingo",
    principle: "Clear goals & visible progress",
    mechanic: "Accepted sentences light the matching word squares. A row, column, or diagonal completes a Bingo line; a full card brings a new board.",
    purpose: "The goal gives learners a reason to use vocabulary, while the board makes accepted practice attempts visible. Completing a line gives the round a smaller milestone to work toward.",
  },
  {
    element: "Choose words, make a sentence",
    principle: "Active use in context",
    mechanic: "Learners choose words from their shelf, then write or say a sentence that connects them. In the Chinese beginner mode, they assemble a sentence from word blocks.",
    purpose: "The task asks learners to connect a word's meaning to its role in a sentence. Open writing leaves room to choose what to say, while word blocks offer a more guided starting point.",
  },
  {
    element: "Try, get feedback, revise",
    principle: "Formative feedback",
    mechanic: "Fast Check supports basic sentence practice. AI Language Check offers more detailed grammar and word-use feedback when available. Learners can revise and try again.",
    purpose: "Feedback follows the learner's own attempt, so there is a sentence to reflect on and improve. Saved grammar mistakes can also become material for the end-of-round review.",
  },
  {
    element: "Levels & sentence support",
    principle: "Scaffolding & differentiation",
    mechanic: "Teachers choose vocabulary levels and class word lists. The Chinese learner page adds beginner word blocks, verb suggestions, tense guidance, and sentence patterns.",
    purpose: "Different starting points need different amounts of support. These options are designed to help learners begin, with room to write more independently as they become ready.",
  },
  {
    element: "Illustrated words & audio",
    principle: "Clues before and during practice",
    mechanic: "Word cards pair vocabulary with illustrations and pronunciation playback. Teachers can add their own vocabulary and generate matching artwork.",
    purpose: "Images offer a clue to meaning, and audio gives learners a pronunciation model. Both are supports for producing a sentence, with the learner still deciding what to express.",
  },
  {
    element: "Solo practice & a shared table",
    principle: "Independent & social learning",
    mechanic: "Learners can play solo, take turns at a local classroom table, or load a teacher's chosen words through a shared classroom link.",
    purpose: "Solo play leaves space to work through an attempt. A shared table gives a teacher a way to invite discussion and ask learners to explain a sentence together.",
  },
];

export default function JourneyPage() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className="brand" href="/" aria-label="Wordcraft Classroom home">
          <span className="brand-logo-frame">
            <Image className="brand-logo" src="/wordcraft-logo-transparent.png" alt="Wordcraft Classroom" width={1448} height={1086} sizes="155px" priority />
          </span>
        </Link>
        <Link className={styles.backLink} href="/"><span aria-hidden="true">←</span> Back to the classroom</Link>
      </header>

      <section className={styles.hero} aria-labelledby="journey-title">
        <div className={styles.intro}>
          <p className={styles.eyebrow}>Behind the game</p>
          <h1 id="journey-title">Making<br /><em>Wordcraft.</em></h1>
          <p className={styles.byline}>By Lisa Feng <span>Student &amp; board game designer</span></p>
          <p className={styles.lead}>I wanted middle-school students to feel more at home with TOEFL vocabulary. My first idea involved word cards, little buildings, and a lot of wooden blocks. The online version turned out a little differently.</p>
          <nav className={styles.sectionLinks} aria-label="On this page">
            <a href="#my-journey">My creation journey <span aria-hidden="true">↓</span></a>
            <a href="#pedagogy">Gamification &amp; pedagogy <span aria-hidden="true">↓</span></a>
          </nav>
        </div>

        <figure className={styles.example}>
          <p className={styles.eyebrow}>The idea in one turn</p>
          <div className={styles.wordPair}>
            <div className={styles.wordTile}><Image src="/vocab/receipt.png" alt="" width={72} height={72} /><strong>receipt</strong></div>
            <span className={styles.plus} aria-hidden="true">+</span>
            <div className={styles.wordTile}><Image src="/vocab/wallet.png" alt="" width={72} height={72} /><strong>wallet</strong></div>
          </div>
          <div className={styles.sentence}><span>Your own sentence</span><p>I put the <strong>receipt</strong> in my <strong>wallet</strong>.</p></div>
          <div className={styles.progressExample}>
            <div className={styles.miniBoard} aria-hidden="true">
              {Array.from({ length: 9 }, (_, index) => <span className={index === 0 || index === 4 ? styles.lit : ""} key={index}>{index === 0 || index === 4 ? "✓" : ""}</span>)}
            </div>
            <div><strong>Use a word.<br />Light a square.</strong><p>Each accepted sentence moves the game forward.</p></div>
          </div>
          <figcaption>An example from today&apos;s vocabulary Bingo.</figcaption>
        </figure>
      </section>

      <section className={styles.journey} id="my-journey" aria-labelledby="story-title">
        <div className={styles.sectionIntro}>
          <p className={styles.eyebrow}>From the first idea to the classroom</p>
          <h2 id="story-title">My creation journey</h2>
          <p>Each version helped me understand a little more about what learners needed.</p>
        </div>
        <ol className={styles.timeline}>
          {milestones.map((milestone, index) => (
            <li key={milestone.stage}>
              <span className={styles.step} aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              <div><p className={styles.stage}>{milestone.stage}</p><h3>{milestone.title}</h3><p className={styles.storyCopy}>{milestone.copy}</p></div>
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.original} aria-labelledby="original-title">
        <div className={styles.originalIntro}>
          <p className={styles.eyebrow}>A peek at the first version</p>
          <h2 id="original-title">How a turn worked</h2>
          <p>Before there was a website, there was a table full of word cards and wooden blocks. Here's how we played.</p>
        </div>
        <ol className={styles.ruleCards}>
          {originalTurn.map((step, index) => (
            <li className={styles.ruleCard} key={step.label}>
              <span className={styles.ruleIndex}>{String(index + 1).padStart(2, "0")}</span>
              <p className={styles.ruleLabel}>{step.label}</p>
              <h3>{step.title}</h3>
              <p className={styles.ruleCopy}>{step.copy}</p>
            </li>
          ))}
        </ol>
        <p className={styles.ruleScoring}><span aria-hidden="true">✳</span><span><strong>How we kept score</strong> At the end of the game, you counted the other players' blocks on your building. More borrowed blocks meant more points.</span></p>
      </section>

      <section className={styles.pedagogy} id="pedagogy" aria-labelledby="pedagogy-title">
        <div className={styles.sectionIntro}>
          <p className={styles.eyebrow}>The thinking behind the play</p>
          <h2 id="pedagogy-title">Gamification elements<br />&amp; pedagogy</h2>
          <p>I want the game mechanics to give learners reasons to practise. Here is how the current activities connect to that teaching intention.</p>
        </div>
        <div className={styles.elementList}>
          {designElements.map((item) => (
            <article className={styles.element} key={item.element}>
              <div><p className={styles.principle}>{item.principle}</p><h3>{item.element}</h3></div>
              <div className={styles.elementCopy}><p>{item.mechanic}</p><p>{item.purpose}</p></div>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.next} aria-labelledby="next-title">
        <div><p className={styles.eyebrow}>Still making, still learning</p><h2 id="next-title">What comes next</h2><p>My next priority is more structured testing with students and teachers: watching where learners get stuck, checking the usefulness of feedback, and seeing what they remember later. Their experience will help shape the next version.</p></div>
        <Link className={styles.classroomLink} href="/">Explore the classroom <span aria-hidden="true">→</span></Link>
      </section>
    </main>
  );
}
