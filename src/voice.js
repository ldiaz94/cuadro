// cuadro voice: turns a script of lines into one audio file per line, and a
// voice.json listing them with their lengths.
// The script is { "lines": [{ "id", "text" }] }. Line <id> becomes
// <out>/<id>.<ext>, and <out>/voice.json is { lines: [{ id, file, seconds,
// hash }] }, where hash covers the provider, its API address, the voice,
// the model and the text. A line whose hash and file are unchanged is not
// spoken again, so editing one line costs one request.
// Depends on speech.js and ffprobe (from ffmpeg) on the PATH. Leaves out
// deleting the files of lines removed from the script.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { address, defaults, speak } from './speech.js';

/** Speaks every line of the script into out; onLine({ id, index, total, skipped }) after each. */
export async function voice({ script, out = 'voice', provider, voice: voiceName, model, baseUrl, onLine = () => {} }) {
  const { lines } = checked(JSON.parse(await readFile(script, 'utf8')));
  const chosen = { voice: voiceName ?? defaults[provider]?.voice, model: model ?? defaults[provider]?.model };
  await mkdir(out, { recursive: true });
  const previous = new Map((await readManifest(out)).map((l) => [l.id, l]));
  const manifest = [];
  for (const [index, { id, text }] of lines.entries()) {
    const hash = createHash('sha256').update([provider, address(provider, baseUrl), chosen.voice, chosen.model, text].join('\0')).digest('hex');
    const old = previous.get(id);
    const skipped = old?.hash === hash && existsSync(join(out, old.file));
    if (skipped) {
      manifest.push(old);
    } else {
      const { bytes, ext } = await speak({ provider, text, baseUrl, ...chosen });
      const file = `${id}.${ext}`;
      await writeFile(join(out, file), bytes);
      manifest.push({ id, file, seconds: await duration(join(out, file)), hash });
    }
    // Saved after every line, so a failure later keeps the work done.
    await writeFile(join(out, 'voice.json'), JSON.stringify({ lines: manifest }, null, 2) + '\n');
    onLine({ id, index, total: lines.length, skipped });
  }
  return { lines: manifest };
}

/** The script's lines, or an error if the script is malformed. */
function checked(script) {
  if (!Array.isArray(script?.lines)) throw new Error('cuadro: the script must be { "lines": [{ "id", "text" }] }');
  const seen = new Set();
  for (const { id, text } of script.lines) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`cuadro: line id ${JSON.stringify(id)} must be letters, digits, - or _`);
    if (seen.has(id)) throw new Error(`cuadro: line id "${id}" is used twice`);
    if (typeof text !== 'string' || !text.trim()) throw new Error(`cuadro: line "${id}" has no text`);
    seen.add(id);
  }
  return script;
}

/** The lines of out/voice.json, or none if it is missing or unreadable. */
async function readManifest(out) {
  try {
    return JSON.parse(await readFile(join(out, 'voice.json'), 'utf8')).lines;
  } catch {
    return [];
  }
}

/** The length in seconds of an audio file, from ffprobe. */
async function duration(file) {
  const args = ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file];
  const { stdout } = await promisify(execFile)('ffprobe', args);
  const seconds = Number(stdout);
  if (!(seconds > 0)) throw new Error(`cuadro: ffprobe could not measure ${file}`);
  return seconds;
}
