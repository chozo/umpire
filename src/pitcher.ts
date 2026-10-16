import * as THREE from 'three';
import { MOUND_HEIGHT, RUBBER_Z } from './config';
import type { Vec3 } from './pitch';

// ローポリのマネキン風ピッチャー。右投げで組み、左投げは全体を x 方向に鏡映する。
// ローカル座標: 前 = +z、左 = +x、右 = -x。セットポジションでは左肩を本塁へ向ける。

type Pose = {
  stride: number; // 本塁方向への体重移動（m）
  drop: number; // 腰の沈み込み（m）
  pelvisYaw: number;
  spineTwist: number;
  spineBend: number;
  spineTilt: number;
  headYaw: number;
  rAbd: number;
  rFlexS: number;
  rHor: number;
  rTwist: number;
  rElbow: number;
  lAbd: number;
  lFlexS: number;
  lHor: number;
  lTwist: number;
  lElbow: number;
  lFlex: number;
  lAbdLeg: number;
  lKnee: number;
  rFlex: number;
  rAbdLeg: number;
  rKnee: number;
};

const SET: Pose = {
  stride: 0, drop: 0, pelvisYaw: 0, spineTwist: 0, spineBend: 0.05, spineTilt: 0, headYaw: 1.3,
  rAbd: 0.12, rFlexS: 0.45, rHor: 0, rTwist: 1.5, rElbow: 2.0,
  lAbd: 0.12, lFlexS: 0.45, lHor: 0, lTwist: 1.5, lElbow: 2.0,
  lFlex: 0, lAbdLeg: 0.12, lKnee: 0.05, rFlex: 0, rAbdLeg: 0.12, rKnee: 0.05,
};

// [時刻, 姿勢の差分]
const KEYS: [number, Partial<Pose>][] = [
  [0.0, {}],
  [0.25, { lFlex: 0.5, lKnee: 0.6, spineTwist: -0.08 }],
  [0.5, { lFlex: 1.55, lKnee: 1.75, lAbdLeg: -0.05, spineTwist: -0.3, spineBend: -0.05, headYaw: 1.4 }],
  [
    0.85,
    {
      stride: 0.55, drop: 0.18, pelvisYaw: 0.3, spineTwist: -0.45, spineBend: 0.0, headYaw: 1.4,
      rAbd: 1.35, rFlexS: 0, rHor: -0.45, rTwist: -1.2, rElbow: 1.1,
      lAbd: 1.4, lFlexS: 0, lHor: 0, lTwist: 0, lElbow: 0.4,
      lFlex: 0.4, lAbdLeg: 1.0, lKnee: 0.6, rAbdLeg: 0.45, rKnee: 0.45, rFlex: 0.1,
    },
  ],
  [
    1.05,
    {
      stride: 0.95, drop: 0.26, pelvisYaw: 1.1, spineTwist: -0.35, spineBend: 0.15, spineTilt: -0.1, headYaw: 0.8,
      rAbd: 1.75, rFlexS: 0, rHor: -0.25, rTwist: -0.75, rElbow: 1.6,
      lAbd: 1.2, lFlexS: 0, lHor: 0.6, lTwist: 0.3, lElbow: 1.0,
      lFlex: 0.3, lAbdLeg: 1.0, lKnee: 0.6, rAbdLeg: 0.6, rKnee: 0.6, rFlex: 0.1,
    },
  ],
  [
    1.18,
    {
      stride: 1.1, drop: 0.3, pelvisYaw: 1.5, spineTwist: 0.15, spineBend: 0.45, spineTilt: -0.45, headYaw: 0.2,
      rAbd: 1.95, rFlexS: 0, rHor: 0.3, rTwist: 0.9, rElbow: 0.35,
      lAbd: 0.5, lFlexS: 0.3, lHor: 0.9, lTwist: 0.5, lElbow: 1.8,
      lFlex: 0.35, lAbdLeg: 0.95, lKnee: 0.55, rAbdLeg: 0.75, rKnee: 0.7, rFlex: 0.0,
    },
  ],
  [
    1.5,
    {
      stride: 1.15, drop: 0.34, pelvisYaw: 1.6, spineTwist: 0.45, spineBend: 1.0, spineTilt: -0.2, headYaw: 0,
      rAbd: 1.25, rFlexS: 0.2, rHor: 1.3, rTwist: 1.6, rElbow: 0.6,
      lAbd: 0.3, lFlexS: 0.3, lHor: 0.6, lTwist: 0.8, lElbow: 1.9,
      lFlex: 0.4, lAbdLeg: 0.9, lKnee: 0.6, rFlex: -0.7, rAbdLeg: 0.9, rKnee: 1.4,
    },
  ],
  [
    2.3,
    {
      stride: 1.0, drop: 0.08, pelvisYaw: 1.57, spineTwist: 0, spineBend: 0.2, spineTilt: 0, headYaw: 0,
      rAbd: 0.2, rFlexS: 0.4, rHor: 0, rTwist: 1.2, rElbow: 1.0,
      lAbd: 0.2, lFlexS: 0.4, lHor: 0, lTwist: 1.2, lElbow: 1.2,
      lFlex: 0.1, lAbdLeg: 0.55, lKnee: 0.25, rFlex: 0.1, rAbdLeg: 0.35, rKnee: 0.25,
    },
  ],
];

