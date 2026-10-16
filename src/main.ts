import * as THREE from 'three';
import { Sfx } from './audio';
import { BALL_RADIUS, CAMERA, GAME, PLATE_FRONT_Z, SCORE, STAGE, difficulty } from './config';
import {
  PITCH_TYPES,
  SLOT_NAMES,
  generatePitch,
  mulberry32,
  posAt,
  timeAtZ,
  type Force,
  type Pitch,
  type Vec3,
} from './pitch';
import { Pitcher, RELEASE_T, WINDUP_END, type ArmSlot } from './pitcher';
import {
  BallView,
  Catcher,
  ReplayViz,
  buildStadium,
  makeTopCamera,
  makeUmpireCamera,
  resizeTopCamera,
  setUmpireZoom,
} from './scene';

type Call = 'strike' | 'ball';
type Phase = 'title' | 'set' | 'windup' | 'flight' | 'decide' | 'called' | 'replay' | 'result';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---- 描画の準備 ----
const canvas = $<HTMLCanvasElement>('c');
const view = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
buildStadium(scene);
const pitcher = new Pitcher();
scene.add(pitcher.mirror);
const catcher = new Catcher(scene);
const ball = new BallView(scene);
const replayViz = new ReplayViz(scene);
let umpCam = makeUmpireCamera(1);
let zoomK = 1; // タイトル画面ではピッチャーのアップ
const topCam = makeTopCamera(1);
let activeCam: THREE.Camera = umpCam;

function resize() {
  const w = view.clientWidth;
  const h = view.clientHeight;
  renderer.setSize(w, h, false);
  umpCam.aspect = w / h;
  setUmpireZoom(umpCam, zoomK);
  resizeTopCamera(topCam, w / h);
}
new ResizeObserver(resize).observe(view);
resize();

const sfx = new Sfx();

// ---- 状態 ----
const params = new URLSearchParams(location.search);
let rng = mulberry32(Number(params.get('seed')) || (Date.now() & 0xffffffff));

type Record = { pitch: Pitch; call: Call | null; correct: boolean; reaction: number; base: number; bonus: number; points: number };

const S = {
  phase: 'title' as Phase,
  t: 0, // フェーズ内の経過時間
  index: 0,
  score: 0,
  misses: 0,
  pitch: null as Pitch | null,
  call: null as Call | null,
  callAt: -1, // 捕球からの時間（捕球前なら負）
  flightT: 0,
  animT: 0,
  tFront: 0,
  caught: false,
  resolved: false,
  verdictShown: false,
  sinceCatch: 0,
  replaySub: 'slow' as 'slow' | 'top',
  records: [] as Record[],
  timeScale: 1,
  forced: null as null | Force,
  events: [] as string[],
};

const releaseCache = new Map<string, Vec3>();
function releaseFor(lefty: boolean, slot: ArmSlot) {
  const key = `${lefty}:${slot}`;
  if (!releaseCache.has(key)) releaseCache.set(key, pitcher.releasePoint(lefty, slot));
  return releaseCache.get(key)!;
}

const BEST_KEY = 'umpire.best';
function loadBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}
function saveBest(v: number) {
  try {
    localStorage.setItem(BEST_KEY, String(v));
  } catch {
    // 保存できない環境では記録しない
  }
}

// ---- UI ----
const ui = {
  hud: $('hud'),
  count: $('hud-count'),
  hand: $('hud-hand'),
  score: $('hud-score'),
  miss: $('hud-miss'),
  timer: $('timer'),
  timerBar: $('timer-bar'),
  info: $('pitch-info'),
  hint: $('hint'),
  call: $('call'),
  verdict: $('verdict'),
  replayTag: $('replay-tag'),
  replayText: $('replay-text'),
  title: $('title'),
  result: $('result'),
  btnBall: $('btn-ball'),
  btnStrike: $('btn-strike'),
};

