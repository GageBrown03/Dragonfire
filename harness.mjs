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
      startBattle, startDuel, startSideHunt, checkEnd, fire, aiSolve, Dragon,
      persist, loadSave, wipeSave, ladderWindow, refreshDen, BIOME_ORDER, blankRecord,
      castInstant, skillMult, refreshSkills, SKILL_KEYS, refreshShop,
      dealDamage, effectiveAtk, ALPHA_TITLES, ENRAGE_HP_PCT, ENRAGE_ATK_MULT, Math,
      elRel, elMult, ELEMENT_ORDER, ampMult, AMP_SURGE_MULT,
      get crates(){ return crates; }, makeCrates, damageCrate, CRATE_CHANCE, explode,
      huntGrade, HUNT_GRADES, SIDE_HUNT_MULT, $,
      blankStones, addStone, synthesizeStone, socketStone, unsocketStone, pickStoneTier, stoneMult, stoneLabel,
      STONE_TIER_PCT, STONE_MAX_TIER, STONE_SOCKETS, STONE_MISMATCH_MULT, STONE_DROP_BASE, STONE_TIER_WEIGHTS,
      refreshStones, victory
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