export const RELEASE_T = 1.18;
export const WINDUP_END = 2.3;

export type ArmSlot = 'over' | 'side' | 'under';

// 腕の振りの高さ（スリークォーター = over を基準に、加速からフォロースルーまでを差し替える）
const SLOT_KEYS: Record<ArmSlot, Record<number, Partial<Pose>>> = {
  over: {},
  side: {
    1.05: { spineTilt: 0.05, spineBend: 0.2, rAbd: 1.5, rHor: -0.35 },
    1.18: { spineTilt: 0.12, spineBend: 0.35, rAbd: 1.55, rHor: 0.25, rTwist: 0.6, rElbow: 0.25 },
    1.5: { spineTilt: 0.15, spineBend: 0.75, rAbd: 1.35, rHor: 1.4 },
  },
  under: {
    0.85: { drop: 0.3 },
    1.05: { stride: 1.05, drop: 0.48, spineTilt: 0.35, spineBend: 0.55, rAbd: 1.0, rHor: -0.5, rElbow: 0.9, rKnee: 1.0 },
    1.18: {
      stride: 1.25, drop: 0.56, spineTilt: 0.55, spineBend: 0.85, rAbd: 0.85, rHor: 0.2, rTwist: 0.4, rElbow: 0.2,
      lKnee: 0.9, rKnee: 1.2, rAbdLeg: 0.95,
    },
    1.5: { stride: 1.25, drop: 0.5, spineTilt: 0.4, spineBend: 1.1, rAbd: 0.9, rHor: 1.4, rKnee: 1.5 },
  },
};

const KEY_POSES: Record<ArmSlot, [number, Pose][]> = {
  over: build('over'),
  side: build('side'),
  under: build('under'),
};
function build(slot: ArmSlot): [number, Pose][] {
  return KEYS.map(([t, p]) => [t, { ...SET, ...p, ...SLOT_KEYS[slot][t] }]);
}
const POSE_KEYS = Object.keys(SET) as (keyof Pose)[];

