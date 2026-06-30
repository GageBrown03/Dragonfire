# Dragonfire Duel — project direction

This file is the standing brief for autonomous nightly runs. Read it in full before
touching anything. It tells you what the game is, what to build next, what you must
never break, and how to prove your work.

---

## 1. What this game is

**Dragonfire Duel** is a single-file, offline, turn-based **dragon-on-dragon artillery**
game, modeled on *Haypi Dragon*. Everything lives in one file: **`dragonfire-duel.html`**.

The combat loop is the artillery duel:

- Two dragons on destructible terrain. On your turn you **move** (stamina-limited),
  **aim** (angle 3–88°), choose **power** (0–100, by holding FIRE to charge or by
  slingshot-dragging back from your dragon), and fire. **Wind** re-rolls every turn and
  bends every non-`windless` shot. Gravity, craters, fall damage, floating destructible
  obstacles, and stone spires all matter.
- Firing / healing / shielding / blinking **ends your turn**; potions do not. Turns
  **strictly alternate**.
- Each dragon has shared skills (Flame Shot, Twin Shot, Mega Blast, Heal, Shield) plus
  **two signature skills**; the second unlocks at **level 4**. Skills cost MP (+14/turn).

**The roster** (6 dragons, in `DRAGONS`): Ember (Fire), Frost (Ice), Volt (Thunder),
Terra (Earth), Dusk (Shadow), Venom (Toxin). Each has base stats, per-level growth, an
element, and two signature skills drawn from `SKILLS`.

### The two modes

- **Campaign / career mode — THIS IS THE ACTIVE FOCUS.** A single player raises and
  pilots **one** dragon up a stage ladder, earning **EXP**, **gold**, and **gear**.
  - Stage ladder: `save.stage` increments on victory; the biome cycles
    meadow → cinder → tundra; every **5th stage is an alpha (boss)** with boosted stats
    and rewards; enemy level scales with stage.
  - Progression: EXP curve is `expNeed(l) = 50 + l*40`; leveling raises stats via each
    dragon's `grow` table (`statsAt`); the 2nd signature skill unlocks at level 4.
  - Economy: victory awards EXP + gold. Gold buys **permanent gear** (ATK / DEF / AGI
    lines, 3 tiers each, in `GEAR`) and **consumable potions** (HP/MP, max 3). Gear
    applies to the player dragon in campaign only.
  - Persistence: `save` is stored via the async **`window.storage`** API (NOT
    `localStorage`) under key `dragonfire-duel-save`, schema `v:1`.
- **Hotseat duel mode — maintained, not extended.** Two players, one device, both
  level 6, no gear/potions, random biome, rematch. **Keep it working, but do not put new
  feature work here unless the human explicitly asks.** All new feature work goes into
  campaign/career.

### The vision you are building toward

Turn the thin linear ladder into a real **career**: a home/den between battles where you
manage your one raised dragon; a legible stage/chapter ladder; deepening progression
(skill upgrades, more gear, milestones); bosses with identity rather than stat-boosted
clones. The current demo is the **seed and the source of truth** for what already works —
build the vision around it, never replace it. The exact ordered plan lives in
**`TODO.md`**.

---

## 2. Engineering constraints (firm — encode them in everything you do)

1. **Single-file HTML where feasible.** The game is one `.html` file with inline CSS/JS
   and no assets (audio is synthesized, art is canvas-drawn). Do not add a build step, a
   framework, or a dependency to the game itself. If a feature truly cannot fit one file,
   say so in the PR and propose the smallest split.
2. **Simple over clever. Mechanics over aesthetics.** A plain mechanic that works beats a
   pretty one that doesn't. Don't gold-plate visuals.
3. **Testable by observation.** The human reviews by opening the file and *playing* it.
   Every feature must be visible and playable from the UI — no feature that can only be
   verified by reading code.
4. **Automated assertions are non-negotiable.** Because nobody watches a nightly run, the
   repo carries a headless test harness (see §4). Its **bot-vs-bot turn-integrity
   simulation** — strict alternation, no skipped or duplicated turns — must pass on every
   run. It exists because a real **frame-loop bug** once broke turn handoff; that class of
   bug is invisible to a quick glance and is exactly what the harness guards. Any change to
   combat or turn-state code must keep the harness green.

