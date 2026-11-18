# cuadro 0.4: themes, scenes and scripts

Goal: a lazy prompt still gives a good-looking video, and a creative idea can
still be written as code. Both kinds of scene are views (`frame => Child`),
so a video can mix them.

## Step 1: themes and designed scenes

- `cuadro/theme`: a theme is a set of CSS custom properties covering
  colours, fonts, type scale, spacing and easing, plus brand inputs (accent
  colours, logo). `theme(name, overrides)` returns the properties for a
  stage. Two or three themes to start with: light and clean, bold, and dark.
- `cuadro/scenes`: title, kinetic text, stat, steps, tiles and end card.
  - Each one fills the 1280×720 frame, with type readable on a phone
    (body ≥ 28 px).
  - Each keeps moving for its whole length, with no still holds.
  - Each takes its length as an input and spreads its beats across it.
  - Each is a plain function that code scenes can also call.
- Proof: rebuild `~/r/tangent-video` with them, plus an AI-twin scene
  written as code (see step 2), at 30–40 s.

## Step 2: motion from the voice

- `cuadro voice` also writes amplitude peaks for each line (e.g. 1 value
  per video frame at 30 fps, 0–1). It takes them from the audio with
  ffmpeg and stores them next to voice.json.
- `level(peaks, frame)` gives a smoothed 0–1 value, so a scene can move to
  the voice. The peaks are worked out before the render, so the video stays
  the same every time.
- Example: the Mentor Twin scene, a waveform driven by its narration line.

## Step 3: scripts

- A script is JSON: `{ theme, brand, scenes: [{ type, props, say } | { code, say }] }`.
- cuadro checks it against a schema, voices the `say` lines, sets each
  scene's length from its line, and plays the scenes in order.
- `make` writes the script, not a whole page, and writes code only for the
  `code` scenes. Those are checked and reviewed as page code is today.

## Left out

A scene editor, plugins, transitions beyond cross-fades, and any scene type
that no real video needs yet.