// キーフレーム間を Catmull-Rom（エルミート補間）でなめらかにつなぐ
function samplePose(KEY_POSES: [number, Pose][], t: number): Pose {
  const n = KEY_POSES.length;
  if (t <= KEY_POSES[0][0]) return { ...KEY_POSES[0][1] };
  if (t >= KEY_POSES[n - 1][0]) return { ...KEY_POSES[n - 1][1] };
  let i = 0;
  while (t > KEY_POSES[i + 1][0]) i++;
  const [t0, p0] = KEY_POSES[i];
  const [t1, p1] = KEY_POSES[i + 1];
  const [tm, pm] = KEY_POSES[Math.max(0, i - 1)];
  const [tp, pp] = KEY_POSES[Math.min(n - 1, i + 2)];
  const h = t1 - t0;
  const u = (t - t0) / h;
  const h00 = 2 * u * u * u - 3 * u * u + 1;
  const h10 = u * u * u - 2 * u * u + u;
  const h01 = -2 * u * u * u + 3 * u * u;
  const h11 = u * u * u - u * u;
  const out = {} as Pose;
  for (const k of POSE_KEYS) {
    const m0 = i === 0 ? 0 : ((p1[k] - pm[k]) / (t1 - tm)) * h;
    const m1 = i + 2 >= n ? 0 : ((pp[k] - p0[k]) / (tp - t0)) * h;
    out[k] = h00 * p0[k] + h10 * m0 + h01 * p1[k] + h11 * m1;
  }
  return out;
}

const HIP_HEIGHT = 0.96;
// 18m 先でもフォームが見えるよう、実寸より少し大きく描く
const PITCHER_SCALE = 1.15;

export class Pitcher {
  readonly mirror = new THREE.Group();
  private root = new THREE.Group();
  private hipBase = new THREE.Group();
  private pelvis = new THREE.Group();
  private spine = new THREE.Group();
  private head = new THREE.Group();
  private rSh = new THREE.Group();
  private rTw = new THREE.Group();
  private rEl = new THREE.Group();
  private lSh = new THREE.Group();
  private lTw = new THREE.Group();
  private lEl = new THREE.Group();
  private lHip = new THREE.Group();
  private lKn = new THREE.Group();
  private rHip = new THREE.Group();
  private rKn = new THREE.Group();
  readonly hand = new THREE.Group(); // 投げる手（ボールを持つ位置）
  private lefty = false;
  private slot: ArmSlot = 'over';

