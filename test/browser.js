// Test helper: one Chromium page on the repo root, served over http.
import { launch } from '../src/chromium.js';
import { serve } from '../src/serve.js';

/** Opens `path` (under the repo root); returns the page, its errors and a close function. */
export async function open(path = '/test/blank.html') {
  const browser = await launch();
  const server = await serve(new URL('..', import.meta.url).pathname);
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));
  await page.goto(server.origin + path);
  return {
    page,
    errors,
    close: async () => { await browser.close(); await server.close(); },
  };
}
