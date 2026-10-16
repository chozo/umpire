// 告知動画の台本（球審ジャッジ）。npm run promo で ../video/umpire-promo.mp4 を作る。
// 狙った投球は __game.repitch({ type, slot, lefty, clip, category, margin, side }) で作る。

export const config = {
  slug: 'umpire',
  url: 'https://game.chozo.net/umpire/',
  orientation: 'portrait',
  game: { width: 390, height: 693 },
  serveDir: 'dist',
  gamePath: '/umpire/',
  background:
    'radial-gradient(ellipse at 50% 115%, #2f7a3a 0, #1a4a2a 30%, transparent 62%), radial-gradient(circle at 15% 0%, rgba(255,255,255,0.22), transparent 28%), radial-gradient(circle at 85% 0%, rgba(255,255,255,0.16), transparent 26%), linear-gradient(#0f1a2e, #13233d)',
  music: false, // BGM はゲームの応援曲を使う（__game.audio.render が鳴らす）
};

const isPhase = (ph) => (s) => s.phase === ph;
const hideHint = (p) => p.eval((_, win) => { win.document.getElementById('hint').hidden = true; });

export default async function scenario(p) {
  await p.call('setSeed', 21);
  await p.call('audio.prepare');

  p.on('resolve', (e) => {
    if (e.args[2] === 'ng') p.shake(10, 0.3);
  });

  // ---- 0〜3秒: つかみ。サイドスローのスイーパーがベースの前の角をかすめる ----
  // 描画の準備ができるまで撮らずに進める
  await p.call('start');
  await p.skip(2);
  // 撮影を始めた直後は 3D の画面が白く写るので、実時間で少し待ってから撮る
  await p.eval(() => new Promise((r) => setTimeout(r, 3000)));
  await hideHint(p);
  await p.call('setIndex', 24);
  await p.call('repitch', { type: 'sweeper', slot: 'side', lefty: false, clip: 'front', margin: -0.01 });
  await p.skip(0.9);
  p.caption('ストライク？\nボール？', { y: 0.2, dur: 1.4 });
  await p.until(isPhase('flight'), { max: 4 });
  await p.until(isPhase('decide'), { max: 2 });
  await p.call('call', 'ball');
  await p.until(isPhase('replay'), { max: 4 });
  p.speed(1.6, { badge: false });
  await p.until((s) => s.replaySub === 'top', { max: 6 });
  p.speed(1);
  p.flash({ dur: 0.2, strength: 0.6 });
  p.fx('かすってた！', { x: 0.45, y: 0.3, dur: 1.3, size: 64 });
  await p.wait(1.25);

  // ---- タイトル ----
  p.title({ title: '球審ジャッジ', sub: 'ストライクか、ボールか。\nキミの目でコールせよ', dur: 2.6 });
  await p.call('skip');
  await p.call('start');
  await hideHint(p);
  await p.wait(2.7);

  // ---- 本編: 普通の投球を正しくコール ----
  await hideHint(p);
  await p.call('repitch', { type: 'straight', category: 'strike', margin: -0.15 });
  p.caption('ベースの上を通れば\nストライク', { y: 0.17, dur: 2.0, size: 42 });
  await p.until(isPhase('flight'), { max: 4 });
  await p.until((s) => s.flightT >= s.tFront, { max: 2 });
  await p.until(isPhase('decide'), { max: 2 });
  await p.wait(0.1);
  await p.call('call', 'strike');
  p.caption('早押しでボーナス！', { y: 0.17, dur: 1.6, size: 42 });
  await p.wait(1.6);

  // ---- 変化球・変則投手 ----
  await p.call('setIndex', 14);
  await p.call('repitch', { type: 'curve', slot: 'under', lefty: true, category: 'ball', margin: 0.06 });
  await p.skip(0.8);
  p.caption('変化球も\n変則投手も', { y: 0.17, dur: 2.0 });
  await p.until(isPhase('decide'), { max: 5 });
  await p.wait(0.1);
  await p.call('call', 'ball');
  await p.wait(1.2);

  // ---- 惜しい誤審: ベースの奥をかすめるシュート ----
  await p.call('setIndex', 31);
  await p.call('repitch', { type: 'shoot', slot: 'over', lefty: false, clip: 'back', margin: -0.008 });
  await p.skip(0.9);
  await p.until(isPhase('flight'), { max: 4 });
  await p.until(isPhase('decide'), { max: 2 });
  await p.call('call', 'ball');
  await p.until((s) => s.phase === 'called', { max: 1 });
  await p.wait(0.9);
  p.caption('誤審…！？', { y: 0.2, dur: 1.2, color: '#ff6b6b' });
  await p.until(isPhase('replay'), { max: 4 });
  p.caption('リプレイで検証', { y: 0.17, dur: 1.6 });
  p.speed(1.6, { badge: false });
  await p.until((s) => s.replaySub === 'top', { max: 6 });
  p.speed(1);
  await p.wait(1.6);

  // ---- 球速アップ ----
  await p.call('skip');
  await p.call('setIndex', 45);
  await p.call('repitch', { type: 'slider', slot: 'over', lefty: false, category: 'strike', margin: -0.05 });
  await p.skip(0.4);
  p.caption('どんどん速く\n鋭くなる！', { y: 0.17, dur: 2.2 });
  await p.until(isPhase('decide'), { max: 5 });
  await p.call('call', 'strike');
  await p.wait(1.3);
  p.caption('誤審3回で退場', { y: 0.17, dur: 1.3 });
  await p.wait(1.3);

  // ---- エンドカード ----
  p.endCard({ title: '球審ジャッジ', sub: 'スマホでもPCでも', cta: '今すぐ遊べる！' });
  await p.wait(3);
}
