// ブラウザでの通し確認（playwright-core + インストール済み Chrome）
// 使い方: npm run dev（別ターミナル）→ npm run e2e [URL]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const URL = process.argv[2] ?? 'http://localhost:5288/';
const OUT = 'tools/out/e2e';
fs.mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=metal', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'] });
let failed = 0;
const check = (cond, msg) => {
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) failed++;
};

async function open(viewport, seed = 11) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`${URL}?seed=${seed}`);
  await page.waitForFunction(() => window.__game);
  await page.evaluate(() => window.__game.manual(true));
  const g = (fn, arg) => page.evaluate(fn, arg);
  const step = (sec, dt = 1 / 60) => g(([s, d]) => window.__game.step(d, Math.round(s / d)), [sec, dt]);
  const state = () => g(() => window.__game.state());
  const until = async (cond, max = 15) => {
    for (let i = 0; i < max * 60; i++) {
      const s = await state();
      if (cond(s)) return s;
      await step(1 / 60, 1 / 60);
    }
    throw new Error('until: timeout ' + JSON.stringify(await state()));
  };
  return { page, errors, g, step, state, until };
}

// 1投ぶんを進める。how: 'correct' | 'wrong' | 'none' | 'early'
async function playPitch(t, how) {
  const s0 = await t.until((s) => s.phase === 'flight' && s.flightT >= s.tFront);
  const truth = s0.pitch.strike ? 'strike' : 'ball';
  if (how === 'correct') await t.g((c) => window.__game.call(c), truth);
  if (how === 'wrong') await t.g((c) => window.__game.call(c), truth === 'strike' ? 'ball' : 'strike');
  const s1 = await t.until((s) => s.records.length > s0.records.length, 5);
  const rec = s1.records[s1.records.length - 1];
  // リプレイ・結果表示を抜ける
  await t.until((s) => s.phase === 'set' || s.phase === 'result' || (s.phase === 'replay' && s.replaySub === 'top'), 20);
  const s2 = await t.state();
  if (s2.phase === 'replay') {
    await t.g(() => window.__game.skip());
  }
  return { rec, pitch: s0.pitch };
}