---

## 3. How to behave on each nightly run

1. **Build on what already works. Never break existing systems.** The load-bearing,
   fragile core is the **turn state machine**: `startTurn` → (`aim`/`anim`) →
   `fire`/`castInstant` → `finishAction` → `waitSettle` → `startTurn(other(B.active))`,
   with states `idle / aim / anim / settle / over`. Alternation rides entirely on that
   single `other()` handoff, and `finishAction` guards against double transitions. The
   **camera** (`cam`, `setOverview`, `autoFrame`) is the other thing not to break.
   - *Cautionary example:* a past **frame-loop bug** double-advanced the turn loop and
     broke alternation. It passed visual inspection. Treat any edit to the loop,
     `setTimeout`/`requestAnimationFrame` timing, or `waitSettle` as high-risk and lean on
     the harness.
2. **Pick exactly one item.** Read `TODO.md`, take the top unchecked item, and do only
   that. Don't bundle unrelated changes.
3. **Prefer a working rough version over a stalled perfect one.** Ship the simplest thing
   that is playable and passes the harness. Rough-but-working and reviewable beats
   polished-but-unfinished.
4. **Always leave reviewable progress.** Never finish a run empty. If you get blocked,
   leave a **partial-progress PR** that explains where you stopped, what's working, and
   what's uncertain — rather than reverting to nothing.
5. **Don't touch the save schema casually.** If a feature needs new `save` fields, add
   them with safe defaults and keep old saves loadable (the loader already merges onto a
   default `save`); bump nothing unless you also migrate.

---

## 4. The test harness — how to run it and what "done" means

**Run it with one command from the repo root:**

```
node harness.mjs
```

It is a single, zero-dependency Node script. It exits **0** when everything passes and
**non-zero** (with a printed list of failures) when anything fails. It must include:

- The **bot-vs-bot turn-integrity simulation**: run a full headless battle with both sides
  driven automatically and assert strict alternation, no skipped/duplicated turns, and
  that the battle terminates.
- **Campaign assertions** (added as the matching features land): a campaign battle
  completes and awards EXP + gold; leveling up actually changes stats; gear purchases
  persist; save-then-load restores campaign progress mid-ladder.

**A feature is "done" when all of these hold:**

1. It is **playable and visible** from the UI (a human can open the file and use it).
2. `node harness.mjs` **passes**, including the turn-integrity sim.
3. Existing systems — duel mode, the turn loop, the camera, save/load — still work.
4. The relevant `TODO.md` item is **checked off**, and any new assertion for the feature
   has been added to the harness.
5. A **PR** is open describing what changed, how it was verified, and anything uncertain.

If you add a new automated check for the feature you built, add it to `harness.mjs` in the
same run so the next night inherits the regression coverage.

---

## 5. Where things live in `dragonfire-duel.html`

| System | Anchor |
| --- | --- |
| Skills data | `SKILLS` |
| Dragon roster + stat growth | `DRAGONS`, `statsAt`, `expNeed` |
| Gear / shop | `GEAR`, `refreshShop`, `buyPotion` |
| Biomes | `BIOMES`, `BIOME_ORDER` |
| Save / persistence | `save`, `loadSave`, `persist`, `wipeSave`, `window.storage` |
| Terrain / obstacles | `genTerrain`, `crater`, `makeObstacles` |
| Camera | `cam`, `camUpdate`, `setOverview`, `autoFrame` |
| Shared physics (live shots + AI sim) | `physStep` |
| Battle state | `B`, `other()` |
| Turn loop | `startTurn`, `fire`, `castInstant`, `finishAction`, `waitSettle`, `checkEnd` |
| Outcomes | `victory`, `defeat`, `duelEnd` |
| AI | `aiThink`, `aiSolve`, `simShot`, `aiUpdate` |
| Title / dragon select / shop UI | `buildCards`, `refreshTitle`, `refreshShop` |
| Render / main loop | `render`, `update`, `frame`, `boot` |

When you add a campaign system, prefer extending these seams over inventing parallel ones.
