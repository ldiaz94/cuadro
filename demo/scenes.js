// cuadro's scenes demo: every scene once, cross-fading, in the theme
// named by the `theme` prop (light, bold or dark), on a 1280x720 frame,
// or 720x1280 with the prop `portrait`. Preview it at
// /demo/scenes.html?props={"theme":"dark"}; render it with
// `npx cuadro render demo/scenes.html out/scenes.mp4 --props '{"theme":"bold"}'`.
import { composition } from 'cuadro';
import { theme } from 'cuadro/theme';
import { stage, play, playLength, title, kinetic, stat, steps, tiles, endCard } from 'cuadro/scenes';

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
  [150, endCard({ length: 150, logo: '/doc/img/logo.svg', line: 'Never lose a *good idea* again', cta: 'Try Lumen free', url: 'lumen.example' })],
];

/** The size is chosen before composition() reads the props, so it is read here. */
const { portrait = false } = JSON.parse(new URLSearchParams(location.search).get('props') ?? '{}');

composition({
  width: portrait ? 720 : 1280, height: portrait ? 1280 : 720, fps: 30, durationInFrames: playLength(...scenes),
  props: { theme: 'light' },
  view: (frame, props) => stage(theme(props.theme), play(...scenes))(frame),
});