// --- 1. 15球を超えて続き、変則投手が出て、誤審3回で終わる ---
{
  const t = await open({ width: 405, height: 720 });
  await t.page.screenshot({ path: `${OUT}/title.png` });
  await t.page.click('#btn-start');
  let closeSeen = 0;
  let clips = 0;
  let lefty = 0;
  const types = new Set();
  const slots = new Set();
  const N = 32;
  const tutorial = [];
  let edge = 0;
  for (let i = 0; i < N; i++) {
    const { rec, pitch } = await playPitch(t, 'correct');
    if (!rec.correct) check(false, `第${i + 1}球の正解が不正解扱い`);
    if (pitch.close) closeSeen++;
    if (pitch.clip) clips++;
    if (pitch.lefty) lefty++;
    types.add(pitch.type);
    slots.add(pitch.slot);
    if (pitch.rubberX !== 0) edge++;
    if (i < 20 && pitch.rubberX !== 0) check(false, `第${i + 1}球でプレートの端から投げた`);
    if (i < 10 && pitch.slot !== 'over') check(false, `第${i + 1}球で変則投手が出た`);
    if (i < 3) tutorial.push(pitch);
    if (i === 14) check((await t.state()).phase === 'set', '第15球の後も試合が続く');
    const hint = (await t.page.isHidden('#hint')) ? '' : await t.page.textContent('#hint');
    if (i === 9) check(hint.includes('変則投手'), '第11球で変則投手の予告: ' + hint);
    if (i === 19) check(hint.includes('プレートの端'), '第21球でプレートの端の予告: ' + hint);
    if (i === 29) check(hint.includes('球速アップ') && hint.includes('+5%'), '第31球で球速アップの予告: ' + hint);
  }
  check((await t.page.textContent('#hud-count')) === String(N + 1), `HUD: 第${N + 1}球`);
  check(tutorial.every((p) => !p.close && Math.abs(p.margin) > 0.1), '最初の3球は際どくない: ' + tutorial.map((p) => (p.margin * 100).toFixed(0) + 'cm').join(','));
  check(tutorial[0].strike !== tutorial[1].strike, '最初の2球でストライクとボールの両方が出る');
  check(closeSeen >= 5, `際どい球が出る（${closeSeen}球、うち角をかすめる球 ${clips}）`);
  check(lefty >= 1, `左投手が出る（${lefty}球）`);
  check(types.size >= 6, `球種が複数出る（${[...types].join(',')}）`);
  check(slots.has('side') || slots.has('under'), `変則投手が出る（${[...slots].join(',')}）`);
  check(edge >= 3, `プレートの端から投げる（${edge}球）`);
  for (let i = 0; i < 3; i++) await playPitch(t, 'wrong');
  const s = await t.until((s) => s.phase === 'result');
  check(s.records.length === N + 3 && s.misses === 3, '誤審3回で終了');
  const rank = await t.page.textContent('#res-rank');
  check(rank === '一軍の球審', `称号: ${rank}`);
  check((await t.page.textContent('#res-correct')).startsWith(`${N}球`), '正解数の表示');
  check((await t.page.textContent('#res-best')) === '新記録！', '初回は新記録');
  await t.page.screenshot({ path: `${OUT}/result.png` });
  check(t.errors.length === 0, 'コンソールエラーなし ' + t.errors.join(' / '));
  // リトライ
  await t.page.click('#btn-retry');
  const r = await t.state();
  check(r.phase === 'set' && r.index === 0 && r.score === 0, 'もう一度で最初から');
  // 2試合目でも判定（正解・誤審）が表示される
  // 早押しボーナス: 捕球前 → 20点、捕球0.5秒後 → 10点、捕球0.9秒後 → 0点
  const bonusCases = [
    { wait: null, bonus: 20 },
    { wait: 0.5, bonus: 10 },
    { wait: 0.9, bonus: 0 },
  ];
  for (let i = 0; i < bonusCases.length; i++) {
    const s0 = await t.until((s) => s.phase === 'flight' && s.flightT >= s.tFront);
    if (bonusCases[i].wait !== null) {
      await t.until((s) => s.phase === 'decide');
      await t.step(bonusCases[i].wait);
    }
    await t.g((c) => window.__game.call(c), s0.pitch.strike ? 'strike' : 'ball');
    await t.until((s) => s.phase === 'called');
    await t.step(0.6);
    check(!(await t.page.isHidden('#verdict')), `2試合目の第${i + 1}球でも判定を表示`);
    const vt = await t.page.textContent('#verdict');
    const vr = (await t.state()).records.at(-1);
    check(
      vt === `${vr.correct && vr.base === 300 ? 'ナイスジャッジ！' : '正解'}${vr.bonus > 0 ? `${vr.base} ＋ ${vr.bonus}（早押しボーナス）` : vr.base}` &&
        vr.bonus === bonusCases[i].bonus,
      `得点の内訳を表示: ${vt}`,
    );
    if (i === 0) await t.page.screenshot({ path: 'tools/out/verdict.png' });
    await t.until((s) => s.phase === 'set' || (s.phase === 'replay' && s.replaySub === 'top' ), 20);
    if ((await t.state()).phase === 'replay') await t.g(() => window.__game.skip());
  }
  await t.page.close();
}

// --- 2. 誤審 3 回で退場、時間切れ、早押し ---
{
  const t = await open({ width: 360, height: 640 }, 5);
  await t.page.click('#btn-start');
  // 早すぎる入力は無視される
  await t.until((s) => s.phase === 'windup');
  await t.g(() => window.__game.call('strike'));
  check(!(await t.page.isHidden('#hint')), '早すぎる入力で「まだ早い」を表示');
  const a = await playPitch(t, 'none');
  check(a.rec.call === null && !a.rec.correct, '何も押さないと時間切れで誤審');
  const b = await playPitch(t, 'wrong');
  check(!b.rec.correct, '逆の判定は誤審');
  // 誤審の直後はリプレイが入る
  await playPitch(t, 'wrong');
  const s = await t.until((s) => s.phase === 'result');
  check(s.misses === 3 && s.records.length === 3, '誤審3回で退場');
  const best = await t.page.textContent('#res-best');
  check(best === '―' || best.endsWith('点'), '自己ベストの表示: ' + best);
  check((await t.page.textContent('#res-head')) === '退場！', '退場の表示');
  check(!(await t.g(() => window.__game.audio.bgmState().playing)), '退場で BGM が止まる');
  await t.page.click('#result .bgm-toggle');
  check((await t.page.textContent('#result .bgm-toggle')) === 'BGM オフ' && !(await t.g(() => window.__game.audio.bgmState().on)), 'BGM をオフにできる');
  await t.page.keyboard.press('m');
  check(await t.g(() => window.__game.audio.bgmState().on), 'M キーで BGM をオンに戻す');
  await t.page.screenshot({ path: `${OUT}/ejected.png` });
  await t.page.click('#btn-title');
  check((await t.state()).phase === 'title', 'タイトルへ戻る');
  check(t.errors.length === 0, 'コンソールエラーなし ' + t.errors.join(' / '));
  await t.page.close();
}

