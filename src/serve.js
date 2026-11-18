// cuadro static file server: serves a directory on a loopback port, so
// Chromium can load a composition page and its ES modules over http.
// Depends on node:http and node:fs. Leaves out caching, ranges and
// directory listings; a path outside the root is a 404.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

/** Content types for what a page usually loads. */
const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
};

/** Serves root; resolves to its origin (http://127.0.0.1:port) and a close function. */
export async function serve(root) {
  const base = resolve(root);
  const server = createServer(async (req, res) => {
    let path = resolve(base, '.' + decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (path !== base && !path.startsWith(base + sep)) path = null;
    else if (path.endsWith(sep) || path === base) path = resolve(path, 'index.html');
    try {
      if (!path) throw new Error('outside root');
      const body = await readFile(path);
      res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((ok) => server.close(ok)),
  };
}
