// cuadro voice: turns a script of lines into one audio file per line, and a
// voice.json listing them with their lengths and loudness.
// The script is { "lines": [{ "id", "text" }], "language" }, or a scene
// script (script.js), whose `say` lines are spoken with ids scene1,
// scene2...; its language, if any, goes to the provider.
// Line <id> becomes
// <out>/<id>.<ext>, and <out>/voice.json is { fps, lines: [{ id, file,
// seconds, hash, levels, words, wordsFrom }] }, where hash covers the
// provider, its API address, the voice, the model, the text and the
// language. levels is the line's loudness,
// one number from 0 to 1 per video frame (ceil(seconds * fps) of them, 2
// decimals, the loudest frame of the line being 1), so a scene can move to
// the narration (see level.js). words is when each word is said,
// [{ text, start, end }] in seconds (timings.js), and wordsFrom where that
// came from: the provider's own timings ("elevenlabs") or "estimate", a
// guess from the levels. A line whose hash and file are unchanged is
// not spoken again, so editing one line costs one request; it only gets its
// levels redone if they are missing or were made for another fps, and its
// words if they are missing or were estimated from levels redone.
// Depends on speech.js, script.js, timings.js, and ffprobe and ffmpeg on
// the PATH. Leaves out
// deleting the files of lines removed from the script.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { check, lines as sceneLines } from './script.js';
import { address, defaults, speak } from './speech.js';
import { estimate } from './timings.js';

/** Speaks every line of the script into out, with levels at fps; onLine({ id, index, total, skipped }) after each. */
export async function voice({ script, out = 'voice', provider, voice: voiceName, model, baseUrl, fps = 30, onLine = () => {} }) {
  const source = JSON.parse(await readFile(script, 'utf8'));
  const { lines } = checked(source?.scenes ? sceneLines(check(source)) : source);
  const language = source.language;
  const chosen = { voice: voiceName ?? defaults[provider]?.voice, model: model ?? defaults[provider]?.model };
  await mkdir(out, { recursive: true });
  const { fps: oldFps, lines: oldLines } = await readManifest(out);
  const previous = new Map(oldLines.map((l) => [l.id, l]));
  const manifest = [];
  for (const [index, { id, text }] of lines.entries()) {
    // The language joins the hash only when given, so lines voiced before it existed stay cached.
    const key = [provider, address(provider, baseUrl), chosen.voice, chosen.model, text, ...(language ? [language] : [])];
    const hash = createHash('sha256').update(key.join('\0')).digest('hex');
    const old = previous.get(id);
    const skipped = old?.hash === hash && existsSync(join(out, old.file));
    if (skipped) {
      const stale = !Array.isArray(old.levels) || oldFps !== fps;
      const line = stale ? { ...old, levels: await levels(join(out, old.file), old.seconds, fps) } : old;
      const guess = !Array.isArray(line.words) || (stale && line.wordsFrom === 'estimate');
      manifest.push(guess ? { ...line, words: estimate(text, line.levels, fps, language), wordsFrom: 'estimate' } : line);
    } else {
      const { bytes, ext, words } = await speak({ provider, text, baseUrl, language, ...chosen });
      const file = `${id}.${ext}`;
      await writeFile(join(out, file), bytes);
      const seconds = await duration(join(out, file));
      const loudness = await levels(join(out, file), seconds, fps);
      const timed = words ? { words, wordsFrom: provider } : { words: estimate(text, loudness, fps, language), wordsFrom: 'estimate' };
      manifest.push({ id, file, seconds, hash, levels: loudness, ...timed });
    }
    // Saved after every line, so a failure later keeps the work done.
    await writeFile(join(out, 'voice.json'), JSON.stringify({ fps, lines: manifest }, null, 2) + '\n');
    onLine({ id, index, total: lines.length, skipped });
  }
  return { fps, lines: manifest };
}

/** The script's lines, or an error if the script is malformed. */
function checked(script) {
  if (!Array.isArray(script?.lines)) throw new Error('cuadro: the script must be { "lines": [{ "id", "text" }] } or a scene script { "scenes": [...] }');
  const seen = new Set();
  for (const { id, text } of script.lines) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`cuadro: line id ${JSON.stringify(id)} must be letters, digits, - or _`);
    if (seen.has(id)) throw new Error(`cuadro: line id "${id}" is used twice`);
    if (typeof text !== 'string' || !text.trim()) throw new Error(`cuadro: line "${id}" has no text`);
    seen.add(id);
  }
  return script;
}

/** The fps and lines of out/voice.json, or no lines if it is missing or unreadable. */
async function readManifest(out) {
  try {
    const { fps, lines } = JSON.parse(await readFile(join(out, 'voice.json'), 'utf8'));
    return { fps, lines: Array.isArray(lines) ? lines : [] };
  } catch {
    return { lines: [] };
  }
}

/** Samples per video frame when measuring loudness. */
const Window = 800;

/** The loudness of an audio file per video frame: RMS over each frame, scaled so the loudest is 1, to 2 decimals. */
async function levels(file, seconds, fps) {
  const args = ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(fps * Window), '-f', 'f32le', '-'];
  const { stdout } = await promisify(execFile)('ffmpeg', args, { encoding: 'buffer', maxBuffer: 1 << 30 });
  const frames = Math.ceil(seconds * fps);
  const rms = [];
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = f * Window; i < (f + 1) * Window && (i + 1) * 4 <= stdout.length; i++) sum += stdout.readFloatLE(i * 4) ** 2;
    rms.push(Math.sqrt(sum / Window));
  }
  const loudest = Math.max(...rms);
  // A (near) silent line stays all zeros rather than amplifying noise.
  return rms.map((r) => (loudest < 1e-4 ? 0 : Math.round((r / loudest) * 100) / 100));
}

/** The length in seconds of an audio file, from ffprobe. */
async function duration(file) {
  const args = ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file];
  const { stdout } = await promisify(execFile)('ffprobe', args);
  const seconds = Number(stdout);
  if (!(seconds > 0)) throw new Error(`cuadro: ffprobe could not measure ${file}`);
  return seconds;
}
