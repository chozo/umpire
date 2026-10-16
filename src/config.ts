// 調整値をここにまとめる。単位はメートル・秒・km/h。
// 座標系: x = 球審から見て右（一塁側）が +、y = 上、z = 球審側が +（投手は -z 側）。

export const BALL_RADIUS = 0.0366; // 硬式球 直径 7.3cm

// ホームベース（五角形）。前端（投手側）z = -0.4318、後ろの頂点 z = 0。
export const PLATE_HALF_WIDTH = 0.2159; // 幅 43.2cm
export const PLATE_FRONT_Z = -0.4318;
export const PLATE_SIDE_Z = -0.2159;

export const RUBBER_Z = -18.44; // プレートの後端からピッチャープレートまで
export const MOUND_HEIGHT = 0.254;
export const RUBBER_EDGE_X = 0.24; // プレート（幅61cm）の端に軸足をかけたときの、体の中心の横位置

// ミットで捕る位置（ベース後方）。キャッチャーの体の近くで捕り、手を前に出さない
// （前で捕るほど、球審の視野でミットがホームベースに重なる）
export const CATCH_Z = 0.95;
// ボールがベースを通り過ぎるまで、ミットはこの高さより上げない（球審の視野でベースに重ならない高さ）。
// 捕球後もこの高さまでボールごと下ろす
export const MITT_LOW_Y = 0.5;

export const GRAVITY = 9.8;
export const DRAG_DECEL = 5.0; // 進行方向の減速（m/s²）

// 球審の目。x = 0（キャッチャーの真後ろ）なので、左右の見え方に視差のずれはない
export const CAMERA = {
  x: 0,
  y: 1.85,
  z: 2.0,
  fov: 63,
  pitchDeg: -27, // 見下ろす角度（ベースの下側に、体の近くで捕るミットが映る余地を残す）
  // 投球前はピッチャーを大きく映し、リリース前に球審の視野へ引く
  zoomFov: 20,
  zoomLook: { x: 0, y: 1.25, z: -17.6 },
  zoomOutFrom: 0.5, // 投球動作の開始からの秒数
  zoomOutTo: 0.98,
};

export const GAME = {
  maxMisses: 3,
  decisionWindow: 1.5, // 捕球後、判定できる時間
  closeMargin: 0.03, // ベースの端からこの距離（ボールの端で計測）以内なら「際どい」
  callDisplay: 0.9,
  resultDisplay: 1.1,
  replaySlow: 0.22, // リプレイの再生速度
  topViewHold: 3.2,
  replaySkipGuard: 0.3, // リプレイ開始直後のタップは無視（コールの押し間違いでスキップしない）
  setPause: 0.7, // 投球と投球の間の構え
};

export const SCORE = {
  correct: 100,
  closeCorrect: 300,
  // 早押しボーナス: 捕球からコールまでの秒数がこの値以内ならその点数（捕球前のコールは0秒扱い）
  speedBonus: [
    { within: 0.3, points: 20 },
    { within: 0.7, points: 10 },
  ],
};

// 難易度の推移（i = 0, 1, 2, ... 誤審3回まで続く）
// 第15球までで一通りそろい、それ以降は変化の大きさ・際どい球・変則投手が増えていく
//   第11球〜: サイドスロー・アンダースロー
//   第21球〜: プレートの端から投げて角度をつける
//   第31球〜: 5球ごとに球速 +5%
export const STAGE = { tutorial: 3, oddSlot: 10, rubberEdge: 20, speedUp: 30, speedUpEvery: 5, speedUpRate: 1.05 };

export function difficulty(i: number) {
  const p = Math.min(1, i / 14); // 序盤（第1〜15球）
  const q = Math.min(1, Math.max(0, (i - 15) / 25)); // 終盤（第16〜40球）
  const speedUp =
    i >= STAGE.speedUp ? STAGE.speedUpRate ** (Math.floor((i - STAGE.speedUp) / STAGE.speedUpEvery) + 1) : 1;
  // 第1〜3球はチュートリアル: 際どい球を出さず、変化の小さい球でストライク・ボールをはっきり分ける
  const tutorial = i < STAGE.tutorial;
  const types: [PitchTypeName, number][] =
    tutorial
      ? [['straight', 3], ['curve', 1]]
      : i < 6
        ? [['straight', 2], ['slider', 2], ['curve', 1], ['shoot', 2]]
        : i < 10
          ? [['straight', 2], ['slider', 2], ['curve', 1], ['shoot', 2], ['cutter', 1], ['twoseam', 1], ['fork', 1]]
          : i < 15
            ? [['straight', 2], ['slider', 2], ['curve', 1], ['shoot', 2], ['cutter', 1], ['twoseam', 1], ['changeup', 1], ['fork', 1], ['sweeper', 1], ['sinker', 1]]
            : [['straight', 1], ['slider', 3], ['curve', 1], ['shoot', 3], ['cutter', 1], ['twoseam', 2], ['changeup', 1], ['fork', 1], ['sweeper', 3], ['sinker', 2]];
  return {
    fastballKmh: (132 + 24 * p + 6 * q) * speedUp, // ストレートの球速
    speedUp,
    tutorial,
    breakScale: tutorial ? 0.6 : 1 + 0.15 * p + 0.35 * q, // 変化の大きさの倍率
    closeRatio: tutorial ? 0 : 0.3 + 0.3 * p + 0.15 * q, // 際どい球の割合
    clipRatio: 0.35 + 0.25 * p + 0.25 * q, // 際どい球のうち、ベースの前の角・奥の角だけをかすめる球の割合
    leftyRatio: i >= 5 ? 0.4 : 0,
    sideRatio: i >= STAGE.oddSlot ? 0.25 + 0.05 * q : 0, // サイドスロー
    underRatio: i >= STAGE.oddSlot ? 0.12 + 0.13 * q : 0, // アンダースロー
    rubberEdgeRatio: i >= STAGE.rubberEdge ? 0.75 : 0, // プレートの端から投げる割合
    pitchTypes: types,
  };
}

export type PitchTypeName =
  | 'straight' | 'curve' | 'slider' | 'shoot' | 'cutter' | 'changeup' | 'fork' | 'sweeper' | 'sinker' | 'twoseam';
