import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { CardThumbnail, ConclusionTile } from '../components/Card.jsx';
import { TUTORIAL_CARDS } from '../lib/tutorialDeck.js';
import SkipLink from '../components/SkipLink.jsx';

/**
 * TutorialGame — a restrictive, scripted 5-turn trainer.
 *
 * It is a deliberately simplified, click-driven version of the solo game (no
 * drag-and-drop, a tiny fixed deck where every card matches) so each step can
 * be locked: only the one correct control is enabled, and the script advances
 * the moment the student does the required thing. It walks through every core
 * option — draw, build a project, set a conclusion, publish an article, invest
 * an upgrade, attend a conference, and publish a book for tenure.
 *
 * Nothing here touches the real game state or the leaderboard.
 */

const HAND_CAP = 7;
const EVIDENCE = TUTORIAL_CARDS.filter((c) => c.card_identifier === 'archive');
const CONCLUSIONS = TUTORIAL_CARDS.filter((c) => c.card_identifier === 'conclusion');

// ── The script. `allow` is the only action enabled; `done(ctx)` advances. ──
const STEPS = [
  {
    info: true,
    rank: 'Visiting Assistant Professor',
    title: 'Welcome to the tutorial',
    body: 'This is a short, guided run through The Historians. You begin as a Visiting Assistant Professor. I’ll walk you through each move — only the right button works at each step. Click Begin to start.',
    cta: 'Begin',
  },
  {
    allow: 'draw',
    highlight: 'draw',
    rank: 'Visiting Assistant Professor',
    title: 'Turn 1 — Draw research',
    body: 'Historians gather evidence first. Click the Archive (Draw) to pull primary-source cards into your notebook. Each draw advances one year.',
    done: (c) => c.draws >= 1,
  },
  {
    allow: 'add',
    highlight: 'hand',
    rank: 'Visiting Assistant Professor',
    title: 'Build a project',
    body: 'Click TWO evidence cards in your notebook to add them to your project. (In the full game you drag them — here a click does it.)',
    done: (c) => c.project.evidence.length >= 2,
  },
  {
    allow: 'conclude',
    highlight: 'conclusions',
    rank: 'Visiting Assistant Professor',
    title: 'Set a conclusion',
    body: 'A project needs a conclusion — the thesis your evidence supports. Click a conclusion on the left to set it. (Your evidence must share its theme; in this tutorial everything matches.)',
    done: (c) => !!c.project.conclusion,
  },
  {
    allow: 'publish',
    highlight: 'publish',
    rank: 'Visiting Assistant Professor',
    title: 'Turn 2 — Publish an article',
    body: 'A project with under 6 evidence cards is an article. Click Publish to put it in print — your first article wins you a tenure-track post.',
    done: (c) => c.articles >= 1,
  },
  {
    allow: 'upgrade',
    highlight: 'upgrade',
    rank: 'Assistant Professor',
    title: 'You’re promoted! Invest your funding',
    body: 'Publishing your first article made you an Assistant Professor (tenure track) — and brought new money to invest. Pick one upgrade. How you invest shapes the research you can do.',
    done: (c) => !!c.upgrade,
  },
  {
    allow: 'conference',
    highlight: 'conference',
    rank: 'Assistant Professor',
    title: 'Turn 3 — Attend a conference',
    body: 'Conferences spread your work and earn citation tokens (worth prestige at game’s end). Click Attend Conference to present and pick up fresh evidence.',
    done: (c) => c.citations >= 1,
  },
  {
    allow: 'draw',
    highlight: 'draw',
    rank: 'Assistant Professor',
    title: 'Turn 4 — Draw again',
    body: 'A book is a bigger argument — six or more evidence cards. You’ll need more research first. Click the Archive to draw again.',
    done: (c) => c.draws >= 2,
  },
  {
    allow: 'addOrConclude',
    highlight: 'hand',
    rank: 'Assistant Professor',
    title: 'Build a book',
    body: 'Now assemble a larger project: add SIX evidence cards and set a conclusion. Click evidence in your notebook, and a conclusion on the left.',
    done: (c) => c.project.evidence.length >= 6 && !!c.project.conclusion,
  },
  {
    allow: 'publish',
    highlight: 'publish',
    rank: 'Assistant Professor',
    title: 'Turn 5 — Publish a book',
    body: 'Six evidence cards make this a book. Click Publish — your first book earns you tenure and promotion to Associate Professor.',
    done: (c) => c.books >= 1,
  },
  {
    info: true,
    rank: 'Associate Professor (tenured)',
    title: 'You did it — tenure!',
    body: 'You’ve published an article and a book, earned a promotion and tenure, invested an upgrade, and attended a conference. That’s the whole loop: draw, build, publish, and grow your career. Ready for a real game?',
    cta: 'Done',
  },
];

