// Types for cuadro/render, the Node side: what TypeScript sees of src/render.js.

/** Renders a composition page to an mp4 with headless Chromium and ffmpeg. */
export function render(options: {
  /** The page's file path; it must be under root. */
  page: string;
  /** The mp4 to write; when the page sets window.cuadro.captions, they go beside it as an .srt. */
  out: string;
  /** Merged over the composition's default props. */
  props?: object;
  /** A soundtrack played from frame 0 with the clips, cut or padded with silence to the video's length. */
  audio?: string;
  /** The directory served to the browser (default: the working directory). */
  root?: string;
  /** Tabs rendering frames at once (default: up to 4, and no more than the CPUs). The video is the same for any number. */
  workers?: number;
  /** Called after each frame is written, in order. */
  onProgress?: (done: number, total: number) => void;
}): Promise<void>;

/** Renders some frames of a composition page to a PNG: one frame as it is, several tiled in a contact sheet. */
export function still(options: {
  /** The page's file path; it must be under root. */
  page: string;
  /** The PNG to write. */
  out: string;
  /** The frame numbers to render (default: one every `every` seconds). */
  frames?: number[];
  /** Seconds between frames when `frames` is not given (default 2). */
  every?: number;
  /** Merged over the composition's default props. */
  props?: object;
  /** The directory served to the browser (default: the working directory). */
  root?: string;
  /** Frames per row of the contact sheet (default: the number of frames, at most 4). */
  columns?: number;
}): Promise<void>;

/** Subtitles as SubRip (.srt) text. */
export function srt(captions: { start: number; end: number; text: string }[]): string;
