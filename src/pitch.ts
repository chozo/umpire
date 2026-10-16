import {
  BALL_RADIUS,
  CATCH_Z,
  DRAG_DECEL,
  GAME,
  GRAVITY,
  PLATE_FRONT_Z,
  PLATE_HALF_WIDTH,
  PLATE_SIDE_Z,
  RUBBER_EDGE_X,
  difficulty,
  type PitchTypeName,
} from './config';
import type { ArmSlot } from './pitcher';

export type Vec3 = { x: number; y: number; z: number };

export type PitchTypeId = PitchTypeName;

// ax: グラブ側（右投手なら一塁側 = +x）への変化の加速度、ay: 重力以外の上下方向の加速度
// ゲームとして見て分かるよう、実際の投球より変化を大きめにしている
export const PITCH_TYPES: Record<PitchTypeId, { name: string; speed: number; ax: number; ay: number }> = {
  straight: { name: 'ストレート', speed: 1.0, ax: -1.5, ay: 5.5 },
  curve: { name: 'カーブ', speed: 0.78, ax: 4.5, ay: -7.0 },
  slider: { name: 'スライダー', speed: 0.87, ax: 7.5, ay: -1.5 },
  shoot: { name: 'シュート', speed: 0.92, ax: -7.5, ay: 1.0 },
  cutter: { name: 'カットボール', speed: 0.95, ax: 3.5, ay: 3.0 },
  changeup: { name: 'チェンジアップ', speed: 0.82, ax: -4.5, ay: -3.0 },
  fork: { name: 'フォーク', speed: 0.87, ax: 0, ay: -8.0 },
  sweeper: { name: 'スイーパー', speed: 0.83, ax: 9.5, ay: -1.0 },
  sinker: { name: 'シンカー', speed: 0.9, ax: -8.5, ay: -3.5 },
  twoseam: { name: 'ツーシーム', speed: 0.97, ax: -5.5, ay: 2.0 },
};

// 横の変化の加速度の上限（m/s²）。曲がりすぎて投げた瞬間に狙いが分かる球にしない
const MAX_AX = 10;

export const SLOT_NAMES: Record<ArmSlot, string> = { over: 'オーバー', side: 'サイド', under: 'アンダー' };

// 腕の振りによる変化の違い。サイド・アンダーは横の変化が大きく、アンダーは浮き上がる
const SLOT_BREAK: Record<ArmSlot, { ax: number; ay: number; dy: number }> = {
  over: { ax: 1, ay: 1, dy: 0 },
  side: { ax: 1.3, ay: 0.6, dy: 0 },
  under: { ax: 1.25, ay: 0.5, dy: 3 },
};

export type Trajectory = { p0: Vec3; v0: Vec3; a: Vec3; tCatch: number };

export function posAt(tr: Trajectory, t: number): Vec3 {
  return {
    x: tr.p0.x + tr.v0.x * t + 0.5 * tr.a.x * t * t,
    y: tr.p0.y + tr.v0.y * t + 0.5 * tr.a.y * t * t,
    z: tr.p0.z + tr.v0.z * t + 0.5 * tr.a.z * t * t,
  };
}

// z 座標に到達する最初の時刻
export function timeAtZ(p0z: number, vz: number, az: number, z: number): number {
  const c = p0z - z;
  if (Math.abs(az) < 1e-9) return -c / vz;
  const disc = vz * vz - 2 * az * c;
  return (-vz + Math.sqrt(Math.max(0, disc))) / az;
}

// 目標点（z = target.z を通過するときの位置）から初速を逆算する
export function solveTrajectory(p0: Vec3, target: Vec3, speedMs: number, accel: { x: number; y: number }): Trajectory {
  const a = { x: accel.x, y: accel.y - GRAVITY, z: -DRAG_DECEL };
  const vz = speedMs;
  const T = timeAtZ(p0.z, vz, a.z, target.z);
  const v0 = {
    x: (target.x - p0.x - 0.5 * a.x * T * T) / T,
    y: (target.y - p0.y - 0.5 * a.y * T * T) / T,
    z: vz,
  };
  const tCatch = timeAtZ(p0.z, vz, a.z, CATCH_Z);
  return { p0, v0, a, tCatch };
}

// ホームベース（真上から見た五角形, (x, z)）
export const PLATE_POLY: [number, number][] = [
  [-PLATE_HALF_WIDTH, PLATE_FRONT_Z],
  [PLATE_HALF_WIDTH, PLATE_FRONT_Z],
  [PLATE_HALF_WIDTH, PLATE_SIDE_Z],
  [0, 0],
  [-PLATE_HALF_WIDTH, PLATE_SIDE_Z],
];