function renderHud() {
  ui.count.textContent = String(S.index + 1);
  ui.score.textContent = S.score.toLocaleString();
  ui.miss.innerHTML = Array.from({ length: GAME.maxMisses }, (_, i) => `<i class="${i < S.misses ? 'on' : ''}"></i>`).join('');
  const lefty = S.pitch?.lefty ?? false;
  const slot = S.pitch?.slot ?? 'over';
  ui.hand.textContent = (lefty ? '左' : '右') + (slot === 'over' ? '投手' : `・${SLOT_NAMES[slot]}`);
  ui.hand.classList.toggle('lefty', lefty);
  ui.hand.classList.toggle('odd', slot !== 'over');
}

let hintTimer = 0;
function showHint(text: string, sec = 0.8) {
  ui.hint.textContent = text;
  ui.hint.hidden = false;
  hintTimer = sec;
}

function setButtonsArmed(on: boolean) {
  ui.btnBall.classList.toggle('idle', !on);
  ui.btnStrike.classList.toggle('idle', !on);
}

function clearOverlays() {
  ui.call.hidden = true;
  ui.verdict.hidden = true;
  ui.replayTag.hidden = true;
  ui.replayText.hidden = true;
  ui.info.hidden = true;
  ui.timer.hidden = true;
}

function setPhase(p: Phase) {
  S.phase = p;
  S.t = 0;
  S.events.push('phase:' + p);
  // 確認用の記録。読み出されなくても増え続けないようにする
  if (S.events.length > 500) S.events.splice(0, S.events.length - 200);
}

// ---- 進行 ----
function startGame() {
  sfx.unlock();
  sfx.startBgm();
  S.index = 0;
  S.score = 0;
  S.misses = 0;
  S.records = [];
  ui.title.hidden = true;
  ui.result.hidden = true;
  ui.hud.hidden = false;
  nextPitch();
  showHint('最初の3球は練習。ベースの上を見よう', 2.6);
}

function nextPitch() {
  clearOverlays();
  replayViz.show(false);
  catcher.group.visible = true;
  activeCam = umpCam;
  const forced = S.forced;
  S.forced = null;
  const lefty = forced?.lefty ?? undefined;
  // チュートリアルの第2球は第1球と逆（ストライクとボールの両方を見せる）
  const prev = S.records[S.records.length - 1];
  const tutorialCat: Force =
    S.index === 1 && prev && !forced ? { category: prev.pitch.judgement.strike ? 'ball' : 'strike' } : {};
  const p = generatePitch(rng, S.index, releaseFor, { ...tutorialCat, ...forced, ...(lefty === undefined ? {} : { lefty }) });
  S.pitch = p;
  S.call = null;
  S.callAt = -1;
  S.flightT = 0;
  S.animT = 0;
  S.caught = false;
  S.sinceCatch = 0;
  S.resolved = false;
  S.tFront = timeAtZ(p.traj.p0.z, p.traj.v0.z, p.traj.a.z, PLATE_FRONT_Z - 0.5);
  pitcher.setLefty(p.lefty);
  pitcher.setSlot(p.slot);
  pitcher.setRubberX(p.rubberX);
  pitcher.setPose(0);
  catcher.prepare(p.target, posAt(p.traj, p.traj.tCatch));
  ball.setTrail([]);
  renderHud();
  setButtonsArmed(false);
  setPhase('set');
}

function onCall(c: Call) {
  if (S.phase === 'replay') {
    finishReplay();
    return;
  }
  if (S.resolved || !S.pitch) return;
  if (S.phase === 'set' || S.phase === 'windup' || (S.phase === 'flight' && S.flightT < S.tFront)) {
    showHint('まだ早い！');
    return;
  }
  if (S.phase !== 'flight' && S.phase !== 'decide') return;
  if (S.call) return;
  S.call = c;
  S.callAt = S.caught ? S.t : 0;
  pressFx(c);
  if (S.caught) resolve();
}

function pressFx(c: Call) {
  const b = c === 'strike' ? ui.btnStrike : ui.btnBall;
  b.classList.add('pressed');
  setTimeout(() => b.classList.remove('pressed'), 120);
}

