# cuadro: plan for v0.2 (audio clips and narration)

Two pieces, each useful alone. Rendering stays deterministic and offline:
anything a model makes is saved to files first, and render only reads files.
Prompt to video (`cuadro make`) is v0.3, planned after this ships.

## 1. Audio clips (no network)

```js
import { audio, sequence, series } from 'cuadro';

sequence(30, 90, (f) => html`${audio('voice/intro.mp3', { volume: 1 })(f)}<h1>…</h1>`)
```

- `audio(src, { volume = 1 })` is a view. It plays from the frame its
  sequence starts (or the composition's frame 0), and stops when its
  sequence unmounts or the file ends.
- When it mounts it records `{ src, from, until, volume }` in
  `window.cuadro.clips`, where `from` is the absolute frame at local frame
  0 (the composition exposes its root frame for this).
- Render: frames are encoded as now (video only, to a temporary file),
  then a second ffmpeg pass mixes every clip (`adelay`, `atrim`, `volume`,
  `amix`, with `--audio` as one more clip at frame 0) and muxes it with
  the video copied as-is (`-c:v copy`).
- Preview: each clip is an `<audio>` element, playing or paused with the
  bar and seeking to `local / fps` when you scrub. Preview only; render never uses it.
- Tests: two clips at known frames come out at the right times (measured
  by detecting silence in the mix); a clip in an unmounted sequence is
  never heard; `--audio` and clips play together; the same input renders
  the same audio twice.

## 2. Narration: `cuadro voice`

```sh
cuadro voice script.json --provider elevenlabs --voice <id> [--model m] [--out voice/]
```

```json
{ "lines": [
  { "id": "hook", "text": "Stop the endless job search." },
  { "id": "stats", "text": "Referrals get people hired nine times more often." } ] }
```

- Each line becomes `voice/<id>.<ext>`, and `voice/voice.json` lists
  `{ id, file, seconds }`. The page imports it with
  `import voice from './voice/voice.json' with { type: 'json' }` and sets
  scene lengths from `seconds`, so the visuals follow the voice.
- A line is regenerated only when its text, provider, voice or model
  changes (a hash stored in voice.json), so edits are cheap.
- Durations come from ffprobe.
- Providers, as plain `fetch` adapters of ~30 lines each, with keys from
  env vars only:
  - `elevenlabs`: `ELEVENLABS_API_KEY`, mp3.
  - `gemini`: `GEMINI_API_KEY`; returns raw PCM, which is wrapped as WAV.
  - `openai`: `OPENAI_API_KEY`, and `OPENAI_BASE_URL` for any compatible
    server (local Kokoro or Piper servers, and others); mp3.
  - Qwen: added if its speech API fits one of these shapes, or as a fourth
    adapter if not. Checked when writing the adapters.
  - Each adapter's exact request is checked against the provider's
    current docs when writing it, not from memory.
- `src/http.js`: one `post()` with a timeout and retries (429, 5xx,
  network; honouring `retry-after`), shared by every adapter now and by
  `make` in v0.3. Errors name the provider and show the API's message,
  never the key.
- Tests: adapters run against a local fake server (request shape, auth
  header, retry on 429 then success, error message without the key);
  caching skips unchanged lines; voice.json durations match the files. No
  test calls a real API.

## Modules

| file | what |
|---|---|
| `src/audio.js` | the `audio` view, clip registry, preview playback |
| `src/render.js` | + the mixing pass |
| `src/voice.js` | `voice()`: script → clips + voice.json, cache |
| `src/speech.js` | the speech adapters |
| `src/http.js` | `post()` with timeout and retries |
| `bin/cuadro.js` | + `voice` subcommand |

Estimate ~250 lines. Dependencies unchanged (spark, playwright-core).

## Order (one commit each)

1. `audio()` + clip registry + mixing pass + tests.
2. Preview playback of clips.
3. `http.js` + fake-server test harness.
4. Speech adapters (elevenlabs, openai-compatible, gemini, then Qwen).
5. `voice()` + CLI + cache + tests.
6. Demo: narrated version of the title card (needs a key: I will ask
   before spending any credits), README (API table), types.

## v0.3 sketch: `cuadro make "prompt"`

The model gets the README and `.d.ts` as context and writes `video.js`;
cuadro loads it, and on a page error or blank frames sends back the error
and a few screenshots for at most N fix rounds. Providers: Anthropic (REST,
`anthropic-version: 2026-10-21`, default model `claude-opus-5-5`), Gemini,
OpenAI and compatible. Writes into its own folder; the result is a source
file you edit and commit. Can call `cuadro voice` for narration.
