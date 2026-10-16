// 開発用: 指定した場面のスクリーンショットを撮る
// node tools/shot.mjs <url> <outDir>
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:5288/';
const out = process.argv[3] ?? 'tools/out';
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--enable-gpu'],
});
const page = await browser.newPage({ viewport: { width: 405, height: 720 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(url + '?seed=3');
await page.waitForFunction(() => window.__game);
await page.screenshot({ path: `${out}/00-title.png` });

const g = (fn, arg) => page.evaluate(fn, arg);
await g(() => {
  window.__game.manual(true);
  window.__game.start();
});
const step = (sec) => g((s) => window.__game.step(1 / 120, Math.round(s * 120)), sec);
const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });

const force = JSON.parse(process.argv[4] ?? '{"type":"slider","category":"close","margin":0.01,"side":1}');
const callAs = process.argv[5] ?? 'strike';
await g((f) => window.__game.repitch(f), force);
await step(0.7);
await shot('01-set');
await step(0.5);
await shot('02-lift');
await step(0.4);
await shot('03-stride');
await step(0.2);
await shot('04-cock');
const until = async (cond, max = 10) => {
  for (let i = 0; i < max * 60; i++) {
    const s = await g(() => window.__game.state());
    if (cond(s)) return s;
    await step(1 / 60);
  }
  throw new Error('timeout');
};
let st = await until((s) => s.phase === 'flight');
await shot('05-release');
console.log(JSON.stringify(st.pitch));
await step(st.pitch.tCatch * 0.5);
await shot('06-flight');
await step(st.pitch.tCatch * 0.3);
await shot('07-plate');
st = await until((s) => s.phase === 'decide');
await shot('08-catch');
await g((c) => window.__game.call(c), callAs);
await step(0.6);
await shot('09-called');
st = await until((s) => s.phase !== 'called');
await step(1.0);
await shot('10-replay-a');
await step(1.2);
await shot('11-replay-b');
st = await until((s) => s.replaySub === 'top' || s.phase !== 'replay');
await step(0.3);
await shot('12-replay-top');
console.log(JSON.stringify(await g(() => window.__game.state())));
console.log('errors', errors);
await browser.close();
