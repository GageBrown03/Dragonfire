# Dragonfire Duel — campaign/career build queue

These are the campaign/career features to build, in order. They are **guidelines, not
specifications**: the *intent* is fixed, the *details are yours*. You choose the numbers,
the layout, the exact mechanics — favor the simplest version that is playable and keeps
the harness green. Read **CLAUDE.md** first; it holds the vision, the firm constraints,
and the definition of "done."

## How to pick the next item (routine, read this each run)

1. Read **CLAUDE.md** in full. The standing rules, the no-break list, and the done
   criteria live there, not here.
2. Run `node harness.mjs`. **If it isn't green, making it green is your job this run** —
   that takes priority over any feature below. Never build features on a red harness.
3. Take the **topmost unchecked** item. Do **only that one**. Don't bundle.
4. Treat the item as a direction, not a recipe. Make the smallest playable version first;
   you can leave a note for a future run to deepen it.
5. When it's done by CLAUDE.md §4 (playable from the UI, harness green, existing systems
   intact, PR open), **check the box** and **add a feature-specific assertion to
   `harness.mjs`** so the next night inherits the coverage.
6. If you get blocked, leave a **partial-progress PR** and add a short note under the item
   saying where you stopped and what's uncertain. Never finish empty.
7. **If this queue runs dry again** (every box below checked): don't default to slicing an
   already-shipped system into another "round N" or "second tier" of itself. That pattern
   is how the previous queue grew to 33 items across twelve tiers before this file was
   cleared out. Instead go back to CLAUDE.md's north star — Haypi Dragon's single-player
   identity, minus PvP — and propose 4-6 new, genuinely different player-facing items in
   that spirit. Small and real beats another slice of something already done.

> Each item lists **Intent** (what must become true for the player), **Weigh** (open
> questions to think through — your call), **Extend** (existing seams to build on instead
> of reinventing; names map to CLAUDE.md §5), and **Done when** (observable result + the
> check to add). Keep duel mode working throughout; it should bypass all of this — and
> stays local hotseat only, never PvP/networked. No new work goes into duel mode.

---

## Shipped (historical record — not actionable, don't re-open)

Every item below was completed by prior nightly runs; `node harness.mjs` carries one
assertion per item (33/33 passing as of this cleanup). Full write-ups (numbers chosen,
tradeoffs weighed, verification notes) live in git history for this file — `git log -p --
TODO.md` — if a future run needs the exact rationale behind a shipped mechanic. This
section is a index, not a queue: nothing here should be reopened or re-sliced by default
(see the "queue runs dry" note above).

**Career spine:** the Den (home base), a legible stage ladder, a persistent career record.

**Combat & progression depth:** skill leveling (skill points, 3 tiers/skill), a fourth and
fifth gear line (LUK, elemental ward) plus a Den loadout view, alpha boss identity
(per-boss titles, two-tier enrage), element affinity (advantage/resist wheel), battle
amplifiers ×3 (Calm Wind, Overcharge, Scope + a second forecast slot), field loot supply
crates, hunt scoring (S/A/B/C grades), side hunts, magic stones & synthesis.

**World & identity:** a fourth biome (the Sundered Chasm) with a weather hook, biome
weather for the first three biomes, a seventh off-wheel dragon (Nyx, alpha-gated), six
boss-only signature hazards (one per alpha, across four shipping rounds), a third
signature-skill tier, a defensive-counter skill archetype (Ward, then a stronger
single-dragon Night Ward for Dusk), trial stages (modifier battles: No Healing, Windstorm,
Halved Stamina).

**Meta & stakes:** achievement/milestone track (9 milestones across two waves), New Game+
with two stacking carry-overs (stat %, starting gold), the in-game Field Guide kept current
with every shipped system, a Bestiary of defeated species.

---

## Tier M — Haypi roots (the next wave)

The completed queue above built the career spine Haypi never really had (a real den, a
stage ladder, deep gear/skill progression). This wave goes back for the things that made
Haypi Dragon feel like *Haypi Dragon* to play — always single-player, always your one
dragon against AI, never a matchmaking system.