// 点から五角形への符号付き距離（内側は負）
export function signedDistanceToPlate(x: number, z: number): number {
  let minD = Infinity;
  let inside = true;
  const n = PLATE_POLY.length;
  for (let i = 0; i < n; i++) {
    const [ax, az] = PLATE_POLY[i];
    const [bx, bz] = PLATE_POLY[(i + 1) % n];
    const ex = bx - ax;
    const ez = bz - az;
    const px = x - ax;
    const pz = z - az;
    const len2 = ex * ex + ez * ez;
    const u = Math.max(0, Math.min(1, (px * ex + pz * ez) / len2));
    const dx = px - u * ex;
    const dz = pz - u * ez;
    minD = Math.min(minD, Math.hypot(dx, dz));
    // 頂点の並びは真上から見て時計回り（x 右, z 下）→ 外積の符号で内外判定
    if (ex * pz - ez * px < 0) inside = false;
  }
  return inside ? -minD : minD;
}

export type Judgement = {
  strike: boolean;
  // ボールの端とベースの端との距離（m）。負 = ベースに重なった量、正 = 外れた量
  margin: number;
  close: boolean;
  closest: { t: number; x: number; y: number; z: number };
};

export function judge(tr: Trajectory): Judgement {
  const zStart = PLATE_FRONT_Z - BALL_RADIUS;
  const zEnd = BALL_RADIUS;
  const t0 = timeAtZ(tr.p0.z, tr.v0.z, tr.a.z, zStart);
  const t1 = timeAtZ(tr.p0.z, tr.v0.z, tr.a.z, zEnd);
  const steps = 400;
  let best = Infinity;
  let bestT = t0;
  for (let i = 0; i <= steps; i++) {
    const t = t0 + ((t1 - t0) * i) / steps;
    const p = posAt(tr, t);
    const d = signedDistanceToPlate(p.x, p.z);
    if (d < best) {
      best = d;
      bestT = t;
    }
  }
  const margin = best - BALL_RADIUS;
  const p = posAt(tr, bestT);
  return {
    strike: margin <= 0,
    margin,
    close: Math.abs(margin) < GAME.closeMargin,
    closest: { t: bestT, ...p },
  };
}

// ---- 投球の生成 ----

export function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Category = 'strike' | 'ball' | 'close';
// 際どい球のうち、ベースの前の角だけ（front）・奥だけ（back）をかすめる球
export type Clip = 'front' | 'back';

export type Pitch = {
  type: PitchTypeId;
  lefty: boolean;
  slot: ArmSlot;
  rubberX: number; // プレート上の立ち位置（0 = 中央、+ = 一塁側、- = 三塁側）
  clip: Clip | null;
  kmh: number;
  category: Category;
  traj: Trajectory;
  judgement: Judgement;
  target: Vec3;
};

export const DEFAULT_RELEASE: Vec3 = { x: -0.55, y: 1.9, z: -16.8 };

const TARGET_Z = (PLATE_FRONT_Z + PLATE_SIDE_Z) / 2;

export function buildPitch(opts: {
  type: PitchTypeId;
  lefty: boolean;
  kmh: number;
  release: Vec3;
  targetX: number;
  targetY: number;
  breakScale?: number;
  slot?: ArmSlot;
}): Trajectory {
  const def = PITCH_TYPES[opts.type];
  const glove = opts.lefty ? -1 : 1;
  const s = opts.breakScale ?? 1;
  const sb = SLOT_BREAK[opts.slot ?? 'over'];
  const ax = Math.max(-MAX_AX, Math.min(MAX_AX, def.ax * s * sb.ax));
  return solveTrajectory(opts.release, { x: opts.targetX, y: opts.targetY, z: TARGET_Z }, opts.kmh / 3.6, {
    x: ax * glove,
    y: def.ay * s * sb.ay + sb.dy,
  });
}

// 判定で最も近づいた位置が、ベースの前の角か奥か
export function clipOf(j: Judgement): Clip | null {
  if (j.closest.z < PLATE_FRONT_Z + 0.04) return 'front';
  if (j.closest.z > PLATE_SIDE_Z - 0.04) return 'back';
  return null;
}

function pickWeighted<T>(rng: () => number, items: readonly (readonly [T, number])[]): T {
  const total = items.reduce((a, [, w]) => a + w, 0);
  let r = rng() * total;
  for (const [v, w] of items) {
    if ((r -= w) < 0) return v;
  }
  return items[items.length - 1][0];
}

