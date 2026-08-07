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

- [x] **Side hunts (the Eyrie valve).** Haypi let you re-run levels and train in the
  Eyrie; the ladder needs a grind valve when a wall stage stops the run.
  - *Intent:* an optional off-ladder battle at roughly the player's level for reduced
    rewards, so a stuck player can strengthen instead of re-throwing at the same wall.
  - *Weigh:* entry point (the Den if built, else title / defeat modal); how discounted
    the rewards are so ladder stages stay the fastest path; enemy variety.
  - *Extend:* `startBattle` (parameterize an off-ladder variant), `victory` (reduced
    payout branch that must not advance `save.stage`), `mDefeat`, the Den.
  - *Shipped:* a new `startSideHunt()` (a sibling of `startBattle`, not a parameterized
    branch of it — the two diverged enough on enemy setup and the alpha rule that a
    shared function would've needed more flags than it saved) fights at the player's own
    `save.stage`/level, biome-matched, always non-alpha. A new `B.side` flag marks the
    battle; `victory()` branches on it to multiply EXP/gold by a new `SIDE_HUNT_MULT`
    (0.5, stacking with the existing hunt-grade bonus) and to skip both
    `save.stage=B.stage+1` and the `save.record.bestStage` bump, so it's strictly
    off-ladder — wins/losses and hunt grades still tally into the career record, since
    those are dragon-lifetime facts, not ladder facts. Entry point is a new "Side Hunt"
    button in the Den's button row (`btnDenSide`, styled like the existing subBtns);
    `btnRetry` also checks `B.side` so retrying a lost side hunt relaunches another side
    hunt rather than dropping back into a ladder battle at the same stage. Guessed the
    50% reward multiplier and "fight at your own current stage" (rather than e.g.
    stage-1) as the simplest read of "roughly the player's level" — a future run could
    retune the discount or add enemy-pool variety once side hunts are actually played.
  - *Done when:* the player can launch a side hunt, win, and receive reduced rewards with
    `save.stage` unchanged; harness asserts a side-hunt victory awards rewards without
    advancing the stage. **Verified**: harness test 16 drives the real `btnDenSide`
    button to launch a side hunt at the player's current stage with no alpha, wins it
    and asserts gold is awarded but reduced below the ladder-equivalent base, that
    `save.stage` and `save.record.bestStage` don't move while `save.record.wins` still
    increments, that the victory modal reads as a side hunt, that a losing side hunt's
    `btnRetry` relaunches another side hunt without touching `save.stage`, and drives a
    full bot-vs-bot side-hunt battle to completion with strict turn alternation intact.
    Also confirmed live in Playwright/Chromium: screenshots show the Den's new "Side
    Hunt" button, a battle tagged "SIDE HUNT · FROZEN REACH" against a same-level
    (non-alpha) enemy, and a victory modal reading "side hunt complete, the ladder is
    unchanged" with +114 Gold (well under the ~180g a stage-6 ladder win would pay) —
    the Den's stage readout stayed "Stage 6" after returning.

- [x] **Magic stones & synthesis.** The most Haypi system of all: augmentation stones you
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
  - *Shipped:* stones are the percent-based track gear isn't: each stone (`STONE_TIER_PCT`,
    3 tiers — +4%/+9%/+16%) carries an element, drops from `victory()` (`STONE_DROP_BASE`
    50% chance on a normal win, scaled down by `SIDE_HUNT_MULT` on a side hunt; alphas
    always drop one and skew `STONE_TIER_WEIGHTS` toward higher tiers) tagged with the
    *defeated enemy's* element. Up to 3 stones socket into `save.stones.sockets` (a new
    Den → **Stones** panel, `refreshStones`/`#mStones`, alongside a matching `#denStones`
    loadout row), and three of the same tier+element synthesize into one of the next tier
    (`synthesizeStone`) — the explicit 3→1 conversion the item asked for, not a parallel
    stat shop. Leaned on the affinity system per the Weigh question: a socketed stone
    grants its full % ATK bonus only when its element matches the wearer's own dragon
    (`stoneMult`), and a reduced share (`STONE_MISMATCH_MULT`, 40%) off-element, so hunting
    same-element stones actually matters. Folded into combat through `effectiveAtk` (which
    already handled alpha enrage's atk multiplier) rather than a fourth multiplier bolted
    onto `explode()` — `stoneMult` only ever returns >1 for the player's own dragon in
    campaign, same gating as `skillMult`, so AI dragons and duel mode are untouched. While
    verifying live, caught and fixed the same class of staleness bug the gear feature
    found: closing the Stones panel from the Den never called `refreshDen()`, so a just
    -socketed stone didn't show in the Den's loadout row until the next screen change —
    now `btnStonesClose` refreshes it. Guessed the 3-socket matrix size, the tier
    percentages, the 50% base drop chance, and the tier-weight skew for alphas — a future
    run could retune once stones are actually farmed and stacked at higher stages.
  - *Done when:* stones drop, socket, and synthesize, visibly changing battle output, and
    persist across save/load; harness asserts 3→1 synthesis and a socketed stone's effect
    on resolved stats. **Verified**: harness test 17 checks 3-of-a-kind synthesis end to
    end (add 3 → synthesize → exactly 1 next-tier stone, and that it fails short of 3 or
    past tier 3), that a socketed stone raises `effectiveAtk`'s resolved output by the
    exact advertised amount when on-element and a reduced amount off-element (and not at
    all for an AI dragon), drives the real Den → Stones panel buttons (Socket/Synth
    x3/unsocket) and confirms the Den's loadout row reflects them (including the
    close-refresh fix), forces both a failed and a passed drop roll on a normal win and a
    guaranteed higher-tier drop on an alpha win via a real `victory()` call, round-trips
    inventory + sockets through save/load, and drives a full bot-vs-bot campaign battle
    with stones socketed to completion with strict turn alternation. Also confirmed live
    in Playwright/Chromium: the victory modal reads "Found a 🪨 Earth Stone T1!", the
    Stones panel lists it with working Socket/Synth buttons, and after socketing and
    closing the panel the Den's loadout row shows "🪨 Earth Stone T1" (screenshots taken).

*Vision-level Haypi ideas deliberately **not** queued — they need the human's call:
capturing beaten wild dragons into a stable (breaks the one-raised-dragon vision in
CLAUDE.md), visual growth stages at level milestones (aesthetic-leaning), 2v2 team
battles (scope). Decide, then queue.*

---

## Tier E — World expansion (new ground to fight on and over)

*Added 2026-07-21 — Tiers A–D are all shipped and the queue ran dry. This wave and the
two below it are a fresh backlog so the routine has real content again: new terrain and
roster (E), new combat texture (F), and new reasons to keep playing (G). Same rules as
always: read CLAUDE.md, topmost unchecked, one per run, treat every item as a direction
not a spec.*

- [x] **Fourth biome.** `BIOME_ORDER` has cycled the same three worlds (meadow → cinder →
  tundra) since the game's first cut. Add a fourth that earns its place in the ladder.
  - *Intent:* a world that reads as mechanically distinct on sight and in play, not a
    fourth palette on the same rock-and-sky layout.
  - *Weigh:* what's the one hook that makes it feel like a different place to fight —
    a terrain hazard (gaps/pits, a lava floor with fall-damage teeth), a different
    obstacle behavior, a lighting/readability twist? Where does it slot into the cycle
    (append it, or interleave for a 4-biome rotation)? Does it need a new `obst` art style
    or can it reuse `rock`/`shard`/`ice`?
  - *Extend:* `BIOMES`, `BIOME_ORDER`, `genTerrain`, `makeObstacles`.
  - *Shipped:* a fourth biome, `BIOMES.chasm` ("Sundered Chasm", a dusk-lit canyon), took
    the gap/pit hazard from the Weigh list. Went with the terrain hook over a new obstacle
    behavior since it reads as unmistakably different on sight (a literal split down the
    middle of the battlefield) without needing new art — reuses the `rock` obstacle style.
    A new per-biome `gap:true` flag on the `BIOMES` entry (data-driven, matching how
    `pillars`/`obst`/`amb` already vary per biome) branches `genTerrain`: instead of the
    usual stone-spire loop, a new `carveChasm()` carves a ~200px-wide pit down to
    `FLOOR-4` at midfield (kept clear of both spawns and their flatten zones). No new
    physics needed — `Dragon.tryMove`'s existing steep-drop check and `Dragon.land`'s
    existing fall-damage rule (used everywhere else for craters/cliffs) apply to the
    chasm automatically, so walking off the lip is genuinely risky, not just a visual.
    Appended (not interleaved) to `BIOME_ORDER`, so it's stage 4, 8, 12… in the existing
    `(stage-1)%BIOME_ORDER.length` cycle — the Den ladder, duel's random-biome picker, and
    the stage tag all picked it up for free since they're already data-driven off
    `BIOMES`/`BIOME_ORDER`. Added a pre-battle toast in campaign
    ("A chasm splits the field — arc your shots, or risk the fall.") mirroring the
    alpha/matchup announcement pattern; left duel mode's toast alone since CLAUDE.md says
    not to extend duel-mode feature work (the terrain hazard itself is unavoidably shared,
    since duel already draws its biome from the same `BIOME_ORDER`). Guessed the pit width
    (~200px), depth (`FLOOR-4`), and placement (always centered, not randomized off-center
    by more than ±50px) — a future run could vary the gap's shape/position per battle, or
    give it a second small ledge to fight from mid-gap.
  - *Done when:* the biome is reachable on the ladder, visually and mechanically distinct
    from the other three, and a battle inside it is playable start to finish; add a
    bot-vs-bot battle in the new biome to the harness. **Verified**: harness test 18
    confirms `BIOME_ORDER` grew a 4th, gap-flagged biome and that stage 4 actually lands
    on it; scans the generated terrain for a wide contiguous gap near `FLOOR` between the
    spawns (and confirms the spawns themselves stay clear of it); drives the real
    `Dragon.tryMove`/`.update`/`.land` methods to confirm stepping toward the lip launches
    a dragon airborne and that landing at the pit's bottom deals real fall damage; and
    drives a full bot-vs-bot campaign battle inside the chasm to completion with strict
    turn alternation (given a larger, still-bounded frame budget — the chasm and its
    floating obstacles make trajectories harder to solve, so bot fights here run
    genuinely longer, confirmed by turn count climbing steadily rather than stalling).
    Also confirmed live in Playwright/Chromium: a stage-4 battle screenshot shows "STAGE 4
    · SUNDERED CHASM" with a canyon splitting Terra and a Wild Venom across a visible gap,
    the pre-battle toast reading "A chasm splits the field — arc your shots, or risk the
    fall.", and the Den's stage ladder correctly reflects the new biome via its existing
    data-driven dot coloring.

