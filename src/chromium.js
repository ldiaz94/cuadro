// cuadro's Chromium: finds a browser and launches it headless.
// Tries $CHROMIUM, then Playwright's own (`npx playwright install
// chromium`), then `chromium` on the PATH, so it runs both on a desktop
// with a system browser and in a job image with Playwright's. Also bounds
// a step in a page, so a page that loops forever fails instead of hanging.
// Depends on playwright-core. Leaves out Firefox and WebKit.
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

/** The Chromium executable to use, or undefined if none is found. */
function executable() {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  if (existsSync(chromium.executablePath())) return chromium.executablePath();
  try {
    return execFileSync('sh', ['-c', 'command -v chromium || command -v chromium-browser'], { encoding: 'utf8' }).trim();
  } catch {
    return undefined;
  }
}

/** Launches headless Chromium; throws saying how to get one if none is found. */
export async function launch() {
  const path = executable();
  if (!path) throw new Error('cuadro: no Chromium found; set $CHROMIUM or run `npx playwright install chromium`');
  return chromium.launch({ executablePath: path, timeout: 30000 });
}

/** How long one step in a page (loading it, showing a frame) may take, in milliseconds. */
export const StepTimeout = 30000;

/** Resolves as promise does, or rejects saying what took too long after ms milliseconds. */
export function within(promise, ms, what) {
  let timer;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`cuadro: ${what} took longer than ${ms / 1000} s`)), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}
