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
      startBattle, startDuel, checkEnd, fire, aiSolve, Dragon,
      persist, loadSave, wipeSave, ladderWindow, refreshDen, BIOME_ORDER, blankRecord
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