function resolve() {
  const p = S.pitch!;
  S.resolved = true;
  S.verdictShown = false;
  setButtonsArmed(false);
  ui.timer.hidden = true;
  const truth: Call = p.judgement.strike ? 'strike' : 'ball';
  const correct = S.call === truth;
  let base = 0;
  let bonus = 0;
  if (correct) {
    base = p.judgement.close ? SCORE.closeCorrect : SCORE.correct;
    bonus = SCORE.speedBonus.find((b) => S.callAt <= b.within)?.points ?? 0;
  } else {
    S.misses++;
  }
  const points = base + bonus;
  S.score += points;
  S.records.push({ pitch: p, call: S.call, correct, reaction: S.callAt, base, bonus, points });
  S.events.push(`resolve:${S.call ?? 'none'}:${truth}:${correct ? 'ok' : 'ng'}`);

  ui.call.hidden = false;
  ui.call.className = S.call ?? 'late';
  ui.call.textContent = S.call === 'strike' ? 'ストライーク！' : S.call === 'ball' ? 'ボール！' : '判定遅れ…';
  setPhase('called');
}

function showVerdict() {
  const r = S.records[S.records.length - 1];
  ui.verdict.hidden = false;
  if (r.correct) {
    const big = r.pitch.judgement.close;
    ui.verdict.className = 'ok' + (big ? ' big' : '');
    ui.verdict.innerHTML = (big ? 'ナイスジャッジ！' : '正解') + `<small>${r.bonus > 0 ? `${r.base} ＋ ${r.bonus}（早押しボーナス）` : r.base}</small>`;
    sfx.correct(big);
  } else {
    ui.verdict.className = 'ng';
    ui.verdict.innerHTML = r.call ? '誤審…' : '時間切れ';
    sfx.wrong();
  }
  renderHud();
}

function needsReplay() {
  const r = S.records[S.records.length - 1];
  return r.pitch.judgement.close || !r.correct;
}

function startReplay() {
  clearOverlays();
  ui.replayTag.hidden = false;
  replayViz.show(true);
  replayViz.setGhost(null, false);
  S.replaySub = 'slow';
  sfx.setBgmSlow(true);
  ball.setTrail([]);
  catcher.prepare(S.pitch!.target, posAt(S.pitch!.traj, S.pitch!.traj.tCatch));
  zoomK = 0;
  setUmpireZoom(umpCam, 0);
  setPhase('replay');
}

function replayCaption() {
  const p = S.pitch!;
  const j = p.judgement;
  const cm = Math.abs(j.margin * 100);
  const balls = Math.abs(j.margin) / (BALL_RADIUS * 2);
  const amount = cm < 10 ? `${cm.toFixed(1)}cm` : `ボール${balls.toFixed(1)}個分（${cm.toFixed(0)}cm）`;
  const where = p.clip === 'front' ? 'ベースの前の角' : p.clip === 'back' ? 'ベースの奥' : 'ベース';
  const detail = j.strike ? `${where}に <b>${amount}</b> かかっていた` : `${where}から <b>${amount}</b> 外れていた`;
  return (
    `<span class="res ${j.strike ? 'strike' : 'ball'}">${j.strike ? 'ストライク' : 'ボール'}</span>` +
    `${PITCH_TYPES[p.type].name} ${p.kmh}km/h ― ${detail}` +
    `<span class="next">タップで次へ</span>`
  );
}

function finishReplay() {
  if (S.phase !== 'replay') return;
  if (S.replaySub === 'slow' && S.t < GAME.replaySkipGuard) return;
  sfx.setBgmSlow(false);
  afterPitch();
}

// 段階が変わる球で知らせる
function stageMessage(i: number) {
  if (i === STAGE.tutorial) return 'ここから本番！ 際どい球も来るぞ';
  if (i === STAGE.oddSlot) return 'ここから変則投手が登場！';
  if (i === STAGE.rubberEdge) return 'プレートの端から角度をつけてくる！';
  if (i >= STAGE.speedUp && (i - STAGE.speedUp) % STAGE.speedUpEvery === 0) {
    const pct = Math.round((difficulty(i).speedUp - 1) * 100);
    return `球速アップ！（+${pct}%）`;
  }
  return null;
}

function afterPitch() {
  if (S.misses >= GAME.maxMisses) {
    showResult();
    return;
  }
  S.index++;
  nextPitch();
  const stageHint = stageMessage(S.index);
  if (stageHint) showHint(stageHint, 2.2);
}

