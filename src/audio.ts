// Web Audio で合成する効果音。ユーザー操作の後に unlock() してから鳴らす。

const BGM_VOL = 0.32;
const BGM_SLOW_RATE = 0.7;

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;
  // BGM
  bgmOn = true;
  private bgmBuf: AudioBuffer | null = null;
  private bgmLoading = false;
  private bgmSrc: AudioBufferSourceNode | null = null;
  private bgmGain: GainNode | null = null;
  private bgmLp: BiquadFilterNode | null = null;
  private bgmWanted = false;
  private bgmSlow = false;

  unlock() {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.7;
        this.master.connect(this.ctx.destination);
      } catch {
        this.ctx = null;
      }
    }
    void this.ctx?.resume();
    if (this.ctx && !this.bgmBuf && !this.bgmLoading) {
      this.bgmLoading = true;
      renderCheer(this.ctx.sampleRate)
        .then((b) => {
          this.bgmBuf = b;
          if (this.bgmWanted) this.startBgm();
        })
        .catch(() => {
          // BGM が作れなくてもゲームは続ける
        });
    }
  }

  // タブが隠れたら音を止める
  suspend(on: boolean) {
    if (!this.ctx) return;
    void (on ? this.ctx.suspend() : this.ctx.resume());
  }

  startBgm() {
    this.bgmWanted = true;
    this.bgmSlow = false;
    if (!this.ctx || !this.master || !this.bgmBuf || this.bgmSrc) {
      this.applyBgmRate(0);
      return;
    }
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.bgmBuf;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 18000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(this.bgmOn ? BGM_VOL : 0.0001, ctx.currentTime + 0.6);
    src.connect(lp).connect(g).connect(this.master);
    src.start();
    this.bgmSrc = src;
    this.bgmGain = g;
    this.bgmLp = lp;
  }

  stopBgm(fade = 0.8) {
    this.bgmWanted = false;
    const src = this.bgmSrc;
    if (!src || !this.ctx || !this.bgmGain) return;
    const t = this.ctx.currentTime;
    this.bgmGain.gain.cancelScheduledValues(t);
    this.bgmGain.gain.setValueAtTime(Math.max(0.0001, this.bgmGain.gain.value), t);
    this.bgmGain.gain.exponentialRampToValueAtTime(0.0001, t + fade);
    src.stop(t + fade + 0.05);
    this.bgmSrc = null;
    this.bgmGain = null;
    this.bgmLp = null;
  }

  // リプレイ中はスロー再生（速度も音程も少し下がり、こもった音になる）
  setBgmSlow(on: boolean) {
    if (this.bgmSlow === on) return;
    this.bgmSlow = on;
    this.applyBgmRate(0.12);
  }

  private applyBgmRate(tc: number) {
    if (!this.ctx || !this.bgmSrc || !this.bgmLp) return;
    const t = this.ctx.currentTime;
    const rate = this.bgmSlow ? BGM_SLOW_RATE : 1;
    if (tc <= 0) this.bgmSrc.playbackRate.setValueAtTime(rate, t);
    else this.bgmSrc.playbackRate.setTargetAtTime(rate, t, tc);
    this.bgmLp.frequency.setTargetAtTime(this.bgmSlow ? 2600 : 18000, t, Math.max(0.01, tc));
  }

  setBgmOn(on: boolean) {
    this.bgmOn = on;
    if (!this.ctx || !this.bgmGain) return;
    const t = this.ctx.currentTime;
    this.bgmGain.gain.cancelScheduledValues(t);
    this.bgmGain.gain.setTargetAtTime(on ? BGM_VOL : 0.0001, t, 0.08);
  }

  // 確認用
  bgmState() {
    return {
      ready: !!this.bgmBuf,
      playing: !!this.bgmSrc,
      on: this.bgmOn,
      slow: this.bgmSlow,
      rate: this.bgmSrc?.playbackRate.value ?? 0,
    };
  }

  private noise(dur: number) {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }

  private ready() {
    return !!this.ctx && !!this.master && !this.muted;
  }

  // ミットに収まる「パン！」
  mitt() {
    if (!this.ready()) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const n = this.noise(0.12);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1400;
    bp.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(1.0, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    n.connect(bp).connect(g).connect(this.master!);
    n.start(t);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.08);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.7, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    o.connect(og).connect(this.master!);
    o.start(t);
    o.stop(t + 0.12);
  }

  // リリース時の風切り音
  whoosh(dur: number) {
    if (!this.ready()) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const n = this.noise(dur);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(500, t);
    bp.frequency.exponentialRampToValueAtTime(2500, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + dur * 0.9);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(bp).connect(g).connect(this.master!);
    n.start(t);
  }

  private tone(freq: number, start: number, dur: number, type: OscillatorType, vol: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(vol, start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g).connect(this.master!);
    o.start(start);
    o.stop(start + dur + 0.02);
  }

  correct(big: boolean) {
    if (!this.ready()) return;
    const t = this.ctx!.currentTime;
    const notes = big ? [784, 988, 1175, 1568] : [880, 1175];
    notes.forEach((f, i) => this.tone(f, t + i * 0.07, 0.22, 'triangle', 0.25));
  }

  wrong() {
    if (!this.ready()) return;
    const t = this.ctx!.currentTime;
    this.tone(196, t, 0.35, 'square', 0.12);
    this.tone(147, t + 0.16, 0.45, 'square', 0.12);
  }

  tick() {
    if (!this.ready()) return;
    this.tone(1320, this.ctx!.currentTime, 0.05, 'sine', 0.12);
  }

  ejected() {
    if (!this.ready()) return;
    const t = this.ctx!.currentTime;
    [523, 415, 330, 262].forEach((f, i) => this.tone(f, t + i * 0.18, 0.35, 'sawtooth', 0.08));
  }
}

