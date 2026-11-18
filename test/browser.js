// Test helper: one Chromium page on the repo root, served over http.
import { launch } from '../src/chromium.js';
import { serve } from '../src/serve.js';

/** Opens `path` (under the repo root) after setup(page); returns the page, its errors and a close function. */
export async function open(path = '/test/blank.html', setup = async () => {}) {
  const browser = await launch();
  const server = await serve(new URL('..', import.meta.url).pathname).catch(async (e) => { await browser.close(); throw e; });
  const close = async () => { await Promise.allSettled([browser.close(), server.close()]); };
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e));
    await setup(page);
    await page.goto(server.origin + path);
    return { page, errors, close };
  } catch (e) {
    await close();
    throw e;
  }
}
