// cuadro's scenes demo: every scene once (the app scene twice, with rows
// and with a screenshot), cross-fading, in the theme named by the `theme`
// prop (light, bold or dark), on a frame of the `format` prop's shape
// (16:9 or 9:16). Preview it at
// /demo/scenes.html?props={"theme":"dark","format":"9:16"}; render it with
// `npx cuadro render demo/scenes.html out/scenes.mp4 --props '{"theme":"bold"}'`.
import { composition } from 'cuadro';
import { theme } from 'cuadro/theme';
import { stage, play, playLength, title, kinetic, stat, steps, tiles, app, quote, compare, endCard } from 'cuadro/scenes';
import { formats } from 'cuadro/script';

/** The scenes, as [length, view], for a made-up note-taking app. */
const scenes = [
  [105, title({ length: 105, kicker: 'Meet Lumen', title: 'Notes that *find you* when you need them', sub: 'Write once. See it again at the right moment.' })],
  [150, kinetic({ length: 150, lines: ['You write it down.', 'Then you *lose it.*', 'Lumen brings it *back.*'] })],
  [135, stat({ length: 135, title: 'Teams on Lumen', stats: [
    { value: 3.5, suffix: 'x', label: 'faster to find past decisions' },
    { value: 82, suffix: '%', label: 'fewer repeated questions' },
    { value: 12, suffix: 'k', label: 'teams writing daily' }] })],
  [160, steps({ length: 160, title: 'How it works', items: [
    { title: 'Write', text: 'Type, paste or speak.' },
    { title: 'Link', text: 'Tied to people and projects.' },
    { title: 'Recall', text: 'Back in your next meeting.' },
    { title: 'Share', text: 'One link, always current.' }] })],
  [150, tiles({ length: 150, title: 'Everything in one place', items: [
    { title: 'Search', text: 'Every word' },
    { title: 'Offline', text: 'On the plane' },
    { title: 'Private', text: 'End to end' },
    { title: 'Calendar', text: 'Meets meetings' },
    { title: 'Voice', text: 'Speak to write' },
    { title: 'Export', text: 'Plain Markdown' }] })],
  [150, app({ length: 150, title: 'Ask your notes *anything*', rows: [
    { kind: 'sent', title: 'What did we decide on pricing?' },
    { kind: 'received', title: 'Two tiers, from May', text: 'Launch plan, 3 Apr' },
    { kind: 'item', title: 'Launch plan', text: 'Edited by Ana' },
    { kind: 'profile', title: 'Ana Ruiz', text: 'Owns pricing' }] })],
  [120, app({ length: 120, device: 'browser', image: '/demo/screen.svg' })],
  [150, quote({ length: 150, quote: 'We stopped asking *the same questions* in every meeting.', name: 'Maya Chen', role: 'Head of Product, Fieldnote' })],
  [165, compare({ length: 165, title: 'A week of notes', left: { label: 'Before', items: ['Five apps', 'Lost decisions', 'Repeated questions'] },
    right: { label: 'With Lumen', items: ['One place', 'Found in seconds', 'Answers on hand'] } })],
  [150, endCard({ length: 150, logo: '/doc/img/logo.svg', line: 'Never lose a *good idea* again', cta: 'Try Lumen free', url: 'lumen.example' })],
];

/** The size is chosen before composition() reads the props, so it is read here. */
const { format = '16:9' } = JSON.parse(new URLSearchParams(location.search).get('props') ?? '{}');

composition({
  ...formats[format], fps: 30, durationInFrames: playLength(...scenes),
  props: { theme: 'light' },
  view: (frame, props) => stage(theme(props.theme), play(...scenes))(frame),
});
