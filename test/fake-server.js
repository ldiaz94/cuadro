// A tiny HTTP server for tests: records every request and answers from a
// script of responses, one per request (the last one repeats).
// Depends on node:http. Leaves out routing and TLS.
import { createServer } from 'node:http';

/** Starts the server; replies are { status = 200, headers, body } (body a string or Buffer). */
export async function fakeServer(replies) {
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString();
    requests.push({ method: req.method, url: req.url, headers: req.headers, body: raw });
    const { status = 200, headers = {}, body = '' } = replies[Math.min(requests.length, replies.length) - 1];
    res.writeHead(status, headers).end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
