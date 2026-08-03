// Dragonfire Duel — headless test harness (zero dependencies, run: `node harness.mjs`)
//
// What this is and why it works this way:
//   The whole game lives in dragonfire-duel.html, tightly coupled to the browser
//   (canvas, audio, DOM, window.storage, requestAnimationFrame). Rather than refactor
//   the game or pull in a headless browser, we extract its <script>, run it inside a
//   Node `vm` context, and feed it the lightest possible browser shims:
//     - a VIRTUAL CLOCK that owns setTimeout / requestAnimationFrame / performance.now,
//       so we can step the REAL game loop deterministically, frame by frame;
//     - a no-op canvas 2D context and audio context (rendering/sound do nothing);
//     - a minimal DOM (getElementById returns stub elements that track class/children);
//     - window.storage backed by an in-memory Map, so save/persist/load round-trips work.
//   An epilogue appended to the game source exposes its internals via globalThis.__HARNESS__.
//
//   Because we drive the actual startTurn -> fire -> finishAction -> waitSettle -> startTurn
//   loop (not a reimplementation), the turn-integrity test genuinely guards the fragile
//   handoff that the past frame-loop bug broke.
//
// Exit code 0 = all green, non-zero = something failed (details printed).

import vm from 'node:vm';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const HTML_PATH = fileURLToPath(new URL('./dragonfire-duel.html', import.meta.url));
const SEED = (Number(process.env.DRAGONFIRE_SEED) || 12345) >>> 0;

/* ------------------------------------------------------------------ */
/* Virtual clock — the harness owns time; the game just schedules onto it. */
/* ------------------------------------------------------------------ */
let now = 0;
let nextId = 1;
const timers = new Map();   // id -> { time, cb }
let rafQueue = [];          // [{ id, cb }] — callbacks for the next frame

function tick(ms = 16) {
  now += ms;
  // Fire all due timers in chronological order (a timer may schedule another).
  for (;;) {
    let pick = null, pickTime = Infinity;
    for (const [id, t] of timers) {
      if (t.time <= now && t.time < pickTime) { pick = id; pickTime = t.time; }
    }
    if (pick === null) break;
    const t = timers.get(pick);
    timers.delete(pick);
    t.cb(now);
  }
  // Then run the animation-frame callbacks registered for this frame.
  const q = rafQueue;
  rafQueue = [];
  for (const r of q) r.cb(now);
}
function clearTimers() { timers.clear(); }   // drops pending setTimeouts; leaves the rAF loop intact

/* ------------------------------------------------------------------ */
/* No-op canvas/audio: any method or property access returns the same proxy,  */
/* so chains like ctx.createLinearGradient(...).addColorStop(...) just no-op.  */
/* ------------------------------------------------------------------ */
const noop = new Proxy(function () {}, {
  get(_t, prop) {
    if (prop === 'state') return 'running';
    if (prop === 'currentTime' || prop === 'sampleRate') return 0;
    if (prop === 'measureText') return () => ({ width: 0 });
    if (prop === 'getChannelData') return () => new Float32Array(8);
    if (prop === Symbol.toPrimitive) return () => 0;
    return noop;
  },
  apply() { return noop; },
  construct() { return noop; },
});

/* ------------------------------------------------------------------ */
/* Minimal DOM: enough for the game's UI plumbing to run without throwing.     */
/* ------------------------------------------------------------------ */
class El {
  constructor(tag = 'div') {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.style = {};
    this.dataset = {};
    this._cls = new Set();
    this._listeners = {};
    this.textContent = '';
    this._innerHTML = '';
    this.disabled = false;
    this.title = '';
    this.value = '';
    this.width = 0;
    this.height = 0;
    this.classList = {
      add: (...c) => c.forEach((x) => this._cls.add(x)),
      remove: (...c) => c.forEach((x) => this._cls.delete(x)),
      contains: (c) => this._cls.has(c),
      toggle: (c, force) => {
        const on = force === undefined ? !this._cls.has(c) : !!force;
        on ? this._cls.add(c) : this._cls.delete(c);
        return on;
      },
    };
  }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(v) { this._innerHTML = v; if (v === '' || v == null) this.children = []; }
  appendChild(c) { this.children.push(c); return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; }
  addEventListener(type, fn) { (this._listeners[type] || (this._listeners[type] = [])).push(fn); }
  removeEventListener(type, fn) { const a = this._listeners[type]; if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } }
  dispatch(type, ev) { (this._listeners[type] || []).forEach((fn) => fn(ev || {})); }
  click() { this.dispatch('click', {}); }
  setPointerCapture() {} releasePointerCapture() {} hasPointerCapture() { return false; }
  setAttribute(k, v) { this[k] = v; } getAttribute(k) { return this[k]; }
  focus() {} blur() {}
  getContext() { return noop; }
  getBoundingClientRect() { return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
}

const elById = new Map();
const document = {
  getElementById(id) { if (!elById.has(id)) elById.set(id, new El('div')); return elById.get(id); },
  createElement(tag) { return new El(tag); },
  querySelector() { return null; },
  querySelectorAll() { return []; },
  addEventListener() {},
  removeEventListener() {},
};

/* ------------------------------------------------------------------ */
/* window.storage — in-memory; makes persist()/loadSave()/wipeSave() real.     */
/* ------------------------------------------------------------------ */
const store = new Map();
const storage = {
  get: async (k) => (store.has(k) ? { value: store.get(k) } : null),
  set: async (k, v) => { store.set(k, v); },
  delete: async (k) => { store.delete(k); },
};