  constructor() {
    const jersey = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.75 });
    const navy = new THREE.MeshStandardMaterial({ color: 0x1d2a4f, roughness: 0.6 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xd9a27a, roughness: 0.7 });
    const black = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5 });
    const leather = new THREE.MeshStandardMaterial({ color: 0x8a4b1f, roughness: 0.6 });

    const cap = (r: number, len: number, mat: THREE.Material, down = true) => {
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), mat);
      m.position.y = down ? -len / 2 : len / 2;
      m.castShadow = true;
      return m;
    };

    this.mirror.add(this.root);
    this.root.scale.setScalar(PITCHER_SCALE);
    this.root.position.set(0, MOUND_HEIGHT, RUBBER_Z + 0.15);
    this.root.rotation.y = -Math.PI / 2;
    this.root.add(this.hipBase);
    this.hipBase.position.y = HIP_HEIGHT;
    this.hipBase.add(this.pelvis);

    const pelvisMesh = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.22), jersey);
    pelvisMesh.castShadow = true;
    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.04, 0.23), navy);
    belt.position.y = 0.09;
    this.pelvis.add(pelvisMesh, belt);

    this.pelvis.add(this.spine);
    this.spine.position.y = 0.1;
    this.spine.rotation.order = 'YXZ';
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.3, 4, 12), jersey);
    torso.scale.set(1.15, 1, 0.75);
    torso.position.y = 0.27;
    torso.castShadow = true;
    this.spine.add(torso);

    // 頭と帽子
    this.spine.add(this.head);
    this.head.position.y = 0.6;
    const neck = cap(0.05, 0.06, skin, false);
    neck.position.y = 0.0;
    const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), skin);
    headMesh.position.y = 0.16;
    headMesh.scale.set(0.9, 1.05, 0.95);
    headMesh.castShadow = true;
    const capTop = new THREE.Mesh(new THREE.SphereGeometry(0.112, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), navy);
    capTop.position.y = 0.19;
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.012, 16, 1, false, -Math.PI / 2, Math.PI), navy);
    brim.position.set(0, 0.19, 0.07);
    brim.scale.set(1, 1, 1.2);
    this.head.add(neck, headMesh, capTop, brim);

    // 腕
    const buildArm = (sh: THREE.Group, tw: THREE.Group, el: THREE.Group, side: 1 | -1, holder: THREE.Object3D) => {
      sh.position.set(side * 0.21, 0.46, 0);
      sh.rotation.order = 'YZX';
      this.spine.add(sh);
      const shoulderBall = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 8), jersey);
      sh.add(shoulderBall, tw);
      tw.add(cap(0.058, 0.2, jersey));
      tw.add(el);
      el.position.y = -0.29;
      el.add(cap(0.05, 0.2, skin));
      holder.position.y = -0.28;
      el.add(holder);
    };
    buildArm(this.rSh, this.rTw, this.rEl, -1, this.hand);
    const rHandMesh = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), skin);
    this.hand.add(rHandMesh);
    const glove = new THREE.Group();
    const gloveMesh = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), leather);
    gloveMesh.scale.set(0.55, 1.1, 1.0);
    gloveMesh.castShadow = true;
    glove.add(gloveMesh);
    buildArm(this.lSh, this.lTw, this.lEl, 1, glove);

    // 脚
    const buildLeg = (hip: THREE.Group, kn: THREE.Group, side: 1 | -1) => {
      hip.position.set(side * 0.1, -0.06, 0);
      hip.rotation.order = 'ZXY';
      this.hipBase.add(hip);
      hip.add(cap(0.075, 0.33, jersey));
      hip.add(kn);
      kn.position.y = -0.44;
      kn.add(cap(0.06, 0.2, jersey));
      const sock = cap(0.055, 0.14, navy);
      sock.position.y = -0.3;
      kn.add(sock);
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.26), black);
      shoe.position.set(0, -0.46, 0.06);
      shoe.castShadow = true;
      kn.add(shoe);
    };
    buildLeg(this.lHip, this.lKn, 1);
    buildLeg(this.rHip, this.rKn, -1);

    this.setPose(0);
  }

  setLefty(lefty: boolean) {
    this.lefty = lefty;
    this.mirror.scale.x = lefty ? -1 : 1;
  }

  // プレート上の立ち位置（ワールド座標の x）
  setRubberX(x: number) {
    this.mirror.position.x = x;
  }

  setSlot(slot: ArmSlot) {
    this.slot = slot;
  }

  isLefty() {
    return this.lefty;
  }

  setPose(t: number) {
    const p = samplePose(KEY_POSES[this.slot], t);
    this.root.position.z = RUBBER_Z + 0.15 + p.stride;
    this.hipBase.position.y = HIP_HEIGHT - p.drop;
    this.root.position.y = MOUND_HEIGHT;
    this.pelvis.rotation.y = p.pelvisYaw;
    this.spine.rotation.set(p.spineBend, p.spineTwist, p.spineTilt);
    this.head.rotation.y = p.headYaw;

    this.rSh.rotation.set(-p.rFlexS, p.rHor, -p.rAbd);
    this.rTw.rotation.y = p.rTwist;
    this.rEl.rotation.z = -p.rElbow;
    this.lSh.rotation.set(-p.lFlexS, -p.lHor, p.lAbd);
    this.lTw.rotation.y = -p.lTwist;
    this.lEl.rotation.z = p.lElbow;

    this.lHip.rotation.set(-p.lFlex, 0, p.lAbdLeg);
    this.lKn.rotation.x = p.lKnee;
    this.rHip.rotation.set(-p.rFlex, 0, -p.rAbdLeg);
    this.rKn.rotation.x = p.rKnee;
  }

  // リリース時の手の位置（ワールド座標）
  releasePoint(lefty: boolean, slot: ArmSlot = 'over'): Vec3 {
    const prev = this.lefty;
    const prevSlot = this.slot;
    const prevX = this.mirror.position.x;
    this.mirror.position.x = 0;
    this.setLefty(lefty);
    this.slot = slot;
    this.setPose(RELEASE_T);
    this.mirror.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    this.hand.getWorldPosition(v);
    this.setLefty(prev);
    this.slot = prevSlot;
    this.mirror.position.x = prevX;
    return { x: v.x, y: v.y, z: v.z };
  }
}
