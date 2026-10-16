import { describe, expect, it } from 'vitest';
import { BALL_RADIUS, PLATE_HALF_WIDTH, difficulty } from '../src/config';
import {
  DEFAULT_RELEASE,
  PITCH_TYPES,
  buildPitch,
  generatePitch,
  judge,
  mulberry32,
  posAt,
  signedDistanceToPlate,
  type PitchTypeId,
} from '../src/pitch';

const release = (lefty: boolean) => ({ ...DEFAULT_RELEASE, x: lefty ? -DEFAULT_RELEASE.x : DEFAULT_RELEASE.x });

describe('ホームベースとの距離', () => {
  it('内側は負、外側は正', () => {
    expect(signedDistanceToPlate(0, -0.2)).toBeLessThan(0);
    expect(signedDistanceToPlate(0.3, -0.3)).toBeCloseTo(0.3 - PLATE_HALF_WIDTH, 6);
    expect(signedDistanceToPlate(-0.3, -0.3)).toBeCloseTo(0.3 - PLATE_HALF_WIDTH, 6);
    expect(signedDistanceToPlate(0, 0.1)).toBeCloseTo(0.1, 6);
  });
  it('後ろの斜めの辺の外側', () => {
    // (0.2, -0.05) は斜めの辺 x + z = 0 の外側（x + z > 0）
    expect(signedDistanceToPlate(0.2, -0.05)).toBeCloseTo((0.2 - 0.05) / Math.SQRT2, 6);
  });
});

describe('軌道', () => {
  it('目標点を通過する', () => {
    const tr = buildPitch({ type: 'slider', lefty: false, kmh: 130, release: DEFAULT_RELEASE, targetX: 0.1, targetY: 0.8 });
    // 目標点の z（ベース中央付近）
    const zT = (-0.4318 + -0.2159) / 2;
    const t = (-tr.v0.z + Math.sqrt(tr.v0.z ** 2 - 2 * tr.a.z * (tr.p0.z - zT))) / tr.a.z;
    const p = posAt(tr, t);
    expect(p.x).toBeCloseTo(0.1, 6);
    expect(p.y).toBeCloseTo(0.8, 6);
  });
  it('飛行時間は 0.35〜0.75 秒', () => {
    for (const kmh of [92, 118, 150]) {
      const tr = buildPitch({ type: 'straight', lefty: false, kmh, release: DEFAULT_RELEASE, targetX: 0, targetY: 0.8 });
      expect(tr.tCatch).toBeGreaterThan(0.35);
      expect(tr.tCatch).toBeLessThan(0.75);
    }
  });
  it('右投手のスライダーは一塁側（+x）、シュートは三塁側（-x）へ曲がる', () => {
    expect(PITCH_TYPES.slider.ax).toBeGreaterThan(0);
    expect(PITCH_TYPES.shoot.ax).toBeLessThan(0);
    const sl = buildPitch({ type: 'slider', lefty: true, kmh: 130, release: release(true), targetX: 0, targetY: 0.8 });
    expect(sl.a.x).toBeLessThan(0); // 左投手は逆
  });
});

