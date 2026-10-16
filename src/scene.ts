import * as THREE from 'three';
import { BALL_RADIUS, CAMERA, CATCH_Z, MITT_LOW_Y, MOUND_HEIGHT, RUBBER_Z } from './config';
import { PLATE_POLY, posAt, type Trajectory, type Vec3 } from './pitch';

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildStadium(scene: THREE.Scene) {
  scene.background = canvasTexture(4, 256, (g) => {
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, '#3f7fd0');
    grd.addColorStop(0.55, '#9cc8ef');
    grd.addColorStop(1, '#dcebf5');
    g.fillStyle = grd;
    g.fillRect(0, 0, 4, 256);
  });
  scene.fog = new THREE.Fog(0xcfe2f0, 60, 220);

  const hemi = new THREE.HemisphereLight(0xdfefff, 0x4a6b2a, 1.4);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3df, 2.4);
  sun.position.set(-8, 20, 6);
  sun.target.position.set(0, 0, RUBBER_Z + 1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const sc = sun.shadow.camera;
  sc.left = -4;
  sc.right = 4;
  sc.top = 4;
  sc.bottom = -4;
  sc.near = 5;
  sc.far = 45;
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);

  // 芝（縞模様）
  const grassTex = canvasTexture(64, 64, (g) => {
    g.fillStyle = '#3f8a37';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#4a9a40';
    g.fillRect(0, 0, 64, 32);
  });
  grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping;
  grassTex.repeat.set(1, 30);
  grassTex.magFilter = THREE.NearestFilter;
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(320, 320), new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 }));
  grass.rotation.x = -Math.PI / 2;
  grass.rotation.z = Math.PI / 4;
  grass.position.set(0, 0, -100);
  grass.receiveShadow = true;
  scene.add(grass);

  const dirt = new THREE.MeshStandardMaterial({ color: 0xb07a4a, roughness: 1 });
  const flat = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, z: number, y: number) => {
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  // 内野の土（大きな扇形）と内野の芝
  flat(new THREE.CircleGeometry(29, 64), dirt, 0, RUBBER_Z, 0.004);
  const infieldGrass = new THREE.MeshStandardMaterial({ color: 0x4a9a40, roughness: 1 });
  const d = 27.43 / Math.SQRT2;
  const diamond = new THREE.Shape();
  diamond.moveTo(0, 2.8);
  diamond.lineTo(d - 2.8, d);
  diamond.lineTo(0, 2 * d - 2.8);
  diamond.lineTo(-(d - 2.8), d);
  diamond.closePath();
  const dg = new THREE.ShapeGeometry(diamond);
  const dm = new THREE.Mesh(dg, infieldGrass);
  dm.rotation.x = -Math.PI / 2; // シェイプの +y を -z（投手方向）へ
  dm.position.y = 0.008;
  dm.receiveShadow = true;
  scene.add(dm);
  // 本塁まわりの土とマウンド
  flat(new THREE.CircleGeometry(3.96, 48), dirt, 0, -0.2, 0.012);
  const mound = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.74, MOUND_HEIGHT, 48), dirt);
  mound.position.set(0, MOUND_HEIGHT / 2, RUBBER_Z);
  mound.receiveShadow = true;
  scene.add(mound);
  const rubber = new THREE.Mesh(new THREE.BoxGeometry(0.61, 0.03, 0.15), new THREE.MeshStandardMaterial({ color: 0xffffff }));
  rubber.position.set(0, MOUND_HEIGHT + 0.01, RUBBER_Z);
  scene.add(rubber);

  // チョークの線（ファウルライン・バッターボックス）
  const chalk = new THREE.MeshBasicMaterial({ color: 0xf2efe6 });
  const line = (x1: number, z1: number, x2: number, z2: number, w = 0.06) => {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, len), chalk);
    m.rotation.order = 'YXZ';
    m.rotation.set(-Math.PI / 2, Math.atan2(-(x2 - x1), -(z2 - z1)), 0);
    m.position.set((x1 + x2) / 2, 0.016, (z1 + z2) / 2);
    scene.add(m);
  };
  for (const s of [1, -1]) {
    line(s * 0.9, -0.9, s * 100, -100);
    const xi = s * 0.37;
    const xo = s * 1.59;
    line(xi, -1.15, xi, 0.68, 0.05);
    line(xo, -1.15, xo, 0.68, 0.05);
    line(xi, -1.15, xo, -1.15, 0.05);
    line(xi, 0.68, xo, 0.68, 0.05);
  }

  // ホームベース
  const shape = new THREE.Shape();
  PLATE_POLY.forEach(([x, z], i) => (i === 0 ? shape.moveTo(x, -z) : shape.lineTo(x, -z)));
  shape.closePath();
  const plateGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: false });
  const plate = new THREE.Mesh(plateGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }));
  plate.rotation.x = -Math.PI / 2;
  plate.position.y = 0.0;
  plate.receiveShadow = true;
  scene.add(plate);

  // 外野フェンスとスタンド
  const fenceR = 118;
  const fence = new THREE.Mesh(
    new THREE.CylinderGeometry(fenceR, fenceR, 4, 96, 1, true, Math.PI * 0.75, Math.PI * 0.5),
    new THREE.MeshStandardMaterial({ color: 0x1f5a3a, side: THREE.BackSide }),
  );
  fence.position.set(0, 2, 0);
  scene.add(fence);
  const crowd = canvasTexture(512, 64, (g) => {
    g.fillStyle = '#5a6270';
    g.fillRect(0, 0, 512, 64);
    const cols = ['#e9e3d6', '#c43d3d', '#2d4f9a', '#f0c23b', '#ffffff', '#30343c', '#7a8899'];
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = cols[(Math.random() * cols.length) | 0];
      g.fillRect(Math.random() * 512, Math.random() * 64, 2, 2);
    }
  });
  crowd.wrapS = THREE.RepeatWrapping;
  crowd.repeat.set(6, 1);
  const stands = new THREE.Mesh(
    new THREE.CylinderGeometry(fenceR + 40, fenceR + 2, 26, 96, 1, true, Math.PI * 0.72, Math.PI * 0.56),
    new THREE.MeshStandardMaterial({ map: crowd, side: THREE.BackSide, roughness: 1 }),
  );
  stands.position.set(0, 4 + 13, 0);
  scene.add(stands);
  // スコアボード
  const board = new THREE.Mesh(new THREE.BoxGeometry(34, 12, 1), new THREE.MeshStandardMaterial({ color: 0x14181f }));
  board.position.set(0, 36, -fenceR - 34);
  scene.add(board);
}