// --- 3. リプレイ画面と左投手の見た目（撮影） ---
{
  const t = await open({ width: 405, height: 720 }, 9);
  await t.page.click('#btn-start');
  await t.g(() => window.__game.repitch({ type: 'shoot', lefty: true, category: 'close', margin: -0.008, side: 1 }));
  await t.until((s) => s.phase === 'flight' && s.flightT > 0.05);
  await t.page.screenshot({ path: `${OUT}/lefty-release.png` });
  const st = await t.until((s) => s.phase === 'decide');
  check(st.pitch.strike && st.pitch.close, '左投手のシュートで際どいストライク');
  await t.g(() => window.__game.call('ball'));
  await t.page.waitForFunction(() => window.__game.audio.bgmState().playing, null, { timeout: 10000 });
  check(!(await t.g(() => window.__game.audio.bgmState().slow)), 'BGM が通常の速さで流れる');
  await t.until((s) => s.phase === 'replay');
  await t.page.waitForTimeout(800);
  const bs = await t.g(() => window.__game.audio.bgmState());
  check(bs.slow && bs.rate < 0.8, `リプレイ中は BGM がスロー（再生速度 ${bs.rate.toFixed(2)}）`);
  await t.step(2.0);
  await t.page.screenshot({ path: `${OUT}/replay-slow.png` });
  await t.until((s) => s.replaySub === 'top');
  await t.step(0.3);
  await t.page.screenshot({ path: `${OUT}/replay-top.png` });
  const cap = await t.page.textContent('#replay-text');
  check(cap.includes('ストライク') && cap.includes('かかっていた'), 'リプレイの説明: ' + cap);
  // サイドスローのスイーパーで、ベースの前の角だけをかすめる球
  await t.g(() => window.__game.skip());
  await t.page.waitForTimeout(800);
  const bn = await t.g(() => window.__game.audio.bgmState());
  check(!bn.slow && bn.rate > 0.9, `リプレイが終わると BGM が元の速さ（${bn.rate.toFixed(2)}）`);
  await t.g(() => window.__game.repitch({ type: 'sweeper', slot: 'side', lefty: false, clip: 'front', margin: -0.01 }));
  const sw = await t.until((s) => s.phase === 'decide');
  check(sw.pitch.slot === 'side' && sw.pitch.clip === 'front' && sw.pitch.strike, 'サイドスローのスイーパーが前の角をかすめる');
  await t.g(() => window.__game.call('ball'));
  await t.until((s) => s.phase === 'replay' && s.replaySub === 'top');
  const cap2 = await t.page.textContent('#replay-text');
  check(cap2.includes('前の角'), 'リプレイの説明: ' + cap2);
  check((await t.page.textContent('#hud-hand')) === '右・サイド', 'HUDに投げ方を表示');
  check(t.errors.length === 0, 'コンソールエラーなし ' + t.errors.join(' / '));
  await t.page.close();
}

// --- 4. スロー再生の途中でタップしてリプレイをスキップ ---
{
  const t = await open({ width: 405, height: 720 }, 3);
  await t.page.click('#btn-start');
  await t.g(() => window.__game.repitch({ type: 'slider', lefty: false, category: 'close', margin: 0.01, side: 1 }));
  await t.until((s) => s.phase === 'decide');
  await t.g(() => window.__game.call('ball'));
  await t.until((s) => s.phase === 'replay');
  await t.page.mouse.click(200, 300); // 開始直後は無視
  check((await t.state()).phase === 'replay', 'リプレイ開始直後のタップは無視');
  await t.step(0.6);
  const mid = await t.state();
  check(mid.phase === 'replay' && mid.replaySub === 'slow', 'スロー再生中');
  await t.page.mouse.click(200, 300);
  const s = await t.state();
  check(s.phase === 'set' && s.index === 1, 'スロー再生の途中のタップで次の投球へ');
  check(t.errors.length === 0, 'コンソールエラーなし ' + t.errors.join(' / '));
  await t.page.close();
}

// --- 5. PC 横長の画面でも縦 9:16 が収まる ---
{
  const t = await open({ width: 1280, height: 720 });
  const box = await t.page.locator('#app').boundingBox();
  check(box.height <= 720 && Math.abs(box.width / box.height - 9 / 16) < 0.01, `PCでの表示 ${box.width}x${box.height}`);
  await t.page.screenshot({ path: `${OUT}/pc.png` });
  await t.page.close();
}

await browser.close();
console.log(failed ? `\n${failed} 件失敗` : '\nすべて成功');
process.exit(failed ? 1 : 0);
