import { test } from 'node:test';
import assert from 'node:assert/strict';
import { post } from '../src/http.js';
import { fakeServer } from './fake-server.js';

const opts = { backoff: 1, provider: 'acme', headers: { authorization: 'Bearer sk-secret-key' }, body: '{}' };

test('retries on 429 honouring retry-after, then succeeds', async () => {
  const s = await fakeServer([{ status: 429, headers: { 'retry-after': '0' } }, { status: 500 }, { body: 'ok' }]);
  const res = await post(s.url, opts);
  assert.equal(await res.text(), 'ok');
  assert.equal(s.requests.length, 3);
  await s.close();
});

test('gives up after retries', async () => {
  const s = await fakeServer([{ status: 503, body: 'busy' }]);
  await assert.rejects(post(s.url, { ...opts, retries: 2 }), /acme: HTTP 503: busy.*3 attempts/);
  assert.equal(s.requests.length, 3);
  await s.close();
});

test('does not retry a 4xx; error has the API message but not the key', async () => {
  const s = await fakeServer([{ status: 401, body: JSON.stringify({ error: { message: 'bad key' } }) }]);
  await assert.rejects(post(s.url, opts), (e) => {
    assert.match(e.message, /acme: HTTP 401: bad key/);
    assert.ok(!e.message.includes('sk-secret-key'));
    return true;
  });
  assert.equal(s.requests.length, 1);
  await s.close();
});

test('network errors are retried, then reported', async () => {
  const s = await fakeServer([{}]);
  const url = s.url;
  await s.close();
  await assert.rejects(post(url, { ...opts, retries: 1 }), /acme: request failed: ECONNREFUSED.*2 attempts/);
});