// 球審の目の前のキャッチャー（後ろ姿）とミット
export class Catcher {
  readonly group = new THREE.Group();
  readonly mitt = new THREE.Group();
  private arm: THREE.Mesh;
  private shoulder = new THREE.Vector3(-0.2, 0.66, 1.14);
  private mittRest = new THREE.Vector3(-0.05, MITT_LOW_Y, CATCH_Z);
  private mittFrom = new THREE.Vector3();
  private mittLow = new THREE.Vector3();
  private mittTo = new THREE.Vector3();
  private mittSettle = new THREE.Vector3();
  readonly mittBall = new THREE.Vector3(); // ミットに収まったボールの位置

  constructor(scene: THREE.Scene) {
    const gear = new THREE.MeshStandardMaterial({ color: 0x1b2340, roughness: 0.6 });
    const gray = new THREE.MeshStandardMaterial({ color: 0x8b8f98, roughness: 0.8 });
    const helmetMat = new THREE.MeshStandardMaterial({ color: 0x1c2438, roughness: 0.8 });
    const leather = new THREE.MeshStandardMaterial({ color: 0x7a3f17, roughness: 0.55 });

    // 体は深くしゃがませ、球審の視線（ホームベース上）にかからない位置へ
    const g = new THREE.Group();
    g.position.set(0, -0.2, 0.42);
    this.group.add(g);
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.22, 4, 12), gray);
    body.scale.set(1.25, 1, 0.85);
    body.position.set(0, 0.7, 0.86);
    body.rotation.x = -0.35;
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.06, 0.3), gear);
    back.position.set(0, 0.92, 0.88);
    back.rotation.x = -0.35;
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.13, 18, 14), helmetMat);
    helmet.position.set(0, 0.98, 0.7);
    helmet.scale.set(1, 0.95, 1.1);
    const hips = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 0.28), gray);
    hips.position.set(0, 0.42, 1.0);
    g.add(body, back, helmet, hips);
    for (const s of [1, -1]) {
      const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.3, 4, 8), gray);
      thigh.position.set(s * 0.22, 0.42, 0.82);
      thigh.rotation.x = Math.PI / 2;
      thigh.rotation.z = s * 0.25;
      const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.32, 4, 8), gear);
      shin.position.set(s * 0.27, 0.22, 0.66);
      shin.rotation.x = -0.4;
      g.add(thigh, shin);
    }
    const rArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.32, 4, 8), gray);
    rArm.position.set(0.26, 0.6, 0.85);
    rArm.rotation.x = 0.6;
    g.add(rArm);
    this.arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 1, 4, 8), gray);
    this.group.add(this.arm);

    const mittMesh = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), leather);
    mittMesh.scale.set(1.0, 1.05, 0.45);
    this.mitt.add(mittMesh);
    const pocket = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 14, 10),
      new THREE.MeshStandardMaterial({ color: 0x4e2610, roughness: 0.7 }),
    );
    pocket.scale.set(1, 1, 0.3);
    pocket.position.z = -0.045;
    this.mitt.add(pocket);
    this.group.add(this.mitt);
    scene.add(this.group);
    this.setMitt(this.mittRest);
  }

  private setMitt(p: THREE.Vector3) {
    // ミットの中心はボールの捕球位置より少し後ろ（ボールがポケットに入る）
    this.mitt.position.set(p.x, p.y, p.z + 0.05);
    const a = this.shoulder;
    const b = new THREE.Vector3(p.x, p.y - 0.04, p.z + 0.12);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const len = a.distanceTo(b);
    this.arm.position.copy(mid);
    this.arm.scale.set(1, Math.max(0.2, len - 0.1) / 1.0, 1);
    this.arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  }

  // 構え（投球前）: target に向けて構える
  prepare(target: Vec3, catchPos: Vec3) {
    // 低く構える（高く構えると球審の視野でホームベースに重なる）
    this.mittFrom.set(target.x * 0.5 - 0.02, MITT_LOW_Y, CATCH_Z);
    this.mittLow.set(catchPos.x, Math.min(catchPos.y, MITT_LOW_Y), CATCH_Z);
    this.mittTo.set(catchPos.x, catchPos.y, CATCH_Z);
    this.mittSettle.set(catchPos.x * 0.8, Math.min(catchPos.y, MITT_LOW_Y), CATCH_Z);
    this.mittBall.copy(this.mittTo);
    this.setMitt(this.mittFrom);
  }

  rest() {
    this.setMitt(this.mittRest);
  }

  // side: 0 → 1 低いまま捕球位置の横へ寄せる。pop: 0 → 1 ボールがベースを通過した後、捕球位置まで上げる
  track(side: number, pop: number) {
    const s = side * side * (3 - 2 * side);
    const p = this.mittFrom.clone().lerp(this.mittLow, s);
    p.lerp(this.mittTo, Math.sqrt(Math.max(0, Math.min(1, pop))));
    this.setMitt(p);
  }

  // 捕球後、ボールごとミットを低い位置へ下ろす（k: 0 → 1）。判定を考える間、ベースを隠さない
  settle(k: number) {
    const e = k * k * (3 - 2 * k);
    this.mittBall.copy(this.mittTo).lerp(this.mittSettle, e);
    this.setMitt(this.mittBall);
  }
}

