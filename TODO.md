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

> Each item lists **Intent** (what must become true for the player), **Weigh** (open
> questions to think through — your call), **Extend** (existing seams to build on instead
> of reinventing; names map to CLAUDE.md §5), and **Done when** (observable result + the
> check to add). Keep duel mode working throughout; it should bypass all of this.

---

## Tier A — Career foundation (the spine; build these first)

- [ ] **Campaign Hub — "the Den."** A persistent home base the player returns to between
  battles, instead of bouncing straight from victory to the next fight.
  - *Intent:* one place that frames the career — your raised dragon, where it stands, and
    where it can go next — and from which the next battle is launched.
  - *Weigh:* what does a player most want to see and do between fights? How does the Den
    coexist with the existing title / Continue flow without making duel mode go through it?
    Is it a new screen, or a richer landing state?
  - *Extend:* `victory` / `defeat` flow, `goTitle`, `refreshTitle`, the shop modal, `save`.
  - *Done when:* with a save present, the player reaches the Den and starts the next stage
    from it; duel still launches straight into its own flow; harness still shows a campaign
    battle completing and turn integrity intact across the Den → battle → Den loop.

- [ ] **Legible stage ladder.** Make progress visible — replace the invisible stage
  counter with something the player can read and anticipate.
  - *Intent:* the player can see where they are on the ladder, what they've cleared, and
    what's coming (including that alphas punctuate it).
  - *Weigh:* how much of the ladder to reveal vs. tease? How to group it so long ladders
    stay readable? How are biome shifts and alpha stages signposted?
  - *Extend:* `save.stage`, `BIOME_ORDER`, the alpha-every-5 rule in `startBattle`, the Den
    from the previous item.
  - *Done when:* the player can view their position and progression at a glance and reach
    the next battle from it; the value shown agrees with `save.stage`; add a check that the
    displayed/derived stage state stays consistent with `save` after a win.

- [ ] **Career record.** Give the one raised dragon a story the player can look back on.
  - *Intent:* surface a sense of accumulated career — what this dragon has done over its
    run — so progress feels earned, not just a number.
  - *Weigh:* which few facts actually feel rewarding to track? What's worth persisting vs.
    derivable? Where does it live (Den panel, dragon profile)?
  - *Extend:* `save` (new fields with safe defaults — keep old saves loadable), `victory`,
    the Den.
  - *Done when:* the record is visible, updates after battles, and survives save/load; add
    a check that the tracked totals persist across a save-then-load.

## Tier B — Combat & progression depth (raising the one dragon)

- [ ] **Skill leveling / upgrades.** Let the player invest in their dragon's signature
  skills over the career, not just ride flat skill values.
  - *Intent:* a meaningful "raise your dragon" lever — choosing to strengthen skills and
    feeling the difference in battle.
  - *Weigh:* what's the currency/source of upgrades (gold, level-up points, something
    else)? Which skill facets are worth scaling, and how do you keep it simple and
    legible? How does the player see what an upgrade did?
  - *Extend:* `SKILLS`, `statsAt` / leveling, `dealDamage`, the shop UI, the Den.
  - *Done when:* the player can upgrade a skill, the upgrade visibly changes that skill's
    behavior in battle, and it persists; add a check that an applied upgrade changes the
    skill's resolved output and survives save/load. **Must not alter the turn loop.**

- [ ] **Gear depth & loadout.** Broaden gear beyond the current three lines and let the
  player see what their dragon is wearing.
  - *Intent:* more interesting permanent-progression choices, and a clear view of the
    dragon's equipped gear and what it grants.
  - *Weigh:* the field guide already promises a crit/LUK line that `GEAR` doesn't have yet
    — start there. What makes gear choices feel distinct rather than strictly-better? Where
    does the loadout view live?
  - *Extend:* `GEAR`, `refreshShop`, the stat application in the `Dragon` constructor,
    `dealDamage` (for crit), the Den.
  - *Done when:* new gear is buyable, equipped gear is visible, and its effect shows up in
    battle and persists; add a check that a purchased gear tier changes the dragon's
    resolved stats and persists across save/load.

## Tier C — Identity & stakes

- [ ] **Alpha boss identity.** Turn the every-5th-stage alpha from a stat-boosted clone
  into a fight the player remembers.
  - *Intent:* milestone battles that feel distinct — a sense of "a real boss" — with stakes
    and a reward that matches.
  - *Weigh:* what gives a boss identity without new art budget (a name, a telegraphed
    modifier, a signature behavior)? How is it signposted before and during the fight? What
    makes its reward feel special?
  - *Extend:* the `alpha` flag and enemy setup in `startBattle`, `aiThink`, `victory`
    rewards, the ladder signposting from Tier A.
  - *Done when:* an alpha stage is visibly different to fight and to win, and rewards
    accordingly; **this is combat-adjacent, so the bot-vs-bot turn-integrity sim must still
    pass against an alpha battle** — add an alpha battle to the harness's coverage.

## Tier D — Haypi alignment (second wave)

*Added 2026-07-01 from a study of how Haypi Dragon actually played — element-matched
dragons, battle props, reward/treasure levels, per-level scores, stone synthesis. These
deliberately do not overlap Tiers A–C; build them after, same rules (topmost unchecked,
one per run).*