// 目標の余白 margin を満たす targetX を二分探索で求める（side: +1 = 一塁側, -1 = 三塁側）
export function solveTargetForMargin(
  base: Omit<Parameters<typeof buildPitch>[0], 'targetX'>,
  side: 1 | -1,
  margin: number,
): number {
  let lo = 0;
  let hi = 1.2;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    const m = judge(buildPitch({ ...base, targetX: side * mid })).margin;
    if (m < margin) lo = mid;
    else hi = mid;
  }
  return side * ((lo + hi) / 2);
}

const HORIZONTAL: PitchTypeId[] = ['slider', 'shoot', 'sweeper', 'sinker', 'twoseam'];

export type Force = Partial<{
  type: PitchTypeId;
  lefty: boolean;
  slot: ArmSlot;
  category: Category;
  margin: number;
  side: 1 | -1;
  clip: Clip;
  rubberX: number;
}>;

export function generatePitch(
  rng: () => number,
  index: number,
  releaseFor: (lefty: boolean, slot: ArmSlot) => Vec3,
  force?: Force,
): Pitch {
  const d = difficulty(index);
  let type = force?.type ?? pickWeighted(rng, d.pitchTypes);
  const lefty = force?.lefty ?? rng() < d.leftyRatio;
  const rs = rng();
  const slot: ArmSlot = force?.slot ?? (rs < d.underRatio ? 'under' : rs < d.underRatio + d.sideRatio ? 'side' : 'over');
  const rubberX =
    force?.rubberX ?? (rng() < d.rubberEdgeRatio ? (rng() < 0.5 ? 1 : -1) * RUBBER_EDGE_X : 0);
  const rel = releaseFor(lefty, slot);
  const release = { ...rel, x: rel.x + rubberX };
  const speedJitter = (rng() - 0.5) * 4;
  const targetY = 0.4 + rng() * 0.6; // 高さは判定に関係しない。低めにして、捕球位置がベースより下に映るようにする
  const breakScale = d.breakScale * (0.9 + rng() * 0.2);
  const makeBase = (type: PitchTypeId) => {
    const kmh = Math.round(d.fastballKmh * PITCH_TYPES[type].speed * (slot === 'under' ? 0.92 : 1) + speedJitter);
    return { type, lefty, slot, kmh, release, targetY, breakScale };
  };
  let base = makeBase(type);

  let category: Category;
  if (force?.category) category = force.category;
  else if (force?.clip) category = 'close';
  else {
    const r = rng();
    category = r < d.closeRatio ? 'close' : r < d.closeRatio + (1 - d.closeRatio) / 2 ? 'strike' : 'ball';
  }
  let side: 1 | -1 = force?.side ?? (rng() < 0.5 ? 1 : -1);
  const wantClip: Clip | null =
    force?.clip ?? (category === 'close' && force?.side === undefined && rng() < d.clipRatio ? (rng() < 0.5 ? 'front' : 'back') : null);

  let margin: number;
  if (force?.margin !== undefined) margin = force.margin;
  else if (category === 'strike') margin = d.tutorial ? -0.12 - rng() * 0.07 : -0.07 - rng() * 0.12; // ベースの内側にしっかり重なる球
  else if (category === 'ball') margin = d.tutorial ? 0.15 + rng() * 0.15 : 0.06 + rng() * 0.3;
  else margin = (0.002 + rng() * (GAME.closeMargin - 0.004)) * (rng() < 0.5 ? -1 : 1); // 際どい球: ストライクとボールが半々

  if (wantClip && force?.side === undefined) {
    // 前の角をかすめるのは「外へ逃げていく」側、奥をかすめるのは「内へ入ってくる」側。両側を試して合う方を使う。
    // 横に曲がらない球で作れなければ、横の変化が大きい球種に替える
    const fits = () => {
      for (const s of [side, -side as 1 | -1]) {
        const tr = buildPitch({ ...base, targetX: solveTargetForMargin(base, s, margin) });
        if (clipOf(judge(tr)) === wantClip) {
          side = s;
          return true;
        }
      }
      return false;
    };
    if (!fits() && !force?.type) {
      const pool = d.pitchTypes.filter(([t]) => HORIZONTAL.includes(t));
      type = pickWeighted(rng, pool.length ? pool : d.pitchTypes);
      base = makeBase(type);
      fits();
    }
  }
  const targetX = solveTargetForMargin(base, side, margin);
  const traj = buildPitch({ ...base, targetX });
  const judgement = judge(traj);
  return {
    type,
    kmh: base.kmh,
    lefty,
    slot,
    rubberX,
    clip: judgement.close ? clipOf(judgement) : null,
    category,
    traj,
    judgement,
    target: { x: targetX, y: targetY, z: TARGET_Z },
  };
}
