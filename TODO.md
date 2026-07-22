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

- [ ] **A seventh dragon, off the elemental wheel.** The roster has matched the 6-element
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
  - *Done when:* the dragon is earnable through play (not just always-available), fully
    playable once unlocked (stats, skills, level growth), and confirmed neutral in every
    elemental matchup; harness asserts the unlock condition, that `elRel` resolves neutral
    both directions for its element, and a bot-vs-bot battle with it stays alternation-
    strict.

- [ ] **Boss-only signature hazards.** Alpha identity today is one shared mechanic
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
  - *Done when:* at least one alpha has a hazard visibly distinct from a plain enrage, is
    telegraphed the way enrage already is, and doesn't destabilize the turn loop; harness
    drives a full alpha battle with the new hazard triggered, bot-vs-bot, to completion
    with strict alternation.

- [ ] **Weather as a biome-linked hazard.** Element affinity made the roster's identity
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

## Tier F — Combat depth (new skills, gear, items)

- [ ] **A third signature-skill tier.** The 2nd signature already unlocks at level 4
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
  - *Done when:* a sufficiently leveled dragon has a visibly new skill in its skill list
    that it didn't have at level 4, usable in battle; harness asserts the 3rd skill is
    absent below the gate level and present at/above it, and a bot-vs-bot battle using it
    stays alternation-strict.

- [ ] **A defensive-counter skill archetype.** Every instant today is passive-defensive
  (Heal, Shield) or repositioning (Shadow Step) — nothing punishes an incoming hit.
  - *Intent:* a skill choice that changes how the *opponent* plays their next turn, not
    just how much damage the caster takes or deals.
  - *Weigh:* simplest version — e.g. a ward that reflects a percentage of the next hit
    taken back at the attacker, single use, ends the turn like Shield does. Which dragon(s)
    get it — a shared skill like Heal/Shield, or a signature for one dragon? Must compose
    cleanly with the existing Shield-block math in `dealDamage`, not fork it.
  - *Extend:* `SKILLS` (new instant-type entry), `dealDamage`'s shield-block path,
    `castInstant`.
  - *Done when:* the skill is selectable, visibly changes the outcome of the next incoming
    hit, and ends the turn like other instants; harness asserts the reflected damage lands
    on the original attacker and the turn ends correctly.

- [ ] **A fifth gear line: elemental ward.** `GEAR` covers ATK/DEF/AGI/LUK; nothing lets
  a player build around the affinity system defensively the way stones build around it
  offensively.
  - *Intent:* a gear choice that specifically softens being on the wrong side of a bad
    matchup, giving affinity a defensive answer to go with its offensive one.
  - *Weigh:* flat damage-taken reduction vs a multiplier that specifically dampens
    `ELEM_RES` — keep it distinct from `talon`'s crit-adjacent LUK so it doesn't feel like
    a reskin. 3 tiers, matching the existing gear shape.
  - *Extend:* `GEAR`, the stat application in the `Dragon` constructor, `elMult`'s
    application inside `dealDamage`, the Den loadout row from Tier B.
  - *Done when:* the gear is buyable, equipped, visible in the Den loadout, and measurably
    reduces resolved damage from an unfavorable matchup; harness asserts the resolved
    damage delta with/without it equipped and that it persists across save/load.

- [ ] **A third battle amplifier: Scope.** Calm Wind and Overcharge (Tier D) proved the
  pattern; a third amplifier gives the player a real choice of which one to carry.
  - *Intent:* an amplifier that plays against information rather than raw power — e.g.
    reveals the exact wind value for the next two turns (a direct counter to the weather
    hazard above, if it ships first, or just to natural wind variance otherwise).
  - *Weigh:* keep it in the existing `B.usedItem`/one-per-turn/cap-of-2 shape exactly;
    price it relative to Calm Wind/Overcharge (120g/160g) based on how strong "certainty"
    turns out to be in practice.
  - *Extend:* `save.amps`, `useAmp`, the `itemCtl` dock, the shop modal's amplifier rows.
  - *Done when:* the item is buyable up to its cap, usable without ending the turn, and
    its effect is visible and verifiable in the aim UI; harness asserts the purchase cap,
    save/load round-trip, and that using it doesn't end the turn.

## Tier G — Meta & stakes (reasons to keep playing)

- [ ] **Achievement / milestone track.** `save.record` already tracks wins, grades,
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
  - *Done when:* at least 3 achievements exist, are visible, and pay out exactly once each
    when earned, surviving save/load; harness asserts an achievement fires on the
    triggering condition and does not re-fire on a second identical win.

- [ ] **Trial stages — modifier battles.** Side hunts (Tier D) proved the off-ladder-battle
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
  - *Done when:* the player can launch a trial, the constraint is visibly enforced in
    battle, and a win pays out more than an equivalent plain side hunt; harness asserts the
    constraint holds during a bot-vs-bot trial battle and that it still terminates with
    strict alternation.

---

*Standing concern, not a task:* difficulty / EXP / gold curve tuning is evaluated
continuously as the ladder grows — adjust it in passing when a feature makes it relevant,
rather than as a checklist item.