- [ ] **Element affinity.** Make the six elements matter in combat, not just in the art.
  - *Intent:* the player reads the enemy's element and it changes how the fight plays —
    the roster's Fire/Ice/Thunder/Earth/Shadow/Toxin identity becomes mechanical, the way
    Haypi dragons' elemental prowess mattered.
  - *Weigh:* a simple wheel (each element strong vs one, weak vs one) vs more texture
    (only signature skills carry the element, basic shots neutral)? Multiplier sizes that
    are felt but not dominant. Where is the matchup telegraphed — before the battle, on
    the enemy plate, as "Effective!" floats on hit? Does duel mode share the rule?
    (CLAUDE.md says maintain duel, don't extend — a shared combat rule is defensible
    either way, but decide deliberately and say so in the PR.)
  - *Extend:* `DRAGONS` (each has `el`), `dealDamage`, `floatTxt`, the HUD plates,
    `startBattle`.
  - *Done when:* the matchup is readable in the UI and visibly changes damage in battle;
    harness asserts advantaged > neutral > resisted resolved damage and the bot-vs-bot
    sim stays green.

- [ ] **Battle amplifiers (tactical items).** Haypi battles were fought with props, not
  just heals — one-shot consumables that bend a single turn.
  - *Intent:* shop-bought consumables that create in-battle decisions: e.g. calm the wind
    for this shot, amplify this shot's damage, reveal the full arc while aiming this
    turn. Like potions, using one does not end the turn.
  - *Weigh:* which 2–3 amplifiers create the best decisions against the wind/aim systems?
    One use per turn (the `usedItem` pattern) and a carry cap like potions? Is the AI
    allowed to use them, or out of scope?
  - *Extend:* `useItem` / `B.usedItem`, the `itemCtl` dock, the shop modal + `buyPotion`
    pattern, new `save` fields with safe defaults, the aim/trajectory preview in `render`.
  - *Done when:* at least two amplifiers are buyable, usable in battle with a visible
    effect on that turn's shot, and persist in the save; harness asserts an amplifier's
    effect applies and is consumed, and that using one does not end the turn (turn
    integrity intact).

- [ ] **Field loot — supply crates.** Haypi's ladder had reward levels and treasure;
  give the battlefield something worth shooting besides the enemy.
  - *Intent:* occasional destructible caches on the field that pay out (gold, a potion)
    to whoever breaks them — a genuine alternative use for a turn.
  - *Weigh:* how often they spawn (every battle vs some), placement that demands a
    deliberate shot, what happens when the AI breaks one, payout scaling with stage.
  - *Extend:* `makeObstacles` / `obstacles` / `damageObstacle` (a crate is nearly an
    obstacle with a payout), `explode`, `victory`, `save.gold`.
  - *Done when:* crates appear in campaign battles and breaking one visibly pays out
    mid-battle and persists after the battle; harness asserts a broken crate credits its
    reward and the sim still terminates with strict alternation.

- [ ] **Hunt scoring.** Haypi graded every level — score each victory and pay for style.
  - *Intent:* after a win, a legible grade (e.g. turns taken, HP kept) with a small
    EXP/gold bonus for a clean hunt — pressure toward mastery, not just victory.
  - *Weigh:* 2–3 inputs max; stars vs letter grade; bonus size; is best-grade-per-stage
    worth persisting (feeds the Tier A career record / ladder if they exist by then)?
  - *Extend:* `B.turnNo` (already counted), the `victory` modal, `save` (safe-default
    fields), the career record.
  - *Done when:* the victory screen shows the grade and the bonus it earned; harness
    asserts the grade computed from a known battle state and that the bonus was added.

- [ ] **Side hunts (the Eyrie valve).** Haypi let you re-run levels and train in the
  Eyrie; the ladder needs a grind valve when a wall stage stops the run.
  - *Intent:* an optional off-ladder battle at roughly the player's level for reduced
    rewards, so a stuck player can strengthen instead of re-throwing at the same wall.
  - *Weigh:* entry point (the Den if built, else title / defeat modal); how discounted
    the rewards are so ladder stages stay the fastest path; enemy variety.
  - *Extend:* `startBattle` (parameterize an off-ladder variant), `victory` (reduced
    payout branch that must not advance `save.stage`), `mDefeat`, the Den.
  - *Done when:* the player can launch a side hunt, win, and receive reduced rewards with
    `save.stage` unchanged; harness asserts a side-hunt victory awards rewards without
    advancing the stage.

- [ ] **Magic stones & synthesis.** The most Haypi system of all: augmentation stones you
  socket and combine. **Build only after Tier B gear/loadout has landed** so the two
  progression tracks are designed to differ, not collide.
  - *Intent:* a second, luck-flavored progression track — stones drop from victories
    (better from alphas), socket into a small matrix on your dragon, and three of a kind
    synthesize into the next tier.
  - *Weigh:* how stones differ from gear so this isn't a parallel stat shop —
    element-keyed bonuses feeding the affinity system? percent-based where gear is flat?
    Matrix size (3 sockets?), drop rates, where the matrix UI lives (the Den).
  - *Extend:* `victory` (drops), `save` (stone inventory + sockets, safe defaults), the
    Den, the `Dragon` constructor's stat application, element affinity above.
  - *Done when:* stones drop, socket, and synthesize, visibly changing battle output, and
    persist across save/load; harness asserts 3→1 synthesis and a socketed stone's effect
    on resolved stats.

*Vision-level Haypi ideas deliberately **not** queued — they need the human's call:
capturing beaten wild dragons into a stable (breaks the one-raised-dragon vision in
CLAUDE.md), visual growth stages at level milestones (aesthetic-leaning), 2v2 team
battles (scope). Decide, then queue.*

---

*Standing concern, not a task:* difficulty / EXP / gold curve tuning is evaluated
continuously as the ladder grows — adjust it in passing when a feature makes it relevant,
rather than as a checklist item.
