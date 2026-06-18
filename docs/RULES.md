# The Historians — Complete Rules

*A card game about building a career as an academic historian. You draw on a
shared archive of historical sources, assemble them into arguments, publish, and
earn prestige. The game comes in two flavors: a solo career mode and a
competitive multiplayer mode. Most rules are shared; where they differ, it is
called out.*

> This document describes the game exactly as implemented. Numbers in the stat
> tables and thresholds are tuned for balance and may change between versions.

---

## 1. The Goal

You play a historian moving through an academic career — from graduate student to
(if you're good) endowed professor. You advance by **publishing**: turning
evidence cards into articles and books. Each publication earns **prestige**, and
the historian with the most prestige at retirement has had the most distinguished
career.

- **Single-player:** survive 25 years, clear the two career checkpoints, and
  retire with as much prestige as possible.
- **Multiplayer:** the same, but 2–5 historians compete on a shared archive, peer
  review each other's work, attend conferences, and cite each other. Final score
  includes citation payouts and end-of-game awards.

---

## 2. The Cards

There are two kinds of card:

- **Evidence cards** (the "archive"). Historical sources you draw into your hand
  and assemble into arguments. Each has a title, content, and several hidden
  properties:
  - **Tags** — one or more letter codes (the card's `argument` and
    `sub_argument`). Tags are how you tell whether evidence supports a thesis.
  - **Context fields** — *location, author, date, source type, citation*. Used
    for the "doubling" bonus (see §4).
  - **Bonus** — a small prestige value some cards add when published.
- **Conclusion cards** (the "shelf" / library). Your theses. Unlike evidence,
  these are never drawn or discarded — they sit permanently in your library and
  can be reused. Each conclusion carries **exactly one tag** (its theme) and a
  bonus value.

**Projects** are your workbenches. A project has one **conclusion slot** and an
**evidence area**. You build an argument by placing a conclusion plus several
pieces of evidence into a project, then publishing it.

---

## 3. Building & Publishing an Argument

This is the heart of the game and works the same in both modes (the threshold
numbers differ — see the appendix).

**An argument is valid to publish only if:**

1. The project has a conclusion.
2. It has at least the minimum number of evidence cards (the **article minimum**).
3. **Every** card — the conclusion and each evidence card — shares **at least one
   common tag**. In other words, the evidence has to actually be about the
   conclusion's theme. Mismatched evidence makes the argument unpublishable (and
   in multiplayer, a reviewer can sink it for exactly this reason).

**Article vs. book:** the size of the argument decides what you publish.

- Fewer evidence cards than the **book minimum** → an **article**.
- At or above the book minimum → a **book**.

Books are worth more and are what the career checkpoints demand.

**Prestige for a publication** is computed roughly as:

```
base   = (number of evidence cards)
       + (sum of evidence card bonuses)
       + (conclusion bonus)
       + (influence bonus)

doubled?  If every evidence card shares one common context field
          (same location, OR same author, OR same date, OR same
          source type, OR same citation) → the base is DOUBLED.

total  = doubled ? base × 2 : base
```

So two things drive a big score: **a focused argument** (all evidence sharing a
context field doubles it) and **the Influence stat** (which adds a per-card
bonus). Note the tag-match (validity) and the context-match (doubling) are
independent — a valid argument doesn't have to double, and you can chase doubling
on top of validity.

When a publication succeeds, the game auto-picks a title for it from the
conclusion's title pool (choosing one whose words best match your evidence), the
evidence is discarded, and the work goes on your shelf.

---

# Part A — Single-Player

### The Year

A solo game runs **25 years**. Time only advances when you take one of two
year-spending actions:

- **Draw** — refill your hand from the archive (the number of cards depends on
  your Research stat). Costs 1 year.
- **Publish** — submit a project for publication. Costs 1 year, whether it
  succeeds or fails. (Exception: with Workspaces maxed, publishing is **free**.)

Everything else — dragging cards into projects, moving them back to your hand,
opening cards, toggling tags — is **free** and doesn't cost a year. If the
archive runs out while drawing, the discard pile is reshuffled into a new deck.

### Upgrades

Every time you **successfully publish**, you may raise **one stat by one level**
(max level 4). This is the solo upgrade economy: publish well, specialize fast.

### Career Stages & Checkpoints

| Years | Stage |
|------|------|
| 1–2 | Graduate Student |
| 3 | *Comps* — automatic milestone, you become ABD |
| 3–5 | ABD (All But Dissertation) |
| 6–12 | Assistant Professor |
| 13+ | Associate → Full (3+ books) → Endowed (5+ books) Professor |
| 25 | Retired (game ends) |

Two **hard checkpoints** can end your career early:

- **Failed Comps (end of year 5):** if you have published *nothing* — no articles
  and no books — your career ends here.
