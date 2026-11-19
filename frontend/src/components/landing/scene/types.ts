// Shared shapes of the landing scene: what the stage measures, what the director computes, what the painters draw. Plain data, no DOM.

import type { Stage } from "./stage";

export type Rect4 = [left: number, top: number, right: number, bottom: number];

/** The camera's pose: it sits on a sphere round the mark (the origin), and `R` is the mark's ring radius in px. */
export interface CamPose {
  yaw: number;
  pitch: number;
  R: number;
  cx: number;
  cy: number;
  fov?: number;
  roll?: number;
}

/** A station's settled pose: the camera plus the orientation of the rings. */
export interface Pose extends CamPose {
  tilt: number;
  flat: number;
}

/** An element the director switches on and off with `--m` (a block of words). `_m` is the last value set, 0 or 1. */
export type Masked = HTMLElement & { _m?: number; _cta?: number };

export interface Pointer {
  x: number;
  y: number;
  nx: number;
  ny: number;
  sx: number;
  sy: number;
  active: boolean;
  down: boolean;
  step(dt: number, lambda?: number): void;
}

export interface StageSection {
  id: string;
  el: HTMLElement;
  index: number;
  top: number;
  h: number;
  enter: number;
  leave: number;
  pass: number;
  fill: number;
  vis: number;
  mid: number;
  local(a: number, b: number): number;
}

/** What the scroll stage knows each frame (`y` raw scroll, `ys` smoothed, `t` the page clock in seconds). */
export interface StageState {
  y: number;
  ys: number;
  vel: number;
  dir: number;
  vh: number;
  vw: number;
  max: number;
  g: number;
  gs: number;
  t: number;
  idle: number;
  active: string | null;
  sections: StageSection[];
  byId: Record<string, StageSection>;
  still: boolean;
  reduced: boolean;
  pointer: Pointer;
}

/** One entry of a station (a role, a member, a listing, an event, a step): where its words are, in page px. */
export interface Entry {
  el: HTMLElement;
  cy: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
  txTop: number;
  txBottom: number;
  txLeft: number;
  txRight: number;
}

/** A block of text the bodies in the scene keep clear of. `host` is the block whose mask (`_m === 0`) hides the rectangle. */
export interface TextRect {
  el: { closest(selector: string): unknown };
  host: Masked | null;
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface Dock {
  x: number;
  y: number;
  w: number;
}

/** The measured geometry the director works from. */
export interface Geometry {
  vw: number;
  vh: number;
  compact: boolean;
  railR: number;
  uw: number;
  hdr: number;
  RLs: number[];
  band: boolean[];
  hold: number;
  T: number[];
  entries: Record<string, Entry[]>;
  rects: TextRect[];
  s0: number[];
  sy: number;
  dock: Dock[];
  ctaCy: number | null;
  pickerCy: number | null;
  exCy: number[];
  ctaBox: { left: number; right: number; top: number; bottom: number } | null;
  ctaHost: { left: number; top: number } | null;
  copyRight: number;
  copyTop: number;
}

/** A glyph body in the scene: world position, size, opacity, how lit it is, and its halo. */
export interface Body {
  key: string;
  glyph: string;
  x: number;
  y: number;
  z: number;
  size: number;
  a: number;
  hi: number;
  halo: number;
  haloK: number;
  order: number;
}

export interface RingState {
  a: number;
  hi: number;
  line: number;
  build?: number;
}

export interface GateState {
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  a: number;
  hi: number;
  build: number;
}

/** Where a body is on screen, and how visible: the leader line from its words runs to it. */
export interface Target {
  x: number;
  y: number;
  r: number;
  a: number;
}

export interface Trail {
  n: number;
  pos: Float32Array;
  size: Float32Array;
  a: number;
  hi: number;
}

export interface Visitor {
  x: number;
  y: number;
  r: number;
  a: number;
  p: number;
}

export interface JoinState {
  p: number;
  pulse: number;
  flash: number;
}

/** One frame of the scene: the director fills it, the painters draw exactly it. */
export interface Frame {
  cam: { yaw: number; pitch: number; R: number; cx: number; cy: number };
  tilt: number;
  flat: number;
  time: number;
  build: number;
  flow: number;
  loose: number;
  streak: number;
  sdx: number;
  sdy: number;
  pulse: number;
  pulseW?: number;
  sky: number;
  markA: number;
  skyYaw: number;
  skyPitch: number;
  core: number;
  coreSwell: number;
  railX: number;
  k: number;
  w: number;
  c: number;
  S: number;
  n: number;
  orbits: RingState[];
  seventh: RingState;
  comm: RingState;
  sat: RingState;
  dial: RingState;
  gates: GateState[];
  bodies: Body[];
  trail: Trail | null;
  rects: Rect4[];
  tg: Target[];
  dock: { gone: boolean; press: number; sock?: number }[];
  visitor: Visitor | null;
}

/** The scroll state the director reads each frame (a poster passes a fixed one). */
export interface FrameScroll {
  ys: number;
  y: number;
  vel: number;
  pointer: { sx: number; sy: number };
}

/** What the director is told each frame. */
export interface FrameInput {
  focusAud: number;
  build: number;
  entrance: number;
  drift: number;
  flowOn: boolean;
  join?: JoinState;
  matches?: number[] | null;
  /** A poster: station k settled, focus c, pose placed by the caller (the static page). */
  force?: { k: number; c: number; pose?: Partial<Pose> | null };
}

/** The test hooks the scene leaves on `window` (the page contract the comparison tools read); every one is inert and none is read by the page. */
declare global {
  interface Window {
    __stage?: Stage;
    __mark?: () => { cx: number; cy: number; r: number } | null;
    __ready?: boolean;
    __stops?: () => number[];
    __prof?: { n: number; dir: number; gl: number; dom: number };
    __F?: Frame;
  }
}
