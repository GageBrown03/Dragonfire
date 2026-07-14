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

- [x] **Campaign Hub — "the Den."** A persistent home base the player returns to between
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

- [x] **Legible stage ladder.** Make progress visible — replace the invisible stage
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

- [x] **Career record.** Give the one raised dragon a story the player can look back on.
  - *Intent:* surface a sense of accumulated career — what this dragon has done over its
    run — so progress feels earned, not just a number.
  - *Weigh:* which few facts actually feel rewarding to track? What's worth persisting vs.
    derivable? Where does it live (Den panel, dragon profile)?
  - *Extend:* `save` (new fields with safe defaults — keep old saves loadable), `victory`,
    the Den.
  - *Done when:* the record is visible, updates after battles, and survives save/load; add
    a check that the tracked totals persist across a save-then-load.

## Tier B — Combat & progression depth (raising the one dragon)

- [x] **Skill leveling / upgrades.** Let the player invest in their dragon's signature
  skills over the career, not just ride flat skill values.
  - *Intent:* a meaningful "raise your dragon" lever — choosing to strengthen skills and
    feeling the difference in battle.
  - *Weigh:* what's the currency/source of upgrades (gold, level-up points, something
    else)? Which skill facets are worth scaling, and how do you keep it simple and
    legible? How does the player see what an upgrade did?
  - *Extend:* `SKILLS`, `statsAt` / leveling, `dealDamage`, the shop UI, the Den.
  - *Shipped:* one skill point per level-up (`save.skillPts`), spent in a new Den → Skills
    panel (`refreshSkills`, modal `#mSkills`) on any of the player's 7 usable skills, 3
    tiers each at +10%/tier. Attack skills scale `sk.base` via a new `skillMult(owner,key)`
    helper (applied in `explode`'s `dealDamage`/`damageObstacle` calls); Heal scales its
    restored %; Shield gets extra block reduction per tier. `skillMult` only ever returns
    >1 for the player's own dragon in campaign mode — AI/duel dragons are untouched by
    design, so duel mode and the AI are unaffected. Guessed the 10%/tier and shield's 6%
    step; a future run could retune once battles are played at higher tiers.
  - *Done when:* the player can upgrade a skill, the upgrade visibly changes that skill's
    behavior in battle, and it persists; add a check that an applied upgrade changes the
    skill's resolved output and survives save/load. **Must not alter the turn loop.**

- [x] **Gear depth & loadout.** Broaden gear beyond the current three lines and let the
  player see what their dragon is wearing.
  - *Intent:* more interesting permanent-progression choices, and a clear view of the
    dragon's equipped gear and what it grants.
  - *Weigh:* the field guide already promises a crit/LUK line that `GEAR` doesn't have yet
    — start there. What makes gear choices feel distinct rather than strictly-better? Where
    does the loadout view live?
  - *Extend:* `GEAR`, `refreshShop`, the stat application in the `Dragon` constructor,
    `dealDamage` (for crit), the Den.
  - *Shipped:* a fourth gear line, `GEAR.talon` ("Lucky Talon", 🍀), 3 tiers of `+4/9/15
    LUK`, buyable in the existing shop (`refreshShop` already iterated `Object.keys(GEAR)`,
    so it picked the new line up for free). `Dragon`'s constructor now adds
    `GEAR.talon.vals[tier]` onto `this.luk`, which was already the input to `dealDamage`'s
    existing crit-chance roll (`5+att.luk*0.4`) — no new crit system needed, LUK gear just
    feeds the one that was already there. Added a `#denGear` loadout row to the Den
    (`recordRow`-styled, reusing existing CSS) showing all four gear lines and their
    current tier at a glance. While verifying live in a browser, caught and fixed a
    pre-existing staleness bug: closing the shop from the Den (`btnShopClose`) never called
    `refreshDen()`, so gold/gear bought from the Den's shop didn't show until the next
    screen change — now it does when `shopReturn==='den'`.
  - *Done when:* new gear is buyable, equipped gear is visible, and its effect shows up in
    battle and persists; add a check that a purchased gear tier changes the dragon's
    resolved stats and persists across save/load. **Verified**: harness test 10 drives the
    real Den → Shop → buy → close flow (not a reimplementation), checks resolved `luk`
    changes on a live `Dragon`, and round-trips through save/load; also confirmed live in
    Playwright/Chromium (screenshot: Den shows "🍀 LUK T1" after purchase, resolved luk
    12→16 on a real `Dragon` instance).

## Tier C — Identity & stakes

- [x] **Alpha boss identity.** Turn the every-5th-stage alpha from a stat-boosted clone
  into a fight the player remembers.
  - *Intent:* milestone battles that feel distinct — a sense of "a real boss" — with stakes
    and a reward that matches.
  - *Weigh:* what gives a boss identity without new art budget (a name, a telegraphed
    modifier, a signature behavior)? How is it signposted before and during the fight? What
    makes its reward feel special?
  - *Extend:* the `alpha` flag and enemy setup in `startBattle`, `aiThink`, `victory`
    rewards, the ladder signposting from Tier A.
  - *Shipped:* a per-dragon `ALPHA_TITLES` map (e.g. Ember's alpha is "Cindermaw", Terra's
    is "Quakehide") replaces the old generic "Alpha <name>" tag everywhere the name is
    shown (HUD plates, stage tag, victory text). A signature behavior: alphas **enrage**
    once at HP <= 40% (`ENRAGE_HP_PCT`) — a one-way flag flip inside `dealDamage` — which
    deals +18% effective attack (`effectiveAtk`/`ENRAGE_ATK_MULT`) and, in `aiThink`, turns
    off healing/shielding and raises both attack-skill frequency and aim accuracy, so an
    enraged boss visibly fights more aggressively and dangerously. It's telegraphed before
    the fight (a toast naming the boss and warning about the enrage threshold as the battle
    opens) and during it (a red "NAME ENRAGES!" float, a screen-shake burst, and a 😡 badge
    that stays on the HUD plate while enraged). The reward is a guaranteed +1 bonus skill
    point on any alpha win, on top of normal EXP/gold/level-up points, called out on the
    victory screen ("+1 bonus skill point"; sub-text also reads "the alpha is felled!").
    Guessed the 40% threshold, +18% enrage boost, and the six titles — a future run could
    reskin the titles or add a second-tier enrage if alphas still feel too similar to a
    regular fight once the roster grows.
  - *Done when:* an alpha stage is visibly different to fight and to win, and rewards
    accordingly; **this is combat-adjacent, so the bot-vs-bot turn-integrity sim must still
    pass against an alpha battle** — add an alpha battle to the harness's coverage.
    **Verified**: harness test 11 drives a real alpha battle bot-vs-bot to completion with
    strict turn alternation, asserts the title replaces the generic name, asserts enrage
    triggers exactly at the HP threshold and boosts damage (RNG pinned via a `Math`
    override so the +18% isn't lost in the existing ±8%/crit variance), and asserts the
    guaranteed bonus skill point on an alpha win with no confounding level-up. Also
    confirmed live in Playwright/Chromium: HUD shows "Nightgorge" + 😡 mid-fight
    (screenshot), and the victory modal reads "Nightgorge has fallen — the alpha is
    felled!" / "+220 Gold + 1 bonus skill point".

## Tier D — Haypi alignment (second wave)

*Added 2026-07-01 from a study of how Haypi Dragon actually played — element-matched
dragons, battle props, reward/treasure levels, per-level scores, stone synthesis. These
deliberately do not overlap Tiers A–C; build them after, same rules (topmost unchecked,
one per run).*

- [x] **Element affinity.** Make the six elements matter in combat, not just in the art.
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
  - *Shipped:* a simple cyclic six-element wheel (`ELEMENT_ORDER`, `elRel`, `elMult`) —
    every element is strong (`1.2x`) against exactly one other and weak (`0.85x`) against
    exactly one other, applied in `dealDamage` to every attack (all shots are elemental
    breath, so basic shots carry the element too, not just signatures — the simpler of the
    two Weigh options). Telegraphed three ways: a pre-battle toast naming the matchup
    (`announceMatchup`, fired from both `startBattle` and `startDuel`), a ▲/▼ badge next to
    each HUD plate's level tag (`setPlate` now takes the opposing dragon and calls `elRel`),
    and "Effective!"/"Resisted" floats on hit (`dealDamage`, same `floatTxt` pattern as the
    existing "Blocked!" text). Each dragon plate's name is also prefixed with its element's
    icon (🔥❄⚡🪨🌑☠) for at-a-glance reading. Decided duel mode shares the rule: it's a
    core `dealDamage` rule like crit/shield, not a campaign-only system, so it needed no
    special-casing and duel dragons already show their element at select. Guessed the
    1.2x/0.85x multiplier sizes and the wheel order (Fire→Toxin→Thunder→Ice→Earth→Shadow→
    Fire) — a future run could retune or reskin the pairings once matchups are felt across
    more play.
  - *Done when:* the matchup is readable in the UI and visibly changes damage in battle;
    harness asserts advantaged > neutral > resisted resolved damage and the bot-vs-bot
    sim stays green. **Verified**: harness test 12 checks the wheel is a consistent cycle
    (every element has exactly one adv/one res, no mutual-advantage pairs), that resolved
    damage is strictly advantaged > neutral > resisted with attacker/defender stats held
    equal (only `.el` varies), that duel mode applies the same multiplier as campaign, and
    drives a real bot-vs-bot campaign battle with an elemental matchup to completion with
    strict turn alternation. Also confirmed live in Playwright/Chromium: picking Ember vs
    Venom in duel mode shows the pre-battle toast "Fire is strong against Toxin!" and a
    green ▲ next to Ember's level on the HUD plate (screenshots taken); did not manage to
    land a screenshotted hit through browser automation (aiming via simulated
    drag/charge was fiddly), so the in-combat "Effective!"/"Resisted" float text is
    verified by code path and the harness's damage-ordering assertion rather than an
    additional screenshot.

- [x] **Battle amplifiers (tactical items).** Haypi battles were fought with props, not
  just heals — one-shot consumables that bend a single turn.
  - *Intent:* shop-bought consumables that create in-battle decisions: e.g. calm the wind
    for this shot, amplify this shot's damage, reveal the full arc while aiming this
    turn. Like potions, using one does not end the turn.
  - *Weigh:* which 2–3 amplifiers create the best decisions against the wind/aim systems?
    One use per turn (the `usedItem` pattern) and a carry cap like potions? Is the AI
    allowed to use them, or out of scope?
  - *Extend:* `useItem` / `B.usedItem`, the `itemCtl` dock, the shop modal + `buyPotion`
    pattern, new `save` fields with safe defaults, the aim/trajectory preview in `render`.
  - *Shipped:* two amplifiers, both following the existing potion pattern exactly (buy in
    the shop up to a cap of 2, use for free in battle without ending the turn, one use per
    item per turn via `B.usedItem`): 🍃 **Calm Wind** (`save.amps.calm`, 120g) zeroes
    `B.wind` for the rest of the current turn; 💥 **Overcharge** (`save.amps.surge`, 160g)
    arms `B.ampSurge`, which `fire()` reads once (`d===B.p && B.ampSurge`) and stamps onto
    every projectile of that shot (including multi-shot skills and the sky/cluster
    sub-shots) as `proj.amp`; `explode()` multiplies `sk.base` by a new `ampMult(proj.amp)`
    (a flat `AMP_SURGE_MULT=1.3`) alongside the existing `skillMult`, so it composes with
    trained skill tiers and element affinity rather than replacing them. The AI never uses
    either (they're gated to `B.active===B.p` in `useAmp`), so it's out of scope by design,
    matching how trained skill tiers stay player-only. Reused `itemCtl`/`.itemBtn` for the
    two new buttons (now a 2x2 wrapped dock) and the existing shop-row markup for the two
    new buy rows. Guessed the 120g/160g prices, the cap of 2 (lower than potions' 3, since
    they're more build-around-able), and the 30% Overcharge number — a future run could
    retune once they're played at higher stages.
  - *Done when:* at least two amplifiers are buyable, usable in battle with a visible
    effect on that turn's shot, and persist in the save; harness asserts an amplifier's
    effect applies and is consumed, and that using one does not end the turn (turn
    integrity intact). **Verified**: harness test 13 drives the real shop buy buttons to
    cap purchases at 2, round-trips both counts through save/load, drives a real battle to
    the player's aim state and clicks the real `btnItemCalm`/`btnItemSurge` buttons,
    asserting `B.wind` zeroes and `B.ampSurge` arms while `B.state` stays `'aim'` (turn not
    ended) and a same-turn reuse is blocked, confirms a real `fire()` call stamps
    `proj.amp` onto the queued projectile and consumes the arm, checks `ampMult` resolves
    to the advertised multiplier and raises `dealDamage`'s resolved output, and drives a
    full bot-vs-bot campaign battle with amplifiers stocked (but unused by the AI) to
    completion with strict turn alternation. Also confirmed live in Playwright/Chromium:
    screenshots show the 2x2 item dock with both new buttons and counts, and after
    clicking them in a real battle the wind pennant reads "WIND 0" and "Wind calmed!" /
    "Overcharged!" float text appears, with the turn still active throughout.

- [x] **Field loot — supply crates.** Haypi's ladder had reward levels and treasure;
  give the battlefield something worth shooting besides the enemy.
  - *Intent:* occasional destructible caches on the field that pay out (gold, a potion)
    to whoever breaks them — a genuine alternative use for a turn.
  - *Weigh:* how often they spawn (every battle vs some), placement that demands a
    deliberate shot, what happens when the AI breaks one, payout scaling with stage.
  - *Extend:* `makeObstacles` / `obstacles` / `damageObstacle` (a crate is nearly an
    obstacle with a payout), `explode`, `victory`, `save.gold`.
  - *Shipped:* a new `crates` array parallel to `obstacles`, spawned by `makeCrates(stage)`
    (called from `setupField` right after `makeObstacles`). It resets every battle and
    only ever spawns in campaign (`B.modeType==='campaign'`) — duel mode never gets one.
    Spawn is a coin flip (`CRATE_CHANCE=0.55`) so crates are occasional, not guaranteed,
    which felt closer to "treasure" than a fixture. One crate at a time, sitting on the
    ground (not floating like obstacles, so it reads as a distinct, deliberately-aimed-at
    target) with `hp=45+stage*4` and `gold=30+stage*8`, both scaling gently with stage.
    Drawn with a new `drawCrate` (a wooden chest with a "$" coin face) alongside
    `drawObstacle` in the render loop. Damage flows through the same two paths as
    obstacles: a splash hit in `explode()` (`damageCrate`, same falloff formula as
    `damageObstacle`, still composed with `skillMult`/`ampMult`) and a direct mid-flight
    hit in the projectile's `step()`, plus a matching block check in the AI's `simShot`
    so the AI's trajectory math doesn't diverge from the real physics when a crate sits in
    the way. Breaking one credits `save.gold` and calls `persist()` immediately (not
    deferred to `victory()`), so the payout survives even a loss or a quit mid-battle — a
    gold float ("+NN Gold!") and a coin-colored burst make the payout visible on the spot.
    Guessed the 55% spawn chance and the flat gold/HP scaling; a future run could add a
    potion-reward variant or scale spawn odds with stage once loot is played more.
    Decided whoever breaks it (player shot or AI splash) pays the player, since only the
    player's save carries a wallet — the AI never targets crates on purpose (out of scope,
    same call as the tactical items), so this only matters when an AI shot happens to
    clip one.
  - *Done when:* crates appear in campaign battles and breaking one visibly pays out
    mid-battle and persists after the battle; harness asserts a broken crate credits its
    reward and the sim still terminates with strict alternation. **Verified**: harness
    test 14 checks spawn gating (forced low/high rolls, campaign vs duel), that
    `damageCrate` credits gold and survives save/load, that a real `explode()` splash hit
    breaks a crate and credits its reward, and drives a full bot-vs-bot campaign battle
    with a forced crate spawn to completion with strict turn alternation. Also confirmed
    live in Playwright/Chromium: screenshot shows the wooden crate rendered on the
    battlefield next to an obstacle, and after a real `explode()` hit the crate
    disappears with a "+54 Gold!" float and `save.gold` moves 50→104.

- [x] **Hunt scoring.** Haypi graded every level — score each victory and pay for style.
  - *Intent:* after a win, a legible grade (e.g. turns taken, HP kept) with a small
    EXP/gold bonus for a clean hunt — pressure toward mastery, not just victory.
  - *Weigh:* 2–3 inputs max; stars vs letter grade; bonus size; is best-grade-per-stage
    worth persisting (feeds the Tier A career record / ladder if they exist by then)?
  - *Extend:* `B.turnNo` (already counted), the `victory` modal, `save` (safe-default
    fields), the career record.
  - *Shipped:* a letter grade (S/A/B/C) computed by `huntGrade(turns, hpPct)` from exactly
    two inputs — `B.turnNo` at the kill and the player's HP fraction remaining — blended
    `hpPct*0.6 + turnScore*0.4` (turnScore full at ≤4 turns, decaying to 0 by 14). Each
    tier (`HUNT_GRADES`) carries a bonus multiplier on the award (S +25%, A +15%, B +5%, C
    +0%), applied to both EXP and gold in `victory()` before they're added to `save`. Shown
    on the victory modal as a new `#vGrade` line ("Hunt Grade S — flawless hunt (+25% bonus
    applied)", color-coded per tier) directly under the EXP/Gold gains. Went with
    persisting lifetime counts per grade (`save.record.grades={S,A,B,C}`, extending
    `blankRecord()`/the existing career record) rather than best-grade-per-stage — simpler,
    and reads naturally alongside the other lifetime totals already in the Den's record
    row (now shows e.g. "1S 0A 0B 0C"). Old saves get a safe-default backfill in
    `loadSave()` if `record.grades` is missing. Duel mode is untouched — `huntGrade` is
    only called from campaign's `victory()`, never `duelEnd()`.
  - *Done when:* the victory screen shows the grade and the bonus it earned; harness
    asserts the grade computed from a known battle state and that the bonus was added.
    **Verified**: harness test 15 unit-checks `huntGrade()` at both extremes (fast/full-HP
    → S with a bonus, slow/near-death → C with none), drives a real `startBattle` +
    `checkEnd()` win with a forced clean-hunt state and asserts the awarded gold exceeds
    the un-bonused base, that `save.record.grades.S` incremented, that the victory modal's
    `#vGrade` text reflects it, that the tally survives save/load, that a rough-win state
    pays the plain award with no bonus, and drives a full bot-vs-bot campaign battle to
    completion with strict turn alternation intact. Also confirmed live in
    Playwright/Chromium: screenshot of the victory modal shows "Hunt Grade S — flawless
    hunt (+25% bonus applied)" under +96 EXP/+145 Gold, and the Den's record row shows
    "1S 0A 0B 0C" after returning. Guessed the two-input blend, the score thresholds, and
    the bonus sizes — a future run could retune once clean hunts are actually chased at
    higher stages, or extend the grade to factor in gear/amps used.

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