// 退場までに正しくコールできた球数で決める
function rankTitle(ok: number) {
  if (ok >= 100) return 'AI球審';
  if (ok >= 50) return '神球審';
  if (ok >= 40) return '名球審';
  if (ok >= 30) return '一軍の球審';
  if (ok >= 20) return '二軍の球審';
  if (ok >= 10) return '審判見習い';
  return '草野球の審判';
}

function showResult() {
  clearOverlays();
  replayViz.show(false);
  catcher.group.visible = true;
  activeCam = umpCam;
  setUmpireZoom(umpCam, (zoomK = 1));
  setButtonsArmed(false);
  const n = S.records.length;
  const ok = S.records.filter((r) => r.correct).length;
  const close = S.records.filter((r) => r.pitch.judgement.close);
  const closeOk = close.filter((r) => r.correct).length;
  const best = loadBest();
  const isBest = S.score > best;
  if (isBest) saveBest(S.score);
  $('res-rank').textContent = rankTitle(ok);
  $('res-score').textContent = S.score.toLocaleString();
  $('res-correct').textContent = `${ok}球（${n}球中）`;
  $('res-close').textContent = `${closeOk} / ${close.length}球`;
  $('res-best').textContent = isBest ? '新記録！' : best > 0 ? `${best.toLocaleString()}点` : '―';
  $('res-best').classList.toggle('new', isBest);
  ui.hud.hidden = true;
  ui.result.hidden = false;
  sfx.stopBgm(0.4);
  sfx.ejected();
  setPhase('result');
}

function toTitle() {
  sfx.stopBgm();
  pitcher.setRubberX(0);
  ui.result.hidden = true;
  ui.title.hidden = false;
  ui.hud.hidden = true;
  setPhase('title');
}

// ---- 毎フレームの更新 ----
const handPos = new THREE.Vector3();
let spin = 0;

function ballInHand() {
  pitcher.mirror.updateMatrixWorld(true);
  pitcher.hand.getWorldPosition(handPos);
  ball.place(handPos);
}

// ミット: 低いまま横へ寄せ、ボールがベースの後ろを通り過ぎてから上げる（ベースを隠さない）
function trackMitt(p: Pitch, t: number) {
  const tr = p.traj;
  const side = Math.min(1, Math.max(0, (t - (tr.tCatch - 0.3)) / 0.24));
  const tBack = timeAtZ(tr.p0.z, tr.v0.z, tr.a.z, BALL_RADIUS);
  const pop = (t - tBack) / Math.max(1e-3, tr.tCatch - tBack);
  if (t <= tr.tCatch) catcher.track(side, pop);
  else catcher.settle(Math.min(1, (t - tr.tCatch - 0.08) / 0.3));
}

// 捕球後: ミットをボールごと下ろす
function settleBall(dt: number) {
  const p = S.pitch;
  if (!p || !S.caught) return;
  S.sinceCatch += dt;
  trackMitt(p, p.traj.tCatch + S.sinceCatch);
  ball.place(catcher.mittBall);
}

