// 告知動画の台本（球審ジャッジ）。npm run promo で ../video/umpire-promo.mp4 を作る。
// 狙った投球は __game.repitch({ type, slot, lefty, clip, category, margin, side }) で作る。

export const config = {
  slug: 'umpire',
  url: 'https://game.chozo.net/umpire/',
  orientation: 'portrait',
  game: { width: 390, height: 693 },
  // ゲーム画面を大きく置く（上端はアプリの表示と少し重なるが、HUD だけなので許容）。字幕は下部のボタンの上に出す
  layout: { centerX: 0.47, centerY: 0.42, maxW: 0.86, maxH: 0.84 },
  serveDir: 'dist',
  gamePath: '/umpire/',
  background:
    'radial-gradient(ellipse at 50% 115%, #2f7a3a 0, #1a4a2a 30%, transparent 62%), radial-gradient(circle at 15% 0%, rgba(255,255,255,0.22), transparent 28%), radial-gradient(circle at 85% 0%, rgba(255,255,255,0.16), transparent 26%), linear-gradient(#0f1a2e, #13233d)',
  music: false, // BGM はゲームの応援曲を使う（__game.audio.render が鳴らす）
};

// 字幕はゲーム画面の下部（ボール・ストライクのボタンの上）に出し、投手やボールに重ねない
const CAP_Y = 0.7;

const isPhase = (ph) => (s) => s.phase === ph;
const hideHint = (p) => p.eval((_, win) => { win.document.getElementById('hint').hidden = true; });

// 撮らずに進める（条件を満たすまで）
async function skipUntil(p, cond) {
  for (let i = 0; i < 300 && !cond(await p.state()); i++) await p.skip(1 / 30);
}

// 1球投げさせて、正しくコールするところまで撮る。
// lead: 投球動作のどこから撮るか（windup に入ってからの秒数）。caption は投球動作の途中で出す
async function pitch(p, { index, force, caption, sub, lead = 0.5, after = 0.7, bgm = false }) {
  await p.call('setIndex', index);
  await p.call('repitch', force);
  await skipUntil(p, isPhase('windup'));
  await p.skip(lead);
  await hideHint(p);
  // 撮らずに進めた間の音は記録されないので、最初の1球では撮り始める直前に BGM を鳴らし直す
  if (bgm) await p.call('audio.startBgm');
  if (caption) p.caption(sub ? `${caption}\n${sub}` : caption, { y: CAP_Y, dur: 1.9, size: 46 });
  await p.until(isPhase('flight'), { max: 3 });
  await p.until((s) => s.flightT >= s.tFront, { max: 2 });
  const s = await p.state();
  await p.call('call', s.pitch.strike ? 'strike' : 'ball');
  await p.until(isPhase('called'), { max: 2 });
  await p.wait(after);
}

export default async function scenario(p) {
  await p.call('setSeed', 21);
  await p.call('audio.prepare');

  // 準備（撮らない）。撮影を始めた直後は 3D の画面が白く写るので、実時間で少し待つ
  await p.call('start');
  await p.skip(2);
  await p.eval(() => new Promise((r) => setTimeout(r, 3000)));

  // ---- 0〜4秒: ふつうの投球で「ストライーク！」 ----
  await pitch(p, { index: 3, force: { type: 'straight', slot: 'over', lefty: false, category: 'strike', margin: -0.12 }, lead: 0.15, after: 0.9, bgm: true });
  p.caption('投球を見極めて\nストライク？ボール？\nを判定しよう！', { y: CAP_Y - 0.05, dur: 2.3, size: 42 });
  await p.wait(2.3);

  // ---- タイトル ----
  p.title({ title: '球審ジャッジ', sub: 'キミが球審だ！', dur: 2.4 });
  await p.wait(2.4);

  // ---- 球種の紹介 ----
  await pitch(p, { index: 6, force: { type: 'curve', slot: 'over', lefty: false, category: 'ball', margin: 0.1, side: 1 }, caption: '多彩な変化球！\nカーブ', sub: null, lead: 0.6 });
  await pitch(p, { index: 7, force: { type: 'slider', slot: 'over', lefty: false, category: 'strike', margin: -0.08 }, caption: 'スライダー', sub: '鋭く横に滑る', lead: 0.6 });
  await pitch(p, { index: 8, force: { type: 'shoot', slot: 'over', lefty: false, category: 'ball', margin: 0.1, side: -1 }, caption: 'シュート', sub: '逆方向へ食い込む', lead: 0.6 });

  // ---- 投手の紹介 ----
  await pitch(p, { index: 12, force: { type: 'slider', slot: 'over', lefty: true, category: 'strike', margin: -0.08 }, caption: '左投手', sub: '左右が逆の変化', lead: 0.2 });
  await pitch(p, { index: 16, force: { type: 'sweeper', slot: 'side', lefty: false, category: 'ball', margin: 0.1, side: 1 }, caption: 'サイドスロー', sub: '横から斜めに入る', lead: 0.2 });
  await pitch(p, { index: 22, force: { type: 'sinker', slot: 'under', lefty: false, category: 'strike', margin: -0.08 }, caption: 'アンダースロー', sub: '下から浮き上がる', lead: 0.2 });

  // ---- 際どい球はリプレイで検証 ----
  await p.call('setIndex', 30);
  await p.call('repitch', { type: 'sweeper', slot: 'side', lefty: false, clip: 'front', margin: -0.01 });
  await skipUntil(p, isPhase('windup'));
  await p.skip(0.6);
  p.caption('多彩な投手を\n見極めろ！', { y: CAP_Y, dur: 1.9, size: 50 });
  await p.until(isPhase('decide'), { max: 3 });
  await p.call('call', 'ball');
  await p.until(isPhase('replay'), { max: 4 });
  p.shake(8, 0.25);
  p.caption('際どい球は\nリプレイで検証', { y: CAP_Y, dur: 1.6, size: 48 });
  p.speed(1.8, { badge: false });
  await p.until((s) => s.replaySub === 'top', { max: 6 });
  p.speed(1);
  p.flash({ dur: 0.2, strength: 0.6 });
  p.fx('かすってた！', { x: 0.45, y: 0.3, dur: 1.4, size: 64 });
  await p.wait(1.5);

  // ---- エンドカード ----
  p.endCard({ title: '球審ジャッジ', sub: '誤審3回で退場！', cta: '今すぐ遊べる！' });
  await p.wait(3);
}