- [x] **A seventh dragon, off the elemental wheel.** The roster has matched the 6-element
  cycle 1:1 since day one; `ELEMENT_ORDER` has no room for a 7th slot without breaking the
  clean wheel. Don't force it in — give it a reason to sit outside the wheel instead.
  - *Intent:* a new dragon worth raising that doesn't just re-skin an existing element,
    and that a returning player has a reason to go get rather than picking at the title
    screen from day one.
  - *Weigh:* `elRel` already returns `'neu'` for any element not found in `ELEMENT_ORDER`
    — an unlisted element is free neutral-vs-everyone by construction, which is a
    legitimate identity (no favorable matchup, but no unfavorable one either), not a bug
    to work around. What unlocks it — a career milestone (e.g. defeat N different alpha
    titles, or reach a stage threshold) rather than being pickable from turn one? Two new
    signature skills, or a remix of two existing ones? Is it usable in duel mode too?
  - *Extend:* `DRAGONS`, `SKILLS`, `elRel`'s neutral fallback, `buildCards` / dragon
    select, `save` (a new unlock flag with a safe default).
  - *Shipped:* a 7th dragon, `DRAGONS.nyx` ("Nyx", element `'Void'`), which — by simply not
    appearing in `ELEMENT_ORDER` — resolves `'neu'` in `elRel` both attacking and being
    attacked, exactly the free-by-construction identity the Weigh question called out; no
    changes to `elRel`/`elMult` were needed. Two new signature skills, each a remix of two
    already-implemented skill flags rather than new engine mechanics (kept the change small
    and low-risk on load-bearing combat code): `voidlance` (windless + freeze, unlocked at
    level 1) and `starrend` (bounce + poison, unlocked at level 4, matching the existing
    2nd-signature gate). Unlock is a derived career milestone, not a stored flag: a new
    `UNLOCK_REQS={nyx:{alphaWins:3}}` + `isDragonUnlocked(key)` gate Nyx behind defeating 3
    alpha bosses, read live off the existing `save.record.alphaWins` — no new save field, so
    old saves need no migration and the check is always in sync with the record the Den
    already shows. `buildCards` renders a locked dragon as a grayscale "???" card with a
    live "X/3" hint instead of its stats/name, and `cardClick` refuses to select a locked
    key; this applies in both campaign and duel mode (decided duel shares the unlock too,
    same call as element affinity sharing `dealDamage` — it's a roster-wide gate, not a
    campaign-only system). Also gated the wild/AI enemy pool in `startBattle`/
    `startSideHunt` to `isDragonUnlocked` dragons only, so a wild Nyx can't appear as an
    opponent before the player has earned it either — this doubled as the fix for a subtle
    harness issue: widening `Object.keys(DRAGONS)` from 6 to 7 shifted the seeded RNG's
    random-enemy draws in every earlier test, which cascaded into an unrelated bot-vs-bot
    sim occasionally running long under its frame budget; gating the pool keeps every
    existing test's enemy draws bit-identical to before since Nyx starts locked on a fresh
    save. While verifying live in Playwright, caught and fixed a real staleness bug:
    `buildCards()` was called once in `boot()` *before* the async `loadSave()` resolved, so
    a returning player who'd already earned Nyx would still see it locked on the title
    screen until some unrelated state change happened to rebuild the grid. Fixed by moving
    the rebuild into `refreshTitle()` (called after `loadSave()`, and on every title-screen
    transition thereafter), so the unlock reliably reflects the loaded save. Guessed the
    3-alpha-win threshold, the two skill remixes, and "off-ladder wild enemy too" — a future
    run could retune the threshold or give Nyx a dedicated alpha encounter once it's played.
  - *Done when:* the dragon is earnable through play (not just always-available), fully
    playable once unlocked (stats, skills, level growth), and confirmed neutral in every
    elemental matchup; harness asserts the unlock condition, that `elRel` resolves neutral
    both directions for its element, and a bot-vs-bot battle with it stays alternation-
    strict. **Verified**: harness test 19 confirms Nyx's element sits outside
    `ELEMENT_ORDER` and resolves neutral both directions against every roster element,
    that it's locked on a fresh save and unlocks exactly at `record.alphaWins===3`, that
    `buildCards` renders it locked (hiding name/stats) then unlocked (revealing them) as
    the milestone flips, that it has real level growth and both signature skills defined,
    and drives a full bot-vs-bot campaign battle with Nyx as the player dragon to
    completion with strict turn alternation. Also confirmed live in Playwright/Chromium: a
    fresh-save screenshot shows 6 full dragon cards plus a grayscale "???  🔒 LOCKED —
    Defeat 3 alpha bosses to unlock (0/3)" 7th card; seeding a save with `record.alphaWins:
    3` through the real `window.storage` load path and reloading shows all 7 cards
    unlocked including "Nyx"; picking it, confirming the switch-dragon dialog, and
    starting a hunt lands in a real battle with the HUD reading "🌌 Nyx Lv 1" and the skill
    dock showing "Void Lance 40 MP" usable and "Star Rend Lv 4" correctly locked until
    that level (screenshots taken).

- [x] **Boss-only signature hazards.** Alpha identity today is one shared mechanic
  (enrage) plus a name. Give each of the six `ALPHA_TITLES` its own battlefield-changing
  move that matches its name, so "fighting Glacierfang" and "fighting Stormcrown" feel
  different, not just reskinned.
  - *Intent:* a boss fight where the *name* predicts a specific thing that will happen to
    the arena, not just a bigger number.
  - *Weigh:* six is a lot for one run — ship one or two well rather than all six shallow;
    leave the rest as a note for a future night. Ideas to pick from, not a spec: Cindermaw
    scorches the ground into a lingering hazard zone, Glacierfang freezes an obstacle into
    an ice wall mid-fight, Stormcrown's bolt arcs to a second point on the field, Quakehide
    quakes open a fresh crater under a random footing, Nightgorge blinks unpredictably,
    Plaguewing's cloud lingers longer than a normal Miasma. Trigger on the existing enrage
    threshold so it doesn't need a second state machine, and it must stay fully
    deterministic-enough for the bot-vs-bot harness (no hazard that could stall or loop the
    AI).
  - *Extend:* `ALPHA_TITLES`, the enrage branch in `dealDamage`/`aiThink`, `SKILLS`'
    `zone`/`build`/`sky` flags already used by Miasma/Ice Wall/Sky Chain (reuse the shape
    rather than inventing a new one).
  - *Shipped:* two of the six, per the Weigh note — a new `BOSS_HAZARDS` map (keyed by
    dragon key, mirroring `ALPHA_TITLES`) and a `triggerBossHazard(boss)` function, called
    once from the exact same enrage branch in `dealDamage` that already flips
    `tgt.enraged`, so no second state machine and no new trigger point. **Cindermaw**
    (`ember`) reuses Miasma's `B.zones` shape directly: on enrage it pushes a
    5-turn/110-radius/3.5%-max-HP-per-tick zone centered on itself (a literal "scorched
    ground," damaging whoever's turn starts inside it, same as Miasma's existing tick in
    `startTurn`). **Glacierfang** (`frost`) reuses Ice Wall's `sk.build` shape: on enrage it
    calls the existing `buildMound()` 160px in front of itself (by facing), raising a real
    80px-radius terrain rampart that forces an arced shot to clear, exactly like a
    player-cast Ice Wall would. Both are purely additive to the existing zone-tick and
    terrain-mound code paths already exercised by Miasma/Ice Wall — no new mechanics, no
    new obstacle/collision types. Generalized the zone system to carry an optional
    `col`/`col2`/`label` so a boss's zone reads as its own hazard rather than reskinned
    miasma-green: the zone fill/stroke colors and the DoT float-text label now default to
    miasma's green/"miasma" but Cindermaw's zone overrides both to orange/"scorch".
    Telegraphed the same way enrage already is: an `announce()` toast naming the effect
    ("Cindermaw scorches the earth around it!" / "Glacierfang freezes the ground into a
    wall of ice!"), a `floatTxt` ("The ground ignites!" / "A wall of ice rises!"), and a
    matching `burst()`. The other four alphas (Stormcrown, Quakehide, Nightgorge,
    Plaguewing) still just enrage — `triggerBossHazard` no-ops for any key not in
    `BOSS_HAZARDS`, left as a note for a future run to pick up one or two more from the
    Weigh list.
  - *Done when:* at least one alpha has a hazard visibly distinct from a plain enrage, is
    telegraphed the way enrage already is, and doesn't destabilize the turn loop; harness
    drives a full alpha battle with the new hazard triggered, bot-vs-bot, to completion
    with strict alternation. **Verified**: harness test 20 checks `BOSS_HAZARDS` only maps
    real alpha titles, that `triggerBossHazard` on a real Cindermaw pushes exactly one
    zone (centered on the boss, real duration/damage/radius, its own color/label rather
    than miasma's), that it on a real Glacierfang raises the terrain rampart directly
    (`ground[mx]` measurably lower/higher afterward), that a boss with no mapped hazard
    (Stormcrown) enrages without touching zones or terrain, that a real `dealDamage` call
    crossing the enrage threshold on Cindermaw fires the hazard through the actual enrage
    branch (not just via a direct call), and drives a full bot-vs-bot campaign battle
    against a forced Cindermaw alpha to completion with strict turn alternation while
    asserting the hazard actually fired live. Also confirmed live in Playwright/Chromium:
    one run shows Cindermaw enraged with a translucent orange "scorch" ring around it and
    a "-32 scorch" float as Terra's turn starts inside it; a second run shows Glacierfang
    enraged with the toast "Glacierfang freezes the ground into a wall of ice!", the float
    "A wall of ice rises!", and a new terrain spike visibly risen between the two dragons
    that wasn't there before the hit (screenshots taken of both).
  - *Note for a future run:* only Cindermaw and Glacierfang have a hazard; Stormcrown,
    Quakehide, Nightgorge, and Plaguewing still just enrage. `BOSS_HAZARDS` and
    `triggerBossHazard` are structured to make adding the next one (e.g. Stormcrown's bolt
    arcing to a second point, reusing `sk.sky`'s `chainSub` shape) a small, additive change.

- [x] **Weather as a biome-linked hazard.** Element affinity made the roster's identity
  mechanical; biomes still only change the backdrop. Give each biome one weather beat that
  changes how a turn plays out.
  - *Intent:* the wind pennant reading "Frozen Reach" should mean something beyond a
    reskinned obstacle sprite — a reason biome matters as much as opponent element does.
  - *Weigh:* keep it to one hook per biome and cheap to reason about — e.g. tundra
    occasionally gusts a harsher wind for a turn, cinder periodically chips obstacle/crate
    HP with ember rain, meadow stays the calm baseline others are measured against. Must
    not make aiming unfair/unreadable — telegraph it before it hits, the way the wind
    pennant and matchup toast already do.
  - *Extend:* `BIOMES` (a new per-biome hazard config), the wind roll in `startTurn`,
    `floatTxt`/toast patterns from element affinity and amplifiers.
  - *Done when:* at least one biome's weather beat is visible and changes a turn's outcome
    (wind, damage, or similar) in a telegraphed way; harness asserts the hazard fires under
    a forced roll and the bot-vs-bot sim in that biome stays alternation-strict.
  - *Shipped:* `BIOME_WEATHER` + `triggerBiomeWeather()`, called from `startTurn` right
    after `rollWind()`. Cinder gets "Ember rain" (chips obstacle/crate HP), tundra gets a
    "Harsh gust" (multiplies wind), on a fixed every-4th-turn cadence — deterministic, not
    a random roll. Meadow and the chasm stay untouched. `B.weatherActive` drives a toast +
    floatTxt + a highlighted wind pennant, so it reads before you commit a shot.
  - *Note for a future run:* the cadence is deterministic instead of chance-based — a
    chance roll consumes `Math.random()` every turn, which shifts the harness's single
    shared seeded PRNG stream and can push an unrelated bot-vs-bot fight past its
    8000-frame budget (hit this while building it: fixed-cadence-vs-chance was the fix,
    not a tuning tweak). If a future biome hook wants true randomness, budget for that
    stream-shift risk across the whole harness, not just its own test. Only cinder/tundra
    have a hook so far; meadow and the chasm still sit it out.

## Tier F — Combat depth (new skills, gear, items)

- [x] **A third signature-skill tier.** The 2nd signature already unlocks at level 4
  (`SKILL_KEYS`, `DRAGONS[key].uniq`); late-ladder play flatlines once it's out because
  there's nothing further to grow into.
  - *Intent:* a reason a level-10+ dragon still feels like it's becoming something, not
    just re-running the same two signatures with bigger numbers.
  - *Weigh:* what level gate makes sense after 4 given the current EXP curve (`expNeed`)?
    Does every dragon get a genuinely new 3rd skill, or does a lower-tier skill "upgrade"
    into a stronger version at that level? Keep it additive to the existing `uniq` shape
    rather than a parallel system.
  - *Extend:* `DRAGONS.uniq` (extend to a 3rd entry), `SKILLS`, `SKILL_KEYS`, the level
    gate that currently reveals `uniq[1]` at level 4, the skill-leveling shop from Tier B.
  - *Shipped:* every dragon gets a genuinely new 3rd signature (not an upgraded lower
    tier), each a remix of already-implemented skill flags in a combination that dragon
    hasn't used yet — e.g. Ember's `solarflare` (windless + burn, its first windless move),
    Frost's `deepfreeze` (bounce + freeze), Nyx's `oblivionshard` (windless + freeze +
    poison) — so no new engine mechanics landed on the fragile combat/turn code, only new
    data rows in `SKILLS` plus a 3rd `DRAGONS[key].uniq` entry. Gated behind a new
    `UNIQ3_LEVEL=8` constant (double the level-4 2nd-signature gate, chosen against
    `expNeed`'s curve so it's reachable in a normal run without being trivial) — extended
    `SKILL_KEYS` to 8 entries, `buildSkillbar`'s lock logic to a per-index gate table
    (`i===6→4, i===7→UNIQ3_LEVEL`) instead of the old hardcoded `i===6`, `aiThink`'s uniqs
    pool with the same gate so AI dragons at/above the level use it too, the level-up
    victory toast with a matching "Third signature skill unlocked!" line, and the title
    screen's field-guide blurb to preview all three signatures. `SKILL_KEYS` already being
    the seam the Den's Skills panel iterates over meant the 3rd tier became trainable
    there for free, no extra plumbing needed. Guessed the level-8 gate, the flat 50-MP
    cost across all seven, and the specific flag remixes — a future run could retune costs
    or vary them per dragon once played at that level.
  - *Done when:* a sufficiently leveled dragon has a visibly new skill in its skill list
    that it didn't have at level 4, usable in battle; harness asserts the 3rd skill is
    absent below the gate level and present at/above it, and a bot-vs-bot battle using it
    stays alternation-strict. **Verified**: harness test 22 checks every dragon carries a
    distinct, real 3rd signature and that `SKILL_KEYS` exposes it as an 8th entry; drives
    the real `buildSkillbar` to confirm the skill dock locks slot 8 below level 8 and
    unlocks it (revealing the real name) at level 8; drives a real `fire()` call to confirm
    it costs its MP and queues a real projectile; sweeps `aiThink` under forced RNG at
    level 7 vs level 8 to confirm the option pool never contains it below the gate and can
    contain it at/above; drives a real oversized `victory()` win to confirm the level-up
    toast calls out the unlock exactly when crossed; and drives a full bot-vs-bot campaign
    battle with a level-8 dragon on both sides to completion with strict turn alternation
    (given a larger frame budget — higher-level dragons carry much more HP, and this test's
    own upfront RNG use shifts the harness's shared seeded stream, the same documented risk
    the biome-weather feature ran into). Also confirmed live in Playwright/Chromium: the
    skill dock at level 8 shows "☀ Solar Flare · 50 MP" unlocked alongside the existing six,
    and firing it at a solved angle/power landed a real hit (screenshot shows "-102" and a
    "Burning!" float with a "🔥×4" badge on the enemy plate) while the turn correctly
    advanced to "ENEMY TURN" afterward.

- [x] **A defensive-counter skill archetype.** Every instant today is passive-defensive
  (Heal, Shield) or repositioning (Shadow Step) — nothing punishes an incoming hit.
  - *Intent:* a skill choice that changes how the *opponent* plays their next turn, not
    just how much damage the caster takes or deals.
  - *Weigh:* simplest version — e.g. a ward that reflects a percentage of the next hit
    taken back at the attacker, single use, ends the turn like Shield does. Which dragon(s)
    get it — a shared skill like Heal/Shield, or a signature for one dragon? Must compose
    cleanly with the existing Shield-block math in `dealDamage`, not fork it.
  - *Extend:* `SKILLS` (new instant-type entry), `dealDamage`'s shield-block path,
    `castInstant`.
  - *Shipped:* a new shared instant, **Ward** (`SKILLS.ward`, 25 MP, 🪞), joins Heal/Shield
    as every dragon's 6th skill slot (`SKILL_KEYS` now runs shot/twin/mega/heal/shield/
    **ward**/uniq0/uniq1/uniq2 — 9 entries; `buildSkillbar`'s gate table shifted to match
    but every gate value is unchanged). Went with shared over a single dragon's signature —
    simpler, and it plants the whole archetype at once rather than picking a favorite.
    Casting it sets a single-use `status.ward` flag (mirrors `status.shield`'s lifecycle
    exactly: set in `castInstant`, decremented at the start of the caster's own next turn in
    `startTurn` if never triggered). In `dealDamage`, the reflect check sits directly after
    the existing shield-block reduction and reuses the same threaded `dmg` value — not a
    parallel damage path — computing `reflect = dmg * WARD_REFLECT_PCT * skillMult(tgt,'ward')`
    (skillMult is the same gated helper attack skills already use for trained-tier scaling,
    so Ward's reflect share trains via the Den Skills panel for free, and — like every other
    `skillMult` use — never benefits an AI-held ward). The target still takes the full hit
    (a "Warded!" float, not a block); the attacker separately loses the reflected share (a
    "−NN reflected" float) and the flag is consumed. `aiThink`'s existing shield-or-nothing
    defensive branch now picks Ward over Shield when it can afford the higher MP cost,
    gated by the same `!me.status.shield` shape (added `!me.status.ward`) and no new
    `Math.random()` call, so the AI actually wards without adding fresh entropy to the
    shared seeded stream. Guessed the 35% base reflect share and the 25 MP cost (5 above
    Shield's) — a future run could retune once it's played at higher stages, or extend the
    archetype to a second, stronger single-dragon signature.
  - *Done when:* the skill is selectable, visibly changes the outcome of the next incoming
    hit, and ends the turn like other instants; harness asserts the reflected damage lands
    on the original attacker and the turn ends correctly. **Verified**: harness test 23
    checks every dragon's `SKILL_KEYS` carries Ward as a 6th shared entry, that the skill
    dock shows it unlocked from level 1, that casting it via a real `castInstant` call sets
    the status flag/spends MP/leaves the battle in its resolving state, that a real
    `dealDamage` call against a warded target lets the hit through while reflecting ~35% of
    it onto the attacker and consumes the flag (a follow-up hit reflects nothing further),
    that a tier-3-trained Ward reflects more than an untrained one while an AI-held Ward
    never benefits from the player's trained tiers, that the Den's Skills panel trains it
    like any other shared skill, and drives a full bot-vs-bot campaign battle (where the AI
    can cast Ward) to completion with strict turn alternation. Also confirmed live in
    Playwright/Chromium: the skill dock shows "Ward 25 MP" between Shield and Inferno,
    casting it on a real battle dragon shows the "Ward!" float and spends MP while the turn
    correctly reads "YOUR TURN" again after the AI's reply, and forcing a real `dealDamage`
    hit against a warded player dragon shows both "−272 Effective!" on the defender and
    "−95 reflected" on the attacker in the same screenshot (hp bars moved 520→248 and
    425→330 respectively).

- [x] **A fifth gear line: elemental ward.** `GEAR` covers ATK/DEF/AGI/LUK; nothing lets
  a player build around the affinity system defensively the way stones build around it
  offensively.
  - *Intent:* a gear choice that specifically softens being on the wrong side of a bad
    matchup, giving affinity a defensive answer to go with its offensive one.
  - *Weigh:* flat damage-taken reduction vs a multiplier that specifically dampens
    `ELEM_RES` — keep it distinct from `talon`'s crit-adjacent LUK so it doesn't feel like
    a reskin. 3 tiers, matching the existing gear shape.
  - *Extend:* `GEAR`, the stat application in the `Dragon` constructor, `elMult`'s
    application inside `dealDamage`, the Den loadout row from Tier B.
  - *Shipped:* a fifth gear line, `GEAR.ward` ("Aegis Ward", 🔰), 3 tiers of `+10/20/35`
    resolved onto a new `Dragon.elemWard` field (gated to the player's own dragon in
    campaign, same `if(!isAI&&B.modeType==='campaign')` block as the other four lines —
    no new gating logic needed). Went with the multiplier option from the Weigh list rather
    than a flat damage-taken reduction, and kept it scoped tighter than "dampens `ELEM_RES`"
    literally: a new `elemWardMult(tgt)` helper multiplies `dmg` by `1-elemWard/100` in
    `dealDamage`, applied only when `elRelation==='adv'` (i.e. only when the *attacker*
    holds the advantage against the wearer) — the actual "wrong side of a bad matchup" case
    from the Intent — so it leaves a neutral or already-favorable-to-the-wearer matchup
    untouched, distinct from `talon`'s crit line and from `scale`'s flat DEF. Buyable in the
    existing shop (`refreshShop` already iterated `Object.keys(GEAR)`, so it picked up the
    new line for free, same as `talon` did) and visible in the Den's existing loadout row
    (`refreshDen`'s `Object.keys(GEAR)` loop, same free pickup). Guessed the 10/20/35 tier
    values (matching `talon`'s pricing) and scoping the softening to the `'adv'` case only
    rather than a broader "any elemental-relevant hit" rule — a future run could retune the
    percentages or extend it to also blunt an attacker's crit against a warded target once
    it's played at higher stages.
  - *Done when:* the gear is buyable, equipped, visible in the Den loadout, and measurably
    reduces resolved damage from an unfavorable matchup; harness asserts the resolved
    damage delta with/without it equipped and that it persists across save/load.
    **Verified**: harness test 24 checks `GEAR.ward` resolves onto a real `Dragon`'s
    `elemWard` field (and that it leaves `def` untouched, so it isn't a `scale` reskin),
    that a fully-forged tier-3 ward measurably lowers `dealDamage`'s resolved output only
    when the attacker holds the elemental advantage (a neutral matchup is provably
    untouched, same before/after damage), drives the real Den → Shop → buy → close flow to
    confirm the Den's loadout row reflects a purchased tier, round-trips the tier and gold
    spend through save/load, and drives a full bot-vs-bot campaign battle with a
    fully-forged ward equipped in a mismatched fight to completion with strict turn
    alternation. Also confirmed live in Playwright/Chromium: the shop lists an "Aegis Ward"
    row alongside the other four gear lines, buying it live drops gold 5000→4780 and the
    row updates to "Tier 1 → 2: +20 E.WARD total", and the Den's loadout row shows
    "🔰 E.WARD T1" after closing the shop (screenshots taken).

- [x] **A third battle amplifier: Scope.** Calm Wind and Overcharge (Tier D) proved the
  pattern; a third amplifier gives the player a real choice of which one to carry.
  - *Intent:* an amplifier that plays against information rather than raw power — e.g.
    reveals the exact wind value for the next two turns (a direct counter to the weather
    hazard above, if it ships first, or just to natural wind variance otherwise).
  - *Weigh:* keep it in the existing `B.usedItem`/one-per-turn/cap-of-2 shape exactly;
    price it relative to Calm Wind/Overcharge (120g/160g) based on how strong "certainty"
    turns out to be in practice.
  - *Extend:* `save.amps`, `useAmp`, the `itemCtl` dock, the shop modal's amplifier rows.
  - *Shipped:* a third amplifier, 🔭 **Scope** (`save.amps.scope`, 140g — between Calm
    Wind's 120g and Overcharge's 160g, guessed as the price of pure information), following
    the existing `useAmp`/`B.usedItem`/cap-of-2 shape exactly. Rather than a random peek,
    using it **pre-rolls and locks in** the base wind value for the very next `startTurn`
    (typically the opponent's reply) into a new `B.windForecast={turn,base}`, and `rollWind`
    now checks that queue first — if the upcoming turn matches, it consumes the locked value
    instead of drawing a fresh one, so the reveal is exact, not a guess, while adding zero
    extra `Math.random()` calls to any battle where Scope isn't used (no shift to the
    harness's shared seeded RNG stream, the documented risk from the biome-weather and
    third-signature-tier features). Went with "next turn" rather than literally "next two
    turns" from the Intent — the current turn's wind is already visible, so revealing one
    turn ahead already tells the player both halves of an exchange (their shot, then the
    reply); a future run could stack a second forecast slot if one turn of lookahead proves
    too weak. Display accounts for the Frozen Reach's deterministic gust hook from the
    biome-weather feature: a new `forecastWindDisplay(base,turn)` checks the same turn-cadence
    math `triggerBiomeWeather` uses (no RNG, so it's exactly predictable) and shows the
    post-gust value when the forecasted turn lands on one, so Scope is a genuine counter to
    that hazard as the Intent suggested. Shown as a small blue "Next: …" pennant under the
    wind flag (`#windForecast`), reusing `windTxt`'s existing arrow formatting.
  - *Done when:* the item is buyable up to its cap, usable without ending the turn, and
    its effect is visible and verifiable in the aim UI; harness asserts the purchase cap,
    save/load round-trip, and that using it doesn't end the turn. **Verified**: harness test
    26 checks Scope is buyable and caps at 2, round-trips through save/load, that using it in
    a real battle doesn't end the turn and is blocked from a same-turn reuse, that the
    forecast's locked value is reproduced **exactly** when `rollWind()` reaches the forecasted
    turn (and left untouched on a non-matching turn), that `forecastWindDisplay` correctly
    predicts the Frozen Reach's gust multiplier on a cadence turn and the plain value off it,
    and drives a full bot-vs-bot campaign battle with Scope stocked but unused to completion
    with strict turn alternation. Also confirmed live in Playwright/Chromium: the shop lists
    a "Scope" row at 140g alongside Calm Wind/Overcharge, buying it live and using it in a
    real Frozen Reach battle shows a "Scoped!" float and the wind pennant grows a "Next: 6 ←"
    line while the turn stays on the player's aim state (screenshots taken).