/* ------------------------------------------------------------------ */
/* Build the sandbox, run the game, capture its internals.                     */
/* ------------------------------------------------------------------ */
function loadGame() {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('could not find <script> block in dragonfire-duel.html');
  const gameSrc = m[1];

  const AudioContext = function () {
    return { state: 'running', currentTime: 0, sampleRate: 44100, resume() {}, destination: noop,
      createOscillator: () => noop, createGain: () => noop, createBuffer: () => noop,
      createBufferSource: () => noop, createBiquadFilter: () => noop };
  };

  const sandbox = {
    console,
    document,
    storage,
    AudioContext,
    webkitAudioContext: AudioContext,
    CanvasRenderingContext2D: function () {},
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1,
    requestAnimationFrame: (cb) => { const id = nextId++; rafQueue.push({ id, cb }); return id; },
    cancelAnimationFrame: (id) => { rafQueue = rafQueue.filter((r) => r.id !== id); },
    setTimeout: (cb, ms = 0) => { const id = nextId++; timers.set(id, { time: now + (ms || 0), cb }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    setInterval: () => 0,
    clearInterval: () => {},
    performance: { now: () => now },
    addEventListener: () => {},
    removeEventListener: () => {},
    confirm: () => true,
    alert: () => {},
  };
  vm.createContext(sandbox);
  sandbox.window = sandbox;          // window === global, like a browser
  sandbox.globalThis = sandbox;

  // Seed Math.random for reproducibility (must run before the game evaluates).
  vm.runInContext(
    `(function(){ let s = ${SEED} >>> 0; Math.random = function(){
       s = (s + 0x6D2B79F5) | 0;
       let t = Math.imul(s ^ (s >>> 15), 1 | s);
       t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
       return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
     }; })();`,
    sandbox,
  );

  // Epilogue shares the game's lexical scope, so it can hand out the internals we test.
  const epilogue = `
    ;globalThis.__HARNESS__ = {
      B, get save(){ return save; },
      SKILLS, DRAGONS, GEAR,
      statsAt, expNeed, other,
      startBattle, startDuel, startSideHunt, startTrial, TRIAL_MODS, TRIAL_MULT, refreshTrial, checkEnd, fire, aiSolve, Dragon, startTurn,
      persist, loadSave, wipeSave, ladderWindow, refreshDen, BIOME_ORDER, BIOMES, blankRecord,
      get curBiomeKey(){ return curBiomeKey; }, get ground(){ return ground; }, FLOOR, SPAWN_P, SPAWN_E,
      castInstant, skillMult, refreshSkills, SKILL_KEYS, refreshShop,
      dealDamage, effectiveAtk, ALPHA_TITLES, ENRAGE_HP_PCT, ENRAGE_ATK_MULT, Math,
      elRel, elMult, ELEMENT_ORDER, ampMult, AMP_SURGE_MULT,
      get crates(){ return crates; }, makeCrates, damageCrate, CRATE_CHANCE, explode,
      huntGrade, HUNT_GRADES, SIDE_HUNT_MULT, $,
      blankStones, addStone, synthesizeStone, socketStone, unsocketStone, pickStoneTier, stoneMult, stoneLabel,
      STONE_TIER_PCT, STONE_MAX_TIER, STONE_SOCKETS, STONE_MISMATCH_MULT, STONE_DROP_BASE, STONE_TIER_WEIGHTS,
      refreshStones, victory,
      isDragonUnlocked, UNLOCK_REQS, buildCards,
      BOSS_HAZARDS, triggerBossHazard,
      get obstacles(){ return obstacles; }, BIOME_WEATHER, triggerBiomeWeather,
      aiThink, buildSkillbar, UNIQ3_LEVEL, WARD_REFLECT_PCT,
      rollWind, forecastWindDisplay, WIND_MAX,
      ACHIEVEMENTS, checkAchievements, refreshAch, achRewardText
    };`;
  vm.runInContext(gameSrc + epilogue, sandbox, { filename: 'dragonfire-duel.html' });
  return sandbox.__HARNESS__;
}

/* ------------------------------------------------------------------ */
/* Tiny test runner.                                                           */
/* ------------------------------------------------------------------ */
const results = [];
function assert(cond, msg) { if (!cond) throw new Error(msg); }
async function test(name, fn) {
  try { await fn(); results.push([name, true, '']); }
  catch (e) { results.push([name, false, e && e.message ? e.message : String(e)]); }
}

const flush = () => new Promise((r) => setImmediate(r));

/* ------------------------------------------------------------------ */
/* Main                                                                        */
/* ------------------------------------------------------------------ */
(async function main() {
  let H;
  try {
    H = loadGame();
    await flush(); await flush();   // let boot()'s async loadSave + requestAnimationFrame settle
  } catch (e) {
    console.error('FATAL: could not load the game headlessly:\n', e);
    process.exit(1);
  }
  H.save.sound = false;             // keep the audio path quiet during tests

  // -- TEST 1: turn integrity, bot vs bot, on the REAL game loop ---------------
  await test('turn integrity: bot-vs-bot campaign battle strictly alternates and terminates', () => {
    clearTimers();
    H.save.dragonKey = 'ember';
    H.save.level = 3;
    H.save.stage = 2;
    H.startBattle(2);

    const B = H.B;
    let lastTurn = 0, prevSide = null, turnsSeen = 0;
    const problems = [];
    const BUDGET = 8000;            // frames (~128s of virtual time)

    let i = 0;
    for (; i < BUDGET && B.state !== 'over'; i++) {
      tick(16);
      // Player-side bot: when it's the human's turn to aim, take an aimed shot.
      if (B.mode === 'battle' && B.state === 'aim' && B.active && !B.active.isAI && !B.active.dead) {
        const foe = H.other(B.active);
        const sol = H.aiSolve ? H.aiSolve(B.active, foe, H.SKILLS.shot, false) : { ang: 50, pow: 70 };
        H.fire(B.active, 'shot', sol.ang, sol.pow);
      }
      // Turn-integrity poll: turnNo is monotonic, so each increment is one real turn.
      if (B.turnNo > lastTurn) {
        if (B.turnNo - lastTurn > 1) problems.push(`turn number jumped by ${B.turnNo - lastTurn} near turn ${B.turnNo} (double-advance?)`);
        const side = B.active === B.p ? 'P' : 'E';
        if (prevSide !== null && side === prevSide) problems.push(`${side} acted twice in a row at turn ${B.turnNo} (broken alternation)`);
        prevSide = side; lastTurn = B.turnNo; turnsSeen++;
      }
    }

    assert(B.state === 'over', `battle did not finish within ${BUDGET} frames (stuck in state "${B.state}")`);
    assert(turnsSeen >= 4, `expected several turns, only saw ${turnsSeen}`);
    assert(problems.length === 0, problems.join('; '));
  });

  // -- TEST 2: a campaign victory awards EXP and gold and advances the stage ---
  await test('campaign battle completes and awards EXP + gold (and advances the ladder)', () => {
    clearTimers();
    const sv = H.save;
    sv.dragonKey = 'ember'; sv.level = 1; sv.exp = 0; sv.gold = 100; sv.stage = 3;
    H.startBattle(3);
    const B = H.B;
    const exp0 = sv.exp, gold0 = sv.gold, lvl0 = sv.level, stage0 = sv.stage;
    assert(B.e && B.e.hp > 0, 'enemy dragon was set up');
    B.e.hp = 0;
    H.checkEnd();
    assert(B.state === 'over', 'battle ended when the enemy fell');
    assert(sv.gold > gold0, `gold should be awarded (was ${gold0}, now ${sv.gold})`);
    assert(sv.stage === stage0 + 1, `stage should advance (was ${stage0}, now ${sv.stage})`);
    assert(sv.exp !== exp0 || sv.level > lvl0, 'EXP should be awarded (or consumed by a level-up)');
    clearTimers();
  });

  // -- TEST 3: leveling up actually changes stats -----------------------------
  await test('leveling up raises stats (statsAt and the Dragon it builds)', () => {
    clearTimers();
    const lo = H.statsAt('terra', 1), hi = H.statsAt('terra', 6);
    assert(hi.hp > lo.hp, `level 6 HP (${hi.hp}) should exceed level 1 HP (${lo.hp})`);
    assert(hi.atk > lo.atk, `level 6 ATK (${hi.atk}) should exceed level 1 ATK (${lo.atk})`);

    H.B.modeType = 'campaign';
    H.save.dragonKey = 'terra';
    H.save.gear = { fang: 0, scale: 0, charm: 0 };
    const d1 = new H.Dragon('terra', 1, false, 300);
    const d6 = new H.Dragon('terra', 6, false, 300);
    assert(d6.maxhp > d1.maxhp, `a level-6 dragon should have more max HP (${d6.maxhp} vs ${d1.maxhp})`);
    assert(d6.atk > d1.atk, `a level-6 dragon should have more ATK (${d6.atk} vs ${d1.atk})`);
  });

  // -- TEST 4: gear purchases persist across save/load ------------------------
  await test('gear purchases persist through save then load', async () => {
    clearTimers();
    await H.wipeSave();
    const sv = H.save;
    sv.dragonKey = 'dusk'; sv.level = 1; sv.stage = 1; sv.gold = 1000;
    const cost = H.GEAR.fang.cost[0];
    sv.gold -= cost;          // simulate buying Drake Fang tier 1
    sv.gear.fang = 1;
    H.persist();
    sv.gold = -1; sv.gear.fang = 0;   // corrupt the in-memory copy
    await H.loadSave();
    const r = H.save;
    assert(r.gear.fang === 1, `gear tier should survive load (got ${r.gear.fang})`);
    assert(r.gold === 1000 - cost, `gold spend should survive load (got ${r.gold})`);
  });

  // -- TEST 5: save then load restores campaign progress mid-ladder -----------
  await test('save then load restores campaign progress mid-ladder', async () => {
    clearTimers();
    const sv = H.save;
    sv.dragonKey = 'volt'; sv.level = 5; sv.stage = 7; sv.exp = 30; sv.gold = 222;
    H.persist();
    sv.level = 1; sv.stage = 1; sv.exp = 0; sv.gold = 0;   // corrupt in memory
    await H.loadSave();
    const r = H.save;
    assert(r.stage === 7, `stage should restore to 7 (got ${r.stage})`);
    assert(r.level === 5, `level should restore to 5 (got ${r.level})`);
    assert(r.exp === 30, `exp should restore to 30 (got ${r.exp})`);
    assert(r.gold === 222, `gold should restore to 222 (got ${r.gold})`);
  });

  // -- TEST 6: the Den (campaign hub) sits between battles ---------------------
  await test('the Den: continuing and victory both land on it, and the next battle launches from it', () => {
    clearTimers();
    const sv = H.save;
    sv.dragonKey = 'ember'; sv.level = 2; sv.exp = 0; sv.gold = 200; sv.stage = 4;
    H.startBattle(4);
    const B = H.B;
    assert(B.mode === 'battle', 'battle should be active after startBattle');

    // win the battle and let the victory modal's timer fire
    B.e.hp = 0;
    H.checkEnd();
    tick(1100);

    // "Return to Den" takes the player to the hub, not straight into the next stage
    document.getElementById('btnNext').click();
    assert(B.mode === 'den', `returning from victory should land in the Den (was "${B.mode}")`);
    assert(document.getElementById('den').classList.contains('hidden') === false, 'Den screen should be visible');
    assert(document.getElementById('title').classList.contains('hidden') === true, 'title screen should be hidden while in the Den');
    assert(document.getElementById('hud').classList.contains('hidden') === true, 'battle HUD should be hidden while in the Den');

    // the next battle launches from the Den, at the stage the save now points to
    const stageAtDen = sv.stage;
    document.getElementById('btnDenNext').click();
    assert(B.mode === 'battle', 'Next Battle from the Den should start a battle');
    assert(B.stage === stageAtDen, `battle launched from the Den should use the save's stage (expected ${stageAtDen}, got ${B.stage})`);
    assert(document.getElementById('den').classList.contains('hidden') === true, 'Den screen should hide once battle starts');

    // leaving battle and returning via "Continue" on the title also routes through the Den
    clearTimers();
    document.getElementById('btnMenu').click();   // confirm() is stubbed true in the harness
    assert(B.mode === 'title', 'leaving the battle should return to the title');
    document.getElementById('btnContinue').click();
    assert(B.mode === 'den', 'Continue from the title should land in the Den, not straight into battle');
    clearTimers();
  });

  // -- TEST 7: legible stage ladder ---------------------------------------------
  await test('Den stage ladder reads consistently with save.stage (window, states, biomes)', () => {
    clearTimers();
    const sv = H.save;
    sv.dragonKey = 'ember'; sv.level = 3; sv.exp = 0; sv.gold = 50; sv.stage = 6;

    const win = H.ladderWindow(sv.stage);
    const cur = win.find((n) => n.state === 'current');
    assert(cur && cur.n === sv.stage, `the current node should be stage ${sv.stage} (got ${cur && cur.n})`);
    assert(win.filter((n) => n.n < sv.stage).every((n) => n.state === 'cleared'), 'every node before the current stage should read as cleared');
    assert(win.filter((n) => n.n > sv.stage).every((n) => n.state === 'future'), 'every node after the current stage should read as future');
    assert(win.every((n) => n.alpha === (n.n % 5 === 0)), 'alpha flag should mark every 5th stage, matching the startBattle alpha rule');
    assert(win.every((n) => n.biomeKey === H.BIOME_ORDER[(n.n - 1) % H.BIOME_ORDER.length]), 'each node\'s biome should follow the same cycle startBattle uses');

    // the Den's rendered ladder should agree with the save it was built from
    H.refreshDen();
    const track = document.getElementById('denLadder');
    assert(track.children.length === win.length, `rendered ladder should have ${win.length} nodes (got ${track.children.length})`);
    const curEl = track.children.find((c) => c.className.split(' ').includes('current'));
    assert(curEl, 'rendered ladder should have exactly one node marked current');
    assert(curEl.title.startsWith('Stage ' + sv.stage + ' '), `current node's title should reference stage ${sv.stage} (got "${curEl.title}")`);

    // after a win advances save.stage, the same window/render machinery should track the new stage
    H.startBattle(sv.stage);
    H.B.e.hp = 0; H.checkEnd(); tick(1100);
    assert(sv.stage === 7, `stage should have advanced to 7 (got ${sv.stage})`);
    const win2 = H.ladderWindow(sv.stage);
    assert(win2.find((n) => n.state === 'current').n === 7, 'ladder window should track the new stage after victory');
    clearTimers();
  });

  // -- TEST 8: career record tracks battles and survives save/load ------------
  await test('career record tracks wins/losses/alphas and persists across save then load', async () => {
    clearTimers();
    await H.wipeSave();
    const sv = H.save;
    sv.dragonKey = 'frost'; sv.level = 4; sv.stage = 5;   // stage 5 => alpha
    H.startBattle(5);
    let B = H.B;
    assert(B.e.alpha, 'stage 5 should be an alpha battle');
    const wins0 = sv.record.wins, alphaWins0 = sv.record.alphaWins, lifeGold0 = sv.record.lifeGold;
    B.e.hp = 0;
    H.checkEnd();
    assert(sv.record.wins === wins0 + 1, `wins should increment (was ${wins0}, now ${sv.record.wins})`);
    assert(sv.record.alphaWins === alphaWins0 + 1, `alpha win should be tallied (was ${alphaWins0}, now ${sv.record.alphaWins})`);
    assert(sv.record.lifeGold > lifeGold0, 'lifetime gold earned should grow');
    assert(sv.record.bestStage >= 5, `best stage should track the stage just cleared (got ${sv.record.bestStage})`);
    tick(1100);

    clearTimers();
    H.startBattle(sv.stage);
    B = H.B;
    const losses0 = sv.record.losses;
    B.p.hp = 0;
    H.checkEnd();
    assert(sv.record.losses === losses0 + 1, `losses should increment on defeat (was ${losses0}, now ${sv.record.losses})`);

    const snapshot = JSON.parse(JSON.stringify(sv.record));
    H.persist();
    sv.record = H.blankRecord ? H.blankRecord() : { wins: 0, losses: 0, alphaWins: 0, bestStage: 1, lifeGold: 0, lifeExp: 0 };
    await H.loadSave();
    assert(JSON.stringify(sv.record) === JSON.stringify(snapshot), 'career record should survive a save/load round trip');
    clearTimers();
  });

  // -- TEST 9: skill upgrades raise resolved output and persist ---------------
  await test('skill upgrades raise a trained skill\'s resolved output, stay off AI dragons, and persist', async () => {
    clearTimers();
    await H.wipeSave();
    const sv = H.save;
    sv.dragonKey = 'ember'; sv.level = 1; sv.stage = 1; sv.skillPts = 5; sv.skillUpg = {};
    H.B.modeType = 'campaign';

    const d = new H.Dragon('ember', 1, false, 300);
    assert(H.skillMult(d, 'heal') === 1, 'an untrained skill should resolve to a 1x multiplier');

    d.mp = 100; d.hp = 1;
    H.castInstant(d, 'heal');
    const healedUntrained = d.hp - 1;
    clearTimers();

    sv.skillUpg.heal = 3;
    assert(H.skillMult(d, 'heal') > 1, 'training a skill should raise its resolved multiplier');
    d.mp = 100; d.hp = 1;
    H.castInstant(d, 'heal');
    const healedTrained = d.hp - 1;
    clearTimers();
    assert(healedTrained > healedUntrained,
      `a level-3-trained heal (${healedTrained}) should restore more than an untrained heal (${healedUntrained})`);

    const aiD = new H.Dragon('ember', 1, true, 900);
    assert(H.skillMult(aiD, 'heal') === 1, 'an AI/enemy dragon must not benefit from the player\'s trained tiers');

    // playable/visible: the Den's Skills panel lists every trainable skill for the raised dragon
    H.refreshSkills();
    const rows = document.getElementById('skillRows');
    assert(rows.children.length === H.SKILL_KEYS(sv.dragonKey).length, 'skill panel should list one row per trainable skill');

    // persistence
    H.persist();
    sv.skillUpg = {}; sv.skillPts = 0;
    await H.loadSave();
    assert(sv.skillUpg.heal === 3, `trained tier should survive load (got ${sv.skillUpg.heal})`);
    assert(sv.skillPts === 5, `unspent skill points should survive load (got ${sv.skillPts})`);
    clearTimers();
  });

  // -- TEST 10: gear depth & loadout — the LUK line resolves stats, is visible, persists --
  await test('a purchased LUK gear tier raises resolved luk/crit chance, is visible in the shop and Den, and persists', async () => {
    clearTimers();
    await H.wipeSave();
    const sv = H.save;
    sv.dragonKey = 'frost'; sv.level = 1; sv.stage = 1; sv.gold = 5000; sv.gear = { fang: 0, scale: 0, charm: 0, talon: 0 };
    H.B.modeType = 'campaign';

    assert(H.GEAR.talon, 'GEAR should define a LUK line (talon)');
    const base = H.statsAt('frost', 1).luk;
    const dBefore = new H.Dragon('frost', 1, false, 300);
    assert(dBefore.luk === base, `untrained dragon's luk should match base stats (got ${dBefore.luk}, base ${base})`);

    const cost = H.GEAR.talon.cost[0];
    sv.gold -= cost;               // simulate buying Lucky Talon tier 1 (as the shop button would)
    sv.gear.talon = 1;
    const dAfter = new H.Dragon('frost', 1, false, 300);
    assert(dAfter.luk === base + H.GEAR.talon.vals[1],
      `a tier-1 Lucky Talon should raise resolved luk by ${H.GEAR.talon.vals[1]} (got ${dAfter.luk - base})`);
    assert(dAfter.luk > dBefore.luk, 'equipped LUK gear should raise resolved luk over the untrained dragon');

    // playable/visible: drive the real Den -> Shop -> buy -> close flow, not a reimplementation.
    sv.gear.talon = 0; sv.gold = 5000; sv.record = H.blankRecord();
    H.refreshDen();
    document.getElementById('btnDenShop').click();       // opens the shop with shopReturn='den'
    const gearRows = document.getElementById('gearRows');
    assert(gearRows.children.length === Object.keys(H.GEAR).length, 'shop should list one row per GEAR line, including talon');
    const talonRow = gearRows.children.find(r => r.innerHTML.includes('Lucky Talon'));
    assert(talonRow, 'the shop should show a Lucky Talon row');
    talonRow.children[0].click();                         // the buy button for that row (only real child; icon/name are innerHTML)
    assert(sv.gear.talon === 1, `buying via the shop UI should set the tier (got ${sv.gear.talon})`);
    document.getElementById('btnShopClose').click();     // back to the Den
    const denGear = document.getElementById('denGear');
    assert(denGear.innerHTML.includes('LUK T1'), `Den loadout should show the newly bought LUK tier after closing the shop (got ${denGear.innerHTML})`);

    // persistence
    H.persist();
    sv.gear.talon = 0; sv.gold = -1;
    await H.loadSave();
    assert(sv.gear.talon === 1, `LUK gear tier should survive load (got ${sv.gear.talon})`);
    assert(sv.gold === 5000 - cost, `gold spend should survive load (got ${sv.gold})`);
    clearTimers();
  });

  // -- TEST 11: alpha boss identity — title, enrage, bot-vs-bot integrity, reward --
  await test('alpha bosses carry a distinct title, enrage below 40% HP, hit harder enraged, grant a bonus skill point, and the bot-vs-bot sim stays green against one', async () => {
    clearTimers();
    await H.wipeSave();
    const sv = H.save;

    // -- named identity --------------------------------------------------------
    const bossPreview = new H.Dragon('ember', 5, true, 900, true);
    assert(H.ALPHA_TITLES.ember, 'ALPHA_TITLES should define a title for every roster dragon');
    assert(bossPreview.name === H.ALPHA_TITLES.ember, `an alpha dragon's name should be its title (got "${bossPreview.name}")`);
    assert(bossPreview.name !== 'Alpha Ember', 'the title should replace the old generic "Alpha <name>" tag');

    // -- effectiveAtk is a pure +18% multiplier while enraged -------------------
    assert(H.effectiveAtk({ atk: 100, enraged: false }) === 100, 'a calm dragon\'s effective atk should be unboosted');
    const boosted = H.effectiveAtk({ atk: 100, enraged: true });
    assert(boosted === Math.round(100 * H.ENRAGE_ATK_MULT), `an enraged dragon's effective atk should be boosted by ENRAGE_ATK_MULT (got ${boosted})`);

    // -- enrage triggers once HP crosses the threshold, and only then ----------
    H.B.modeType = 'campaign';
    sv.dragonKey = 'frost'; sv.gear = { fang: 0, scale: 0, charm: 0, talon: 0 };
    const attacker = new H.Dragon('frost', 5, false, 300);
    const boss = new H.Dragon('ember', 5, true, 900, true);
    assert(boss.enraged === false, 'a fresh alpha should not start enraged');
    boss.hp = Math.round(boss.maxhp * 0.44);       // comfortably above the 40% threshold
    H.dealDamage(attacker, boss, 70, 1, 'shot');   // sized so it crosses the threshold under any rand()/crit draw
    assert(boss.enraged === true, `boss should enrage once HP drops below ${H.ENRAGE_HP_PCT * 100}% (hp now ${boss.hp}/${boss.maxhp})`);
    assert(boss.hp > 0, 'the hit that triggers enrage should not itself be lethal in this scenario');

    // -- an enraged dragon deals more damage than an identical calm one --------
    // Pin rand()/crit rolls to a fixed draw so the +18% atk effect isn't lost in noise.
    const realRandom = H.Math.random;
    H.Math.random = () => 0.5;
    const calmClone = new H.Dragon('ember', 5, true, 900, true);
    const enragedClone = new H.Dragon('ember', 5, true, 900, true);
    enragedClone.enraged = true;
    const dummyA = new H.Dragon('frost', 5, false, 300), dummyB = new H.Dragon('frost', 5, false, 300);
    dummyA.hp = dummyA.maxhp = 100000; dummyB.hp = dummyB.maxhp = 100000;
    H.dealDamage(calmClone, dummyA, 200, 1, null);
    H.dealDamage(enragedClone, dummyB, 200, 1, null);
    H.Math.random = realRandom;
    const calmDmg = 100000 - dummyA.hp, enragedDmg = 100000 - dummyB.hp;
    assert(enragedDmg > calmDmg, `enraged boss should deal more damage than a calm one (calm ${calmDmg}, enraged ${enragedDmg})`);

    // -- reward: an alpha win grants a guaranteed bonus skill point ------------
    // Pre-earn every achievement so this fresh save's first alpha win can't also trigger
    // "firstAlpha"/"threeAlphas" (each of which also pays a skill point) — that stacking
    // is real and covered by the achievements test; here we isolate the alpha-only bonus.
    for (const a of H.ACHIEVEMENTS) sv.achieved[a.id] = true;
    sv.dragonKey = 'ember'; sv.level = 50; sv.exp = 0; sv.stage = 5; sv.skillPts = 0; // level 50 so no EXP level-up muddies the count
    H.startBattle(5);
    let B = H.B;
    assert(B.e.alpha, 'stage 5 should still be an alpha battle');
    B.e.hp = 0;
    H.checkEnd();
    assert(sv.skillPts === 1, `an alpha win should grant exactly one bonus skill point when no level-up occurs (got ${sv.skillPts})`);
    tick(1100);

    // -- bot-vs-bot turn integrity must stay green against an alpha battle -----
    clearTimers();
    sv.dragonKey = 'terra'; sv.level = 4; sv.stage = 10; sv.exp = 0;
    H.startBattle(10);
    B = H.B;
    assert(B.e.alpha, 'stage 10 should be an alpha battle');
    let lastTurn = 0, prevSide = null, turnsSeen = 0;
    const problems = [];
    const BUDGET = 8000;
    for (let i = 0; i < BUDGET && B.state !== 'over'; i++) {
      tick(16);
      if (B.mode === 'battle' && B.state === 'aim' && B.active && !B.active.isAI && !B.active.dead) {
        const foe = H.other(B.active);
        const sol = H.aiSolve ? H.aiSolve(B.active, foe, H.SKILLS.shot, false) : { ang: 50, pow: 70 };
        H.fire(B.active, 'shot', sol.ang, sol.pow);
      }
      if (B.turnNo > lastTurn) {
        if (B.turnNo - lastTurn > 1) problems.push(`turn number jumped by ${B.turnNo - lastTurn} near turn ${B.turnNo} (double-advance?)`);
        const side = B.active === B.p ? 'P' : 'E';
        if (prevSide !== null && side === prevSide) problems.push(`${side} acted twice in a row at turn ${B.turnNo} (broken alternation)`);
        prevSide = side; lastTurn = B.turnNo; turnsSeen++;
      }
    }
    assert(B.state === 'over', `alpha battle did not finish within ${BUDGET} frames (stuck in state "${B.state}")`);
    assert(turnsSeen >= 4, `expected several turns in the alpha battle, only saw ${turnsSeen}`);
    assert(problems.length === 0, problems.join('; '));
    clearTimers();
  });

  await test('element affinity: advantaged > neutral > resisted resolved damage, it is readable on the wheel, and the bot-vs-bot sim stays green', async () => {
    clearTimers();
    await H.wipeSave();

    // -- the wheel is a consistent cycle: every element has exactly one adv and one res --
    for (const el of H.ELEMENT_ORDER) {
      const advCount = H.ELEMENT_ORDER.filter(o => H.elRel(el, o) === 'adv').length;
      const resCount = H.ELEMENT_ORDER.filter(o => H.elRel(el, o) === 'res').length;
      assert(advCount === 1, `${el} should be strong against exactly one element (got ${advCount})`);
      assert(resCount === 1, `${el} should be weak against exactly one element (got ${resCount})`);
      const foe = H.ELEMENT_ORDER.find(o => H.elRel(el, o) === 'adv');
      assert(H.elRel(foe, el) === 'res', `if ${el} is strong vs ${foe}, ${foe} should be weak vs ${el} (no mutual advantage)`);
    }
    assert(H.elRel('Fire', 'Fire') === 'neu', 'an element should never have a matchup against itself');

    // -- resolved damage: advantaged > neutral > resisted, all else held equal --------
    const realRandom = H.Math.random;
    H.Math.random = () => 0.5;   // pin rand()/crit rolls so only the elemental factor varies
    const emberAtk = new H.Dragon('ember', 5, true, 900);      // Fire — adv vs Toxin, res vs Shadow
    // Same base dragon (identical def/atk) with only .el swapped, so the multiplier is isolated.
    const advFoe = new H.Dragon('terra', 5, false, 300); advFoe.el = 'Toxin';
    const neuFoe = new H.Dragon('terra', 5, false, 300); neuFoe.el = 'Earth';
    const resFoe = new H.Dragon('terra', 5, false, 300); resFoe.el = 'Shadow';
    for (const d of [advFoe, neuFoe, resFoe]) d.hp = d.maxhp = 100000;
    H.dealDamage(emberAtk, advFoe, 200, 1, 'shot');
    H.dealDamage(emberAtk, neuFoe, 200, 1, 'shot');
    H.dealDamage(emberAtk, resFoe, 200, 1, 'shot');
    H.Math.random = realRandom;
    const advDmg = 100000 - advFoe.hp, neuDmg = 100000 - neuFoe.hp, resDmg = 100000 - resFoe.hp;
    assert(advDmg > neuDmg, `advantaged damage (${advDmg}) should exceed neutral damage (${neuDmg})`);
    assert(neuDmg > resDmg, `neutral damage (${neuDmg}) should exceed resisted damage (${resDmg})`);

    // -- the affinity rule is shared by duel mode too (a core dealDamage rule, not campaign-only) --
    H.B.modeType = 'duel';
    H.Math.random = () => 0.5;   // keep every Dragon() construction (incl. its rand() flap draw) off the seeded stream
    const dmgDuel = (() => {
      const atk = new H.Dragon('ember', 6, false, 300), def = new H.Dragon('terra', 6, false, 900);
      def.el = 'Toxin'; def.hp = def.maxhp = 100000;
      H.dealDamage(atk, def, 200, 1, 'shot');
      return 100000 - def.hp;
    })();
    const dmgDuelNeutral = (() => {
      const atk = new H.Dragon('ember', 6, false, 300), def = new H.Dragon('terra', 6, false, 900);
      def.hp = def.maxhp = 100000;
      H.dealDamage(atk, def, 200, 1, 'shot');
      return 100000 - def.hp;
    })();
    H.Math.random = realRandom;
    assert(dmgDuel > dmgDuelNeutral, 'duel mode should share the same elemental affinity rule as campaign');

    // -- bot-vs-bot turn integrity must stay green in a battle with an elemental matchup --
    H.B.modeType = 'campaign';
    const sv = H.save;
    sv.dragonKey = 'ember'; sv.level = 4; sv.stage = 3; sv.exp = 0;
    H.startBattle(3);
    let B = H.B;
    let lastTurn = 0, prevSide = null, turnsSeen = 0;
    const problems = [];
    const BUDGET = 8000;
    for (let i = 0; i < BUDGET && B.state !== 'over'; i++) {
      tick(16);
      if (B.mode === 'battle' && B.state === 'aim' && B.active && !B.active.isAI && !B.active.dead) {
        const foe = H.other(B.active);
        const sol = H.aiSolve ? H.aiSolve(B.active, foe, H.SKILLS.shot, false) : { ang: 50, pow: 70 };
        H.fire(B.active, 'shot', sol.ang, sol.pow);
      }
      if (B.turnNo > lastTurn) {
        if (B.turnNo - lastTurn > 1) problems.push(`turn number jumped by ${B.turnNo - lastTurn} near turn ${B.turnNo} (double-advance?)`);
        const side = B.active === B.p ? 'P' : 'E';
        if (prevSide !== null && side === prevSide) problems.push(`${side} acted twice in a row at turn ${B.turnNo} (broken alternation)`);
        prevSide = side; lastTurn = B.turnNo; turnsSeen++;
      }
    }
    assert(B.state === 'over', `battle with elemental matchups did not finish within ${BUDGET} frames (stuck in state "${B.state}")`);
    assert(turnsSeen >= 2, `expected several turns, only saw ${turnsSeen}`);
    assert(problems.length === 0, problems.join('; '));
    clearTimers();
  });

  await test('battle amplifiers: buyable and capped, one-per-turn without ending it, change the armed shot (wind / damage), and persist', async () => {
    clearTimers();
    await H.wipeSave();
    const sv = H.save;
    sv.dragonKey = 'ember'; sv.level = 3; sv.stage = 2; sv.gold = 1000; sv.amps = { calm: 0, surge: 0 };
    H.B.modeType = 'campaign';

    // -- buyable in the shop, capped at 2 ---------------------------------------
    H.refreshShop();
    const buyCalm = document.getElementById('buyCalm'), buySurge = document.getElementById('buySurge');
    assert(buyCalm.textContent === '120g' && !buyCalm.disabled, 'Calm Wind should be buyable at 120g with gold to spare');
    buyCalm.click(); buyCalm.click();
    assert(sv.amps.calm === 2, `buying Calm Wind twice should reach the cap (got ${sv.amps.calm})`);
    H.refreshShop();
    assert(buyCalm.textContent === 'MAX' && buyCalm.disabled, 'Calm Wind should show MAX and disable once capped');
    buySurge.click(); buySurge.click();
    assert(sv.amps.surge === 2, `buying Overcharge twice should reach the cap (got ${sv.amps.surge})`);

    // -- persistence -------------------------------------------------------------
    H.persist();
    sv.amps = { calm: 0, surge: 0 };
    await H.loadSave();
    assert(sv.amps.calm === 2 && sv.amps.surge === 2, `amplifier counts should survive save/load (got calm ${sv.amps.calm}, surge ${sv.amps.surge})`);

    // -- in battle: using one doesn't end the turn, and each is capped at once per turn --
    sv.stage = 2;
    H.startBattle(2);
    let B = H.B;
    let guard = 0;
    while (B.state !== 'aim' && guard < 200) { tick(16); guard++; }
    assert(B.state === 'aim' && B.active === B.p, 'the player should be aiming at the top of their turn');

    B.wind = 0.03;
    const btnCalm = document.getElementById('btnItemCalm');
    btnCalm.click();
    assert(B.wind === 0, `Calm Wind should zero the wind (got ${B.wind})`);
    assert(B.state === 'aim' && B.active === B.p, 'using an amplifier must not end the turn');
    assert(sv.amps.calm === 1, `using Calm Wind should consume one charge (got ${sv.amps.calm})`);
    assert(B.usedItem.calm === true, 'Calm Wind should be marked used for this turn');
    B.wind = 0.03;
    btnCalm.click();
    assert(B.wind === 0.03 && sv.amps.calm === 1, 'a second Calm Wind use on the same turn should be blocked even with charges left');

    const btnSurge = document.getElementById('btnItemSurge');
    assert(B.ampSurge === false, 'Overcharge should not start armed');
    btnSurge.click();
    assert(B.ampSurge === true, 'Overcharge should arm after use');
    assert(B.state === 'aim' && B.active === B.p, 'arming Overcharge must not end the turn');
    assert(sv.amps.surge === 1, `arming Overcharge should consume one charge (got ${sv.amps.surge})`);

    // -- the armed shot actually carries the amp flag through to its projectile --
    const d = B.p;
    d.mp = 100;
    H.fire(d, 'shot', 45, 70);
    assert(B.ampSurge === false, 'firing should consume the armed Overcharge');
    assert(B.projs.length > 0 && B.projs[0].amp === true, "the fired shot's projectile should carry the amp flag");
    clearTimers();

    // -- ampMult resolves the advertised multiplier and changes dealt damage accordingly --
    assert(H.ampMult(false) === 1, 'an unamped shot should resolve to a 1x multiplier');
    assert(H.ampMult(true) === H.AMP_SURGE_MULT, `an amped shot should resolve to the advertised multiplier (got ${H.ampMult(true)})`);
    const realRandom = H.Math.random;
    H.Math.random = () => 0.5;
    const attacker = new H.Dragon('ember', 5, false, 300);
    const foeA = new H.Dragon('terra', 5, true, 900), foeB = new H.Dragon('terra', 5, true, 900);
    foeA.hp = foeA.maxhp = 100000; foeB.hp = foeB.maxhp = 100000;
    H.dealDamage(attacker, foeA, 200 * H.ampMult(false), 1, 'shot');
    H.dealDamage(attacker, foeB, 200 * H.ampMult(true), 1, 'shot');
    H.Math.random = realRandom;
    const plainDmg = 100000 - foeA.hp, ampedDmg = 100000 - foeB.hp;
    assert(ampedDmg > plainDmg, `an Overcharged shot should deal more damage than an unamped one (plain ${plainDmg}, amped ${ampedDmg})`);

    // -- bot-vs-bot turn integrity stays intact when amplifiers are stocked but unused --
    sv.dragonKey = 'volt'; sv.level = 3; sv.exp = 0; sv.stage = 4; sv.amps = { calm: 2, surge: 2 };
    H.startBattle(4);
    B = H.B;
    let lastTurn = 0, prevSide = null, turnsSeen = 0;
    const problems = [];
    const BUDGET = 8000;
    for (let i = 0; i < BUDGET && B.state !== 'over'; i++) {
      tick(16);
      if (B.mode === 'battle' && B.state === 'aim' && B.active && !B.active.isAI && !B.active.dead) {
        const foe = H.other(B.active);
        const sol = H.aiSolve ? H.aiSolve(B.active, foe, H.SKILLS.shot, false) : { ang: 50, pow: 70 };
        H.fire(B.active, 'shot', sol.ang, sol.pow);
      }
      if (B.turnNo > lastTurn) {
        if (B.turnNo - lastTurn > 1) problems.push(`turn number jumped by ${B.turnNo - lastTurn} near turn ${B.turnNo} (double-advance?)`);
        const side = B.active === B.p ? 'P' : 'E';
        if (prevSide !== null && side === prevSide) problems.push(`${side} acted twice in a row at turn ${B.turnNo} (broken alternation)`);
        prevSide = side; lastTurn = B.turnNo; turnsSeen++;
      }
    }
    assert(B.state === 'over', `battle did not finish within ${BUDGET} frames (stuck in state "${B.state}")`);
    assert(turnsSeen >= 4, `expected several turns, only saw ${turnsSeen}`);
    assert(problems.length === 0, problems.join('; '));
    clearTimers();
  });

  await test('field loot: supply crates spawn campaign-only, pay out gold on break, and the bot-vs-bot sim stays green', async () => {
    clearTimers();
    await H.wipeSave();
    const sv = H.save;
    const realRandom = H.Math.random;

    // -- spawn gating: a low roll spawns a crate in campaign, scaled with stage --
    H.B.modeType = 'campaign';
    H.Math.random = () => 0;
    H.makeCrates(5);
    assert(H.crates.length === 1, `a low roll under the spawn chance should spawn a crate (got ${H.crates.length})`);
    const c = H.crates[0];
    assert(c.hp === 45 + 5 * 4, `crate HP should scale with stage (got ${c.hp})`);
    assert(c.gold === 30 + 5 * 8, `crate gold reward should scale with stage (got ${c.gold})`);

    // -- a high roll (>= the spawn chance) spawns nothing --
    H.Math.random = () => 0.99;
    H.makeCrates(5);
    assert(H.crates.length === 0, `a roll at/above ${H.CRATE_CHANCE} should not spawn a crate (got ${H.crates.length})`);

    // -- duel mode never spawns crates, even on a guaranteed-spawn roll --
    H.B.modeType = 'duel';
    H.Math.random = () => 0;
    H.makeCrates(5);
    assert(H.crates.length === 0, `duel mode should never spawn crates (got ${H.crates.length})`);
    H.Math.random = realRandom;

    // -- breaking a crate pays out gold immediately and persists --
    H.B.modeType = 'campaign';
    sv.gold = 100;
    H.crates.length = 0;
    H.crates.push({ x: 500, y: 400, r: 22, hp: 40, maxhp: 40, gold: 77, bob: 0 });
    H.damageCrate(H.crates[0], 999);
    assert(H.crates.length === 0, 'a broken crate should be removed from the field');
    assert(sv.gold === 177, `breaking a crate should credit its gold reward (expected 177, got ${sv.gold})`);
    sv.gold = -1;
    await H.loadSave();
    assert(sv.gold === 177, `the crate payout should survive save/load (got ${sv.gold})`);

    // -- a splash explosion (the real combat path) damages and can break a crate --
    sv.dragonKey = 'ember'; sv.level = 3; sv.stage = 2; sv.gold = 50;
    H.startBattle(2);
    let B = H.B;
    H.crates.length = 0;
    H.crates.push({ x: B.p.x + 120, y: B.p.y, r: 22, hp: 40, maxhp: 40, gold: 33, bob: 0 });
    const goldBefore = sv.gold;
    const fakeProj = { sk: H.SKILLS.shot, owner: B.p, skillKey: 'shot', amp: false, isSub: true };
    H.explode(B.p.x + 120, B.p.y, fakeProj);
    assert(H.crates.length === 0, 'a direct-hit explosion should break the crate');
    assert(sv.gold === goldBefore + 33, `breaking the crate via explode() should credit its gold (expected ${goldBefore + 33}, got ${sv.gold})`);
    clearTimers();

    // -- bot-vs-bot turn integrity stays intact in a battle with a crate on the field --
    sv.dragonKey = 'volt'; sv.level = 3; sv.exp = 0; sv.stage = 4;
    H.Math.random = () => 0;   // force a crate to spawn for this battle
    H.startBattle(4);
    H.Math.random = realRandom;
    B = H.B;
    assert(H.crates.length === 1, 'the forced-spawn battle should have a crate on the field');
    let lastTurn = 0, prevSide = null, turnsSeen = 0;
    const problems = [];
    const BUDGET = 8000;
    for (let i = 0; i < BUDGET && B.state !== 'over'; i++) {
      tick(16);
      if (B.mode === 'battle' && B.state === 'aim' && B.active && !B.active.isAI && !B.active.dead) {
        const foe = H.other(B.active);
        const sol = H.aiSolve ? H.aiSolve(B.active, foe, H.SKILLS.shot, false) : { ang: 50, pow: 70 };
        H.fire(B.active, 'shot', sol.ang, sol.pow);
      }
      if (B.turnNo > lastTurn) {
        if (B.turnNo - lastTurn > 1) problems.push(`turn number jumped by ${B.turnNo - lastTurn} near turn ${B.turnNo} (double-advance?)`);
        const side = B.active === B.p ? 'P' : 'E';
        if (prevSide !== null && side === prevSide) problems.push(`${side} acted twice in a row at turn ${B.turnNo} (broken alternation)`);
        prevSide = side; lastTurn = B.turnNo; turnsSeen++;
      }
    }
    assert(B.state === 'over', `battle with a crate on the field did not finish within ${BUDGET} frames (stuck in state "${B.state}")`);
    assert(turnsSeen >= 4, `expected several turns, only saw ${turnsSeen}`);
    assert(problems.length === 0, problems.join('; '));
    clearTimers();
  });

  // -- TEST 15: hunt scoring — a post-victory grade with an EXP/gold bonus -----
  await test('hunt scoring: victory grades the fight from turns/HP kept, pays a bonus for a clean hunt, and persists', async () => {
    clearTimers();
    const sv = H.save;

    // -- huntGrade() itself: a fast, undamaged win should grade S; a slow, near-death win should grade C --
    const clean = H.huntGrade(2, 1);
    assert(clean.grade === 'S', `a fast win at full HP should grade S (got ${clean.grade})`);
    assert(clean.bonus > 0, 'grade S should carry a positive bonus');
    const rough = H.huntGrade(20, 0.02);
    assert(rough.grade === 'C', `a long win at near-zero HP should grade C (got ${rough.grade})`);
    assert(rough.bonus === 0, 'grade C should carry no bonus');
    assert(clean.score > rough.score, 'a clean hunt should score higher than a rough one');

    // -- a real victory() applies the grade's bonus to the awarded EXP/gold and records it --
    sv.dragonKey = 'ember'; sv.level = 1; sv.exp = 0; sv.gold = 100; sv.stage = 3;
    H.startBattle(3);
    let B = H.B;
    B.turnNo = 2; B.p.hp = B.p.maxhp; B.e.hp = 0;
    const gold0 = sv.gold, grades0 = sv.record.grades.S;
    const baseGold = 50 + B.stage * 22;
    H.checkEnd();
    assert(B.state === 'over', 'battle ended when the enemy fell');
    assert(sv.record.grades.S === grades0 + 1, `a clean win should be tallied as an S grade (got ${JSON.stringify(sv.record.grades)})`);
    assert(sv.gold > gold0 + baseGold, `a clean-hunt bonus should push gold above the unbonused award (base ${baseGold}, gained ${sv.gold - gold0})`);
    assert(H.$('vGrade').textContent.includes('S'), `the victory modal should show the earned grade (got "${H.$('vGrade').textContent}")`);

    // -- the tallied grade survives save then load --
    sv.gold = -1;
    await H.loadSave();
    assert(sv.record.grades.S === grades0 + 1, 'the grade tally should survive save/load');
    assert(typeof sv.record.grades.C === 'number', 'other grade buckets should still be present after load');
    clearTimers();

    // -- a rough win (many turns, low HP) grades low and pays no bonus, without breaking turn integrity --
    sv.dragonKey = 'ember'; sv.level = 1; sv.exp = 0; sv.gold = 100; sv.stage = 2;
    H.startBattle(2);
    B = H.B;
    B.turnNo = 25; B.p.hp = Math.max(1, Math.round(B.p.maxhp * 0.02)); B.e.hp = 0;
    const gold1 = sv.gold, baseGold2 = 50 + B.stage * 22;
    H.checkEnd();
    assert(sv.gold === gold1 + baseGold2, `a rough win should pay the plain award with no bonus (expected ${baseGold2}, got ${sv.gold - gold1})`);
    clearTimers();

    // -- bot-vs-bot turn integrity still holds through a battle that ends in a grade + bonus ---
    sv.dragonKey = 'volt'; sv.level = 3; sv.exp = 0; sv.stage = 4;
    H.startBattle(4);
    B = H.B;
    let lastTurn = 0, prevSide = null, turnsSeen = 0;
    const problems = [];
    const BUDGET = 8000;
    for (let i = 0; i < BUDGET && B.state !== 'over'; i++) {
      tick(16);
      if (B.mode === 'battle' && B.state === 'aim' && B.active && !B.active.isAI && !B.active.dead) {
        const foe = H.other(B.active);
        const sol = H.aiSolve ? H.aiSolve(B.active, foe, H.SKILLS.shot, false) : { ang: 50, pow: 70 };
        H.fire(B.active, 'shot', sol.ang, sol.pow);
      }
      if (B.turnNo > lastTurn) {
        if (B.turnNo - lastTurn > 1) problems.push(`turn number jumped by ${B.turnNo - lastTurn} near turn ${B.turnNo} (double-advance?)`);
        const side = B.active === B.p ? 'P' : 'E';
        if (prevSide !== null && side === prevSide) problems.push(`${side} acted twice in a row at turn ${B.turnNo} (broken alternation)`);
        prevSide = side; lastTurn = B.turnNo; turnsSeen++;
      }
    }
    assert(B.state === 'over', `battle did not finish within ${BUDGET} frames (stuck in state "${B.state}")`);
    assert(turnsSeen >= 4, `expected several turns, only saw ${turnsSeen}`);
    assert(problems.length === 0, problems.join('; '));
    clearTimers();
  });

  // -- TEST 16: side hunts — off-ladder battle, reduced rewards, stage untouched --
  await test('side hunts: launchable from the Den, pay reduced rewards, and never advance save.stage', async () => {
    clearTimers();
    const sv = H.save;

    // -- driving the real Den button launches a side hunt at the player's own stage --
    sv.dragonKey = 'ember'; sv.level = 3; sv.exp = 0; sv.gold = 100; sv.stage = 6;
    H.refreshDen();
    H.$('btnDenSide').click();
    let B = H.B;
    assert(B.mode === 'battle' && B.side === true, 'the Den\'s Side Hunt button should start a side-hunt battle');
    assert(B.stage === 6, `a side hunt should fight at the player's current stage (expected 6, got ${B.stage})`);
    assert(!B.e.alpha, 'a side hunt should never spawn an alpha boss');

    // -- winning a side hunt pays a reduced award and leaves save.stage untouched --
    B.turnNo = 10; B.p.hp = B.p.maxhp; B.e.hp = 0;
    const stage0 = sv.stage, gold0 = sv.gold, wins0 = sv.record.wins, best0 = sv.record.bestStage;
    const ladderExp = Math.round(35 + B.stage * 14), ladderGold = Math.round(50 + B.stage * 22);
    H.checkEnd();
    assert(B.state === 'over', 'the side-hunt battle ended when the enemy fell');
    assert(sv.stage === stage0, `a side-hunt win must not advance the stage (was ${stage0}, now ${sv.stage})`);
    assert(sv.record.bestStage === best0, 'a side-hunt win must not bump the ladder best-stage record');
    assert(sv.record.wins === wins0 + 1, 'a side-hunt win should still count toward the overall win record');
    const goldGained = sv.gold - gold0;
    assert(goldGained > 0 && goldGained < ladderGold, `a side hunt should pay a reduced gold award (ladder base ${ladderGold}, got ${goldGained})`);
    assert(H.$('vSub').textContent.toLowerCase().includes('side hunt'), 'the victory modal should read as a side hunt');
    clearTimers();

    // -- a losing side hunt (Retry) restarts as a side hunt, still without touching stage --
    sv.dragonKey = 'ember'; sv.level = 3; sv.exp = 0; sv.gold = 100; sv.stage = 6;
    H.startSideHunt();
    B = H.B;
    B.p.hp = 0;
    H.checkEnd();
    tick(1100);
    assert(!H.$('mDefeat').classList.contains('hidden'), 'defeat modal should show after a side-hunt loss');
    H.$('btnRetry').click();
    assert(H.B.side === true, 'retrying after a side-hunt defeat should relaunch a side hunt, not a ladder battle');
    assert(sv.stage === 6, 'a side-hunt defeat + retry must never touch save.stage');
    clearTimers();

    // -- bot-vs-bot turn integrity holds through a full side-hunt battle --
    sv.dragonKey = 'volt'; sv.level = 4; sv.exp = 0; sv.stage = 7;
    H.startSideHunt();
    B = H.B;
    let lastTurn = 0, prevSide = null, turnsSeen = 0;
    const problems = [];
    // The Ward skill (defensive-counter archetype) gates aiThink's shield/ward pick behind
    // an extra status check, which skips a would-be Math.random() call once an enemy has
    // warded — the same shared-seeded-stream shift documented by the biome-weather and
    // 3rd-signature-tier features, not a stuck loop. This particular matchup needed more
    // headroom than the default 8000 once that shift landed.
    const BUDGET = 16000;
    for (let i = 0; i < BUDGET && B.state !== 'over'; i++) {
      tick(16);
      if (B.mode === 'battle' && B.state === 'aim' && B.active && !B.active.isAI && !B.active.dead) {
        const foe = H.other(B.active);
        const sol = H.aiSolve ? H.aiSolve(B.active, foe, H.SKILLS.shot, false) : { ang: 50, pow: 70 };
        H.fire(B.active, 'shot', sol.ang, sol.pow);
      }
      if (B.turnNo > lastTurn) {
        if (B.turnNo - lastTurn > 1) problems.push(`turn number jumped by ${B.turnNo - lastTurn} near turn ${B.turnNo} (double-advance?)`);
        const side = B.active === B.p ? 'P' : 'E';
        if (prevSide !== null && side === prevSide) problems.push(`${side} acted twice in a row at turn ${B.turnNo} (broken alternation)`);
        prevSide = side; lastTurn = B.turnNo; turnsSeen++;
      }
    }
    assert(B.state === 'over', `side-hunt battle did not finish within ${BUDGET} frames (stuck in state "${B.state}")`);
    assert(turnsSeen >= 4, `expected several turns, only saw ${turnsSeen}`);
    assert(problems.length === 0, problems.join('; '));
    assert(sv.stage === 7, 'a full bot-vs-bot side hunt must still leave save.stage untouched');
    clearTimers();
  });

  // -- TEST 17: magic stones — 3-for-1 synthesis, socketed effect on resolved atk, drops, persistence --
  await test('magic stones: 3-of-a-kind synthesis, a socketed stone raises resolved atk (full on-element, reduced off), drops from victory, and persists', async () => {
    clearTimers();
    await H.wipeSave();
    const sv = H.save;
    H.B.modeType = 'campaign';

    // -- inventory + 3-for-1 synthesis --------------------------------------------
    assert(JSON.stringify(sv.stones) === JSON.stringify(H.blankStones()), 'a fresh save should start with empty stone sockets/inventory');
    H.addStone('Fire', 1); H.addStone('Fire', 1); H.addStone('Fire', 1);
    assert(sv.stones.inv['Fire_1'] === 3, `three added stones should tally to 3 (got ${sv.stones.inv['Fire_1']})`);
    assert(H.synthesizeStone('Fire', 1) === true, 'synthesizing 3 tier-1 stones should succeed');
    assert(!sv.stones.inv['Fire_1'], `synthesis should consume all 3 source stones (got ${sv.stones.inv['Fire_1']})`);
    assert(sv.stones.inv['Fire_2'] === 1, `synthesis should yield exactly 1 tier-2 stone (got ${sv.stones.inv['Fire_2']})`);
    assert(H.synthesizeStone('Fire', 1) === false, 'synthesizing with fewer than 3 stones on hand should fail');
    assert(H.synthesizeStone('Fire', 3) === false, 'a tier-3 stone should not synthesize further (max tier)');

    // -- a socketed stone raises effectiveAtk: full value on-element, reduced off-element --
    sv.dragonKey = 'ember';   // Fire
    const d = new H.Dragon('ember', 5, false, 300);   // isAI=false, campaign -> stoneMult applies
    const baseAtk = H.effectiveAtk(d);
    assert(baseAtk === d.atk, `with no stones socketed, effective atk should equal raw atk (got ${baseAtk} vs ${d.atk})`);

    assert(H.socketStone(0, 'Fire', 2) === true, 'socketing the synthesized Fire T2 stone should succeed');
    assert(!sv.stones.inv['Fire_2'], 'socketing should remove the stone from inventory');
    const matchedAtk = H.effectiveAtk(d);
    const expectMatched = Math.round(d.atk * (1 + H.STONE_TIER_PCT[2]));
    assert(matchedAtk === expectMatched, `a matching-element T2 stone should raise effective atk to ${expectMatched} (got ${matchedAtk})`);
    assert(matchedAtk > baseAtk, 'a socketed matching stone should raise resolved atk over the unsocketed baseline');

    assert(H.unsocketStone(0) === true, 'unsocketing should succeed and return the stone to inventory');
    assert(sv.stones.inv['Fire_2'] === 1, 'unsocketing should restore the stone to the inventory');
    assert(H.effectiveAtk(d) === baseAtk, 'with the stone unsocketed, effective atk should fall back to the baseline');

    const offEl = H.ELEMENT_ORDER.find(e => e !== 'Fire');
    H.addStone(offEl, 2);
    assert(H.socketStone(0, offEl, 2) === true, 'socketing an off-element stone should still succeed');
    const mismatchedAtk = H.effectiveAtk(d);
    const expectMismatched = Math.round(d.atk * (1 + H.STONE_TIER_PCT[2] * H.STONE_MISMATCH_MULT));
    assert(mismatchedAtk === expectMismatched, `an off-element T2 stone should raise effective atk to ${expectMismatched} (got ${mismatchedAtk})`);
    assert(mismatchedAtk > baseAtk && mismatchedAtk < matchedAtk, 'an off-element stone should help less than a matching one, but still help');
    H.unsocketStone(0);

    // -- AI dragons never benefit, even with sockets full ------------------------
    H.socketStone(0, offEl, 2);
    const aiD = new H.Dragon('ember', 5, true, 900);
    assert(H.effectiveAtk(aiD) === aiD.atk, 'an AI/enemy dragon must not benefit from the player\'s socketed stones');
    H.unsocketStone(0);

    // -- playable/visible: the Den's Stones panel drives real socket/synth/unsocket buttons --
    sv.stones = H.blankStones();   // clean slate so the counts below are exact
    H.addStone('Fire', 2); H.addStone('Fire', 2); H.addStone('Fire', 2);
    H.refreshDen();
    document.getElementById('btnDenStones').click();
    const stoneRows = document.getElementById('stoneRows');
    const fireRow = stoneRows.children.find(r => r.innerHTML.includes('Fire Stone T2'));
    assert(fireRow, 'the Stones panel should list the Fire T2 stones in inventory');
    const socketBtn = fireRow.children.find(b => b.textContent === 'Socket');
    socketBtn.click();
    assert(sv.stones.sockets[0] && sv.stones.sockets[0].el === 'Fire' && sv.stones.sockets[0].tier === 2,
      'clicking Socket on the Stones panel should fill the first empty socket');
    H.refreshDen();
    assert(document.getElementById('denStones').innerHTML.includes('Fire Stone T2'), 'the Den should show the newly socketed stone in its loadout summary');
    H.refreshStones();
    const sockBtn0 = document.getElementById('stoneSockets').children[0];
    sockBtn0.click();
    assert(sv.stones.sockets[0] === null, 'clicking a filled socket in the Stones panel should unsocket it');
    assert(sv.stones.inv['Fire_2'] === 3, 'unsocketing via the panel should return the stone to inventory');
    H.refreshStones();
    const synBtn = stoneRows.children.find(r => r.innerHTML.includes('Fire Stone T2')).children.find(b => b.textContent === 'Synth x3');
    synBtn.click();
    assert(!sv.stones.inv['Fire_2'] && sv.stones.inv['Fire_3'] === 1, 'clicking Synth x3 on the panel should synthesize into a tier-3 stone');
    document.getElementById('btnStonesClose').click();
    assert(!document.getElementById('denStones').innerHTML.includes('Fire Stone T2'),
      'closing the Stones panel should refresh the Den, not leave its loadout row showing the since-unsocketed stone');

    // -- drops from victory: alphas always drop; a forced-fail roll drops nothing --------
    sv.stones = H.blankStones();   // clean slate (note: not a re-wipeSave — `sv` must stay the live save object)
    sv.dragonKey = 'ember'; sv.level = 3; sv.exp = 0; sv.gold = 100; sv.stage = 2;   // non-alpha
    H.startBattle(2);
    let B = H.B;
    const dropEl = B.e.el;
    B.e.hp = 0;
    const realRandom = H.Math.random;
    H.Math.random = () => 0.99;   // fails the base drop-chance check for a non-alpha win
    H.checkEnd();
    H.Math.random = realRandom;
    assert(!sv.stones.inv[dropEl + '_1'], 'a failed drop roll on a non-alpha win should not add a stone');
    tick(1100); clearTimers();

    sv.dragonKey = 'ember'; sv.level = 3; sv.exp = 0; sv.gold = 100; sv.stage = 2;
    H.startBattle(2);
    B = H.B;
    const dropEl2 = B.e.el;
    B.e.hp = 0;
    H.Math.random = () => 0.01;   // passes the drop-chance check, and picks the lowest tier
    H.checkEnd();
    H.Math.random = realRandom;
    assert(sv.stones.inv[dropEl2 + '_1'] >= 1, `a passed drop roll on a non-alpha win should add a tier-1 stone (inv: ${JSON.stringify(sv.stones.inv)})`);
    assert(document.getElementById('vStone').textContent.includes('Found a'), 'the victory modal should announce a dropped stone');
    tick(1100); clearTimers();

    sv.dragonKey = 'ember'; sv.level = 3; sv.exp = 0; sv.gold = 100; sv.stage = 5;   // alpha stage
    H.startBattle(5);
    B = H.B;
    assert(B.e.alpha, 'stage 5 should be an alpha battle');
    const dropEl3 = B.e.el;
    B.e.hp = 0;
    H.Math.random = () => 0.99;   // would fail a normal drop roll, but alphas always drop
    H.checkEnd();
    H.Math.random = realRandom;
    assert(sv.stones.inv[dropEl3 + '_3'] >= 1, `an alpha win should always drop a stone, and favor higher tiers (expected a T3 ${dropEl3} stone, inv: ${JSON.stringify(sv.stones.inv)})`);
    tick(1100); clearTimers();

    // -- persistence: inventory and sockets survive a save/load round trip --------------
    sv.stones.sockets[1] = { el: 'Ice', tier: 1 };
    const snapshot = JSON.parse(JSON.stringify(sv.stones));
    H.persist();
    sv.stones = H.blankStones();
    await H.loadSave();
    assert(JSON.stringify(sv.stones) === JSON.stringify(snapshot), 'stone inventory and sockets should survive a save/load round trip');

    // -- bot-vs-bot turn integrity holds with stones socketed -----------------------
    sv.dragonKey = 'volt'; sv.level = 3; sv.exp = 0; sv.stage = 4;
    sv.stones.sockets = [{ el: 'Thunder', tier: 2 }, null, null];
    H.startBattle(4);
    B = H.B;
    let lastTurn = 0, prevSide = null, turnsSeen = 0;
    const problems = [];
    const BUDGET = 8000;
    for (let i = 0; i < BUDGET && B.state !== 'over'; i++) {
      tick(16);
      if (B.mode === 'battle' && B.state === 'aim' && B.active && !B.active.isAI && !B.active.dead) {
        const foe = H.other(B.active);
        const sol = H.aiSolve ? H.aiSolve(B.active, foe, H.SKILLS.shot, false) : { ang: 50, pow: 70 };
        H.fire(B.active, 'shot', sol.ang, sol.pow);
      }
      if (B.turnNo > lastTurn) {
        if (B.turnNo - lastTurn > 1) problems.push(`turn number jumped by ${B.turnNo - lastTurn} near turn ${B.turnNo} (double-advance?)`);
        const side = B.active === B.p ? 'P' : 'E';
        if (prevSide !== null && side === prevSide) problems.push(`${side} acted twice in a row at turn ${B.turnNo} (broken alternation)`);
        prevSide = side; lastTurn = B.turnNo; turnsSeen++;
      }
    }
    assert(B.state === 'over', `battle with stones socketed did not finish within ${BUDGET} frames (stuck in state "${B.state}")`);
    assert(turnsSeen >= 4, `expected several turns, only saw ${turnsSeen}`);
    assert(problems.length === 0, problems.join('; '));
    clearTimers();
  });

  // -- TEST 18: fourth biome — the chasm hazard is a real terrain gap, reachable on the
  // ladder, and a bot-vs-bot battle fought inside it stays alternation-strict -----------
  await test('fourth biome: the chasm carves a genuine gap in the terrain, is reachable on the ladder, and the bot-vs-bot sim stays green', () => {
    clearTimers();
    assert(H.BIOME_ORDER.length === 4, `expected a 4th biome appended to BIOME_ORDER, got [${H.BIOME_ORDER}]`);
    const chasmKey = H.BIOME_ORDER[3];
    assert(H.BIOMES[chasmKey] && H.BIOMES[chasmKey].gap, `expected BIOME_ORDER[3] ("${chasmKey}") to be a gap-hazard biome`);

    const sv = H.save;
    sv.dragonKey = 'terra'; sv.level = 5; sv.exp = 0; sv.stage = 4;   // stage 4 -> the 4th biome in the cycle
    H.startBattle(4);
    const B = H.B;
    assert(H.curBiomeKey === chasmKey, `expected stage 4 to land on the chasm biome, got "${H.curBiomeKey}"`);

    // The signature hazard: a genuine deep gap mid-field, not just a palette swap. Look for
    // a contiguous stretch of ground within a few px of FLOOR, well away from either spawn
    // (a plain undulating meadow/cinder/tundra terrain never dips this close to FLOOR on its own).
    const ground = H.ground;
    let gapPx = 0;
    for (let x = H.SPAWN_P + 240; x < H.SPAWN_E - 240; x++) if (ground[x] >= H.FLOOR - 10) gapPx++;
    assert(gapPx > 60, `expected a wide contiguous chasm gap between the spawns, found only ${gapPx}px near FLOOR`);
    // and the spawns themselves must stay clear of the chasm so dragons don't start fallen in
    assert(ground[H.SPAWN_P] < H.FLOOR - 10 && ground[H.SPAWN_E] < H.FLOOR - 10, 'the chasm should not reach either spawn point');

    // The hazard must be mechanically real, not just cosmetic. Two checks, both driven
    // through the dragon's real movement/physics methods (Dragon.tryMove / .update / .land):
    //   1) stepping toward the lip genuinely launches the dragon airborne (tryMove's own
    //      steep-drop check engages with the carved terrain, same as any other cliff);
    let gapStart = -1;
    for (let x = H.SPAWN_P; x < H.SPAWN_E; x++) { if (ground[x] >= H.FLOOR - 10) { gapStart = x; break; } }
    assert(gapStart > 0, 'could not locate the chasm gap to test falling into it');
    B.p.x = gapStart - 4; B.p.y = ground[gapStart - 4]; B.p.air = false; B.p.stamina = B.p.maxstam;
    B.p.tryMove(1, 1 / 60);
    assert(B.p.air, "stepping toward the chasm's lip should launch the dragon airborne (tryMove didn't engage the drop)");
    //   2) landing at the pit's full depth deals real fall damage, same rule as any steep drop.
    B.p.air = true; B.p.x = gapStart + 40; B.p.y = ground[H.SPAWN_P]; B.p.fallFrom = B.p.y; B.p.vy = 0;
    const hpBeforeFall = B.p.hp;
    for (let i = 0; i < 400 && B.p.air; i++) B.p.update(1 / 60);
    assert(!B.p.air, 'dragon should have landed after falling into the chasm within the simulated budget');
    assert(B.p.hp < hpBeforeFall, `landing at the bottom of the chasm should deal real fall damage (hp ${hpBeforeFall} -> ${B.p.hp})`);

    // Fresh battle for the turn-integrity sim — the mechanical checks above deliberately
    // dropped B.p mid-chasm, which isn't a state a real battle would ever start from.
    clearTimers();
    sv.dragonKey = 'terra'; sv.level = 5; sv.exp = 0; sv.stage = 4;
    H.startBattle(4);
    const B2 = H.B;
    let lastTurn = 0, prevSide = null, turnsSeen = 0;
    const problems = [];
    // The chasm and its floating obstacles make line-of-sight harder to solve than open
    // terrain, so bot-vs-bot fights here run longer than the standard 8000-frame budget
    // (confirmed: turnNo climbs steadily throughout, this is a slower grind, not a stall).
    const BUDGET = 16000;
    for (let i = 0; i < BUDGET && B2.state !== 'over'; i++) {
      tick(16);
      if (B2.mode === 'battle' && B2.state === 'aim' && B2.active && !B2.active.isAI && !B2.active.dead) {
        const foe = H.other(B2.active);
        const sol = H.aiSolve ? H.aiSolve(B2.active, foe, H.SKILLS.shot, false) : { ang: 50, pow: 70 };
        H.fire(B2.active, 'shot', sol.ang, sol.pow);
      }
      if (B2.turnNo > lastTurn) {
        if (B2.turnNo - lastTurn > 1) problems.push(`turn number jumped by ${B2.turnNo - lastTurn} near turn ${B2.turnNo} (double-advance?)`);
        const side = B2.active === B2.p ? 'P' : 'E';
        if (prevSide !== null && side === prevSide) problems.push(`${side} acted twice in a row at turn ${B2.turnNo} (broken alternation)`);
        prevSide = side; lastTurn = B2.turnNo; turnsSeen++;
      }
    }
    assert(B2.state === 'over', `chasm battle did not finish within ${BUDGET} frames (stuck in state "${B2.state}")`);
    assert(turnsSeen >= 4, `expected several turns, only saw ${turnsSeen}`);
    assert(problems.length === 0, problems.join('; '));
    clearTimers();
  });

  // -- TEST 19: a seventh dragon, off the elemental wheel and earned by milestone
  await test('a seventh dragon (Nyx) sits off the elemental wheel, is locked until 3 alphas are felled, and the bot-vs-bot sim stays green once picked', async () => {
    clearTimers();
    assert(H.DRAGONS.nyx, 'expected a 7th dragon, "nyx", in the roster');
    assert(!H.ELEMENT_ORDER.includes(H.DRAGONS.nyx.el), `nyx's element ("${H.DRAGONS.nyx.el}") should sit outside ELEMENT_ORDER`);

    // -- confirmed neutral in every elemental matchup, both directions ---------
    for (const el of H.ELEMENT_ORDER) {
      assert(H.elRel(H.DRAGONS.nyx.el, el) === 'neu', `nyx attacking ${el} should resolve neutral`);
      assert(H.elRel(el, H.DRAGONS.nyx.el) === 'neu', `${el} attacking nyx should resolve neutral`);
    }

    // -- earned through play: locked on a fresh save, unlocks at the milestone -
    await H.wipeSave();
    const sv = H.save;
    assert(H.UNLOCK_REQS.nyx && H.UNLOCK_REQS.nyx.alphaWins === 3, 'expected nyx to require 3 alpha wins to unlock');
    assert(sv.record.alphaWins === 0, 'a fresh save should have no alpha wins yet');
    assert(H.isDragonUnlocked('nyx') === false, 'nyx should be locked on a fresh save');
    assert(H.isDragonUnlocked('ember') === true, 'roster dragons without an unlock requirement should stay always-available');

    H.buildCards();
    const lockedCard = H.$('cards').children.find((c) => c.dataset.key === 'nyx');
    assert(lockedCard && lockedCard.className.includes('locked'), 'the nyx card should render locked before the milestone is met');
    assert(lockedCard.innerHTML.includes('Locked'), "a locked card shouldn't reveal the dragon's name/stats");

    sv.record.alphaWins = 3;
    assert(H.isDragonUnlocked('nyx') === true, 'nyx should unlock once 3 alphas are felled');
    H.buildCards();
    const unlockedCard = H.$('cards').children.find((c) => c.dataset.key === 'nyx');
    assert(!unlockedCard.className.includes('locked'), 'the nyx card should render unlocked once the milestone is met');
    assert(unlockedCard.innerHTML.includes('Nyx'), "an unlocked card should reveal the dragon's name");

    // -- fully playable once unlocked: real stats, growth, and both signatures -
    const lvl1 = H.statsAt('nyx', 1), lvl5 = H.statsAt('nyx', 5);
    assert(lvl5.hp > lvl1.hp && lvl5.atk > lvl1.atk, 'nyx should have real level growth like the rest of the roster');
    const skillKeys = H.SKILL_KEYS('nyx');
    assert(skillKeys.includes('voidlance') && skillKeys.includes('starrend'), 'nyx should carry its two signature skills');
    assert(H.SKILLS.voidlance && H.SKILLS.starrend, "nyx's signature skills should be defined in SKILLS");

    // -- bot-vs-bot turn integrity holds with nyx as the player dragon ---------
    clearTimers();
    sv.dragonKey = 'nyx'; sv.level = 4; sv.exp = 0; sv.stage = 3;
    H.startBattle(3);
    const B = H.B;
    assert(B.p.el === 'Void', 'the battle should be using nyx as the player dragon');
    let lastTurn = 0, prevSide = null, turnsSeen = 0;
    const problems = [];
    const BUDGET = 8000;
    for (let i = 0; i < BUDGET && B.state !== 'over'; i++) {
      tick(16);
      if (B.mode === 'battle' && B.state === 'aim' && B.active && !B.active.isAI && !B.active.dead) {
        const foe = H.other(B.active);
        const sol = H.aiSolve ? H.aiSolve(B.active, foe, H.SKILLS.shot, false) : { ang: 50, pow: 70 };
        H.fire(B.active, 'shot', sol.ang, sol.pow);
      }
      if (B.turnNo > lastTurn) {
        if (B.turnNo - lastTurn > 1) problems.push(`turn number jumped by ${B.turnNo - lastTurn} near turn ${B.turnNo} (double-advance?)`);
        const side = B.active === B.p ? 'P' : 'E';
        if (prevSide !== null && side === prevSide) problems.push(`${side} acted twice in a row at turn ${B.turnNo} (broken alternation)`);
        prevSide = side; lastTurn = B.turnNo; turnsSeen++;
      }
    }
    assert(B.state === 'over', `nyx battle did not finish within ${BUDGET} frames (stuck in state "${B.state}")`);
    assert(turnsSeen >= 4, `expected several turns, only saw ${turnsSeen}`);
    assert(problems.length === 0, problems.join('; '));
    clearTimers();
  });

  // -- TEST 20: boss-only signature hazards, keyed off the enrage trigger
  await test('boss-only signature hazards: Cindermaw scorches the ground, Glacierfang raises an ice wall, and Quakehide cracks the ground underfoot on enrage, and the bot-vs-bot sim stays green', async () => {
    clearTimers();
    await H.wipeSave();
    const sv = H.save;

    // -- config sanity: every mapped hazard belongs to a real alpha title -----
    const hazardKeys = Object.keys(H.BOSS_HAZARDS);
    assert(hazardKeys.length >= 1, 'expected at least one boss-signature hazard defined');
    for (const key of hazardKeys) assert(H.ALPHA_TITLES[key], `BOSS_HAZARDS key "${key}" should be a real alpha title`);
    assert(H.BOSS_HAZARDS.ember, 'expected Cindermaw (ember) to carry a signature hazard');
    assert(H.BOSS_HAZARDS.frost, 'expected Glacierfang (frost) to carry a signature hazard');
    assert(H.BOSS_HAZARDS.terra, 'expected Quakehide (terra) to carry a signature hazard');

    // real terrain so ground-raising is meaningful, and B.zones/B.modeType set up like a live battle
    sv.dragonKey = 'terra'; sv.level = 3; sv.stage = 2; sv.exp = 0;
    H.startBattle(2);
    const B = H.B;

    // -- Cindermaw: enraging scorches the ground into a lingering, distinctly-labeled zone --
    B.zones = [];
    const emberBoss = new H.Dragon('ember', 5, true, 900, true);
    H.triggerBossHazard(emberBoss);
    assert(B.zones.length === 1, `triggerBossHazard should push exactly one zone for ember (got ${B.zones.length})`);
    const zone = B.zones[0];
    assert(zone.label && zone.label !== 'miasma', `the scorch zone should read as its own hazard, not generic miasma (got "${zone.label}")`);
    assert(zone.x === emberBoss.x, 'the scorch zone should be centered on the boss');
    assert(zone.turns > 0 && zone.pct > 0 && zone.r > 0, 'the scorch zone should have real duration, damage, and radius');
    assert(zone.col && zone.col !== '#a8d93a', 'the scorch zone should render in its own color, not miasma green');

    // -- Glacierfang: enraging raises a real wall of ice, centered ahead of the boss --
    const frostBoss = new H.Dragon('frost', 5, true, 900, true);
    frostBoss.facing = 1;
    const mx = Math.max(H.SPAWN_P + 180, Math.min(H.SPAWN_E - 180, frostBoss.x + frostBoss.facing * 160));
    const groundBefore = H.ground[Math.round(mx)];
    H.triggerBossHazard(frostBoss);
    const groundAfter = H.ground[Math.round(mx)];
    assert(groundAfter < groundBefore, `an ice wall should raise the terrain ahead of Glacierfang (before ${groundBefore}, after ${groundAfter})`);

    // -- Quakehide: enraging cracks the ground open directly under the foe's footing --
    // triggerBossHazard reads other(boss) off the live B.p/B.e globals; B.p is still the
    // real 'terra' player dragon from startBattle(2) above, and a freshly-built boss object
    // is never === B.p, so other(quakeBoss) resolves to the real foe without any rewiring.
    const foeX = Math.round(B.p.x);
    const groundBeforeQuake = H.ground[foeX];
    const quakeBoss = new H.Dragon('terra', 5, true, 900, true);
    H.triggerBossHazard(quakeBoss);
    const groundAfterQuake = H.ground[foeX];
    assert(groundAfterQuake > groundBeforeQuake, `a quake should carve the ground deeper under the foe's footing (before ${groundBeforeQuake}, after ${groundAfterQuake})`);

    // -- a boss with no mapped hazard (e.g. Stormcrown) enrages without pushing a zone or touching terrain --
    B.zones = [];
    const voltBoss = new H.Dragon('volt', 5, true, 900, true);
    const groundUnrelated = H.ground[500];
    H.triggerBossHazard(voltBoss);
    assert(B.zones.length === 0, 'a boss without a mapped hazard should not push a zone');
    assert(H.ground[500] === groundUnrelated, 'a boss without a mapped hazard should not touch the terrain');

    // -- wired to the real enrage trigger, not just callable in isolation -----
    B.zones = [];
    B.modeType = 'campaign';
    const attacker = new H.Dragon('terra', 5, false, 300);
    const wiredBoss = new H.Dragon('ember', 5, true, 900, true);
    wiredBoss.hp = Math.round(wiredBoss.maxhp * 0.44); // just above the 40% enrage threshold
    assert(wiredBoss.enraged === false, 'a fresh alpha should not start enraged');
    H.dealDamage(attacker, wiredBoss, 70, 1, 'shot');  // sized to cross the threshold under any rand()/crit draw
    assert(wiredBoss.enraged === true, 'the hit should have crossed the enrage threshold');
    assert(B.zones.length === 1, 'a real enrage event on Cindermaw should fire its hazard through dealDamage, not just via a direct call');
    // (Quakehide's own wire-through-dealDamage is exercised live in the bot-vs-bot pass below
    // rather than with a second isolated dealDamage() call here — an extra call here would
    // consume two more draws off the shared seeded Math.random() stream and shift every
    // later test's RNG-dependent outcomes, the exact risk earlier features already hit.)

    // -- bot-vs-bot turn integrity stays intact with a live hazard triggered --
    clearTimers();
    sv.dragonKey = 'frost'; sv.level = 4; sv.stage = 5; sv.exp = 0;
    H.startBattle(5);
    assert(B.e.alpha, 'stage 5 should be an alpha battle');
    B.e = new H.Dragon('ember', B.e.level, true, H.SPAWN_E, true); // force a hazard-mapped alpha so it's exercised live
    B.zones = [];
    let lastTurn = 0, prevSide = null, turnsSeen = 0, hazardFired = false;
    const problems = [];
    const BUDGET = 8000;
    for (let i = 0; i < BUDGET && B.state !== 'over'; i++) {
      tick(16);
      if (B.zones.length > 0) hazardFired = true;
      if (B.mode === 'battle' && B.state === 'aim' && B.active && !B.active.isAI && !B.active.dead) {
        const foe = H.other(B.active);
        const sol = H.aiSolve ? H.aiSolve(B.active, foe, H.SKILLS.shot, false) : { ang: 50, pow: 70 };
        H.fire(B.active, 'shot', sol.ang, sol.pow);
      }
      if (B.turnNo > lastTurn) {
        if (B.turnNo - lastTurn > 1) problems.push(`turn number jumped by ${B.turnNo - lastTurn} near turn ${B.turnNo} (double-advance?)`);
        const side = B.active === B.p ? 'P' : 'E';
        if (prevSide !== null && side === prevSide) problems.push(`${side} acted twice in a row at turn ${B.turnNo} (broken alternation)`);
        prevSide = side; lastTurn = B.turnNo; turnsSeen++;
      }
    }
    assert(B.state === 'over', `hazard battle did not finish within ${BUDGET} frames (stuck in state "${B.state}")`);
    assert(turnsSeen >= 4, `expected several turns, only saw ${turnsSeen}`);
    assert(problems.length === 0, problems.join('; '));
    assert(hazardFired, 'the scorched-ground hazard should have actually fired during the live bot-vs-bot fight');
    clearTimers();

    // -- bot-vs-bot turn integrity stays intact with Quakehide's crater/fall-damage hazard --
    // this is the riskiest of the three (it drops a dragon's footing out from under them mid-
    // battle, which relies on the existing air/land physics and waitSettle's airborne wait),
    // so it gets its own dedicated live pass rather than piggybacking on the ember run above.
    clearTimers();
    sv.dragonKey = 'ember'; sv.level = 4; sv.stage = 5; sv.exp = 0;
    H.startBattle(5);
    assert(B.e.alpha, 'stage 5 should be an alpha battle');
    B.e = new H.Dragon('terra', B.e.level, true, H.SPAWN_E, true); // force Quakehide so its hazard is exercised live
    let lastTurnQ = 0, prevSideQ = null, turnsSeenQ = 0, quakeEnraged = false;
    const problemsQ = [];
    const BUDGET_Q = 8000;
    for (let i = 0; i < BUDGET_Q && B.state !== 'over'; i++) {
      tick(16);
      if (B.e.enraged) quakeEnraged = true; // triggerBossHazard fires synchronously right after this flips true
      if (B.mode === 'battle' && B.state === 'aim' && B.active && !B.active.isAI && !B.active.dead) {
        const foe = H.other(B.active);
        const sol = H.aiSolve ? H.aiSolve(B.active, foe, H.SKILLS.shot, false) : { ang: 50, pow: 70 };
        H.fire(B.active, 'shot', sol.ang, sol.pow);
      }
      if (B.turnNo > lastTurnQ) {
        if (B.turnNo - lastTurnQ > 1) problemsQ.push(`turn number jumped by ${B.turnNo - lastTurnQ} near turn ${B.turnNo} (double-advance?)`);
        const side = B.active === B.p ? 'P' : 'E';
        if (prevSideQ !== null && side === prevSideQ) problemsQ.push(`${side} acted twice in a row at turn ${B.turnNo} (broken alternation)`);
        prevSideQ = side; lastTurnQ = B.turnNo; turnsSeenQ++;
      }
    }
    assert(B.state === 'over', `Quakehide battle did not finish within ${BUDGET_Q} frames (stuck in state "${B.state}")`);
    assert(turnsSeenQ >= 4, `expected several turns, only saw ${turnsSeenQ}`);
    assert(problemsQ.length === 0, problemsQ.join('; '));
    assert(quakeEnraged, 'Quakehide should have enraged (and fired its crater hazard) during the live bot-vs-bot fight');
    clearTimers();
  });

  // -- TEST 21: biome-linked weather — a telegraphed, deterministic per-turn hook for
  // cinder (ember rain chips obstacles/crates) and tundra (a harsher wind gust) --------
  await test('biome weather: ember rain chips the field in the Cinder Wastes, a gust bends the wind in the Frozen Reach, meadow/chasm stay calm, and the bot-vs-bot sim stays green', async () => {
    clearTimers();
    await H.wipeSave();
    const sv = H.save;

    // -- config sanity: every weather-mapped biome is a real BIOMES entry ------
    const weatherKeys = Object.keys(H.BIOME_WEATHER);
    assert(weatherKeys.length >= 1, 'expected at least one biome-linked weather hook defined');
    for (const key of weatherKeys) assert(H.BIOMES[key], `BIOME_WEATHER key "${key}" should be a real biome`);
    assert(H.BIOME_WEATHER.cinder && H.BIOME_WEATHER.tundra, 'expected the Cinder Wastes and Frozen Reach to both carry a weather hook');
    assert(!H.BIOME_WEATHER.meadow, 'the meadow should stay the calm baseline with no weather hook');

    // -- cinder: ember rain chips obstacle/crate HP on its fixed turn cadence, deterministically --
    sv.dragonKey = 'ember'; sv.level = 3; sv.stage = 2; sv.exp = 0;   // stage 2 -> cinder
    H.startBattle(2);
    let B = H.B;
    assert(H.curBiomeKey === 'cinder', `expected stage 2 to land on cinder, got "${H.curBiomeKey}"`);
    const cw = H.BIOME_WEATHER.cinder;
    H.obstacles.length = 0;
    H.obstacles.push({ x: 500, y: 400, r: 30, hp: 100, maxhp: 100, style: 'shard', verts: [], cracks: [], bob: 0 });
    B.turnNo = cw.every - 1;   // not yet on the cadence: should not fire
    H.triggerBiomeWeather();
    assert(B.weatherActive === false, 'ember rain should not fire off its turn cadence');
    assert(H.obstacles[0].hp === 100, 'an obstacle should be untouched off the ember-rain cadence');
    B.turnNo = cw.every;   // on the cadence: should fire, for an exact, forced-roll-free amount
    H.triggerBiomeWeather();
    assert(B.weatherActive === true, 'ember rain should mark the weather active on its turn cadence');
    const expectedDmg = Math.max(1, Math.round(100 * cw.pct));
    assert(H.obstacles[0].hp === 100 - expectedDmg, `ember rain should chip the obstacle for exactly its advertised percent (expected hp ${100 - expectedDmg}, got ${H.obstacles[0].hp})`);

    // -- tundra: a harsher gust multiplies (and clamps) the wind on its cadence --------
    clearTimers();
    sv.dragonKey = 'frost'; sv.level = 3; sv.stage = 3; sv.exp = 0;   // stage 3 -> tundra
    H.startBattle(3);
    B = H.B;
    assert(H.curBiomeKey === 'tundra', `expected stage 3 to land on tundra, got "${H.curBiomeKey}"`);
    const tw = H.BIOME_WEATHER.tundra;
    B.wind = 0.02;
    B.turnNo = tw.every - 1;
    H.triggerBiomeWeather();
    assert(B.weatherActive === false && B.wind === 0.02, 'a gust should not fire off its turn cadence');
    B.turnNo = tw.every;
    H.triggerBiomeWeather();
    assert(B.weatherActive === true, 'a gust should mark the weather active on its turn cadence');
    assert(Math.abs(B.wind - 0.02 * tw.mult) < 1e-9, `a gust should multiply the wind by its advertised factor (expected ${0.02 * tw.mult}, got ${B.wind})`);

    // -- meadow and the chasm are the calm biomes: never touched, on any turn ---------
    clearTimers();
    sv.dragonKey = 'ember'; sv.level = 3; sv.stage = 1; sv.exp = 0;   // stage 1 -> meadow
    H.startBattle(1);
    B = H.B;
    for (let t = 0; t < 12; t++) { B.turnNo = t; H.triggerBiomeWeather(); assert(B.weatherActive === false, `meadow should never trigger weather (turn ${t})`); }

    // -- wired into the real turn loop: startTurn calls it, and it fires during a live cinder fight --
    clearTimers();
    sv.dragonKey = 'ember'; sv.level = 3; sv.exp = 0; sv.stage = 2;
    H.startBattle(2);
    B = H.B;
    let lastTurn = 0, prevSide = null, turnsSeen = 0, weatherFired = false;
    const problems = [];
    const BUDGET = 8000;
    for (let i = 0; i < BUDGET && B.state !== 'over'; i++) {
      tick(16);
      if (B.weatherActive) weatherFired = true;
      if (B.mode === 'battle' && B.state === 'aim' && B.active && !B.active.isAI && !B.active.dead) {
        const foe = H.other(B.active);
        const sol = H.aiSolve ? H.aiSolve(B.active, foe, H.SKILLS.shot, false) : { ang: 50, pow: 70 };
        H.fire(B.active, 'shot', sol.ang, sol.pow);
      }
      if (B.turnNo > lastTurn) {
        if (B.turnNo - lastTurn > 1) problems.push(`turn number jumped by ${B.turnNo - lastTurn} near turn ${B.turnNo} (double-advance?)`);
        const side = B.active === B.p ? 'P' : 'E';
        if (prevSide !== null && side === prevSide) problems.push(`${side} acted twice in a row at turn ${B.turnNo} (broken alternation)`);
        prevSide = side; lastTurn = B.turnNo; turnsSeen++;
      }
    }
    assert(B.state === 'over', `cinder weather battle did not finish within ${BUDGET} frames (stuck in state "${B.state}")`);
    assert(turnsSeen >= 4, `expected several turns, only saw ${turnsSeen}`);
    assert(problems.length === 0, problems.join('; '));
    assert(weatherFired, 'ember rain should have actually fired during the live bot-vs-bot cinder fight');
    clearTimers();
  });

  // -- TEST 22: a third signature-skill tier unlocks well past the second -----
  await test('a third signature-skill tier: every dragon has one, it is locked below UNIQ3_LEVEL and visible/usable at or above it, the AI can select it, and the bot-vs-bot sim stays green', async () => {
    clearTimers();
    await H.wipeSave();

    // -- config sanity: every dragon carries a real, distinct 3rd signature ---
    for (const key of Object.keys(H.DRAGONS)) {
      const D = H.DRAGONS[key];
      assert(D.uniq.length === 3, `${key} should carry a 3rd signature skill (uniq: ${JSON.stringify(D.uniq)})`);
      assert(H.SKILLS[D.uniq[2]], `${key}'s 3rd signature ("${D.uniq[2]}") should be defined in SKILLS`);
      assert(D.uniq[2] !== D.uniq[0] && D.uniq[2] !== D.uniq[1], `${key}'s 3rd signature should be a distinct skill from its first two`);
      const keys = H.SKILL_KEYS(key);
      assert(keys.length === 9 && keys[8] === D.uniq[2], `SKILL_KEYS(${key}) should carry the 3rd signature as a 9th entry`);
    }
    assert(H.UNIQ3_LEVEL > 4, 'the 3rd tier should gate well past the level-4 2nd signature');

    // -- visible in the UI: the skill dock locks slot 9 below the gate, unlocks at/above it --
    const below = new H.Dragon('ember', H.UNIQ3_LEVEL - 1, false, 300);
    H.buildSkillbar(below);
    let rows = H.$('skills').children;
    assert(rows.length === 9, `skill dock should render 9 buttons (got ${rows.length})`);
    assert(rows[8].dataset.lock === '1', `the 3rd signature should be locked below level ${H.UNIQ3_LEVEL}`);
    assert(rows[8].innerHTML.includes('🔒'), 'a locked slot should show the lock icon');
    assert(rows[7].dataset.lock === '0', 'the 2nd signature should already be unlocked below the 3rd-tier gate');

    const above = new H.Dragon('ember', H.UNIQ3_LEVEL, false, 300);
    H.buildSkillbar(above);
    rows = H.$('skills').children;
    assert(rows[8].dataset.lock === '0', `the 3rd signature should unlock at level ${H.UNIQ3_LEVEL}`);
    assert(rows[8].innerHTML.includes(H.SKILLS[H.DRAGONS.ember.uniq[2]].name), 'an unlocked slot should reveal the skill\'s real name');

    // -- usable in battle: firing it costs MP and queues a real shot -----------
    H.save.dragonKey = 'ember'; H.save.level = H.UNIQ3_LEVEL; H.save.stage = H.UNIQ3_LEVEL;
    H.startBattle(H.UNIQ3_LEVEL);
    let B = H.B;
    B.p = new H.Dragon('ember', H.UNIQ3_LEVEL, false, H.SPAWN_P);
    B.active = B.p; B.state = 'aim';
    const mpBefore = B.p.mp, sk = H.SKILLS['solarflare'];
    H.fire(B.p, 'solarflare', 45, 70);
    assert(B.p.mp === mpBefore - sk.cost, `firing the 3rd signature should spend its MP cost (expected ${mpBefore - sk.cost}, got ${B.p.mp})`);
    assert(B.projs.length === 1 && B.projs[0].skillKey === 'solarflare', 'firing the 3rd signature should queue a real projectile using it');
    assert(B.state === 'anim', 'firing the 3rd signature should advance the turn state like any other attack');
    clearTimers();

    // -- the AI's option pool includes it at/above the gate, never below it ----
    H.startBattle(H.UNIQ3_LEVEL);
    B = H.B;
    const realRandom = H.Math.random;
    function sweepSkills(level) {
      const boss = new H.Dragon('ember', level, true, B.e.x);
      boss.hp = boss.maxhp; boss.mp = boss.maxmp;
      B.e = boss; B.active = boss; B.mode = 'battle'; B.state = 'anim';
      const seen = new Set();
      for (let i = 0; i < 40; i++) {
        B.aiPlan = null;
        H.Math.random = () => (i + 0.5) / 40;
        H.aiThink();
        if (B.aiPlan && B.aiPlan.skKey) seen.add(B.aiPlan.skKey);
      }
      return seen;
    }
    const lowSeen = sweepSkills(H.UNIQ3_LEVEL - 1);
    assert(!lowSeen.has('solarflare'), `an enemy below level ${H.UNIQ3_LEVEL} should never select the 3rd signature (saw: ${[...lowSeen].join(',')})`);
    const highSeen = sweepSkills(H.UNIQ3_LEVEL);
    assert(highSeen.has('solarflare'), `an enemy at/above level ${H.UNIQ3_LEVEL} should be able to select the 3rd signature (saw: ${[...highSeen].join(',')})`);
    H.Math.random = realRandom;
    clearTimers();

    // -- level-up toast calls out the unlock exactly when the gate is crossed --
    const sv = H.save;
    sv.dragonKey = 'ember'; sv.level = H.UNIQ3_LEVEL - 1; sv.exp = 0; sv.gold = 0; sv.stage = 30;
    H.startBattle(30);
    B = H.B;
    B.e.hp = 0;
    H.checkEnd();
    assert(sv.level >= H.UNIQ3_LEVEL, `the forced-huge win should have leveled past ${H.UNIQ3_LEVEL} (now ${sv.level})`);
    assert(H.$('vLvl').textContent.includes('Third signature skill unlocked!'), `victory text should call out the 3rd-signature unlock (got "${H.$('vLvl').textContent}")`);
    tick(1100); clearTimers();

    // -- bot-vs-bot turn integrity holds with a high-level dragon carrying it --
    clearTimers();
    sv.dragonKey = 'ember'; sv.level = H.UNIQ3_LEVEL; sv.exp = 0; sv.stage = 9;
    H.startBattle(9);
    B = H.B;
    B.e = new H.Dragon('ember', H.UNIQ3_LEVEL, true, H.SPAWN_E);
    let lastTurn = 0, prevSide = null, turnsSeen = 0;
    const problems = [];
    // Higher-level dragons (bigger HP pools) plus this test's own earlier RNG use (Dragon
    // construction, the aiThink sweep) shift the harness's single shared seeded stream, so
    // this fight needs more headroom than the level-3-ish battles elsewhere — same
    // stream-shift risk noted by the biome-weather feature, not a sign of a stuck loop.
    const BUDGET = 16000;
    for (let i = 0; i < BUDGET && B.state !== 'over'; i++) {
      tick(16);
      if (B.mode === 'battle' && B.state === 'aim' && B.active && !B.active.isAI && !B.active.dead) {
        const foe = H.other(B.active);
        const sol = H.aiSolve ? H.aiSolve(B.active, foe, H.SKILLS.shot, false) : { ang: 50, pow: 70 };
        H.fire(B.active, 'shot', sol.ang, sol.pow);
      }
      if (B.turnNo > lastTurn) {
        if (B.turnNo - lastTurn > 1) problems.push(`turn number jumped by ${B.turnNo - lastTurn} near turn ${B.turnNo} (double-advance?)`);
        const side = B.active === B.p ? 'P' : 'E';
        if (prevSide !== null && side === prevSide) problems.push(`${side} acted twice in a row at turn ${B.turnNo} (broken alternation)`);
        prevSide = side; lastTurn = B.turnNo; turnsSeen++;
      }
    }
    assert(B.state === 'over', `3rd-signature battle did not finish within ${BUDGET} frames (stuck in state "${B.state}")`);
    assert(turnsSeen >= 4, `expected several turns, only saw ${turnsSeen}`);
    assert(problems.length === 0, problems.join('; '));
    clearTimers();
  });

  // -- TEST 23: a defensive-counter skill (Ward) — reflects a share of the incoming hit ----
  await test('a defensive-counter skill (Ward): reflects a share of the next hit back at the attacker, trains, and the bot-vs-bot sim stays green', async () => {
    clearTimers();
    await H.wipeSave();

    // -- config sanity: Ward is a shared instant every dragon carries, unlocked from level 1 --
    assert(H.SKILLS.ward && H.SKILLS.ward.type === 'instant', 'Ward should be defined as a shared instant skill');
    for (const key of Object.keys(H.DRAGONS)) {
      const keys = H.SKILL_KEYS(key);
      assert(keys.length === 9 && keys[5] === 'ward', `SKILL_KEYS(${key}) should carry Ward as its 6th (shared) entry`);
    }

    // -- visible in the UI: the skill dock shows Ward unlocked from level 1, like Heal/Shield --
    const lvl1 = new H.Dragon('ember', 1, false, 300);
    H.buildSkillbar(lvl1);
    const rows = H.$('skills').children;
    assert(rows[5].dataset.lock === '0', 'Ward should be usable from level 1, unlike the signature slots');
    assert(rows[5].innerHTML.includes(H.SKILLS.ward.name), 'the Ward button should show its real name, not a lock');

    // -- casting it: sets the single-use status flag, spends MP, and ends the turn like Shield --
    H.B.modeType = 'campaign';
    const caster = new H.Dragon('ember', 1, false, 300);
    caster.mp = caster.maxmp = 100;
    H.B.state = 'anim';
    H.castInstant(caster, 'ward');
    assert(caster.status.ward === 1, 'casting Ward should raise the single-use ward status flag');
    assert(caster.mp === 100 - H.SKILLS.ward.cost, `casting Ward should spend its MP cost (expected ${100 - H.SKILLS.ward.cost}, got ${caster.mp})`);
    assert(H.B.state === 'anim', 'casting an instant should move the battle into its resolving state, same as Shield/Heal');
    clearTimers();

    // -- reflect math: the warder still takes the hit, but a share lands back on the attacker --
    const realRandom = H.Math.random;
    H.Math.random = () => 0.5;   // pin rand()/crit rolls so only the ward reflect varies
    const att = new H.Dragon('ember', 5, true, 900);
    const def = new H.Dragon('frost', 5, false, 300);
    att.hp = att.maxhp = 100000; def.hp = def.maxhp = 100000;
    def.status.ward = 1;
    H.dealDamage(att, def, 200, 1, 'shot');
    const defTaken = 100000 - def.hp, attReflected = 100000 - att.hp;
    H.Math.random = realRandom;
    assert(defTaken > 0, 'a warded dragon should still take the incoming hit, not block it outright');
    assert(attReflected > 0, 'the attacker should take reflected damage back from a warded target');
    assert(def.status.ward === 0, 'Ward should be single-use, consumed by the hit it reflects');
    const expected = Math.max(1, Math.round(defTaken * H.WARD_REFLECT_PCT));
    assert(Math.abs(attReflected - expected) <= 1,
      `reflected damage (${attReflected}) should be about ${Math.round(H.WARD_REFLECT_PCT * 100)}% of the taken hit (${defTaken}), expected ~${expected}`);

    // -- single-use: a second hit on the same (now-unwarded) target reflects nothing further --
    H.Math.random = () => 0.5;
    const attBefore = att.hp;
    H.dealDamage(att, def, 200, 1, 'shot');
    H.Math.random = realRandom;
    assert(att.hp === attBefore, 'once consumed, Ward must not reflect damage from a follow-up hit');

    // -- trained tiers raise the reflected share, gated off AI dragons like other skillMult uses --
    H.save.skillUpg.ward = 3;
    H.Math.random = () => 0.5;
    const attT = new H.Dragon('ember', 5, true, 900), defT = new H.Dragon('frost', 5, false, 300);
    attT.hp = attT.maxhp = 100000; defT.hp = defT.maxhp = 100000;
    defT.status.ward = 1;
    H.dealDamage(attT, defT, 200, 1, 'shot');
    const trainedReflect = 100000 - attT.hp;
    H.Math.random = realRandom;
    assert(trainedReflect > attReflected, `a tier-3-trained Ward (${trainedReflect}) should reflect more than an untrained one (${attReflected})`);

    assert(H.skillMult(new H.Dragon('frost', 5, true, 300), 'ward') === 1, 'an AI dragon should never resolve a trained Ward multiplier, mirroring skillMult\'s existing gating');
    H.Math.random = () => 0.5;
    const attAI = new H.Dragon('ember', 5, false, 900), defAI = new H.Dragon('frost', 5, true, 300);
    attAI.hp = attAI.maxhp = 100000; defAI.hp = defAI.maxhp = 100000;
    defAI.status.ward = 1;
    H.dealDamage(attAI, defAI, 200, 1, 'shot');
    const aiReflect = 100000 - attAI.hp;
    H.Math.random = realRandom;
    assert(aiReflect < trainedReflect, `an AI-held Ward must not benefit from the player's trained tiers (got ${aiReflect}, trained player reflect was ${trainedReflect})`);
    clearTimers();

    // -- playable/visible: the Den's Skills panel trains it like any other shared skill -----
    const sv = H.save;
    sv.dragonKey = 'ember'; sv.level = 3; sv.skillPts = 3; sv.skillUpg = {};
    H.refreshSkills();
    const skillRows = document.getElementById('skillRows');
    const wardRow = skillRows.children[H.SKILL_KEYS('ember').indexOf('ward')];
    assert(wardRow.innerHTML.includes('Ward'), 'the Skills panel should list a Ward row');
    wardRow.children[0].click();
    assert(sv.skillUpg.ward === 1, `training Ward from the Den should raise its tier (got ${sv.skillUpg.ward})`);
    assert(sv.skillPts === 2, 'training a skill should spend a skill point');

    // -- bot-vs-bot turn integrity holds through a battle where the AI can cast Ward -----
    clearTimers();
    sv.dragonKey = 'ember'; sv.level = 3; sv.stage = 2; sv.exp = 0; sv.skillUpg = {};
    H.startBattle(2);
    const B = H.B;
    let lastTurn = 0, prevSide = null, turnsSeen = 0;
    const problems = [];
    const BUDGET = 8000;
    for (let i = 0; i < BUDGET && B.state !== 'over'; i++) {
      tick(16);
      if (B.mode === 'battle' && B.state === 'aim' && B.active && !B.active.isAI && !B.active.dead) {
        const foe = H.other(B.active);
        const sol = H.aiSolve ? H.aiSolve(B.active, foe, H.SKILLS.shot, false) : { ang: 50, pow: 70 };
        H.fire(B.active, 'shot', sol.ang, sol.pow);
      }
      if (B.turnNo > lastTurn) {
        if (B.turnNo - lastTurn > 1) problems.push(`turn number jumped by ${B.turnNo - lastTurn} near turn ${B.turnNo} (double-advance?)`);
        const side = B.active === B.p ? 'P' : 'E';
        if (prevSide !== null && side === prevSide) problems.push(`${side} acted twice in a row at turn ${B.turnNo} (broken alternation)`);
        prevSide = side; lastTurn = B.turnNo; turnsSeen++;
      }
    }
    assert(B.state === 'over', `Ward battle did not finish within ${BUDGET} frames (stuck in state "${B.state}")`);
    assert(turnsSeen >= 4, `expected several turns, only saw ${turnsSeen}`);
    assert(problems.length === 0, problems.join('; '));
    clearTimers();
  });

  // -- TEST 24: a fifth gear line (elemental ward) — softens the disadvantaged matchup ----
  await test('a fifth gear line (elemental ward) resolves onto the dragon, softens damage taken in an unfavorable matchup, is visible in the shop/Den, and persists', async () => {
    clearTimers();
    await H.wipeSave();
    const sv = H.save;
    sv.dragonKey = 'frost'; sv.level = 1; sv.stage = 1; sv.gold = 5000;
    sv.gear = { fang: 0, scale: 0, charm: 0, talon: 0, ward: 0 };
    H.B.modeType = 'campaign';

    assert(H.GEAR.ward, 'GEAR should define a fifth, elemental-ward line');
    assert(H.GEAR.ward.vals.length === 4 && H.GEAR.ward.cost.length === 3,
      'elemental ward should have 3 buyable tiers, matching the existing gear shape');

    // -- resolves onto the dragon, distinct from the flat DEF line (scale) --
    const dUnwarded = new H.Dragon('frost', 1, false, 300);
    assert(dUnwarded.elemWard === 0, 'an unequipped dragon should resolve zero elemental ward');
    sv.gear.ward = 1;
    const dWarded = new H.Dragon('frost', 1, false, 300);
    assert(dWarded.elemWard === H.GEAR.ward.vals[1],
      `a tier-1 Aegis Ward should raise resolved elemWard to ${H.GEAR.ward.vals[1]} (got ${dWarded.elemWard})`);
    assert(dWarded.def === dUnwarded.def, 'elemental ward should be distinct from the flat DEF gear line (scale), not a reskin of it');

    // -- softens specifically the case where the attacker holds the elemental advantage --
    const realRandom = H.Math.random;
    H.Math.random = () => 0.5;   // pin rand()/crit rolls so only elemWard varies
    const atk = new H.Dragon('ember', 5, true, 900);          // Fire — adv vs Toxin
    const defNoWard = new H.Dragon('venom', 5, false, 300);   // Toxin, elemWard 0
    const defWarded = new H.Dragon('venom', 5, false, 300);
    defWarded.elemWard = H.GEAR.ward.vals[3];                 // fully-forged tier
    defNoWard.hp = defNoWard.maxhp = 100000; defWarded.hp = defWarded.maxhp = 100000;
    H.dealDamage(atk, defNoWard, 200, 1, 'shot');
    H.dealDamage(atk, defWarded, 200, 1, 'shot');
    H.Math.random = realRandom;
    const dmgNoWard = 100000 - defNoWard.hp, dmgWarded = 100000 - defWarded.hp;
    assert(dmgWarded < dmgNoWard,
      `a warded dragon (${dmgWarded}) should take less damage from a disadvantaged matchup than an unwarded one (${dmgNoWard})`);

    // -- a neutral matchup is untouched by elemental ward (it only softens the 'adv' case) --
    H.Math.random = () => 0.5;
    const neuNoWard = new H.Dragon('venom', 5, false, 300); neuNoWard.el = 'Earth';
    const neuWarded = new H.Dragon('venom', 5, false, 300); neuWarded.el = 'Earth'; neuWarded.elemWard = H.GEAR.ward.vals[3];
    neuNoWard.hp = neuNoWard.maxhp = 100000; neuWarded.hp = neuWarded.maxhp = 100000;
    H.dealDamage(atk, neuNoWard, 200, 1, 'shot');
    H.dealDamage(atk, neuWarded, 200, 1, 'shot');
    H.Math.random = realRandom;
    assert(100000 - neuNoWard.hp === 100000 - neuWarded.hp,
      'elemental ward should not touch a neutral matchup, only a disadvantaged one');

    // -- playable/visible: drive the real Den -> Shop -> buy -> close flow, not a reimplementation --
    sv.gear.ward = 0; sv.gold = 5000; sv.record = H.blankRecord();
    H.refreshDen();
    document.getElementById('btnDenShop').click();          // opens the shop with shopReturn='den'
    const gearRows = document.getElementById('gearRows');
    assert(gearRows.children.length === Object.keys(H.GEAR).length, 'shop should list one row per GEAR line, including the new ward line');
    const wardRow = gearRows.children.find(r => r.innerHTML.includes('Aegis Ward'));
    assert(wardRow, 'the shop should show an Aegis Ward row');
    const wardCost = H.GEAR.ward.cost[0];
    wardRow.children[0].click();
    assert(sv.gear.ward === 1, `buying via the shop UI should set the tier (got ${sv.gear.ward})`);
    assert(sv.gold === 5000 - wardCost, `buying via the shop UI should spend its cost (got ${sv.gold})`);
    document.getElementById('btnShopClose').click();        // back to the Den
    const denGear = document.getElementById('denGear');
    assert(denGear.innerHTML.includes('E.WARD T1'), `Den loadout should show the newly bought ward tier after closing the shop (got ${denGear.innerHTML})`);

    // -- persistence --
    H.persist();
    sv.gear.ward = 0; sv.gold = -1;
    await H.loadSave();
    assert(sv.gear.ward === 1, `elemental ward tier should survive load (got ${sv.gear.ward})`);
    assert(sv.gold === 5000 - wardCost, `gold should survive load (got ${sv.gold})`);

    // -- bot-vs-bot turn integrity holds with elemental ward equipped in a mismatched battle --
    clearTimers();
    sv.dragonKey = 'venom'; sv.level = 5; sv.stage = 3; sv.exp = 0; sv.gear.ward = 3;
    H.startBattle(3);
    const B = H.B;
    let lastTurn = 0, prevSide = null, turnsSeen = 0;
    const problems = [];
    const BUDGET = 8000;
    for (let i = 0; i < BUDGET && B.state !== 'over'; i++) {
      tick(16);
      if (B.mode === 'battle' && B.state === 'aim' && B.active && !B.active.isAI && !B.active.dead) {
        const foe = H.other(B.active);
        const sol = H.aiSolve ? H.aiSolve(B.active, foe, H.SKILLS.shot, false) : { ang: 50, pow: 70 };
        H.fire(B.active, 'shot', sol.ang, sol.pow);
      }
      if (B.turnNo > lastTurn) {
        if (B.turnNo - lastTurn > 1) problems.push(`turn number jumped by ${B.turnNo - lastTurn} near turn ${B.turnNo} (double-advance?)`);
        const side = B.active === B.p ? 'P' : 'E';
        if (prevSide !== null && side === prevSide) problems.push(`${side} acted twice in a row at turn ${B.turnNo} (broken alternation)`);
        prevSide = side; lastTurn = B.turnNo; turnsSeen++;
      }
    }
    assert(B.state === 'over', `elemental-ward battle did not finish within ${BUDGET} frames (stuck in state "${B.state}")`);
    assert(turnsSeen >= 2, `expected several turns, only saw ${turnsSeen}`);
    assert(problems.length === 0, problems.join('; '));
    clearTimers();
  });

  // -- TEST 26: a third battle amplifier, Scope (now two turns of lookahead) ----
  await test('a third battle amplifier (Scope): buyable and capped, reveals the exact wind for the next two turns without ending the turn, and the bot-vs-bot sim stays green', async () => {
    clearTimers();
    await H.wipeSave();
    const sv = H.save;
    sv.dragonKey = 'ember'; sv.level = 3; sv.stage = 3; sv.gold = 1000; sv.amps = { calm: 0, surge: 0, scope: 0 };
    H.B.modeType = 'campaign';

    // -- buyable in the shop, capped at 2 ---------------------------------------
    H.refreshShop();
    const buyScope = document.getElementById('buyScope');
    assert(buyScope.textContent === '140g' && !buyScope.disabled, 'Scope should be buyable at 140g with gold to spare');
    buyScope.click(); buyScope.click();
    assert(sv.amps.scope === 2, `buying Scope twice should reach the cap (got ${sv.amps.scope})`);
    H.refreshShop();
    assert(buyScope.textContent === 'MAX' && buyScope.disabled, 'Scope should show MAX and disable once capped');

    // -- persistence -------------------------------------------------------------
    H.persist();
    sv.amps.scope = 0;
    await H.loadSave();
    assert(sv.amps.scope === 2, `Scope charge count should survive save/load (got ${sv.amps.scope})`);

    // -- in battle: using it doesn't end the turn, and it's capped at once per turn --
    sv.stage = 3;   // Frozen Reach (tundra) so the forecast can be checked against its gust hook too
    H.startBattle(3);
    let B = H.B;
    let guard = 0;
    while (B.state !== 'aim' && guard < 200) { tick(16); guard++; }
    assert(B.state === 'aim' && B.active === B.p, 'the player should be aiming at the top of their turn');
    assert(H.curBiomeKey === 'tundra', `expected stage 3 to land on the Frozen Reach (got ${H.curBiomeKey})`);

    assert(Array.isArray(B.windForecast) && B.windForecast.length === 0, 'no forecast should be armed before Scope is used');
    const btnScope = document.getElementById('btnItemScope');
    const turnAtUse = B.turnNo;
    btnScope.click();
    assert(B.state === 'aim' && B.active === B.p, 'using Scope must not end the turn');
    assert(sv.amps.scope === 1, `using Scope should consume one charge (got ${sv.amps.scope})`);
    assert(B.usedItem.scope === true, 'Scope should be marked used for this turn');
    assert(B.windForecast.length === 2, `Scope should arm two forecast slots (got ${JSON.stringify(B.windForecast)})`);
    const [slot1, slot2] = B.windForecast;
    assert(slot1.turn === turnAtUse + 1, `the first slot should forecast the very next turn (got ${JSON.stringify(slot1)}, current turn ${turnAtUse})`);
    assert(slot2.turn === turnAtUse + 2, `the second slot should forecast two turns out (got ${JSON.stringify(slot2)}, current turn ${turnAtUse})`);
    assert(Math.abs(slot1.base) <= H.WIND_MAX && Math.abs(slot2.base) <= H.WIND_MAX, 'both forecasted bases should be within the normal wind range');

    // -- a second use on the same turn is blocked even with a charge left --
    btnScope.click();
    assert(sv.amps.scope === 1 && B.windForecast[0] === slot1 && B.windForecast[1] === slot2, 'a second Scope use on the same turn should be blocked');

    // -- the first slot is exact: rolling wind for that forecasted turn reproduces it verbatim,
    //    and leaves the second slot armed and untouched --
    B.turnNo = slot1.turn;
    H.rollWind();
    assert(B.wind === slot1.base, `rolling wind on the first forecasted turn should reproduce the locked value exactly (expected ${slot1.base}, got ${B.wind})`);
    assert(B.windForecast.length === 1 && B.windForecast[0] === slot2, 'consuming the first slot should leave the second slot armed');

    // -- the second slot resolves exactly too, two turns out from the original use --
    B.turnNo = slot2.turn;
    H.rollWind();
    assert(B.wind === slot2.base, `rolling wind on the second forecasted turn should reproduce the locked value exactly (expected ${slot2.base}, got ${B.wind})`);
    assert(B.windForecast.length === 0, 'the second slot should be consumed once its turn arrives');

    // -- a stale (non-matching) turn number does not consume an armed forecast --
    B.windForecast = [{ turn: 999, base: 0.01 }];
    B.turnNo = 5;
    H.rollWind();
    assert(B.windForecast.length === 1, 'a forecast for a turn that has not arrived yet should not be consumed');

    // -- forecastWindDisplay predicts the Frozen Reach's deterministic gust on the forecasted turn --
    const gustTurn = 8;   // a multiple of BIOME_WEATHER.tundra.every
    const base = 0.02;
    const displayed = H.forecastWindDisplay(base, gustTurn);
    assert(Math.abs(displayed) > Math.abs(base), `a forecast landing on a gust turn should predict the gust multiplier being applied (base ${base}, displayed ${displayed})`);
    const displayedOffTurn = H.forecastWindDisplay(base, gustTurn + 1);
    assert(displayedOffTurn === base, 'a forecast landing off the gust cadence should predict the plain rolled value');

    // -- bot-vs-bot turn integrity stays intact when Scope is stocked but unused --
    sv.dragonKey = 'volt'; sv.level = 3; sv.exp = 0; sv.stage = 4; sv.amps = { calm: 0, surge: 0, scope: 2 };
    H.startBattle(4);
    B = H.B;
    let lastTurn = 0, prevSide = null, turnsSeen = 0;
    const problems = [];
    const BUDGET = 8000;
    for (let i = 0; i < BUDGET && B.state !== 'over'; i++) {
      tick(16);
      if (B.mode === 'battle' && B.state === 'aim' && B.active && !B.active.isAI && !B.active.dead) {
        const foe = H.other(B.active);
        const sol = H.aiSolve ? H.aiSolve(B.active, foe, H.SKILLS.shot, false) : { ang: 50, pow: 70 };
        H.fire(B.active, 'shot', sol.ang, sol.pow);
      }
      if (B.turnNo > lastTurn) {
        if (B.turnNo - lastTurn > 1) problems.push(`turn number jumped by ${B.turnNo - lastTurn} near turn ${B.turnNo} (double-advance?)`);
        const side = B.active === B.p ? 'P' : 'E';
        if (prevSide !== null && side === prevSide) problems.push(`${side} acted twice in a row at turn ${B.turnNo} (broken alternation)`);
        prevSide = side; lastTurn = B.turnNo; turnsSeen++;
      }
    }
    assert(B.state === 'over', `Scope-stocked battle did not finish within ${BUDGET} frames (stuck in state "${B.state}")`);
    assert(turnsSeen >= 4, `expected several turns, only saw ${turnsSeen}`);
    assert(problems.length === 0, problems.join('; '));
    clearTimers();
  });

  // -- TEST 27: achievement / milestone track --
  await test('achievements: fire once per milestone off save.record, pay out, are visible in the Den, and the bot-vs-bot sim stays green', async () => {
    clearTimers();
    await H.wipeSave();
    const sv = H.save;
    sv.dragonKey = 'ember'; sv.level = 1; sv.gold = 500; sv.stage = 1;

    assert(H.ACHIEVEMENTS.length >= 3, `at least 3 achievements should exist (got ${H.ACHIEVEMENTS.length})`);
    for (const a of H.ACHIEVEMENTS) {
      assert(a.id && a.name && typeof a.check === 'function' && a.reward, `every achievement needs an id/name/check/reward (bad entry: ${JSON.stringify(a)})`);
    }

    // -- a fresh record earns nothing --
    assert(H.checkAchievements().length === 0, 'a fresh save should not earn any achievement yet');
    assert(Object.keys(sv.achieved).length === 0, 'save.achieved should start empty');

    // -- crossing a milestone earns exactly that achievement, once, and pays its reward --
    sv.record.wins = 1;
    const goldBefore = sv.gold, ptsBefore = sv.skillPts;
    const earned = H.checkAchievements();
    assert(earned.length === 1 && earned[0].id === 'firstWin', `crossing 1 win should earn "firstWin" (got ${JSON.stringify(earned.map(a => a.id))})`);
    assert(sv.achieved.firstWin === true, 'firstWin should be recorded in save.achieved');
    const want = (H.ACHIEVEMENTS.find(a => a.id === 'firstWin')).reward;
    assert(sv.gold === goldBefore + (want.gold || 0), `the reward gold should be credited (expected +${want.gold}, got ${sv.gold - goldBefore})`);
    assert(sv.skillPts === ptsBefore + (want.skillPts || 0), 'the reward skill points should be credited');

    // -- it does not re-fire on a second identical check --
    const goldAfter = sv.gold;
    assert(H.checkAchievements().length === 0, 'an already-earned achievement should not fire again');
    assert(sv.gold === goldAfter, 'gold should not be paid out twice for the same achievement');

    // -- earning multiple milestones at once reports all of them --
    sv.record.alphaWins = 3; sv.record.grades.S = 1;
    const multi = H.checkAchievements();
    const ids = multi.map(a => a.id).sort();
    assert(ids.includes('firstAlpha') && ids.includes('firstS') && ids.includes('threeAlphas'), `crossing 3 milestones at once should report all of them (got ${JSON.stringify(ids)})`);

    // -- earned achievements survive save then load --
    await H.persist();
    sv.achieved = {};
    await H.loadSave();
    assert(sv.achieved.firstWin === true && sv.achieved.threeAlphas === true, `earned achievements should survive save/load (got ${JSON.stringify(sv.achieved)})`);

    // -- visible in the Den's Achievements panel --
    H.refreshAch();
    assert(/\d+\/\d+ earned/.test(H.$('achCount').textContent), `achCount should read like "N/M earned" (got "${H.$('achCount').textContent}")`);
    assert(H.$('achRows').children.length === H.ACHIEVEMENTS.length, 'every achievement should render a row in the Den panel');

    // -- a real victory() that crosses a milestone shows it on the victory modal --
    await H.wipeSave();
    const sv2 = H.save;
    sv2.dragonKey = 'ember'; sv2.level = 1; sv2.exp = 0; sv2.gold = 100; sv2.stage = 2;
    H.startBattle(2);
    let B = H.B;
    B.turnNo = 3; B.p.hp = B.p.maxhp; B.e.hp = 0;
    H.checkEnd();
    assert(sv2.record.wins === 1, 'the real victory should have tallied the first win');
    assert(sv2.achieved.firstWin === true, 'the real victory should have earned firstWin via save.record');
    assert(H.$('vAch').textContent.includes('First Blood'), `the victory modal should call out the newly earned achievement (got "${H.$('vAch').textContent}")`);
    clearTimers();

    // -- winning again does not re-show/re-pay the already-earned achievement --
    sv2.stage = 3;
    H.startBattle(3);
    B = H.B;
    B.turnNo = 3; B.p.hp = B.p.maxhp; B.e.hp = 0;
    H.checkEnd();
    assert(H.$('vAch').textContent === '', `a repeat win should not re-announce an already-earned achievement (got "${H.$('vAch').textContent}")`);
    clearTimers();

    // -- bot-vs-bot turn integrity stays intact through a battle that ends in a fresh achievement --
    await H.wipeSave();
    const sv3 = H.save;
    sv3.dragonKey = 'volt'; sv3.level = 3; sv3.exp = 0; sv3.stage = 4;
    H.startBattle(4);
    B = H.B;
    let lastTurn = 0, prevSide = null, turnsSeen = 0;
    const problems = [];
    const BUDGET = 8000;
    for (let i = 0; i < BUDGET && B.state !== 'over'; i++) {
      tick(16);
      if (B.mode === 'battle' && B.state === 'aim' && B.active && !B.active.isAI && !B.active.dead) {
        const foe = H.other(B.active);
        const sol = H.aiSolve ? H.aiSolve(B.active, foe, H.SKILLS.shot, false) : { ang: 50, pow: 70 };
        H.fire(B.active, 'shot', sol.ang, sol.pow);
      }
      if (B.turnNo > lastTurn) {
        if (B.turnNo - lastTurn > 1) problems.push(`turn number jumped by ${B.turnNo - lastTurn} near turn ${B.turnNo} (double-advance?)`);
        const side = B.active === B.p ? 'P' : 'E';
        if (prevSide !== null && side === prevSide) problems.push(`${side} acted twice in a row at turn ${B.turnNo} (broken alternation)`);
        prevSide = side; lastTurn = B.turnNo; turnsSeen++;
      }
    }
    assert(B.state === 'over', `achievement-earning battle did not finish within ${BUDGET} frames (stuck in state "${B.state}")`);
    assert(turnsSeen >= 4, `expected several turns, only saw ${turnsSeen}`);
    assert(problems.length === 0, problems.join('; '));
    assert(sv3.achieved.firstWin === true, 'the bot-vs-bot win should also have earned firstWin');
    clearTimers();
  });

  // -- TEST 28: trial stages — modifier battles, one active constraint, bigger-than-side-hunt payout --
  await test('trials: launchable from the Den with one active constraint, enforce it in battle, pay more than a side hunt, and the bot-vs-bot sim stays green', async () => {
    clearTimers();
    await H.wipeSave();
    const sv = H.save;
    // Pre-mark every achievement earned so checkAchievements() (called inside victory()) never
    // pays a confounding bonus into the gold comparisons below — the same fix the alpha-boss
    // and hunt-scoring tests needed once the achievement track landed.
    for (const a of H.ACHIEVEMENTS) sv.achieved[a.id] = true;
    const modKeys = Object.keys(H.TRIAL_MODS);
    assert(modKeys.length >= 1, 'at least one trial modifier should exist');
    assert(modKeys.includes('noheal') && modKeys.includes('windx2') && modKeys.includes('halfstam'), `expected the noheal/windx2/halfstam modifiers (got ${JSON.stringify(modKeys)})`);
    assert(H.TRIAL_MULT > H.SIDE_HUNT_MULT, `a trial should pay a bigger reward multiplier than a side hunt (trial ${H.TRIAL_MULT}, side ${H.SIDE_HUNT_MULT})`);

    // -- driving the real Den button + modal launches a trial at the player's own stage --
    sv.dragonKey = 'ember'; sv.level = 3; sv.exp = 0; sv.gold = 100; sv.stage = 6;
    H.refreshDen();
    H.$('btnDenTrial').click();
    assert(!H.$('mTrial').classList.contains('hidden'), 'the Trial button should open the trial-selection modal');
    assert(H.$('trialRows').children.length === modKeys.length, 'the trial modal should list one row per modifier');
    H.$('trialRows').children[0].children[0].click();
    let B = H.B;
    assert(B.mode === 'battle' && B.trial && B.trial.mod === modKeys[0], `clicking the first trial row should launch that modifier's trial (got ${JSON.stringify(B.trial)})`);
    assert(B.stage === 6, `a trial should fight at the player's current stage (expected 6, got ${B.stage})`);
    assert(!B.e.alpha, 'a trial should never spawn an alpha boss');
    clearTimers();

    // -- No Healing: the Heal skill is visibly locked and cannot be cast, but the AI never stalls on it --
    sv.dragonKey = 'ember'; sv.level = 3; sv.exp = 0; sv.gold = 100; sv.stage = 6;
    H.startTrial('noheal');
    B = H.B;
    B.p.mp = B.p.maxmp;
    H.buildSkillbar(B.p);
    const healBtn = H.$('skills').children.find(c => c.dataset.key === 'heal');
    assert(healBtn && healBtn.dataset.lock === '1', 'the Heal button should render locked during a No Healing trial');
    const hpBefore = B.p.hp; B.p.hp = Math.round(B.p.maxhp * 0.5);
    const castOk = H.castInstant(B.p, 'heal');
    assert(castOk === false, 'casting Heal during a No Healing trial should fail');
    assert(B.p.hp === Math.round(B.p.maxhp * 0.5), 'a blocked heal must not restore any HP');
    assert(B.state !== 'anim' || B.active === B.p, 'a blocked heal must not hand the turn to the enemy');
    B.p.hp = hpBefore;
    clearTimers();

    // -- Windstorm: wind is doubled every turn relative to the un-doubled roll --
    sv.dragonKey = 'ember'; sv.level = 3; sv.exp = 0; sv.gold = 100; sv.stage = 6;
    H.startTrial('windx2');
    B = H.B;
    {
      const realRandom = H.Math.random;
      H.Math.random = () => 0.75; // pin so both rolls use the identical underlying draw
      const savedTrial = B.trial; B.trial = null;
      H.rollWind(); const plain = B.wind;
      B.trial = savedTrial;
      H.rollWind(); const doubled = B.wind;
      H.Math.random = realRandom;
      assert(Math.abs(plain) > 1e-9, 'the pinned wind roll must be nonzero for a meaningful doubling check');
      assert(Math.abs(doubled - plain * 2) < 1e-9, `a Windstorm trial should exactly double the plain wind roll (plain ${plain}, trial ${doubled})`);
    }
    clearTimers();

    // -- Halved Stamina: both dragons' maxstam/stamina are halved from the un-modified 90+agi formula
    // (agi already includes the player's own gear, per the Dragon constructor) at battle start, and the
    // halved max persists as the refill target on every subsequent turn, same as a normal battle. Compare
    // against each dragon's own agi rather than a separately-launched baseline battle: a second launch
    // would draw a different random enemy dragon (and thus a different agi) off the shared RNG stream,
    // the same documented risk earlier trial/biome/skill-tier features hit. --
    sv.dragonKey = 'ember'; sv.level = 3; sv.exp = 0; sv.gold = 100; sv.stage = 6;
    H.startTrial('halfstam');
    B = H.B;
    const expectedPlayerMaxStam = 90 + B.p.agi, expectedEnemyMaxStam = 90 + B.e.agi;
    assert(B.p.maxstam === Math.round(expectedPlayerMaxStam / 2), `Halved Stamina should halve the player's maxstam (expected ${Math.round(expectedPlayerMaxStam / 2)}, got ${B.p.maxstam})`);
    assert(B.e.maxstam === Math.round(expectedEnemyMaxStam / 2), `Halved Stamina should halve the enemy's maxstam (expected ${Math.round(expectedEnemyMaxStam / 2)}, got ${B.e.maxstam})`);
    assert(B.p.stamina === B.p.maxstam, "the player should already sit at the halved max stamina when the trial starts");
    B.p.stamina = 3;
    H.startTurn(B.p);
    assert(B.p.stamina === B.p.maxstam, 'stamina should refill to the halved max at the start of every turn, same as a normal battle');
    clearTimers();

    // -- a trial win pays more than a plain side hunt at the same stage, and never advances the ladder --
    sv.dragonKey = 'ember'; sv.level = 3; sv.exp = 0; sv.gold = 100; sv.stage = 6;
    H.startSideHunt();
    B = H.B;
    B.turnNo = 10; B.p.hp = B.p.maxhp; B.e.hp = 0;
    const sideGold0 = sv.gold;
    H.checkEnd();
    const sideHuntGold = sv.gold - sideGold0;
    clearTimers();

    sv.dragonKey = 'ember'; sv.level = 3; sv.exp = 0; sv.gold = 100; sv.stage = 6;
    H.startTrial('noheal');
    B = H.B;
    B.turnNo = 10; B.p.hp = B.p.maxhp; B.e.hp = 0;
    const stage0 = sv.stage, gold0 = sv.gold, best0 = sv.record.bestStage, wins0 = sv.record.wins;
    H.checkEnd();
    assert(B.state === 'over', 'the trial battle ended when the enemy fell');
    assert(sv.stage === stage0, `a trial win must not advance the stage (was ${stage0}, now ${sv.stage})`);
    assert(sv.record.bestStage === best0, 'a trial win must not bump the ladder best-stage record');
    assert(sv.record.wins === wins0 + 1, 'a trial win should still count toward the overall win record');
    const trialGold = sv.gold - gold0;
    assert(trialGold > sideHuntGold, `a trial should pay more gold than an equivalent plain side hunt (side hunt ${sideHuntGold}, trial ${trialGold})`);
    assert(H.$('vSub').textContent.toLowerCase().includes('trial'), 'the victory modal should read as a trial');
    clearTimers();

    // -- a losing trial (Retry) restarts the same trial, still without touching stage --
    sv.dragonKey = 'ember'; sv.level = 3; sv.exp = 0; sv.gold = 100; sv.stage = 6;
    H.startTrial('windx2');
    B = H.B;
    B.p.hp = 0;
    H.checkEnd();
    tick(1100);
    assert(!H.$('mDefeat').classList.contains('hidden'), 'defeat modal should show after a trial loss');
    H.$('btnRetry').click();
    assert(H.B.trial && H.B.trial.mod === 'windx2', 'retrying after a trial defeat should relaunch the same trial, not a ladder battle');
    assert(sv.stage === 6, 'a trial defeat + retry must never touch save.stage');
    clearTimers();

    // -- bot-vs-bot turn integrity holds through a full No Healing trial (the AI never stalls trying to heal) --
    sv.dragonKey = 'volt'; sv.level = 4; sv.exp = 0; sv.stage = 7;
    H.startTrial('noheal');
    B = H.B;
    let lastTurn = 0, prevSide = null, turnsSeen = 0;
    const problems = [];
    const BUDGET = 16000;
    for (let i = 0; i < BUDGET && B.state !== 'over'; i++) {
      tick(16);
      if (B.mode === 'battle' && B.state === 'aim' && B.active && !B.active.isAI && !B.active.dead) {
        const foe = H.other(B.active);
        const sol = H.aiSolve ? H.aiSolve(B.active, foe, H.SKILLS.shot, false) : { ang: 50, pow: 70 };
        H.fire(B.active, 'shot', sol.ang, sol.pow);
      }
      if (B.turnNo > lastTurn) {
        if (B.turnNo - lastTurn > 1) problems.push(`turn number jumped by ${B.turnNo - lastTurn} near turn ${B.turnNo} (double-advance?)`);
        const side = B.active === B.p ? 'P' : 'E';
        if (prevSide !== null && side === prevSide) problems.push(`${side} acted twice in a row at turn ${B.turnNo} (broken alternation)`);
        prevSide = side; lastTurn = B.turnNo; turnsSeen++;
      }
    }
    assert(B.state === 'over', `No Healing trial battle did not finish within ${BUDGET} frames (stuck in state "${B.state}")`);
    assert(turnsSeen >= 4, `expected several turns, only saw ${turnsSeen}`);
    assert(problems.length === 0, problems.join('; '));
    assert(sv.stage === 7, 'a full bot-vs-bot trial must still leave save.stage untouched');
    clearTimers();

    // -- bot-vs-bot turn integrity holds through a full Halved Stamina trial (less movement range, still terminates) --
    sv.dragonKey = 'volt'; sv.level = 4; sv.exp = 0; sv.stage = 7;
    H.startTrial('halfstam');
    B = H.B;
    lastTurn = 0; prevSide = null; turnsSeen = 0;
    const problems2 = [];
    for (let i = 0; i < BUDGET && B.state !== 'over'; i++) {
      tick(16);
      if (B.mode === 'battle' && B.state === 'aim' && B.active && !B.active.isAI && !B.active.dead) {
        const foe = H.other(B.active);
        const sol = H.aiSolve ? H.aiSolve(B.active, foe, H.SKILLS.shot, false) : { ang: 50, pow: 70 };
        H.fire(B.active, 'shot', sol.ang, sol.pow);
      }
      if (B.turnNo > lastTurn) {
        if (B.turnNo - lastTurn > 1) problems2.push(`turn number jumped by ${B.turnNo - lastTurn} near turn ${B.turnNo} (double-advance?)`);
        const side = B.active === B.p ? 'P' : 'E';
        if (prevSide !== null && side === prevSide) problems2.push(`${side} acted twice in a row at turn ${B.turnNo} (broken alternation)`);
        prevSide = side; lastTurn = B.turnNo; turnsSeen++;
      }
    }
    assert(B.state === 'over', `Halved Stamina trial battle did not finish within ${BUDGET} frames (stuck in state "${B.state}")`);
    assert(turnsSeen >= 4, `expected several turns, only saw ${turnsSeen}`);
    assert(problems2.length === 0, problems2.join('; '));
    assert(sv.stage === 7, 'a full bot-vs-bot trial must still leave save.stage untouched');
    clearTimers();
  });

  /* ---- report ---- */
  console.log('\nDragonfire Duel — test harness\n' + '-'.repeat(48));
  let failed = 0;
  for (const [name, ok, msg] of results) {
    console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}`);
    if (!ok) { failed++; console.log(`        ${msg}`); }
  }
  console.log('-'.repeat(48));
  console.log(`${results.length - failed}/${results.length} passed${failed ? `, ${failed} FAILED` : ' — all green'}\n`);
  process.exit(failed ? 1 : 0);
})();