- [x] **Hatch & name your dragon.** Starting a career is currently picking a card off a
  stat-comparison grid. Haypi opened with hatching an egg and naming what came out of it.
  - *Intent:* starting a new run feels like an origin moment for *your* dragon, not a
    spec-sheet comparison — and the dragon carries a name you gave it for the rest of the
    career.
  - *Weigh:* keep the existing species/element choice (it's real information, don't hide
    it) but wrap starting a new campaign in a short hatch beat, then prompt for a name.
    Store it with a safe default (the species name) so it needs no save migration.
    Continuing an existing save must skip straight past all of this.
  - *Extend:* `buildCards`/`cardClick`/`pickedKey` and the title→Den flow for the hatch
    beat; `save` for the new `dragonName` field; `refreshDen`, HUD plates, and
    victory/defeat text wherever the species name is currently shown for a run.
  - *Done when:* a new campaign goes through a hatch-and-name beat before its first Den
    visit; Continue skips it; the custom name displays through Den/HUD/battle and persists
    through save/load; old saves without `dragonName` still load and show the species name.
    Add a harness assertion covering save/load of the name and that a fresh campaign still
    produces a valid, playable save with the added step.

- [x] **A companion — one passive ally.** Haypi paired your dragon with a pet that gave it
  a small edge. Give the player one companion slot alongside gear and stones — not a new
  inventory system, just one more lever.
  - *Intent:* a companion feels like a small, visible part of the dragon's loadout, earned
    or bought like gear, that measurably helps in a fight.
  - *Weigh:* keep it to a single slot and a single passive each (e.g. a flat AGI/LUK nudge,
    reduced fall damage, a small heal-per-turn) so it doesn't collide with or duplicate
    `GEAR`/stones. Where's it obtained — bought in the shop, dropped from field loot, a
    hunt reward? Keep the source consistent with an existing reward path rather than
    inventing a new currency.
  - *Extend:* `GEAR`/stones for the "one more resolved-stat modifier" precedent, the
    `Dragon` constructor where those modifiers are applied, `refreshDen`'s loadout row,
    field loot/hunt reward payout code if that's the source.
  - *Done when:* a companion is obtainable, visible in the Den, and measurably changes a
    resolved battle stat or outcome; persists through save/load. Add a harness assertion
    covering the resolved-stat change and save/load persistence.

- [x] **Named world regions.** The ladder today is a bare stage counter plus a biome name.
  Haypi's world was a map of named places you moved through.
  - *Intent:* the player feels like they're crossing a world with places in it, not
    climbing a numbered staircase.
  - *Weigh:* group stages into named regions (per biome cycle, or every N stages within one)
    with a one-line flavor blurb; show the region on the ladder/Den and as a short banner
    on first entry to a new one. This is signposting on top of the existing biome/stage
    logic, not a change to it.
  - *Extend:* `BIOME_ORDER`, `buildLadder`, the Den's stage line (`denStage`).
  - *Done when:* the player sees a named region while progressing that's consistent with
    `save.stage`; add a harness assertion that the displayed/derived region agrees with
    stage/biome across the ladder.
  - *Shipped:* an 8-entry `WORLD_REGIONS` pool, grouped in `REGION_SPAN`-stage (5) blocks
    aligned with the existing alpha-every-5 cadence, so each region has its own local boss.
    `regionForStage(stage)` is the pure lookup (cycles back to region 0 once the pool is
    exhausted, so a deep NG+ ladder never breaks); `isRegionEntry(stage)` flags a block's
    first stage. Shown as a gold line above the stage readout in the Den (`denRegion`,
    wired in `refreshDen`), folded into each ladder node's tooltip (`ladderWindow`), and
    bannered in the victory modal (`vRegion`) only when a win crosses a region boundary on
    the real ladder — side hunts/trials never trigger it since they don't advance
    `save.stage`. Verified by a new harness test (36/36 green). Uncertain: region names are
    flavor-only and don't currently gate anything (no per-region mechanics), which matches
    "signposting, not a system" from the intent above.