export class BallView {
  readonly mesh: THREE.Mesh;
  private trail: THREE.Line;
  private trailPts: THREE.Vector3[] = [];

  constructor(scene: THREE.Scene) {
    const tex = canvasTexture(128, 64, (g) => {
      g.fillStyle = '#fbfaf4';
      g.fillRect(0, 0, 128, 64);
      g.strokeStyle = '#c8323a';
      g.lineWidth = 3;
      g.beginPath();
      for (let x = 0; x <= 128; x += 2) {
        const y = 32 + Math.sin((x / 128) * Math.PI * 4) * 16;
        if (x === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    });
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_RADIUS, 20, 14),
      new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.5 }),
    );
    this.mesh.castShadow = true;
    scene.add(this.mesh);
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.trail = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 }));
    this.trail.frustumCulled = false;
    scene.add(this.trail);
  }

  // 捕球の瞬間の光
  private flashSprite: THREE.Sprite | null = null;
  private flashT = 1;
  flash(p: Vec3) {
    if (!this.flashSprite) {
      const tex = canvasTexture(64, 64, (g) => {
        const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        grd.addColorStop(0, 'rgba(255,255,255,1)');
        grd.addColorStop(0.35, 'rgba(255,240,180,0.7)');
        grd.addColorStop(1, 'rgba(255,240,180,0)');
        g.fillStyle = grd;
        g.fillRect(0, 0, 64, 64);
      });
      this.flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
      this.flashSprite.renderOrder = 20;
      this.mesh.parent!.add(this.flashSprite);
    }
    this.flashSprite.position.set(p.x, p.y, p.z - 0.05);
    this.flashT = 0;
    this.tickFlash(0);
  }
  tickFlash(dt: number) {
    if (!this.flashSprite) return;
    this.flashT += dt;
    const k = Math.min(1, this.flashT / 0.22);
    this.flashSprite.visible = k < 1;
    this.flashSprite.scale.setScalar(0.12 + 0.35 * k);
    this.flashSprite.material.opacity = 1 - k;
  }

  place(p: Vec3, spin = 0) {
    this.mesh.position.set(p.x, p.y, p.z);
    this.mesh.rotation.x = spin;
  }

  setTrail(points: Vec3[]) {
    this.trailPts = points.map((p) => new THREE.Vector3(p.x, p.y, p.z));
    if (this.trailPts.length < 2) {
      this.trail.visible = false;
      return;
    }
    this.trail.visible = true;
    this.trail.geometry.setFromPoints(this.trailPts);
  }
}

