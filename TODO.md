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
  - *Shipped:* new `#den` screen (`goDen`/`refreshDen`) shows the raised dragon (portrait,
    level, EXP bar), the next stage + biome, and gold, with a "Launch Battle" button that
    starts it. Title's "Begin the Hunt" and "Continue" now route here instead of straight
    into `startBattle`; the victory modal's button ("To the Den ▶") does too. Duel mode is
    untouched — `startDuel` never touches the Den. Rough edges for a future pass: no visuals
    beyond text/portrait, and it doesn't yet show the full ladder (that's the next item) or
    a career record (the item after).

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

---

*Standing concern, not a task:* difficulty / EXP / gold curve tuning is evaluated
continuously as the ladder grows — adjust it in passing when a feature makes it relevant,
rather than as a checklist item.
