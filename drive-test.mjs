import { _electron as electron } from 'playwright-core';
import path from 'path';
const APP_DIR = 'C:/lab-galatista';
const SHOT_DIR = 'C:/Users/papadcha/AppData/Local/Temp/claude/C--lab-galatista/d7aa3705-764d-48f9-b77b-5e64c51e4252/scratchpad';
const electronBin = path.join(APP_DIR, 'node_modules/electron/dist/electron.exe');
const wait = ms => new Promise(r => setTimeout(r, ms));

const app = await electron.launch({
  executablePath: electronBin, args: [APP_DIR], timeout: 30_000,
  env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
});

// Screenshot κατά τη φόρτωση (splash)
await wait(1000);
const page = app.windows().find(w => !w.url().startsWith('devtools://')) ?? await app.firstWindow();
await page.screenshot({ path: path.join(SHOT_DIR, 'splash-loading.png') });
console.log('splash screenshot taken');

// Περιμένω το splash να εξαφανιστεί (max 15s)
let splashGone = false;
for (let i = 0; i < 30; i++) {
  await wait(500);
  const visible = await page.evaluate(() => !!document.getElementById('splash-overlay'));
  if (!visible) { splashGone = true; break; }
}

await page.screenshot({ path: path.join(SHOT_DIR, 'after-splash.png') });
console.log('Splash gone:', splashGone);

// Έλεγχος init banner
const initBanner = await page.evaluate(() => {
  const b = document.getElementById('init-banner');
  return b ? b.innerText : null;
});
console.log('Init banner:', initBanner ?? 'not shown');

await app.close();
