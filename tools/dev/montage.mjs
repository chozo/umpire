// 開発用: 画像を横に並べた一覧画像を作る  node tools/montage.mjs out.png img...
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const [outFile, ...imgs] = process.argv.slice(2);
const W = Number(process.env.W ?? 160);
const html = `<body style="margin:0;background:#222;white-space:nowrap">` +
  imgs.map((f) => `<img src="data:image/png;base64,${fs.readFileSync(f).toString('base64')}" style="width:${W}px;margin-right:3px;vertical-align:top">`).join('') + '</body>';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const p = await b.newPage({ viewport: { width: (W + 3) * imgs.length, height: 100 } });
await p.setContent(html);
await p.waitForTimeout(200);
await p.screenshot({ path: outFile, fullPage: true });
await b.close();
