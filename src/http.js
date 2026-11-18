// cuadro http: one POST with a timeout and retries, shared by the speech
// adapters.
// Retries on 429, 5xx and network errors, waiting retry-after seconds when
// the server says so and an exponential backoff otherwise. A failure throws
// an Error naming the provider and quoting the API's own message; headers
// (which carry the key) are never put in an error.
// Depends on the global fetch. Leaves out redirects, streaming bodies and
// cookies.

/** POSTs body to url; resolves to the 2xx Response, else throws after retries. */
export async function post(url, { headers = {}, body, timeout = 120000, retries = 3, backoff = 500, provider = 'http' }) {
  let problem;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let wait = backoff * 2 ** attempt;
    try {
      const res = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(timeout) });
      if (res.ok) return res;
      problem = `${provider}: HTTP ${res.status}: ${await excerpt(res)}`;
      if (res.status !== 429 && res.status < 500) throw new Fatal(problem);
      const after = Number(res.headers.get('retry-after'));
      if (after >= 0 && res.headers.get('retry-after')) wait = after * 1000;
    } catch (e) {
      if (e instanceof Fatal) throw new Error(e.message);
      problem = `${provider}: request failed: ${e.cause?.code ?? e.name}`;
    }
    if (attempt < retries) await new Promise((r) => setTimeout(r, wait));
  }
  throw new Error(`${problem} (gave up after ${retries + 1} attempts)`);
}

/** An error that must not be retried. */
class Fatal extends Error {}

/** The API's error message from a failed response, at most 300 characters. */
async function excerpt(res) {
  const text = await res.text().catch(() => '');
  let message = text;
  try {
    const json = JSON.parse(text);
    const found = json.error?.message ?? json.error ?? json.message ?? json.detail?.message ?? json.detail;
    if (found) message = typeof found === 'string' ? found : JSON.stringify(found);
  } catch {}
  return message.slice(0, 300);
}
