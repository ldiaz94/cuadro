// cuadro http: one request with a timeout and retries, and the few helpers
// the speech and chat adapters share.
// Retries on 429, 5xx and network errors, waiting retry-after seconds when
// the server says so and an exponential backoff otherwise, at most a
// minute either way. A failure throws an Error naming the provider and
// quoting the API's own message; headers (which carry the key) are never
// put in an error. need() reads a required key; openaiKey() picks the key
// for an OpenAI-style server, so OpenAI's key never goes to another host.
// Depends on the global fetch. Leaves out redirects, streaming bodies and
// cookies.

/** The longest wait between two attempts, in milliseconds. */
const MaxWait = 60000;

/** POSTs body to url; resolves to the 2xx Response, else throws after retries. */
export function post(url, options) {
  return send('POST', url, options);
}

/** GETs url; resolves to the 2xx Response, else throws after retries. */
export function get(url, options) {
  return send('GET', url, options);
}

/** Sends one request, retrying as the module comment says. */
async function send(method, url, { headers = {}, body, timeout = 120000, retries = 3, backoff = 500, provider = 'http' }) {
  let problem;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let wait = backoff * 2 ** attempt;
    try {
      const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(timeout) });
      if (res.ok) return res;
      problem = `${provider}: HTTP ${res.status}: ${await excerpt(res)}`;
      if (res.status !== 429 && res.status < 500) throw new Fatal(problem);
      const after = Number(res.headers.get('retry-after'));
      if (after >= 0 && res.headers.get('retry-after')) wait = after * 1000;
    } catch (e) {
      if (e instanceof Fatal) throw new Error(e.message);
      problem = `${provider}: request failed: ${e.cause?.code ?? e.name}`;
    }
    if (attempt < retries) await new Promise((r) => setTimeout(r, Math.min(wait, MaxWait)));
  }
  throw new Error(`${problem} (gave up after ${retries + 1} attempts)`);
}

/** The value of the environment variable name, or an error saying to set it. */
export function need(name) {
  const value = process.env[name];
  if (!value) throw new Error(`cuadro: set ${name} to use this provider`);
  return value;
}

/** OpenAI's own API address, the default for the openai providers. */
export const OpenAIUrl = 'https://api.openai.com/v1';

/** The key for an OpenAI-style API at baseUrl: OPENAI_API_KEY for OpenAI itself, else OPENAI_COMPAT_API_KEY; both optional. */
export function openaiKey(baseUrl) {
  return new URL(baseUrl).host === new URL(OpenAIUrl).host ? process.env.OPENAI_API_KEY : process.env.OPENAI_COMPAT_API_KEY;
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