function update(dt: number) {
  S.t += dt;
  ball.tickFlash(dt);
  if (hintTimer > 0) {
    hintTimer -= dt;
    if (hintTimer <= 0) ui.hint.hidden = true;
  }
  const p = S.pitch;
  switch (S.phase) {
    case 'title':
    case 'result': {
      // 背景で軽く投球フォームを繰り返す
      S.animT = (S.animT + dt) % 3.2;
      pitcher.setPose(Math.min(S.animT, WINDUP_END));
      ballInHand();
      break;
    }
    case 'set': {
      pitcher.setPose(0);
      ballInHand();
      zoomK = Math.min(1, zoomK + dt / 0.45);
      setUmpireZoom(umpCam, zoomK);
      if (S.t >= GAME.setPause) setPhase('windup');
      break;
    }
    case 'windup': {
      S.animT = S.t;
      pitcher.setPose(S.animT);
      zoomK = 1 - Math.min(1, Math.max(0, (S.t - CAMERA.zoomOutFrom) / (CAMERA.zoomOutTo - CAMERA.zoomOutFrom)));
      setUmpireZoom(umpCam, zoomK);
      ballInHand();
      if (S.animT >= RELEASE_T && p) {
        S.flightT = S.animT - RELEASE_T;
        sfx.whoosh(p.traj.tCatch);
        setPhase('flight');
      }
      break;
    }
    case 'flight': {
      if (!p) break;
      if (zoomK !== 0) setUmpireZoom(umpCam, (zoomK = 0));
      S.flightT += dt;
      S.animT = RELEASE_T + S.flightT;
      pitcher.setPose(S.animT);
      if (S.flightT >= S.tFront) setButtonsArmed(!S.call);
      const t = Math.min(S.flightT, p.traj.tCatch);
      spin += dt * 60;
      ball.place(posAt(p.traj, t), spin);
      const trail: Vec3[] = [];
      for (let k = 0; k <= 6; k++) trail.push(posAt(p.traj, Math.max(0, t - k * 0.012)));
      ball.setTrail(trail);
      trackMitt(p, S.flightT);
      if (S.flightT >= p.traj.tCatch) {
        S.caught = true;
        ball.setTrail([]);
        ball.flash(posAt(p.traj, p.traj.tCatch));
        sfx.mitt();
        ui.info.hidden = false;
        ui.info.innerHTML =
          `${PITCH_TYPES[p.type].name} <b>${p.kmh}</b>km/h` +
          (p.rubberX ? `<small>プレートの${p.rubberX > 0 ? '一塁' : '三塁'}側から</small>` : '');
        S.events.push('catch');
        if (S.call) {
          S.callAt = 0;
          resolve();
        } else {
          setButtonsArmed(true);
          ui.timer.hidden = false;
          setPhase('decide');
        }
      }
      break;
    }
    case 'decide': {
      S.animT += dt;
      settleBall(dt);
      pitcher.setPose(S.animT);
      const left = 1 - S.t / GAME.decisionWindow;
      ui.timerBar.style.transform = `scaleX(${Math.max(0, left)})`;
      if (S.t >= GAME.decisionWindow) {
        S.call = null;
        S.callAt = GAME.decisionWindow;
        resolve();
      }
      break;
    }
    case 'called': {
      S.animT += dt;
      settleBall(dt);
      pitcher.setPose(Math.min(S.animT, WINDUP_END));
      if (S.t >= 0.45 && !S.verdictShown) {
        S.verdictShown = true;
        S.events.push('verdict:' + S.index);
        showVerdict();
      }
      if (S.t >= GAME.callDisplay + GAME.resultDisplay) {
        if (needsReplay()) startReplay();
        else afterPitch();
      }
      break;
    }
    case 'replay': {
      if (!p) break;
      if (S.replaySub === 'slow') {
        const tr = p.traj;
        const rt = S.t * GAME.replaySlow - 0.15; // リリースの少し前から映す
        const bt = Math.max(0, Math.min(rt, tr.tCatch));
        pitcher.setPose(RELEASE_T + rt);
        if (rt < 0) ballInHand();
        else ball.place(posAt(tr, bt), spin);
        replayViz.update(tr, bt, p.judgement.strike);
        trackMitt(p, bt);
        if (rt >= tr.tCatch + 0.12) {
          S.replaySub = 'top';
          S.t = 0;
          activeCam = topCam;
          catcher.group.visible = false;
          replayViz.setGhost(p.judgement.closest, p.judgement.strike);
          ui.replayText.hidden = false;
          ui.replayText.innerHTML = replayCaption();
          if (p.judgement.strike) sfx.tick();
        }
      } else if (S.t >= GAME.topViewHold + 1.2) {
        finishReplay();
      }
      break;
    }
  }
}

// ---- 入力 ----
ui.btnBall.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  onCall('ball');
});
ui.btnStrike.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  onCall('strike');
});
view.addEventListener('pointerdown', () => {
  if (S.phase === 'replay') finishReplay();
});
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  if (k === 'f' || e.key === 'ArrowLeft') onCall('ball');
  else if (k === 'j' || e.key === 'ArrowRight') onCall('strike');
  else if ((k === ' ' || k === 'enter') && (S.phase === 'title' || S.phase === 'result')) startGame();
  else if ((k === ' ' || k === 'enter') && S.phase === 'replay') finishReplay();
  else if (k === 'm') setBgm(!sfx.bgmOn);
});
$('btn-start').addEventListener('click', startGame);
$('btn-retry').addEventListener('click', startGame);
$('btn-title').addEventListener('click', toTitle);

