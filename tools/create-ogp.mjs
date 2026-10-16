// SNS共有用の画像 public/ogp.png（1200×630）を作る。node tools/create-ogp.mjs [URL]（開発サーバーを起動しておく）
// 際どい球のリプレイ（球審の視点の軌跡と、真上から見た図）を撮り、タイトルと並べる
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
const GAME_URL = process.argv[2] || process.env.GAME_URL || 'http://localhost:5173/';
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
try {
  const page = await browser.newPage({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 2 });
  await page.goto(GAME_URL + (GAME_URL.includes('?') ? '&' : '?') + 'seed=7');
  await page.waitForTimeout(800);
  const g = (fn, ...a) => page.evaluate(([f, a]) => window.__game[f](...a), [fn, a]);
  const state = () => g('state');
  const until = async (cond) => {
    for (let i = 0; i < 2000; i++) {
      if (cond(await state())) return;
      await g('step', 1 / 60);
    }
    throw new Error('until: timeout');
  };
  await page.click('#btn-start');
  await page.addStyleTag({ content: '#controls,.hud-r{display:none!important}' });
  await g('manual', true);
  // サイドスローのスイーパーが、ベースの前の角だけをかすめる
  await g('repitch', { type: 'sweeper', slot: 'side', lefty: false, clip: 'front', margin: -0.01 });
  await until((s) => s.phase === 'decide');
  await g('call', 'ball');
  await until((s) => s.phase === 'replay');
  await g('step', 1 / 60, 230);
  await page.waitForTimeout(300);
  const slow = await page.screenshot({ type: 'png' });
  await until((s) => s.replaySub === 'top');
  await g('step', 1 / 60, 30);
  await page.waitForTimeout(300);
  const top = await page.screenshot({ type: 'png' });

  const img = (b) => `data:image/png;base64,${b.toString('base64')}`;
  const card = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await card.setContent(`<!doctype html><html lang="ja"><meta charset="utf-8"><style>
    *{box-sizing:border-box}
    body{margin:0;width:1200px;height:630px;overflow:hidden;color:#fff;font-family:"Hiragino Sans","Hiragino Kaku Gothic ProN",sans-serif;
      background:radial-gradient(ellipse at 25% 110%,#2f7a3a 0,#1a4a2a 30%,transparent 60%),radial-gradient(circle at 10% 0%,#fff3 0,transparent 25%),radial-gradient(circle at 40% -5%,#fff2 0,transparent 22%),linear-gradient(#0f1a2e,#13233d)}
    .copy{position:absolute;left:64px;top:160px;width:560px}
    .brand{font-size:18px;letter-spacing:7px;color:#9fc2e6;font-weight:700;margin:0 0 14px}
    h1{font-size:86px;white-space:nowrap;line-height:1.1;margin:0;font-weight:900;letter-spacing:2px;text-shadow:0 6px 0 #b91c1c,0 0 40px #0008}
    .sub{font-size:36px;white-space:nowrap;font-weight:800;color:#fde047;margin:30px 0 0;letter-spacing:2px}
    .note{margin-top:30px;display:inline-block;border:2px solid #ffffff55;border-radius:30px;padding:10px 22px;font-size:21px;letter-spacing:1px;color:#e8f0f8}
    .shot{position:absolute;width:270px;height:480px;border-radius:26px;border:6px solid #fff;overflow:hidden;box-shadow:0 24px 50px #0009;background:#000}
    .shot img{width:100%;height:100%;object-fit:cover;display:block}
    .a{left:660px;top:96px;transform:rotate(-5deg)}
    .b{left:900px;top:62px;transform:rotate(5deg)}
  </style>
  <div class="copy"><p class="brand">UMPIRE CHALLENGE</p><h1>球審ジャッジ</h1><p class="sub">ストライクか、ボールか。</p><p class="note">変化球を見極めて、キミの目でコールせよ</p></div>
  <div class="shot a"><img src="${img(slow)}"></div>
  <div class="shot b"><img src="${img(top)}"></div>
  </html>`);
  await card.evaluate(() => document.fonts.ready);
  await card.waitForTimeout(200);
  await card.screenshot({ path: fileURLToPath(new URL('../public/ogp.png', import.meta.url)) });
  console.log('Created public/ogp.png (1200 × 630)');
} finally {
  await browser.close();
}