- [x] **Growth stages — your dragon visibly matures.** Haypi dragons visibly grew up as
  they leveled; today the same art represents level 1 and a fully-grown level 40 alike.
  - *Intent:* leveling up reads as your dragon growing, not just a stat sheet changing
    underneath the same picture.
  - *Weigh:* cheapest version is a small number of discrete stages (e.g.
    hatchling/juvenile/adult/elder) gated on level thresholds, expressed as a size/proportion
    or color-intensity change on the existing canvas-drawn dragon — no new art assets, no
    stat changes beyond what `statsAt` already grants. Keep it cosmetic and cheap; this is
    the lowest-priority item in this wave for a reason.
  - *Extend:* `statsAt`/level for the thresholds, wherever the dragon body is drawn in
    `render()`, the Den orb (`denOrb`).
  - *Done when:* the dragon's appearance visibly changes at level milestones in both the Den
    and battle; add a harness assertion that the growth-stage lookup returns the expected
    stage at boundary levels.
  - *Shipped:* a 4-stage `GROWTH_STAGES` table (Hatchling/Juvenile/Adult/Elder, thresholds at
    levels 1/4/10/18 — spaced near the existing signature-skill gates so a stage change lines
    up with a real power milestone) with a pure `growthStageAt(level)` lookup. Applied as a
    uniform `ctx.scale` in `Dragon.draw()` (and the ground-shadow radius) so a grown dragon is
    visibly larger in battle with no new art; the Den orb (`denOrb`) resizes to match and
    `denLvl` now names the stage next to the level/element line. Verified by a new harness
    test (37/37 green): boundary-level lookups, strictly-increasing scale per stage, Den DOM
    (orb px + label) at Hatchling vs. Elder, and a full bot-vs-bot sim with a level-20 (Elder)
    player dragon drawing every frame without breaking turn integrity. Also spot-checked live
    in a headless browser (level-1 Hatchling renders cleanly, no distortion). Uncertain: the
    scale range (0.74–1.18) is a judgment call with no reference art to match; icons above the
    dragon's head don't scale with it (kept simple, low-visibility tradeoff).

- [x] **Sparring — a no-stakes practice battle.** Haypi's training grounds let you test
  your dragon without risking your run. This item exists partly to make the "no PvP"
  boundary concrete: it's practice against an AI-controlled partner, never another player.
  - *Intent:* the player can try a loadout, a newly upgraded skill, or a new companion/gear
    tier with nothing on the line.
  - *Weigh:* launchable from the Den; must not touch `save.stage`/gold/EXP/record/bestiary.
    Reuse the existing bot-vs-bot AI plumbing so both sides can be AI-driven, or let the
    player pilot against a leveled AI opponent — either way it's local and offline, same as
    everything else in this game.
  - *Extend:* side hunts (shipped, off-ladder battle precedent) for how to branch battle
    setup without touching the ladder; `startBattle`, `victory`/`defeat`, `aiThink`.
  - *Done when:* a sparring match is launchable and completes normally (turn integrity
    intact) without altering campaign save state. Add a harness assertion that `save` is
    unchanged (aside from RNG-independent fields) after a sparring win or loss.
  - *Shipped:* a new `B.spar` flag and `startSpar()` (sibling of `startSideHunt`/`startTrial`,
    same off-ladder setup shape: player's real dragon at the save's level/gear/companion/
    stones vs. a random AI opponent leveled to match, at the player's current stage/biome).
    Launched from a new **Spar** button in the Den's button row. `victory()` and `defeat()`
    both short-circuit on `B.spar` before touching any save field — no exp/gold, no
    `save.record` wins/losses, no bestiary credit, no stone drop, no `persist()` call — and
    show a distinct "nothing gained or lost" victory line with the reward fields left blank.
    Retry after a sparring loss relaunches a spar rather than falling through to the ladder
    battle. Verified by a new harness test (38/38 green): launching via the real Den button,
    a win and a loss each asserted with a byte-for-byte `JSON.stringify(save)` equality
    check (stricter than "aside from RNG-independent fields" — sparring truly touches
    nothing), Retry relaunching a spar, and a full bot-vs-bot sim confirming turn integrity
    and save-untouched together. Uncertain: the opponent is always a random unlocked
    species at the player's level (mirroring side hunts) rather than a hand-picked
    "training partner" — simplest version per the Weigh note, and it can be revisited if a
    future run wants named sparring partners.