// リプレイ用の軌跡（空中の軌跡と、真下の地面に落とした軌跡）
export class ReplayViz {
  readonly group = new THREE.Group();
  private tube: THREE.Mesh | null = null;
  private ground: THREE.Mesh | null = null;
  private ghost: THREE.Mesh;
  private ghostRing: THREE.Mesh;
  private plateGlow: THREE.Mesh;

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    this.ghost = new THREE.Mesh(
      new THREE.CircleGeometry(BALL_RADIUS, 32),
      new THREE.MeshBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 0.9, depthTest: false }),
    );
    this.ghost.rotation.x = -Math.PI / 2;
    this.ghost.renderOrder = 12;
    this.ghostRing = new THREE.Mesh(
      new THREE.RingGeometry(BALL_RADIUS, BALL_RADIUS + 0.006, 40),
      new THREE.MeshBasicMaterial({ color: 0x1a1a1a, depthTest: false }),
    );
    this.ghostRing.rotation.x = -Math.PI / 2;
    this.ghostRing.renderOrder = 13;
    const shape = new THREE.Shape();
    PLATE_POLY.forEach(([x, z], i) => (i === 0 ? shape.moveTo(x, -z) : shape.lineTo(x, -z)));
    shape.closePath();
    this.plateGlow = new THREE.Mesh(
      new THREE.ShapeGeometry(shape),
      new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.35, depthTest: false }),
    );
    this.plateGlow.rotation.x = -Math.PI / 2;
    this.plateGlow.position.y = 0.03;
    this.plateGlow.renderOrder = 10;
    this.group.add(this.ghost, this.ghostRing, this.plateGlow);
    this.group.visible = false;
  }

  show(on: boolean) {
    this.group.visible = on;
  }

  // 0..t までの軌跡を描く
  update(tr: Trajectory, t: number, strike: boolean) {
    const pts: THREE.Vector3[] = [];
    const gpts: THREE.Vector3[] = [];
    const n = 80;
    for (let i = 0; i <= n; i++) {
      const p = posAt(tr, (t * i) / n);
      pts.push(new THREE.Vector3(p.x, p.y, p.z));
      gpts.push(new THREE.Vector3(p.x, 0.035, p.z));
    }
    const color = strike ? 0xff5a4f : 0x44d36b;
    if (this.tube) {
      this.group.remove(this.tube);
      this.tube.geometry.dispose();
    }
    if (this.ground) {
      this.group.remove(this.ground);
      this.ground.geometry.dispose();
    }
    if (t <= 0.01) return;
    this.tube = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 120, 0.018, 6),
      new THREE.MeshBasicMaterial({ color: 0xffe14d }),
    );
    // 地面の軌跡は帯（ボールの幅）で描く。ベースにかかったかが一目で分かる
    this.ground = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(gpts), 160, BALL_RADIUS, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthTest: false }),
    );
    this.ground.scale.y = 0.0001;
    this.ground.position.y = 0.035;
    this.ground.renderOrder = 11;
    this.group.add(this.tube, this.ground);
  }

  setGhost(p: Vec3 | null, strike: boolean) {
    this.ghost.visible = this.ghostRing.visible = !!p;
    if (!p) return;
    (this.ghost.material as THREE.MeshBasicMaterial).color.set(strike ? 0xff5a4f : 0x44d36b);
    this.ghost.position.set(p.x, 0.04, p.z);
    this.ghostRing.position.set(p.x, 0.041, p.z);
  }
}

