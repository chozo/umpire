// 開発用: 投球フォームを横・正面から撮る
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const out = 'tools/out/poses';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 300, height: 400 } });
await page.goto('http://localhost:5288/');
await page.waitForFunction(() => window.__game);
await page.evaluate(() => { window.__game.manual(true); document.getElementById('title').hidden = true; });
const views = {
  side: [{ x: 5.5, y: 1.3, z: -17.4 }, { x: 0, y: 1.1, z: -17.4 }],
  front: [{ x: 0, y: 1.3, z: -11 }, { x: 0, y: 1.2, z: -17.6 }],
};
const slot = process.argv[3] ?? 'over';
const times = (process.argv[2] ?? '0,0.5,0.85,1.05,1.18,1.5,2.3').split(',').map(Number);
for (const [name, [pos, look]] of Object.entries(views)) {
  await page.evaluate(([p, l]) => window.__game.setCamera(p, l, 40), [pos, look]);
  for (const t of times) {
    await page.evaluate(([t, s]) => window.__game.posePitcher(t, false, s), [t, slot]);
    await page.locator('#c').screenshot({ path: `${out}/${slot}-${name}-${t.toFixed(2)}.png` });
  }
}
await browser.close();