// BGM のオン・オフ（ブラウザに保存）
const BGM_KEY = 'umpire.bgm';
function setBgm(on: boolean) {
  sfx.setBgmOn(on);
  try {
    localStorage.setItem(BGM_KEY, on ? '1' : '0');
  } catch {
    // 保存できない環境では今回だけ
  }
  document.querySelectorAll<HTMLButtonElement>('.bgm-toggle').forEach((b) => {
    b.textContent = on ? 'BGM オン' : 'BGM オフ';
    b.classList.toggle('off', !on);
  });
}
try {
  setBgm(localStorage.getItem(BGM_KEY) !== '0');
} catch {
  setBgm(true);
}
document.querySelectorAll<HTMLButtonElement>('.bgm-toggle').forEach((b) =>
  b.addEventListener('click', () => {
    sfx.unlock();
    setBgm(!sfx.bgmOn);
  }),
);
document.addEventListener('visibilitychange', () => sfx.suspend(document.hidden));

// ---- ループ ----
let last = performance.now();
let manual = false;
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!manual) {
    update(dt * S.timeScale);
    renderer.render(scene, activeCam);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---- 確認用の入口 ----
declare global {
  interface Window {
    __game: unknown;
  }
}
window.__game = {
  state: () => ({
    phase: S.phase,
    replaySub: S.replaySub,
    index: S.index,
    score: S.score,
    misses: S.misses,
    flightT: S.flightT,
    tFront: S.tFront,
    pitch: S.pitch && {
      type: S.pitch.type,
      lefty: S.pitch.lefty,
      slot: S.pitch.slot,
      rubberX: S.pitch.rubberX,
      clip: S.pitch.clip,
      kmh: S.pitch.kmh,
      category: S.pitch.category,
      strike: S.pitch.judgement.strike,
      margin: S.pitch.judgement.margin,
      close: S.pitch.judgement.close,
      tCatch: S.pitch.traj.tCatch,
      release: S.pitch.traj.p0,
    },
    records: S.records.map((r) => ({ call: r.call, correct: r.correct, base: r.base, bonus: r.bonus, points: r.points })),
  }),
  releasePoint: releaseFor,
  start: startGame,
  call: onCall,
  skip: finishReplay,
  toTitle,
  setTimeScale: (s: number) => (S.timeScale = s),
  setSeed: (n: number) => (rng = mulberry32(n)),
  force: (f: typeof S.forced) => (S.forced = f),
  // 次の投球を差し替えて最初から（撮影用）
  repitch: (f: typeof S.forced) => {
    S.forced = f;
    nextPitch();
  },
  // 第何球かを変える（撮影用。次の repitch から反映）
  setIndex: (n: number) => (S.index = n),
  manual: (on: boolean) => (manual = on),
  step: (dt: number, n = 1) => {
    for (let i = 0; i < n; i++) update(dt);
    renderer.render(scene, activeCam);
  },
  // 出来事を { type, args } で返して空にする（例: 'resolve:strike:ball:ng' → { type: 'resolve', args: ['strike', 'ball', 'ng'] }）
  drainEvents: () =>
    S.events.splice(0).map((e) => {
      const [type, ...args] = e.split(':');
      return { type, args };
    }),
  posePitcher: (t: number, lefty = false, slot: ArmSlot = 'over') => {
    pitcher.setLefty(lefty);
    pitcher.setSlot(slot);
    pitcher.setPose(t);
    ballInHand();
    renderer.render(scene, activeCam);
  },
  audio: sfx,
  camera: () => umpCam,
  setCamera: (pos: Vec3, look: Vec3, fov?: number) => {
    umpCam = makeUmpireCamera(view.clientWidth / view.clientHeight);
    umpCam.position.set(pos.x, pos.y, pos.z);
    if (fov) umpCam.fov = fov;
    umpCam.updateProjectionMatrix();
    umpCam.lookAt(look.x, look.y, look.z);
    activeCam = umpCam;
  },
};