const UPGRADES = [
  { key: 'research',   name: 'Research Funding',        blurb: 'Draw more cards at a time.' },
  { key: 'notebook',   name: 'Personal Archive',        blurb: 'Hold more cards in your notebook.' },
  { key: 'influence',  name: 'Literary Agent',          blurb: 'Bonus prestige on every publication.' },
  { key: 'reputation', name: 'Association Memberships', blurb: 'Bigger payoff at conferences.' },
];

export default function TutorialGame() {
  const navigate = useNavigate();

  const [stepIndex, setStepIndex] = useState(0);
  const [hand, setHand] = useState(() => EVIDENCE.slice(0, 3));
  const [deckRest, setDeckRest] = useState(() => EVIDENCE.slice(3));
  const [project, setProject] = useState({ evidence: [], conclusion: null });
  const [published, setPublished] = useState([]); // [{kind}]
  const [citations, setCitations] = useState(0);
  const [upgrade, setUpgrade] = useState(null);
  const [draws, setDraws] = useState(0);
  const [flash, setFlash] = useState(null);

  const step = STEPS[stepIndex];
  const articles = published.filter((p) => p.kind === 'article').length;
  const books = published.filter((p) => p.kind === 'book').length;

  const ctx = useMemo(
    () => ({ hand, project, published, citations, upgrade, draws, articles, books }),
    [hand, project, published, citations, upgrade, draws, articles, books]
  );

  // Auto-advance when the current step's goal is met.
  const advancedFor = useRef(-1);
  useEffect(() => {
    if (step.info) return;
    if (step.done && step.done(ctx) && advancedFor.current !== stepIndex) {
      advancedFor.current = stepIndex;
      const t = setTimeout(() => setStepIndex((i) => Math.min(i + 1, STEPS.length - 1)), 550);
      return () => clearTimeout(t);
    }
  }, [ctx, step, stepIndex]);

  function allowed(action) {
    if (step.allow === action) return true;
    if (step.allow === 'addOrConclude' && (action === 'add' || action === 'conclude')) return true;
    return false;
  }
  function deny() {
    setFlash('Follow the highlighted step.');
    setTimeout(() => setFlash(null), 1400);
  }

  function doDraw() {
    if (!allowed('draw')) return deny();
    setHand((h) => {
      const need = Math.max(0, HAND_CAP - h.length);
      const add = deckRest.slice(0, need);
      setDeckRest((d) => d.slice(need));
      return [...h, ...add];
    });
    setDraws((n) => n + 1);
  }
  function addEvidence(card) {
    if (!allowed('add')) return deny();
    if (project.evidence.length >= 6) return;
    setProject((p) => ({ ...p, evidence: [...p.evidence, card] }));
    setHand((h) => h.filter((c) => c.id !== card.id));
  }
  function removeEvidence(card) {
    setProject((p) => ({ ...p, evidence: p.evidence.filter((c) => c.id !== card.id) }));
    setHand((h) => [...h, card]);
  }
  function setConclusion(card) {
    if (!allowed('conclude')) return deny();
    setProject((p) => ({ ...p, conclusion: card }));
  }
  function doPublish() {
    if (!allowed('publish')) return deny();
    if (!project.conclusion || project.evidence.length < 2) return;
    const kind = project.evidence.length >= 6 ? 'book' : 'article';
    setPublished((p) => [...p, { kind }]);
    setProject({ evidence: [], conclusion: null });
  }
  function doConference() {
    if (!allowed('conference')) return deny();
    setCitations((c) => c + 2);
    // Pick up a fresh card to reinforce the "swap" idea.
    setHand((h) => {
      if (h.length >= HAND_CAP || deckRest.length === 0) return h;
      const [first, ...rest] = deckRest;
      setDeckRest(rest);
      return [...h, first];
    });
  }
  function chooseUpgrade(key) {
    if (!allowed('upgrade')) return deny();
    setUpgrade(key);
  }

  const hl = step.highlight;
  const ringIf = (name) =>
    hl === name ? 'ring-4 ring-gold-400 ring-offset-2 ring-offset-teal-950 animate-pulse' : '';
  const dim = (name) => (step.allow && hl !== name && !(step.allow === 'addOrConclude' && (name === 'hand' || name === 'conclusions')) ? 'opacity-40' : '');

  return (
    <div className="min-h-screen bg-teal-950 text-cream-50 flex flex-col">
      <SkipLink />

      {/* Header / progress */}
      <header className="px-6 py-3 border-b border-gold-500/30 flex items-center justify-between gap-4">
        <div className="font-display text-lg text-gold-300">The Historians — Tutorial</div>
        <div className="font-mono text-[11px] uppercase tracking-widest text-cream-200/80">
          Step {Math.min(stepIndex + 1, STEPS.length)} / {STEPS.length} · {step.rank}
        </div>
        <Link to="/" className="font-mono text-[11px] uppercase tracking-wider text-cream-200/70 hover:text-gold-300">Exit ✕</Link>
      </header>

      {/* Coach instruction banner */}
      <div className="px-6 py-4 bg-teal-900/60 border-b border-gold-500/20">
        <div className="max-w-3xl mx-auto">
          <h2 className="font-display text-xl text-gold-300">{step.title}</h2>
          <p className="font-serif text-cream-100 mt-1 leading-snug">{step.body}</p>
          {flash && <p className="font-mono text-[11px] uppercase tracking-wider text-oxblood-300 mt-2">{flash}</p>}
          {step.info && (
            <div className="mt-3 flex gap-3">
              {stepIndex === STEPS.length - 1 ? (
                <>
                  <button onClick={() => navigate('/game', { state: {} })} className="btn-primary">Play a real game →</button>
                  <Link to="/" className="btn-ghost">Back to home</Link>
                </>
              ) : (
                <button onClick={() => setStepIndex((i) => i + 1)} className="btn-primary">{step.cta || 'Next'}</button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Board */}
      <main id="main-content" className="flex-1 flex flex-col gap-4 p-4 md:p-6 max-w-5xl w-full mx-auto">

        {/* Action bar */}
        <div className="flex flex-wrap gap-3 items-center">
          <button
            onClick={doDraw}
            disabled={!allowed('draw')}
            className={`px-5 py-3 border border-gold-500 bg-teal-900/70 font-mono text-sm uppercase tracking-wider ${ringIf('draw')} ${allowed('draw') ? 'hover:bg-teal-800 text-cream-50' : 'opacity-40 cursor-not-allowed'}`}
          >
            🃏 Draw · {deckRest.length} left
          </button>
          <button
            onClick={doPublish}
            disabled={!allowed('publish')}
            data-tutorial="publish-button"
            className={`px-5 py-3 border border-gold-500 bg-teal-900/70 font-mono text-sm uppercase tracking-wider ${ringIf('publish')} ${allowed('publish') ? 'hover:bg-teal-800 text-cream-50' : 'opacity-40 cursor-not-allowed'}`}
          >
            📰 Publish
          </button>
          <button
            onClick={doConference}
            disabled={!allowed('conference')}
            className={`px-5 py-3 border border-gold-500 bg-teal-900/70 font-mono text-sm uppercase tracking-wider ${ringIf('conference')} ${allowed('conference') ? 'hover:bg-teal-800 text-cream-50' : 'opacity-40 cursor-not-allowed'}`}
          >
            🎤 Attend Conference
          </button>
          <span className="ml-auto font-mono text-xs text-cream-200/80">
            Citations: <span className="text-verdigris-300">{citations}</span>
          </span>
        </div>

        {/* Upgrade chooser (only during the upgrade step) */}
        {step.allow === 'upgrade' && (
          <div className={`p-4 border border-gold-500/50 bg-teal-900/50 ${ringIf('upgrade')}`}>
            <div className="font-mono text-[11px] uppercase tracking-widest text-gold-300 mb-2">Invest your funding — choose one</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {UPGRADES.map((u) => (
                <button
                  key={u.key}
                  onClick={() => chooseUpgrade(u.key)}
                  className={`p-3 text-left border ${upgrade === u.key ? 'border-gold-400 bg-gold-500/20' : 'border-gold-500/30 bg-teal-900/40 hover:bg-teal-800/60'}`}
                >
                  <div className="font-display text-cream-50">{u.name}</div>
                  <div className="font-serif text-xs text-cream-200/80 mt-0.5">{u.blurb}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Play row: conclusions (left) + project (right) */}
        <div className="flex gap-4 flex-col md:flex-row">
          {/* Conclusion rail */}
          <div className={`md:w-56 shrink-0 ${dim('conclusions')}`} data-tutorial="conclusion-rail">
            <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-gold-400 mb-2">Conclusions</div>
            <div className={`flex md:flex-col gap-2 ${ringIf('conclusions')} p-1`}>
              {CONCLUSIONS.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setConclusion(c)}
                  disabled={!allowed('conclude')}
                  className={`text-left ${project.conclusion?.id === c.id ? 'outline outline-2 outline-gold-400' : ''} ${allowed('conclude') ? 'hover:brightness-110' : 'cursor-not-allowed'}`}
                >
                  <ConclusionTile card={c} showTags={false} showSignificance={false} />
                </button>
              ))}
            </div>
          </div>

          {/* Project */}
          <div className="flex-1">
            <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-gold-400 mb-2">
              Your Project · {project.evidence.length} evidence {project.evidence.length >= 6 ? '(book)' : project.evidence.length >= 2 ? '(article)' : ''}
            </div>
            <div className="min-h-[7rem] p-3 border border-dashed border-gold-500/40 bg-teal-900/30 flex flex-wrap gap-2 items-start">
              {project.conclusion && (
                <div className="px-3 py-2 bg-gold-500/20 border border-gold-400 text-sm font-display text-cream-50 max-w-[14rem]">
                  ⚑ {project.conclusion.title}
                </div>
              )}
              {project.evidence.length === 0 && !project.conclusion && (
                <p className="font-serif italic text-cream-200/50 text-sm self-center">Add evidence and a conclusion here.</p>
              )}
              {project.evidence.map((c) => (
                <button
                  key={c.id}
                  onClick={() => removeEvidence(c)}
                  title="Click to send back to your notebook"
                  className="px-3 py-2 bg-teal-800/70 border border-gold-500/40 text-xs font-display text-cream-50 max-w-[12rem] hover:border-oxblood-400"
                >
                  {c.title} <span className="text-cream-200/50">✕</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Notebook / hand */}
        <div className={dim('hand')}>
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-gold-400 mb-2">
            Research Notebook · {hand.length}/{HAND_CAP}
          </div>
          <div className={`flex gap-2 flex-wrap p-2 ${ringIf('hand')}`} data-tutorial="draw-zone">
            {hand.length === 0 && <p className="font-serif italic text-cream-200/50 text-sm">Empty — draw to research.</p>}
            {hand.map((c) => {
              const canAdd = allowed('add');
              return (
                <button
                  key={c.id}
                  onClick={() => addEvidence(c)}
                  disabled={!canAdd}
                  className={`${canAdd ? 'hover:-translate-y-1 transition-transform' : 'cursor-not-allowed'}`}
                >
                  <CardThumbnail card={c} showTags={false} showSignificance={false} size="sm" />
                </button>
              );
            })}
          </div>
        </div>
      </main>
    </div>
  );
}
