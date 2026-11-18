// Compiled, never run (npm run types): uses the API as a video would, so a
// wrong declaration fails to type-check.
import { composition, sequence, series, audio, interpolate, spring, easeOut, bezier, html, signal, type View } from 'cuadro';
import { render, still } from 'cuadro/render';
import { make } from 'cuadro/make';

const dot: View = (frame) => html`<b>${() => interpolate(frame(), [0, 10], [0, 1], { easing: easeOut, extrapolate: { left: 'clamp', right: 'extend' } })}</b>`;
const c = composition({
  width: 640, height: 360, fps: 30, durationInFrames: 90,
  props: { title: 'hi' },
  view: (frame, props) => html`<h1>${props.title}</h1>${sequence(10, 20, dot)(frame)}${series([5, dot], [Infinity, dot])(frame)}${audio('a.mp3', { volume: 0.5 })(frame)}`,
});
const n: number = spring({ frame: 3, fps: c.fps, config: { damping: 12 }, to: 2 }) + bezier(0, 0, 1, 1)(0.5);
const [, set] = signal(n);
set((x) => x + 1);
void c.setFrame(0);
const from: number = c.clips[0].from;
void render({ page: 'demo/index.html', out: 'out.mp4', props: { title: 'x' }, workers: 2, onProgress: (done: number, total: number) => {} });
void still({ page: 'demo/index.html', out: 'sheet.png', frames: [0, 30], columns: 2 });
void still({ page: 'demo/index.html', out: 'sheet.png', every: 2 });
void make({ prompt: 'a box', provider: 'anthropic', rounds: 2, logo: 'logo.svg', brand: { accent: '#4d65ff' }, music: 'music.wav', onStep: (m: string) => {} }).then(({ file }) => file.length);

import { theme, themes } from 'cuadro/theme';
import { stage, play, playLength, scene, beats, Fade, title, kinetic, stat, steps, tiles, endCard } from 'cuadro/scenes';
const look = theme('bold', { accent: '#ff3366' });
const bg: string = themes.dark['--bg'];
const clips: [number, View][] = [
  [90, title({ length: 90, kicker: 'New', title: 'Hello *world*', sub: 'sub' })],
  [90, kinetic({ length: 90, lines: ['one', 'two'] })],
  [90, stat({ length: 90, title: 'Numbers', stats: [{ value: 9, suffix: 'x', label: 'more' }] })],
  [90, steps({ length: 90, items: [{ title: 'a', text: 'b' }, { title: 'c' }] })],
  [90, tiles({ length: 90, title: 'T', items: [{ title: 'a' }, { title: 'b' }] })],
  [90, endCard({ length: 90, logo: 'logo.svg', line: 'Bye', cta: 'Go', url: 'x.example' })],
  [60, scene(60, (t) => html`<b style=${() => ({ opacity: t.enter(beats(60, 2)[1].from) * t.between(0, Fade) })}>${t.frame}</b>`)],
];
composition({ width: 1280, height: 720, fps: 30, durationInFrames: playLength(...clips), view: (frame) => stage(look, play(...clips))(frame) });

import { level, word, type Word } from 'cuadro/level';
import { captions, cues, CaptionBand } from 'cuadro/captions';
import { translate } from 'cuadro/translate';
import { voice } from 'cuadro/voice';
import { check, lines, timing } from 'cuadro/script';
import { player, type CodeScene } from 'cuadro/player';
const script = check({ scenes: [{ type: 'title', props: { title: 'Hi' }, say: 'Hi.' }, { code: 'scenes/x.js' }] });
const spoken: string = lines(script).lines[0].text;
const first: number = timing(script, { fps: 30, lines: [{ id: 'scene1', file: 'a.wav', seconds: 1 }] })[0].length;
const twin = ({ length, levels }: CodeScene): View => scene(length, (t) => html`<i style=${() => ({ opacity: level(levels, t.frame()) })}></i>`);
void player({ voice: null }).then((c) => c.durationInFrames + first + spoken.length + twin.length);

const said: Word[] = [{ text: 'Hi', start: 0, end: 0.3 }];
const lit: number = word(said, 10, 30);
const band: string = CaptionBand + cues(said)[0].text;
stage({ ...theme('dark', {}, { font: 'noto.woff2' }), '--safe-bottom': band }, captions(said));
const talker = ({ length, words, fps }: CodeScene): View => scene(length, (t) => html`<b>${() => words[word(words, t.frame(), fps)]?.text}</b>`);
void steps({ length: 90, items: [{ title: 'a' }, { title: 'b' }], words: said });
void translate({ script: 'script.json', to: 'es', provider: 'gemini' }).then((file: string) => file.length + lit + talker.length);
void voice({ script: 'script.json', provider: 'gemini' }).then(({ lines }) => lines[0].words[0].start + lines[0].wordsFrom.length);
void check({ language: 'es', captions: true, font: 'noto.woff2', scenes: [] }).captions;