export function makeUmpireCamera(aspect: number) {
  const cam = new THREE.PerspectiveCamera(CAMERA.fov, aspect, 0.05, 600);
  cam.position.set(CAMERA.x, CAMERA.y, CAMERA.z);
  const pitch = (CAMERA.pitchDeg * Math.PI) / 180;
  cam.lookAt(CAMERA.x, CAMERA.y + Math.tan(pitch) * 10, CAMERA.z - 10);
  wideQuat.copy(cam.quaternion);
  cam.lookAt(CAMERA.zoomLook.x, CAMERA.zoomLook.y, CAMERA.zoomLook.z);
  zoomQuat.copy(cam.quaternion);
  cam.quaternion.copy(wideQuat);
  return cam;
}

const wideQuat = new THREE.Quaternion();
const zoomQuat = new THREE.Quaternion();

// k = 0: 球審の視野（判定用）、k = 1: ピッチャーのアップ
export function setUmpireZoom(cam: THREE.PerspectiveCamera, k: number) {
  const e = k * k * (3 - 2 * k);
  cam.quaternion.slerpQuaternions(wideQuat, zoomQuat, e);
  // 画角は見た目の大きさが線形に変わるよう tan で補間
  const tw = Math.tan(((CAMERA.fov / 2) * Math.PI) / 180);
  const tz = Math.tan(((CAMERA.zoomFov / 2) * Math.PI) / 180);
  cam.fov = (2 * Math.atan(tw + (tz - tw) * e) * 180) / Math.PI;
  cam.updateProjectionMatrix();
}

// 真上から見るカメラ（正射影なので高さによる位置のずれがない）
const TOP_HALF_W = 0.42;
const TOP_CENTER_Z = -0.12;

export function makeTopCamera(aspect: number) {
  const halfW = TOP_HALF_W;
  const cam = new THREE.OrthographicCamera(-halfW, halfW, halfW / aspect, -halfW / aspect, 0.1, 20);
  cam.position.set(0, 5, TOP_CENTER_Z);
  cam.up.set(0, 0, -1);
  cam.lookAt(0, 0, TOP_CENTER_Z);
  return cam;
}

export function resizeTopCamera(cam: THREE.OrthographicCamera, aspect: number) {
  const halfW = TOP_HALF_W;
  cam.left = -halfW;
  cam.right = halfW;
  cam.top = halfW / aspect;
  cam.bottom = -halfW / aspect;
  cam.updateProjectionMatrix();
}
