import { _electron as electron } from 'playwright-core';
import path from 'path';
import { spawn } from 'child_process';

const SHOT_DIR = 'C:/Users/papadcha/AppData/Local/Temp/claude/C--lab-galatista/d7aa3705-764d-48f9-b77b-5e64c51e4252/scratchpad';
const installedExe = 'C:/Program Files/lab-galatista/Εργαστήριο Γαλάτιστας.exe';
const wait = ms => new Promise(r => setTimeout(r, ms));

// Πρώτα δοκιμάζω το Python backend απευθείας με το σωστό cwd
console.log('Testing Python backend directly...');
const backendDir = 'C:/Program Files/lab-galatista/resources/lab-backend';
const backendExe = backendDir + '/lab-backend.exe';
const pyProc = spawn(backendExe, [], {
  cwd: backendDir,
  env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  stdio: ['pipe', 'pipe', 'pipe'],
});
let pyOut = '';
pyProc.stdout.on('data', d => { pyOut += d.toString('utf8'); });
pyProc.stderr.on('data', d => { pyOut += '[ERR] ' + d.toString('utf8'); });
await wait(8000);
pyProc.kill();
console.log('Backend output:', pyOut.substring(0, 300));

// Τώρα launch full app
console.log('\nLaunching installed Electron app...');
const app = await electron.launch({
  executablePath: installedExe,
  args: [],
  timeout: 30_000,
  env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
});

const page = app.windows().find(w => !w.url().startsWith('devtools://')) ?? await app.firstWindow();

// Capture renderer console
page.on('console', msg => {
  if (['error','warn'].includes(msg.type())) {
    console.log(`[renderer ${msg.type()}]`, msg.text());
  }
});

await wait(1000);
await page.screenshot({ path: path.join(SHOT_DIR, 'installed-splash.png') });

let splashGone = false;
for (let i = 0; i < 40; i++) {
  await wait(500);
  const visible = await page.evaluate(() => !!document.getElementById('splash-overlay'));
  if (!visible) { splashGone = true; break; }
  if (i === 9) {
    // After 5s: what's in the DOM?
    const bodyText = await page.evaluate(() => document.body.innerText?.substring(0, 200));
    console.log('DOM at 5s:', bodyText);
    const splashMsg = await page.evaluate(() => document.getElementById('splash-msg')?.textContent);
    console.log('Splash msg:', splashMsg);
  }
}

await page.screenshot({ path: path.join(SHOT_DIR, 'installed-after-splash.png') });
console.log('Splash gone:', splashGone);

const dashboardVisible = await page.evaluate(() => !!document.getElementById('page-dashboard'));
const initBanner       = await page.evaluate(() => document.getElementById('init-banner')?.innerText ?? null);
console.log('Dashboard visible:', dashboardVisible);
console.log('Init banner:', initBanner ?? 'not shown');

await app.close();