describe('判定', () => {
  it('真ん中はストライク、大きく外れればボール', () => {
    const mid = judge(buildPitch({ type: 'straight', lefty: false, kmh: 140, release: DEFAULT_RELEASE, targetX: 0, targetY: 0.8 }));
    expect(mid.strike).toBe(true);
    const out = judge(buildPitch({ type: 'straight', lefty: false, kmh: 140, release: DEFAULT_RELEASE, targetX: 0.5, targetY: 0.8 }));
    expect(out.strike).toBe(false);
  });
  it('境界: ボールの端がベースの端にかかればストライク', () => {
    // 曲がらない球（加速度なし・正面から）なら、x = 幅/2 + 半径 が境界
    const base = { lefty: false, kmh: 140, release: { x: 0.25, y: 1.9, z: -16.8 }, targetY: 0.8, breakScale: 0 };
    const justIn = judge(buildPitch({ ...base, type: 'fork', targetX: PLATE_HALF_WIDTH + BALL_RADIUS - 0.001 }));
    const justOut = judge(buildPitch({ ...base, type: 'fork', targetX: PLATE_HALF_WIDTH + BALL_RADIUS + 0.001 }));
    expect(justIn.strike).toBe(true);
    expect(justOut.strike).toBe(false);
    expect(Math.abs(justIn.margin)).toBeLessThan(0.0015);
  });
  it('変化球がベースの後ろの角だけをかすめてもストライク', () => {
    // 左投手のシュート（+x へ曲がる）を、ベース前端では外、後ろでは内側に入るように
    const base = { type: 'slider' as PitchTypeId, lefty: false, kmh: 100, release: { x: -0.4, y: 1.9, z: -16.8 }, targetY: 0.8, breakScale: 1.5 };
    // 前端より手前で外 → 後ろで入る、を作るため、通過点を探す
    let found = false;
    for (let x = -0.35; x < -0.2; x += 0.002) {
      const tr = buildPitch({ ...base, targetX: x });
      const j = judge(tr);
      if (j.strike && j.closest.z > -0.4318 + 0.02) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });
});

describe('投球の生成', () => {
  it('カテゴリどおりの判定になる', () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 300; i++) {
      const p = generatePitch(rng, i % 40, release);
      if (p.category === 'strike') expect(p.judgement.strike).toBe(true);
      if (p.category === 'ball') expect(p.judgement.strike).toBe(false);
      if (p.category === 'close') expect(p.judgement.close).toBe(true);
    }
  });
  it('指定した余白どおりに作れる', () => {
    const rng = mulberry32(7);
    for (const m of [-0.02, -0.005, 0.005, 0.02]) {
      for (const type of Object.keys(PITCH_TYPES) as PitchTypeId[]) {
        const p = generatePitch(rng, 10, release, { type, margin: m, side: 1 });
        expect(p.judgement.margin).toBeCloseTo(m, 3);
        const q = generatePitch(rng, 10, release, { type, margin: m, side: -1, lefty: true });
        expect(q.judgement.margin).toBeCloseTo(m, 3);
      }
    }
  });
  it('前の角・奥だけをかすめる球を指定して作れる', () => {
    const rng = mulberry32(99);
    for (const clip of ['front', 'back'] as const) {
      let ok = 0;
      for (let i = 0; i < 60; i++) {
        const p = generatePitch(rng, 20, release, { clip });
        expect(p.judgement.close).toBe(true);
        if (p.clip === clip) ok++;
      }
      expect(ok / 60).toBeGreaterThan(0.8);
    }
  });
  it('第11球からサイドスロー・アンダースローが出る（それまでは出ない）', () => {
    const rng = mulberry32(5);
    const slots = (from: number) => new Set(Array.from({ length: 200 }, (_, k) => generatePitch(rng, from + (k % 10), release).slot));
    expect([...slots(0)]).toEqual(['over']);
    expect(slots(10)).toEqual(new Set(['over', 'side', 'under']));
  });
  it('第21球からプレートの端から投げ、リリース位置が横にずれる', () => {
    const rng = mulberry32(8);
    const before = Array.from({ length: 200 }, (_, k) => generatePitch(rng, k % 20, release));
    expect(before.every((p) => p.rubberX === 0)).toBe(true);
    const after = Array.from({ length: 200 }, () => generatePitch(rng, 20, release));
    const edge = after.filter((p) => p.rubberX !== 0);
    expect(edge.length).toBeGreaterThan(100);
    for (const p of edge) expect(p.traj.p0.x - release(p.lefty).x).toBeCloseTo(p.rubberX, 6);
  });
  it('第31球から5球ごとに球速が5%ずつ上がる', () => {
    expect(difficulty(29).speedUp).toBe(1);
    expect(difficulty(30).speedUp).toBeCloseTo(1.05, 9);
    expect(difficulty(34).speedUp).toBeCloseTo(1.05, 9);
    expect(difficulty(35).speedUp).toBeCloseTo(1.1025, 9);
    expect(difficulty(40).fastballKmh / difficulty(39).fastballKmh).toBeCloseTo(1.05, 2);
  });
  it('第1〜3球（チュートリアル）は際どい球がなく、変化の小さい球ではっきり分かれる', () => {
    const rng = mulberry32(31);
    for (let k = 0; k < 300; k++) {
      const p = generatePitch(rng, k % 3, release);
      expect(p.judgement.close).toBe(false);
      expect(Math.abs(p.judgement.margin)).toBeGreaterThan(0.1);
      expect(['straight', 'curve']).toContain(p.type);
      expect(p.slot).toBe('over');
    }
  });
  it('「全部ストライク」「全部ボール」では正解率が 6 割に届かない', () => {
    const rng = mulberry32(2026);
    let strikes = 0;
    const n = 1200;
    for (let i = 0; i < n; i++) {
      if (generatePitch(rng, i % 40, release).judgement.strike) strikes++;
    }
    const rate = strikes / n;
    expect(rate).toBeGreaterThan(0.4);
    expect(rate).toBeLessThan(0.6);
  });
});