## Tier G — Meta & stakes (reasons to keep playing)

- [x] **Achievement / milestone track.** `save.record` already tracks wins, grades,
  alpha kills, lifetime EXP/gold — enough raw material for a rewards layer without any new
  combat mechanics.
  - *Intent:* one-off bonus rewards (gold, a skill point) for feats that are already being
    tracked or trivially derivable, giving the career record teeth instead of just being a
    readout.
  - *Weigh:* which handful of feats are worth calling out (first S-grade hunt, first alpha
    felled, first crate broken, N side hunts run)? One-time only, or repeatable tiers? Where
    does the list live — a new Den panel, or folded into the existing record row?
  - *Extend:* `save.record`, `victory()`, the Den (`refreshDen`, a new panel alongside
    Skills/Stones), `save` (a new achieved-set field with a safe default).
  - *Shipped:* a new `ACHIEVEMENTS` array (6 one-time milestones: first win, first alpha
    felled, first S-grade hunt, 10 wins, stage 10 reached, 3 alphas felled), each derived
    entirely from existing `save.record` fields — no new tracking needed, matching the
    Weigh note that the raw material already exists. `checkAchievements()` is called once
    from `victory()` right after the existing `persist()`, loops the list, and for any
    milestone not yet in the new `save.achieved` map whose `check(save.record)` passes,
    marks it earned and credits its `reward` (gold and/or a skill point) — one-time by
    construction, since a marked id is skipped on every future call. Went with a dedicated
    Den panel (`mAch`, `refreshAch`, a new "Achievements" button alongside Skills/Stones)
    rather than folding the full list into the existing record row per the Weigh question,
    but also added a compact "🏆 N/M" count into the existing `denRecord` row so the
    at-a-glance option isn't lost either. Newly earned achievements are called out on the
    victory modal itself (a new `#vAch` line under the hunt-grade line, e.g. "🏅
    Achievement: First Blood (+100 Gold)") so the payout is visible the moment it's earned,
    not just discoverable later in the Den. `save.achieved` gets a safe `{}` default in both
    the initial `save` literal and `loadSave()`'s backfill, so old saves load fine. Guessed
    the six milestones, their reward sizes (roughly scaled to `firstAlpha`'s existing
    trophy-bonus precedent), and that "first S-grade hunt" was worth calling out over e.g.
    "first crate broken" — a future run could add more milestones or vary reward sizes once
    they're actually chased at higher stages. While verifying, hit and fixed the documented
    RNG-stream-shift risk from earlier Tier E/F entries: the pre-existing alpha-boss test
    unconditionally expects "exactly one bonus skill point" from a fresh save's first alpha
    win, but a fresh save also earns the new `firstAlpha`/`threeAlphas` achievements (each
    paying their own skill point) on that same win, so the assertion started failing —
    fixed by pre-marking all achievements earned before that test's isolated alpha-bonus
    check, which also stopped the test's early throw from silently truncating the shared
    seeded `Math.random()` stream for every test after it (same class of stream-shift bug
    the biome-weather and third-signature-tier features ran into, just triggered by a
    thrown assertion this time instead of an extra random draw).
  - *Done when:* at least 3 achievements exist, are visible, and pay out exactly once each
    when earned, surviving save/load; harness asserts an achievement fires on the
    triggering condition and does not re-fire on a second identical win. **Verified**:
    harness test 27 checks at least 3 achievements exist and each carries a valid
    id/name/check/reward; that a fresh save earns nothing; that crossing a single milestone
    earns exactly that achievement once and credits its exact reward; that a repeat check
    does not re-fire or re-pay it; that crossing multiple milestones in one check reports
    all of them; that earned achievements survive save/load; that the Den's Achievements
    panel renders a row per achievement with a correct "N/M earned" count; that a real
    `victory()` call shows the newly earned achievement on the victory modal and that a
    second, unrelated win does not re-announce it; and drives a full bot-vs-bot campaign
    battle that ends in a fresh achievement to completion with strict turn alternation.
    Also confirmed live in Playwright/Chromium: a seeded save with 3/6 achievements already
    earned shows "🏆 3/6" in the Den's record row, and opening the new Achievements panel
    lists all six with the earned three showing their icon and an "Earned" tag and the
    other three greyed out with 🔒 (screenshot taken); driving a real `victory()` call
    through the actual game (not a reimplementation) shows the victory modal reading
    "🏅 Achievement: First Blood (+100 Gold) · ✨ Achievement: Flawless (+150 Gold)"
    directly under the hunt-grade line (screenshot taken).

- [x] **Trial stages — modifier battles.** Side hunts (Tier D) proved the off-ladder-battle
  pattern; a trial is a side hunt with one active constraint for a bigger payout, testing
  mastery instead of just re-grinding the same fight.
  - *Intent:* an optional, harder off-ladder fight (e.g. no healing allowed, doubled wind,
    halved max stamina) that pays out better than a plain side hunt for players who want
    a real test rather than a grind valve.
  - *Weigh:* which 1–2 constraints are simplest to enforce without touching the turn loop
    (gating a skill vs a `B` flag another system already reads, like the amplifiers' wind
    override)? Payout relative to a plain side hunt vs a ladder win?
  - *Extend:* `startSideHunt` (a sibling variant, matching how it was built as a sibling of
    `startBattle` rather than a parameterized branch), `B` flags, `victory()`'s reward
    branching.
  - *Shipped:* a new `startTrial(modKey)` (a sibling of `startSideHunt`, same rationale that
    kept side hunts out of `startBattle`) fights at the player's own stage/level, non-alpha,
    exactly like a side hunt but tagged `B.trial={mod:modKey}` and paying `TRIAL_MULT` (0.85)
    instead of `SIDE_HUNT_MULT` (0.5) — bigger than a side hunt per the Intent, still
    off-ladder (`victory()`'s stage-advance/bestStage-bump branches now key off a shared
    `offLadder=side||trial` so both off-ladder modes skip them the same way). Shipped both
    constraints from the Weigh list rather than picking one, each a different mechanism as
    the Weigh question suggested: **No Healing** (`noheal`) gates the Heal skill directly —
    `castInstant` refuses the cast (a "Healing disabled!" float, no MP spent, turn not
    ended) and `buildSkillbar` renders the Heal button locked (🔒/"OFF") so it's visibly
    enforced before the player even tries; the AI's existing heal branch in `aiThink` gained
    the same gate so it never attempts a doomed cast that would've stalled its turn (a real
    risk called out explicitly — verified live, see below). **Windstorm** (`windx2`) is the
    `B`-flag-on-an-existing-system option: `rollWind()` doubles `B.wind` after its normal
    roll (composing with the existing wind-forecast and biome-gust logic already in that
    function rather than a parallel path), and `forecastWindDisplay` got the same doubling so
    Scope's exact-reveal amplifier still predicts correctly during a Windstorm trial. Entry
    point is a new "Trial" button in the Den (`btnDenTrial`) opening a small `mTrial` modal
    (`refreshTrial`) listing both modifiers with a "Fight" button each — picked a modal over
    inline buttons since a player choosing between constraints benefits from reading the
    description first, unlike the single-option Side Hunt button. `btnRetry` also checks
    `B.trial` so retrying a lost trial relaunches the same modifier. Guessed the 0.85
    multiplier (better than a side hunt, still worse than a full ladder win) and shipping
    exactly two modifiers rather than one — a future run could add the halved-stamina idea
    from the Intent or vary the payout once trials are actually played at higher stages.
  - *Done when:* the player can launch a trial, the constraint is visibly enforced in
    battle, and a win pays out more than an equivalent plain side hunt; harness asserts the
    constraint holds during a bot-vs-bot trial battle and that it still terminates with
    strict alternation. **Verified**: harness test 28 drives the real `btnDenTrial` → modal →
    "Fight" click flow to launch a trial at the player's stage, confirms the Heal button
    renders locked and a real `castInstant(p,'heal')` call fails without spending MP or
    ending the turn during a No Healing trial, pins `Math.random()` to confirm `rollWind()`
    exactly doubles the plain roll during a Windstorm trial, confirms a trial win pays more
    gold than an equivalent side hunt while leaving `save.stage`/`bestStage` untouched, checks
    `btnRetry` relaunches the same modifier after a loss, and drives a full bot-vs-bot No
    Healing trial to completion with strict turn alternation (confirming the AI's heal-gate
    fix prevents a stall). Also confirmed live in Playwright/Chromium: the Trial modal lists
    both modifiers with descriptions (screenshot), a live No Healing battle shows the HUD tag
    "TRIAL: NO HEALING · CINDER WASTES" with the Heal button greyed out and reading "OFF"
    while every other skill stays usable (screenshot), and a live Windstorm battle shows
    "WIND 18" on the pennant — roughly double the normal ~0–10 range — under the tag
    "TRIAL: WINDSTORM · CINDER WASTES" (screenshot).