// ---- 応援風の BGM ----
// トランペット・太鼓・メガホン・観客のざわめきを OfflineAudioContext で一度だけ合成し、ループ再生する。
// リプレイ中は再生速度を落とす（テープの遅回しのように音程も下がる）。曲はこのゲームのための自作。

const BPM = 150;
const BEAT = 60 / BPM;
const BARS = 8;
export const BGM_LOOP_SEC = BARS * 4 * BEAT;

// 半音（0 = C5）と長さ（8分音符単位）。null は休み
type Note = [number | null, number];
const RIFF: Note[][] = [
  [[-5, 1], [0, 1], [0, 1], [4, 1], [7, 2], [4, 1], [0, 1]],
  [[2, 1], [2, 1], [4, 1], [5, 1], [4, 2], [0, 2]],
  [[-5, 1], [0, 1], [0, 1], [4, 1], [7, 2], [9, 1], [7, 1]],
  [[5, 1], [4, 1], [2, 1], [4, 1], [0, 3], [null, 1]],
  // 三三七拍子（後半4小節）: トランペットは拍に合わせて短く吹く
  [[7, 2], [7, 2], [7, 2], [null, 2]],
  [[9, 2], [9, 2], [9, 2], [null, 2]],
  [[7, 2], [7, 2], [7, 2], [7, 2]],
  [[12, 2], [12, 2], [12, 2], [null, 2]],
];
// 太鼓を打つ拍（小節内の 8分音符の位置）
const DRUM: number[][] = [
  [0, 2, 4, 6], [0, 2, 4, 5, 6], [0, 2, 4, 6], [0, 2, 4, 5, 6],
  [0, 2, 4], [0, 2, 4], [0, 2, 4, 6], [0, 2, 4],
];

function brass(ctx: BaseAudioContext, out: AudioNode, semi: number, t: number, dur: number, vol: number) {
  const f = 523.25 * 2 ** (semi / 12);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 2;
  lp.frequency.setValueAtTime(f * 1.5, t);
  lp.frequency.linearRampToValueAtTime(f * 6, t + 0.04);
  lp.frequency.exponentialRampToValueAtTime(f * 3, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.025);
  g.gain.setValueAtTime(vol * 0.8, t + Math.max(0.03, dur - 0.05));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  lp.connect(g).connect(out);
  // 少しずらした 2 本 + 3度下のハモり
  for (const [mul, det, v] of [[1, -6, 1], [1, 7, 1], [2 ** (-4 / 12), 0, 0.45]] as const) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f * mul;
    o.detune.value = det;
    const og = ctx.createGain();
    og.gain.value = v;
    o.connect(og).connect(lp);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
}

function drum(ctx: BaseAudioContext, out: AudioNode, t: number, vol: number) {
  const o = ctx.createOscillator();
  o.frequency.setValueAtTime(130, t);
  o.frequency.exponentialRampToValueAtTime(55, t + 0.18);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + 0.32);
}

function noiseBuffer(ctx: BaseAudioContext, sec: number) {
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * sec), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

// メガホンを打ち鳴らす音
function clap(ctx: BaseAudioContext, out: AudioNode, noise: AudioBuffer, t: number, vol: number) {
  const s = ctx.createBufferSource();
  s.buffer = noise;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1600;
  bp.Q.value = 1.2;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  s.connect(bp).connect(g).connect(out);
  s.start(t, Math.random() * 0.5, 0.1);
}

export async function renderCheer(sampleRate = 44100): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(1, Math.ceil(sampleRate * BGM_LOOP_SEC), sampleRate);
  const bus = ctx.createGain();
  bus.gain.value = 0.8;
  bus.connect(ctx.destination);
  const noise = noiseBuffer(ctx, 1);
  const E = BEAT / 2;
  for (let bar = 0; bar < BARS; bar++) {
    const t0 = bar * 4 * BEAT;
    let pos = 0;
    for (const [semi, len] of RIFF[bar]) {
      if (semi !== null) brass(ctx, bus, semi, t0 + pos * E, len * E * 0.92, 0.09);
      pos += len;
    }
    for (const e of DRUM[bar]) drum(ctx, bus, t0 + e * E, 0.9);
    // メガホン: 前半は裏拍、三三七拍子は太鼓と同時
    const claps = bar < 4 ? [1, 3, 5, 7] : DRUM[bar];
    for (const e of claps) clap(ctx, bus, noise, t0 + e * E, 0.35);
  }
  // 観客のざわめき（ループの継ぎ目が目立たないよう一定の音量）
  const crowd = ctx.createBufferSource();
  crowd.buffer = noiseBuffer(ctx, BGM_LOOP_SEC);
  const cf = ctx.createBiquadFilter();
  cf.type = 'bandpass';
  cf.frequency.value = 700;
  cf.Q.value = 0.5;
  const cg = ctx.createGain();
  cg.gain.value = 0.05;
  crowd.connect(cf).connect(cg).connect(ctx.destination);
  crowd.start(0);
  return ctx.startRendering();
}