- **Tenure Denied (end of year 12):** if you have published *no books*, your
  career ends here. (Articles alone don't earn tenure.)

Survive to year 25 and you retire. Your **final score is simply your accumulated
prestige.** (Citations and renown are multiplayer-only — they do nothing in
solo.)

---

# Part B — Multiplayer

2–5 historians share one archive and compete. The shape of a turn is different:
instead of acting whenever you like, everyone acts **simultaneously each year**,
and the year resolves once everyone has committed.

### Setup

- **Players:** 2–5. The host picks a deck and a game length.
- **Game length:**
  - **Short** — 10 years
  - **Medium** — 18 years
  - **Long** — 25 years
- The archive is shuffled server-side. Each player is dealt a **starting hand of
  3 cards** and gets **3 project slots**. Everyone starts at **level 1** in every
  stat.

### The Year and Its Phases

Each year runs through up to three phases in order:

1. **Action phase** — every player secretly commits one action. The year doesn't
   resolve until *all* active players have committed.
2. **Review phase** — if anyone published, those manuscripts go to peer review,
   one at a time (see below). Skipped if nobody published.
3. **Conference phase** — if anyone chose "Attend a Conference," the draft runs
   (see below). Skipped if nobody attended.

Then the year advances, upgrades drip out, and career checkpoints are applied.

### Actions (one per year)

| Action | What it does |
|------|------|
| **Draw** | Refill your hand from the archive (count from your Research stat). |
| **Publish** | Send a project (conclusion + evidence) to **peer review**. |
| **Review** | Read and vote on another player's pending manuscript. |
| **Attend a Conference** | Stage a project's evidence and join the conference draft. |
| **Pass** | Do nothing (also used for absent players). |

### Upgrades — the biennial drip

Multiplayer does **not** reward upgrades for publishing or reviewing. Instead,
**every player gains one upgrade at the end of every odd year** (years 1, 3, 5,
…), no matter what they did. You spend it to raise one stat by one level (max 4).

Because upgrades come on a fixed clock and stats cap at 4, you can't max
everything — multiplayer forces you to **specialize**.

### Peer Review

When you publish in multiplayer, you don't publish directly — your manuscript
becomes **pending** and the table reviews it.

- Manuscripts are reviewed **one at a time**. Everyone moves through them together
  via a barrier: each player clicks **"Continue to Next Manuscript"** (or "Start
  Next Year" on the last one), and the phase only advances once everyone has.
- **The writer** sees their own full manuscript but doesn't vote — they're just
  waiting for the verdict.
- **Reviewers** see a limited view (titles, authors, tags — not the full prose)
  and must cast a verdict before continuing:
  - **Approve** — publish as is.
  - **Reject** — must flag at least one piece of evidence that sinks it.
  - **Revise & Resubmit** — must flag what to cut and/or add a card from your own
    hand for the writer to consider.

**The verdict is decided by majority.** If the vote is tied (or "revise" wins),
the outcome is **Revise & Resubmit**.

**Outcomes:**

- **Approved** → the work is published, prestige is awarded, evidence is
  discarded, and it goes on the shelf (where others can cite it).
- **Rejected** → the evidence stays bound to the failed manuscript (you can
  **reclaim** it into your hand later), and you get a one-time **consolation
  draw** as a soft landing. No prestige penalty.
- **Revise & Resubmit** → next year, the writer chooses one of:
  - **Accept** — publish the revised version (original evidence minus the flagged
    cards, plus any cards the reviewer added). The reviewer who proposed it earns
    a contributor's share of the prestige, and their donated cards are consumed.
  - **Object** — spend **2 objection tokens** to contest. The game checks the
    *original* manuscript for a single tag shared by the conclusion, all evidence,
    and all citations. If it finds one, the work is approved and every reviewer who
    voted "reject" loses **5 prestige**; your tokens are refunded. If not, the
    rejection stands and the tokens are spent.
  - **Rebuild** — walk away from the collaboration; treat as a normal rejection
    and rebuild it yourself for a future year.

**Citation tag rule:** if your manuscript cites published works (see Citations),
every cited work's tag must match your conclusion's tag. A single mismatched
citation **auto-rejects** the manuscript regardless of how reviewers voted.

### Conferences

"Attend a Conference" is a way to trade cards and earn citation tokens.

- You stage one project's evidence — those become the cards you **contribute** to
  the conference pool. You can take back up to **as many cards as you
  contributed.**
- The pool also gets **fresh cards** drawn from the archive based on your
  **Reputation** (1 / 2 / 3 / 4 fresh cards at levels 1–4).
- **Draft order** is by **Reputation (highest first)**, then Renown, then lowest
  prestige. Players take turns picking from the pool, up to their take limit. You
  **cannot pick up your own contributed cards.**
- **If you attend alone**, your contributed cards are discarded and you draw from
  a fresh pool of equal-or-greater size, keeping up to what you contributed.
- **Every attendee earns citation tokens** equal to a Reputation-based grant
  (**1 / 2 / 3 / 6** at levels 1–4). Leftover cards return to their owners'
  discards (or back to the archive if they were fresh).

The net effect: your hand size is unchanged, but you swap cards with the table
and bank citation tokens for end-game scoring.

### Citations

A **citation token** is a hidden point banked for the end of the game. You earn
them two ways:

1. **Someone cites your published work** in their own argument → you get 1 token.
2. **You attend a conference** → you get tokens equal to your Reputation grant
   (1 / 2 / 3 / 6).

When *you* cite someone's published work inside your own argument (by dragging its
spine into your project):

- **You, the citer,** gain prestige equal to **half** the cited work's recorded
  conclusion contribution (its stored `citation_value`). Citations add this as a
  flat prestige bonus — they don't count as evidence and don't trigger doubling.
- **The cited author** gains 1 citation token — *unless you cited your own work,*
  which earns no token.

**At the end of the game,** every banked token is cashed in:

```
end-game bonus = (your citation tokens) × (your Renown multiplier)
Renown multiplier by level: ×1 / ×2 / ×3 / ×5
```

So Renown is the lever that turns a pile of citation tokens into real prestige.

### Career Stages & Checkpoints

Stages work like single-player, driven by year and books published:

| Years | Stage |
|------|------|
| 1–2 | Graduate Student |
| 3 | Comps milestone → ABD |
| 3–5 | ABD |
| 6–12 | Assistant Professor |
| 13+ | Associate → Full (3+ books) → Endowed (5+ books) Professor |

The same two checkpoints apply, with one mercy: a manuscript that's still under
review at the checkpoint counts as not-yet-failed.

- **Failed Comps (year 6 gate):** no articles or books published (and nothing
  pending) → out.
- **Tenure Denied (year 13 gate):** no books published (and no book pending) →
  out. *Short (10-year) games end before this gate ever fires.*
- A player may also **Concede** at any time and leave the game.

### End of Game — Scoring & Awards

When the final year passes, the game ends and scoring resolves:

1. **Renown bonus:** each player's citation tokens × their Renown multiplier is
   added to their prestige.
2. **Base ranking:** players are ranked by total prestige.
3. **Awards:** five end-game awards each grant prestige to their winner (and to
   *every* co-winner on a tie — the points aren't split):

   | Award | Points | How to win |
   |------|:---:|------|
   | **Francis Perkins Award** | 15 | The single publication built on the most evidence. |
   | **Lifetime Achievement Award** | 15 | The most publications (articles + books). |
   | **Renaissance Scholar** | 10 | Publications across the most distinct conclusions. |
   | **The Pulitzer Award** | 10 | The most citations — but you must have published at least once. |
   | **Prodigy** | 10 | First to publish a book. |

   An award nobody qualifies for is simply not given. Award points are folded into
   the final standings, so a strong showing in the awards can change who finishes
   on top.

### Leaderboard

Final scores are posted to a shared **Hall of Scholars**, kept on **separate
boards per game length** (short / medium / long) so a 10-year sprint isn't ranked
against a 25-year marathon. Multiplayer scores are tagged so they're
distinguishable from solo runs.

---

## Appendix — Stat Tables

All stats run from level 1 to 4. The two modes use **different curves** — solo is
tuned for a 25-year arc where you can grow tall; multiplayer is tighter to force
specialization.

| Stat | What it does | Single-player (L1→L4) | Multiplayer (L1→L4) |
|------|------|------|------|
| **Research** | Cards drawn per Draw | 3 / 5 / 7 / full hand | 3 / 5 / 7 / full hand |
| **Notebook (hand limit)** | Max hand size | 7 / 11 / 15 / 25 | 7 / 9 / 11 / 15 |
| **Influence** | Prestige bonus per evidence card | 0 / 1 / 2 / +3 each | 0 / 1 / 2 / +4 each |
| **Workspaces** | Project slots (L4 = free publishing) | 1 / 2 / 3 / 3 | 1 / 2 / 3 / 3 |
| **Reputation** | *SP:* lowers publish thresholds. *MP:* conference fresh cards + citation grant | thresholds ease | 1 / 2 / 3 / 6 |
| **Renown** | End-game multiplier on citation tokens (MP only) | unused | ×1 / ×2 / ×3 / ×5 |

**Publishing thresholds**

- *Multiplayer (fixed):* article needs **2** evidence cards; book needs **6**.
- *Single-player:* a higher Reputation level lowers these — from "article 3 / book
  6" down to "article 1 / book 3" at max Reputation.

---

*This rulebook reflects the current implementation. The economy (upgrade cadence,
stat ceilings, thresholds, conference payouts) is deliberately tunable and is
still being balanced through playtesting.*