## Tier H — Second wave of polish (queue ran dry again)

*Added 2026-08-01 — Tiers A–G are all shipped and the queue ran dry a second time. Same
rules as always: read CLAUDE.md, topmost unchecked, one per run, treat every item as a
direction not a spec. This wave leans on notes-for-a-future-run left by earlier items
rather than inventing new systems from scratch.*

- [x] **Boss-only hazards, round two.** Only Cindermaw (ember) and Glacierfang (frost) got
  a signature hazard when the archetype shipped; the item's own note flagged the other four
  (Stormcrown, Quakehide, Nightgorge, Plaguewing) as future work with the shape already
  sketched out.
  - *Intent:* one more alpha whose name predicts a specific thing that happens to the arena
    on enrage, same as the first two.
  - *Weigh:* pick whichever remaining boss has the lowest-risk mechanic given what already
    exists — Quakehide's "fresh crater underfoot" reuses `crater()` exactly like a normal
    projectile impact and the existing fall-damage-on-landing rule the chasm biome already
    exercises, with zero new `Math.random()` calls (the documented RNG-stream-shift risk
    from several earlier Tier E/F/G items). Stormcrown's bolt-to-a-second-point is more
    tempting narratively but means pushing into `B.queue` from inside `dealDamage`
    mid-explode, which risks the exact "second state machine" CLAUDE.md warns against —
    leave it for a run with more room to verify the queue interaction carefully.
  - *Extend:* `BOSS_HAZARDS`, `triggerBossHazard`, `crater`, the existing fall-damage rule
    in `Dragon.land`/`update`.
  - *Shipped:* a third mapped hazard, `BOSS_HAZARDS.terra` (Quakehide), added to the same
    `triggerBossHazard` function the first two use, fired from the identical enrage branch
    in `dealDamage` — no new trigger point, no second state machine. On enrage it calls the
    existing `crater()` (the same function every ordinary splash impact already uses)
    centered directly under `other(boss)`'s current footing, radius 130, which measurably
    drops the ground there; nothing new was needed to make that dangerous — `Dragon.update`'s
    existing gravity check and `Dragon.land`'s existing fall-damage rule (the same ones the
    chasm biome already exercises) pick it up automatically once the ground drops out from
    under whoever's standing there. Telegraphed the same three ways as Cindermaw/Glacierfang:
    an `announce()` toast ("Quakehide quakes open a crater underfoot!"), a `floatTxt` ("The
    ground gives way!"), and a matching `burst()`. Deliberately skipped Stormcrown's
    bolt-to-a-second-point idea from the original Weigh list — it would need pushing into
    `B.queue` from inside `dealDamage` mid-explode, a real risk to the turn loop that
    deserves its own dedicated run rather than a second addition bundled into this one.
  - *Done when:* a third alpha's hazard is visible and distinct on enrage, telegraphed the
    same way the first two are, and doesn't destabilize the turn loop; harness extends the
    existing boss-hazard test with the new boss and keeps the bot-vs-bot sim green.
    **Verified**: harness test 20 (extended) confirms `BOSS_HAZARDS.terra` exists, that a
    direct `triggerBossHazard` call on a fresh Quakehide carves the ground deeper at the real
    foe's exact standing column (leaving Stormcrown, still unmapped, provably untouched), and
    drives a dedicated full bot-vs-bot campaign battle forcing a Quakehide alpha to completion
    with strict turn alternation while asserting it actually enraged (and therefore fired its
    hazard) live — kept as its own separate live pass rather than reusing the ember run above
    since crater/fall-damage physics is the riskiest of the three hazards to the turn loop.
    Deliberately did *not* add a second isolated `dealDamage()` call to prove the "wired
    through a real hit" path in isolation (unlike Cindermaw's test) — that would consume two
    more draws off the shared seeded `Math.random()` stream mid-test and shift every later
    test's RNG-dependent outcome, the exact documented risk earlier Tier E/F/G features hit;
    the dedicated live bot-vs-bot pass already exercises the real `dealDamage` wiring end to
    end. Also confirmed live in Playwright/Chromium: a stage-5 battle forced against Quakehide
    shows the toast "Quakehide quakes open a crater underfoot!", the float "The ground gives
    way!", and — comparing before/after screenshots — a new, visibly deeper pit carved into
    the terrain directly under the player dragon's feet the instant Quakehide enrages.

- [x] **A second Scope forecast slot.** Scope currently reveals exactly one turn of wind
  ahead; its own note flagged stacking a second forecast slot as the natural next step if
  one turn of lookahead proves too weak in practice.
  - *Intent:* let a player who leans on Scope see two turns of wind ahead instead of one,
    making the amplifier a stronger information tool without changing its cost/cap.
  - *Weigh:* a queue of two forecasts vs a single deeper one; does using Scope twice in two
    turns stack cleanly with `rollWind`'s existing single-slot check?
  - *Extend:* `B.windForecast`, `rollWind`, `forecastWindDisplay`, `useAmp`.
  - *Shipped:* went with the queue-of-two option from the Weigh list rather than a single
    deeper slot — `B.windForecast` changed from a single `{turn,base}`/`null` value to an
    array of up to two `{turn,base}` entries. One Scope use now arms *both* `B.turnNo+1`
    and `B.turnNo+2` at once (two `rand()` calls in turn order, so the near slot always
    consumes the earlier draw), rather than requiring two separate uses across two turns —
    simpler for the cost/cap to reason about, and it matches the Intent's "one use, two
    turns of lookahead" framing more directly than a stacking-across-turns design would
    have. `rollWind()` now searches the array by `turn` for a match at the current
    `B.turnNo`, applies and splices out only that entry, leaving any other armed slot
    intact — so the far slot survives the near slot resolving. The `#windForecast` HUD
    pennant renders every armed entry, each labeled by its offset from the current turn
    ("Next: …" for +1, "+2: …" for +2), joined with " · ", reusing the existing
    `forecastWindDisplay`/`windTxt` formatting unchanged (that helper already took a
    `(base,turn)` pair per-entry, so no signature change was needed there — it composes
    with the Frozen Reach's gust cadence exactly as before, per-slot). A second Scope use
    while a forecast is still armed fully replaces the array (same overwrite behavior the
    single-slot version had), rather than trying to merge/extend the existing queue —
    simplest option, and avoids ambiguity about what "using it again" should mean.
  - *Done when:* using Scope shows (and correctly predicts) wind two turns out, not just
    one; harness extends the existing Scope test to check the second slot resolves exactly.
    **Verified**: harness test 26 (extended) checks a single Scope use arms both slots at
    exactly `turnNo+1`/`turnNo+2` with bases in range, that a same-turn reuse is still
    blocked and leaves both slots untouched, that resolving the first slot via a real
    `rollWind()` call reproduces its base exactly and leaves the second slot armed, that
    resolving the second slot similarly reproduces its base exactly and empties the array,
    that a stale non-matching turn number still doesn't consume an armed forecast, and
    drives a full bot-vs-bot campaign battle with Scope stocked but unused to completion
    with strict turn alternation. Also confirmed live in Playwright/Chromium: buying Scope
    and using it in a real campaign battle showed `#windForecast` grow to two entries
    ("Next: 10 ← · +2: 0"), the turn stayed on the player's aim state throughout, and the
    charge/used-this-turn bookkeeping matched the harness assertions — no overflow or
    cutoff at 1280px width and no console errors.

- [x] **Halved-stamina trial modifier.** Trials shipped with two modifiers (No Healing,
  Windstorm); the item's own note flagged the third Intent idea — halved max stamina — as
  left for a future run.
  - *Intent:* a third trial constraint that changes the *movement* half of a turn instead of
    healing or aim, rounding out the modifier set.
  - *Weigh:* simplest enforcement point — scale `Dragon.stamina`/max at battle start for the
    trial's dragon(s), matching how `windx2` scales `B.wind` in `rollWind` rather than
    touching `tryMove` directly.
  - *Extend:* `TRIAL_MODS`, `startTrial`, the Den's Trial modal, `Dragon` stamina fields.
  - *Shipped:* a third `TRIAL_MODS` entry, `halfstam` ("Halved Stamina", 🐌), following the
    Weigh note exactly — `startTrial` rounds both dragons' `maxstam` (and current `stamina`)
    down to half immediately after they're constructed, the same "scale it once at battle
    start" approach `windx2` uses on `B.wind`, rather than touching `Dragon.tryMove` or its
    per-frame drain math. Because `startTurn` already refills `d.stamina=d.maxstam` at the
    top of every turn, halving `maxstam` once is sufficient — the halved cap sticks for the
    rest of the battle with no extra state to track. The Den's Trial modal, the HUD's
    `TRIAL: …` tag, and `victory()`'s off-ladder/trial-rate reward branch are all already
    data-driven off `TRIAL_MODS`/`B.trial`, so the new modifier needed no plumbing beyond the
    data entry and the two-line halving in `startTrial`. Guessed the plain 50%/round-to-
    nearest cut (matching stone/gear rounding elsewhere) with no separate tuning for AI vs
    player — a future run could retune the fraction or scale it per-dragon if halved stamina
    proves too harsh/mild once played at higher stages.
  - *Done when:* the constraint is visibly enforced (a shorter movement range in battle) and
    a win still pays the trial rate; harness asserts stamina is halved during the trial and
    the bot-vs-bot sim stays green. **Verified**: harness test 28 (extended) checks
    `TRIAL_MODS` now carries `halfstam`, that starting a Halved Stamina trial halves both
    dragons' `maxstam` from the real `90+agi` formula (agi already includes the player's own
    gear) and leaves the player already sitting at the halved cap, that a real `startTurn`
    call still refills stamina to the halved max on every subsequent turn, and drives a full
    bot-vs-bot campaign battle under the Halved Stamina trial to completion with strict turn
    alternation (the AI solving with a smaller movement budget doesn't stall or destabilize
    the turn loop). Also confirmed live in Playwright/Chromium: the Trial modal lists all
    three modifiers including "🐌 Halved Stamina", a live battle's HUD tag reads "TRIAL:
    HALVED STAMINA · CINDER WASTES", and driving the real `Dragon.tryMove` loop for the same
    simulated 2 seconds of held movement shows the halved-stamina dragon travels 158px before
    stamina hits 0 versus 195px+ (with stamina to spare) for an un-modified battle dragon of
    the same build.

## Tier I — Third wave of polish (queue ran dry a third time)

*Added 2026-08-04 — Tiers A–H are all shipped and the queue ran dry again. Same rules as
always: read CLAUDE.md, topmost unchecked, one per run, treat every item as a direction not
a spec. This wave again leans on a note-for-a-future-run left by an earlier item rather than
inventing a system from scratch.*

- [x] **Boss-only hazards, round three: Stormcrown.** Only Cindermaw (ember), Glacierfang
  (frost), and Quakehide (terra) had a signature hazard; the boss-hazards item's own note
  explicitly deferred Stormcrown's "bolt arcs to a second point" idea, flagging it as
  needing its own dedicated run because it means pushing into `B.queue` from inside
  `dealDamage` mid-explode — a real risk to the turn loop that deserved more care than a
  second addition bundled into an already-shipped feature.
  - *Intent:* a fourth alpha whose name predicts a specific thing that happens to the arena
    on enrage — this time a genuine second point of damage, not another terrain edit.
  - *Weigh:* reuse the exact shape `sk.sky`'s `chainSub` already proves safe (`explode()`
    pushing `{d, skillKey, ov}` onto `B.queue`, launched by the existing
    `finishAction`/`waitSettle`/`launchNext` machinery) rather than inventing a new queue
    interaction. Target the foe's exact position (deterministic, no `rand()`) so the bolt
    reads as a real retaliation, not a random peek.
  - *Extend:* `BOSS_HAZARDS`, `triggerBossHazard`, `B.queue`/`launchNext` (the `sk.sky`
    pattern), a new hidden `SKILLS` sub-munition alongside `chainSub`/`meteorSub`.
  - *Shipped:* a new hidden `SKILLS.stormboltSub` entry (`hidden:true`, `windless:true`, no
    `sky`/`build`/`zone` flags so it can never itself chain or recurse) and a `volt` branch
    in `triggerBossHazard`, added to the exact same `BOSS_HAZARDS` map and enrage-triggered
    call site the other three hazards already use — no second state machine. On enrage it
    pushes `{d:boss, skillKey:'stormboltSub', ov:{x:foe.x, y:high-above, vx:0, vy:13}}` onto
    `B.queue`, precisely mirroring the `sk.sky`/`chainSub` shape `explode()` already relies
    on for Sky Chain/Quakecall — the queued bolt falls straight down onto the foe's exact
    current position (no `rand()` in the targeting), landing after the current action
    settles via the same `finishAction`→`waitSettle`→`launchNext` sequence chainSub already
    exercises. Telegraphed the same three ways as the other hazards: an `announce()` toast
    ("Stormcrown's bolt arcs to strike a second point!"), a `floatTxt` ("A second bolt arcs
    down!"), and a `burst()`. While verifying, discovered and fixed a real RNG-stream-shift
    bug this specific hazard introduced: unlike the zone/terrain hazards, a live volt enrage
    now queues a real projectile whose `explode()` fires `burst()`/particle effects that
    consume dozens of `Math.random()` draws — previously a no-op — which shifted the
    harness's shared seeded stream for every test after the one exercising it. Fixed at the
    source (not by avoiding the draws, which would just be hiding the same cost real
    gameplay pays) by pinning the harness's own new assertions/bot-vs-bot pass onto an
    independent local PRNG so they draw zero extra from the shared stream, and by bumping
    one pre-existing, unrelated test's frame budget (8000→16000, matching the same
    documented-risk pattern the biome-weather and 3rd-signature-tier features already used)
    since a wild volt alpha enraging naturally during an earlier test now legitimately takes
    a bit longer to resolve under the shifted seed — confirmed with a much larger budget that
    it finishes on its own (turn 40+), not a stuck loop.
  - *Done when:* a fourth alpha's hazard is visible and distinct on enrage, telegraphed the
    same way the others are, and doesn't destabilize the turn loop; harness extends the
    existing boss-hazard test with the new boss and keeps the bot-vs-bot sim green.
    **Verified**: harness test 20 (extended) confirms `BOSS_HAZARDS.volt` exists and maps to
    a real alpha title; that a direct `triggerBossHazard` call on a fresh Stormcrown queues
    exactly one `stormboltSub` bolt owned by the boss and targeted at the foe's exact
    position, without touching zones or terrain (Cindermaw/Glacierfang/Quakehide's shapes);
    that a boss with no mapped hazard (Nightgorge) still does none of the above; and drives a
    dedicated full bot-vs-bot campaign battle forcing a Stormcrown alpha to completion with
    strict turn alternation while asserting it actually enraged and the bolt actually
    launched as a real projectile live. Also confirmed live in Playwright/Chromium: driving a
    real `triggerBossHazard()` call against a Stormcrown built at 45% HP shows the toast
    "Stormcrown's bolt arcs to strike a second point!" and the float "A second bolt arcs
    down!" on the HUD/canvas, with `B.queue` carrying exactly one real
    `{skillKey:'stormboltSub', ov:{x:<foe's exact x>,...}}` entry matching the harness
    assertions, and the UI kept animating normally afterward with no stall or console errors.
  - *Note for a future run:* Nightgorge (dusk) and Plaguewing (venom) still just enrage —
    2 of 6 alphas remain without a signature hazard. Nightgorge's "blinks unpredictably" idea
    from the original item needs a `rand()` draw for the blink target, so budget for the same
    stream-shift risk this run just hit (or make the blink deterministic, e.g. always to the
    opposite side of the foe, the way this run kept Stormcrown's targeting `rand()`-free).

- [x] **Boss-only hazards, round four: Nightgorge and Plaguewing.** The last two alphas
  (dusk, venom) still just enrage with no signature hazard — see the note above.
  - *Intent:* close out the full six-boss hazard set so every alpha's name predicts a
    specific thing that happens to the arena, not just Cindermaw/Glacierfang/Quakehide/
    Stormcrown.
  - *Weigh:* Nightgorge (Shadow) blinking unpredictably is the trickiest of the two — decide
    deliberately whether its blink target needs real randomness (budget for the stream-shift
    risk, matching this run's fix) or can stay deterministic (e.g. always swap sides with the
    foe). Plaguewing's "Miasma lingers longer" is the lower-risk pick — it can likely reuse
    the existing `zone` shape directly, the way Cindermaw already does, just with a longer
    `turns` value and its own color/label.
  - *Extend:* `BOSS_HAZARDS`, `triggerBossHazard`, the `zone`/`blink` shapes already used by
    Miasma/Shadow Step.
  - *Shipped:* both mapped into the same `BOSS_HAZARDS`/`triggerBossHazard` function the other
    four already use, fired from the identical enrage branch in `dealDamage` — no second state
    machine, no new trigger point, closing out the full six-alpha set. **Nightgorge** (`dusk`)
    went with the deterministic option from the Weigh list rather than budgeting for the
    stream-shift risk: on enrage it always blinks to the far side of the foe from wherever it
    currently stands (`dir=(boss.x<foe.x)?1:-1`, then clamps to `foe.x+dir*160` within world
    bounds) — genuinely "unpredictable" from the player's perspective since it depends on live
    battle positions, but costs zero `Math.random()` draws. Reuses the same
    `x/y/air/vy/fallFrom/facing` fields `castInstant`'s own Shadow Step blink already sets, so
    it lands on real ground via the existing `groundAt`, not a parallel teleport path.
    **Plaguewing** (`venom`) took the lower-risk pick exactly as scoped: reuses Miasma's own
    `sk.zone` shape via `B.zones.push`, just longer-lived (9 turns vs Miasma's 4) and with its
    own color/label (`'plague'`, a sickly yellow-green, distinct from both Miasma's default
    green and Cindermaw's orange scorch) so it reads as Plaguewing's own hazard rather than
    reskinned Miasma. Telegraphed the same three ways as the first four: an `announce()` toast,
    a `floatTxt`, and a `burst()`. Guessed the 160px blink offset (matching Shadow Step's own
    240px scaled down slightly since a boss threat should feel close, not distant) and the
    9-turn plague duration (roughly double Miasma's 4) — a future run could retune either once
    they're played more.
  - *Done when:* both remaining alphas have a hazard visibly distinct from a plain enrage,
    telegraphed the same way the first four are, and the bot-vs-bot sim stays green; harness
    extends the existing boss-hazard test to cover both. **Verified**: harness test 20
    (extended) checks `BOSS_HAZARDS` now covers all six original alphas; that a direct
    `triggerBossHazard` call on a fresh Nightgorge blinks it to the exact expected far-side
    position (deterministic, no zone/queue touched) and it lands on real ground, not airborne;
    that a fresh Plaguewing pushes exactly one zone with its own label/color and a longer
    `turns` than a normal Miasma cast (and no queue/terrain touched); that a boss with no
    mapped hazard (Nyx/Voidmaw, off the original six-alpha set) still enrages doing none of the
    above; and drives two dedicated full bot-vs-bot campaign battles — one forcing a Nightgorge
    alpha (asserting it actually enraged, actually blinked to a new position, and stayed within
    world bounds) and one forcing a Plaguewing alpha (asserting its zone actually appeared) —
    each to completion with strict turn alternation. Both new live battle passes run on an
    independent local PRNG rather than the shared seeded stream, so they don't shift any later
    test's RNG-dependent outcome (the exact documented risk this tier has hit repeatedly;
    caught and fixed here after the achievements test's bot-vs-bot win flipped to a loss on the
    first pass). Also confirmed live in Playwright/Chromium: forcing a Nightgorge hazard mid-
    battle shows the toast "Nightgorge blinks behind you!" and the boss sprite visibly jumps
    from the far spawn to behind the player dragon (screenshot, x 1380→140); forcing a
    Plaguewing hazard shows "A lingering plague cloud spreads!" with a distinct olive-green
    zone ring rendered around the boss (screenshot), no console errors in either run.

- [x] **New Game+ — a ladder reset with a permanent carry-over.** The stage ladder currently
  only goes up; nothing gives a player who reaches the top (or just wants a fresh run) a
  reason to restart deliberately rather than just stopping.
  - *Intent:* a deliberate "start a new career" option that resets the grind (stage, level,
    gold, gear) but keeps something permanent and meaningful from the old run, so replaying
    the ladder from stage 1 feels like a fresh, slightly-stronger run rather than punitive.
  - *Weigh:* what resets vs what's permanent (career record/achievements/highest-stage-ever
    should probably persist; gear/gold/stage/level should probably reset)? What's the
    carry-over bonus — a small permanent stat bump, a discount, an early unlock? Where does
    the option live (the Den, alongside Side Hunt/Trial)? Does it require reaching a stage
    threshold first, or is it always available?
  - *Extend:* `save` (new prestige-count field with a safe default), `wipeSave`/the save
    loader (a softer reset than a full wipe), the Den, `victory`/the stage ladder from Tier A.
  - *Shipped:* a new `save.prestige` counter (safe-defaulted to 0 on old saves) plus
    `canPrestige()`/`newGamePlus()`, mirroring `wipeSave`'s reset-the-whole-object pattern but
    keeping `dragonKey`, `record` (wins/losses/alphas/best-stage/hunt grades — the "who this
    dragon has been" the career-record item established) and `achieved`. Everything else —
    level, exp, gold, gear tiers, trained skill points/upgrades, amp stock, and the stone
    inventory/sockets — resets to the fresh-save defaults. Gated behind reaching stage
    `PRESTIGE_STAGE_REQ=10` at least once (`save.record.bestStage`, which already existed and
    already never resets) — the same milestone the `stage10` achievement uses, so it's a real
    ladder threshold, not a made-up number, and it can't be spammed turn one. The carry-over
    is a flat `+3%` (`PRESTIGE_STAT_PCT`) to ATK/DEF/AGI/LUK per reset, stacking with every
    earlier one, applied in the `Dragon` constructor right after gear (`pMult=1+save.prestige*
    PRESTIGE_STAT_PCT`) — gated to `!isAI&&B.modeType==='campaign'`, the same gating
    `skillMult`/`stoneMult` already use, so AI dragons and duel mode are untouched. Entry point
    is a new "New Game+" button in its own row under the Den's existing button row
    (`btnDenPrestige`), disabled with an explanatory tooltip ("Reach stage 10...") until
    unlocked, and a `confirm()` dialog before committing — same pattern as the existing
    "Reset save" and "Switch dragons" confirmations. The Den's record row grows a "♻ N NG+"
    tag once `save.prestige>0`, and the level line grows a "· NG+N" suffix. Kept the same
    raised dragon rather than forcing a reselect — simplest reading of "start a new career"
    that doesn't need to touch the title/dragon-select flow at all. Guessed the stage-10 gate
    and the 3%/reset size — a future run could retune either once players actually chain
    resets at higher stages, or add a second carry-over choice (e.g. a starting-gold bump)
    alongside the flat stat bonus.
  - *Done when:* the player can deliberately reset their ladder run from the Den, the reset
    is visible (stage/level/gold back to the start), and the chosen carry-over is visible and
    measurably in effect on the new run; harness asserts what resets, what persists, and that
    the bot-vs-bot sim stays green on a post-reset battle. **Verified**: harness test 28 checks
    the button/`canPrestige()` stay locked below stage 10 and that a blocked `newGamePlus()`
    call leaves the save object untouched, that they unlock at stage 10, drives the real
    `btnDenPrestige` button (with gear/skills/amps/stones/record/achievements all pre-loaded)
    and asserts gear/skillPts/skillUpg/amps/stones reset to defaults while `dragonKey`/`record`
    /`achieved` survive byte-for-byte, that a second reset stacks `prestige` to 2, that a fresh
    `Dragon` at prestige 2 resolves atk/def/agi/luk at exactly the stacked `+6%` over base while
    an AI dragon and a duel-mode dragon both resolve to plain base stats, that the reset and
    prestige count survive a real save/load round-trip, and drives a full bot-vs-bot campaign
    battle on the post-reset save to completion with strict turn alternation. Also confirmed
    live in Playwright/Chromium: a screenshot shows the Den's "New Game+" button grayed out
    with a "Reach stage 10..." tooltip on a fresh save, then enabled once `save.record.bestStage`
    reaches 10; clicking it (confirm auto-accepted) shows the Den immediately reading "LEVEL 1 ·
    FIRE · NG+1", "Stage 1 · Verdant Vale", "120g", gear back to all T0, while "best stage 10",
    the "1S 0A 0B 0C" hunt-grade tally, and "🏆 2/6" achievements stayed exactly as before the
    reset, plus a new "♻ 1 NG+" tag; a real page reload (via the `window.storage` shim backed by
    `localStorage`) confirmed `save.prestige` survives a genuine reload, not just an in-memory
    save/load call.

## Tier J — Fourth wave of polish (queue ran dry a fourth time)

*Added 2026-08-07 — Tiers A–I are all shipped and the queue ran dry a fourth time. Same
rules as always: read CLAUDE.md, topmost unchecked, one per run, treat every item as a
direction not a spec. This wave opens with a low-risk documentation catch-up (found while
scanning for stale seams before seeding new mechanics) and leaves two mechanical ideas
queued behind it.*

- [x] **Field Guide catch-up.** The in-game `#mHelp` FIELD GUIDE modal was last touched
  around the gear-depth item (Tier B) — everything shipped since then (element affinity,
  amplifiers 2 and 3, field loot, hunt grading, side hunts, magic stones, the 4th biome,
  Nyx, boss hazards, biome weather, the 3rd skill tier, Ward, the 5th gear line,
  achievements, trials, New Game+) was never added to it. A new player reading the one
  reference the game offers gets a description of roughly a third of the actual game.
  - *Intent:* the Field Guide actually describes the game as it exists today, so a player
    who opens it isn't missing entire systems they can see on screen but can't explain.
  - *Weigh:* this is text-only and touches no combat/turn code, so risk is close to zero —
    the only judgment call is how much to compress vs. how much to cover. Chose coverage:
    one short section per shipped system, reusing the existing `.sec` heading pattern
    rather than inventing new structure, and leaned on `.helpBody`'s existing
    `overflow-y:auto` scroll (already there) instead of trimming older sections to make
    room.
  - *Extend:* the `#mHelp` modal markup, the existing `.sec`/`.helpBody` CSS.
  - *Shipped:* rewrote the `Wind, terrain & obstacles`, `Skills & MP`, `Gear & stats`, and
    `Amplifiers` sections to mention crates, biome weather, the 3rd signature tier, Ward,
    the 5th gear line, and Scope; added three new sections — `Elements` (the six-element
    wheel plus Nyx sitting outside it), `Alpha bosses` (enrage + all six signature
    hazards), and `Beyond the ladder` (hunt grading, Side Hunts, Trials, Achievements, New
    Game+). No JS/combat code touched, no new `save` fields, no new UI chrome beyond text
    in the existing modal.
  - *Done when:* opening the Field Guide from the title screen shows coverage of every
    shipped campaign system by name; harness asserts the modal's markup contains a
    recognizable reference to each major system. **Verified**: harness test 29 reads the
    raw `dragonfire-duel.html` source, extracts the `#mHelp` block, and asserts it mentions
    every major shipped system by name/keyword (Ward, the 5th gear line, Scope, elements/
    Nyx, alpha enrage/hazard names, hunt grading, Side Hunt, Trial, Achievements, New
    Game+) — a regression here means a future feature shipped without a Field Guide update
    getting caught immediately instead of drifting further. `node harness.mjs` is 29/29
    green. Also confirmed live in Playwright/Chromium: opening the Field Guide from the
    title screen's ❓ button shows the new sections in place, scrolling smoothly under the
    existing `.helpBody` scroll container with no layout overflow at 1280px width, and no
    console errors.

- [ ] **A stronger single-dragon Ward signature.** Ward shipped as a shared instant that
  plants the whole reflect-a-hit archetype at once (Tier F's own note flagged this as the
  natural next step: "a future run could... extend the archetype to a second, stronger
  single-dragon signature").
  - *Intent:* one dragon gets a signature-tier version of the counter-attack idea — e.g. a
    ward that also deals damage back, not just reduces what the attacker dealt — so the
    archetype has a build-around payoff beyond the flat shared version.
  - *Weigh:* which dragon (Dusk/Shadow reads thematically closest to a "counter" motif); does
    it replace a `uniq` slot or is it a genuinely new mechanic; must still compose with the
    existing shield-block math in `dealDamage`, not fork it, the same constraint Ward itself
    was built under.
  - *Extend:* `SKILLS`, `DRAGONS[key].uniq`, `dealDamage`'s Ward-reflect path, `WARD_REFLECT_PCT`.
  - *Done when:* the new signature is selectable on its dragon, visibly more punishing than
    plain Ward in battle, and doesn't fork the shield/ward damage math; harness asserts its
    resolved reflect (or bonus effect) exceeds plain Ward's under matching conditions, and a
    bot-vs-bot battle using it stays alternation-strict.

- [ ] **A second-tier enrage for alphas.** The alpha-identity item's own note flagged this:
  "a future run could... add a second-tier enrage if alphas still feel too similar to a
  regular fight once the roster grows" — the roster has since grown from 6 to 7 dragons and
  every alpha now has a signature hazard, but enrage itself is still a single flat +18% jump
  at one HP threshold.
  - *Intent:* a boss that's been fought down to critical HP feels like it's escalating a
    second time, not just sitting at the same enraged state from 40% down to 0.
  - *Weigh:* a second, lower HP threshold (e.g. 15%) that stacks a further attack/aim boost
    on top of the existing enrage, reusing the same one-way-flip pattern `dealDamage` already
    uses for the first threshold rather than a new state machine; keep it deterministic (no
    new `Math.random()` draws) given the documented RNG-stream-shift risk several earlier
    Tier E–I items hit.
  - *Extend:* `dealDamage`'s enrage branch, `ENRAGE_HP_PCT`/`ENRAGE_ATK_MULT`, `aiThink`'s
    enraged-AI behavior, the HUD's 😡 badge/telegraph.
  - *Done when:* an alpha fought below the new second threshold is visibly and mechanically
    more dangerous than a merely-enraged one, telegraphed the same way the first threshold
    is; harness asserts the second tier fires at its threshold and stacks correctly, and a
    bot-vs-bot alpha battle stays alternation-strict through both tiers.

---

*Standing concern, not a task:* difficulty / EXP / gold curve tuning is evaluated
continuously as the ladder grows — adjust it in passing when a feature makes it relevant,
rather than as a checklist item.
