// The demo's soundtrack, made from sines: ten seconds of an arpeggio over
// a soft pad and bass, through Am F C G, written as a 16-bit mono WAV.
// Self-made, so it is free to use. Usage: node demo/music.js out.wav
// Depends on node:fs. Leaves out everything a synth would have.
import { writeFileSync } from 'node:fs';

const Rate = 44100;
const Seconds = 10;
const Beat = 0.625; // 96 beats a minute; a chord lasts four beats
/** Each chord as semitones above A3 (220 Hz): Am, F, C, G. */
const Chords = [[0, 3, 7], [-4, 0, 3], [3, 7, 10], [-2, 2, 5]];
/** The arpeggio's eighth notes, as indexes into the chord (3 and up wrap an octave higher). */
const Pattern = [0, 1, 2, 3, 4, 3, 2, 1];

const hz = (semitones) => 220 * 2 ** (semitones / 12);
const tone = (semitones, octave = 0) => hz(semitones + 12 * octave);
const out = new Float32Array(Rate * Seconds);

/** Adds a sine of frequency f from start for length seconds, shaped by env(age). */
function add(f, start, length, env) {
  const from = Math.round(start * Rate), to = Math.min(out.length, Math.round((start + length) * Rate));
  for (let i = from; i < to; i++) {
    const age = i / Rate - start;
    out[i] += env(age) * Math.sin(2 * Math.PI * f * age);
  }
}

for (let bar = 0; bar < Seconds / (4 * Beat); bar++) {
  const chord = Chords[bar % Chords.length], t0 = bar * 4 * Beat;
  for (const s of chord) add(tone(s), t0, 4 * Beat, (a) => 0.05 * Math.min(1, a / 0.4) * Math.min(1, (4 * Beat - a) / 0.2)); // pad
  for (let b = 0; b < 4; b++) add(tone(chord[0], -1), t0 + b * Beat, Beat, (a) => 0.18 * Math.exp(-a * 5)); // bass
  Pattern.forEach((k, i) => {
    const s = chord[k % 3] + 12 * (Math.floor(k / 3) + 1);
    add(hz(s), t0 + (i * Beat) / 2, 1, (a) => 0.12 * Math.min(1, a / 0.005) * Math.exp(-a * 6)); // pluck
  });
}

const pcm = Buffer.alloc(44 + out.length * 2);
out.forEach((v, i) => {
  const fade = Math.min(1, (Seconds - i / Rate) / 1.5); // fade out over the last 1.5 s
  pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v * fade)) * 32767), 44 + i * 2);
});
pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + out.length * 2, 4); pcm.write('WAVEfmt ', 8);
pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22); // PCM, mono
pcm.writeUInt32LE(Rate, 24); pcm.writeUInt32LE(Rate * 2, 28); pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34);
pcm.write('data', 36); pcm.writeUInt32LE(out.length * 2, 40);
writeFileSync(process.argv[2] ?? 'music.wav', pcm);
