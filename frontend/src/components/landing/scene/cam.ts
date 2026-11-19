// The one camera. Both renderers (WebGL and the 2D poster painter) and the director project through it, so a label, a leader line and a star can
// never disagree about where a body is. The mark sits at the world origin and is always the look-at target, so the screen position of the origin IS
// the mark's centre and its ring radius in px follows from the distance alone.
import { PerspectiveCamera, Vector3 } from "three";
import type { CamPose } from "./types";

export const FOV = 35;
export const TAN_HALF = Math.tan((FOV * Math.PI) / 360);

export interface Projected {
  x: number;
  y: number;
  z: number;
  depth: number;
  k: number;
}

export class Cam {
  camera = new PerspectiveCamera(FOV, 1, 0.1, 220);
  w = 1;
  h = 1;
  /** mark ring radius in px */
  R = 100;
  /** camera distance in world units */
  dist = 8;
  /** where the origin lands on screen (px) */
  cx = 0;
  cy = 0;
  private _v = new Vector3();
  private _d = new Vector3();

  /** dist from a wanted mark radius in px (the mark's world radius is 1). */
  static distFor(Rpx: number, h: number): number {
    return h / (2 * TAN_HALF * Rpx);
  }

  /** Camera sits on a sphere round the origin; yaw 0 pitch 0 looks down -z. */
  set(pose: CamPose, w: number, h: number): void {
    const cam = this.camera;
    this.w = w;
    this.h = h;
    const fov = pose.fov ?? FOV;
    const dist = h / (2 * Math.tan((fov * Math.PI) / 360) * pose.R);
    this.R = pose.R;
    this.dist = dist;
    this.cx = pose.cx;
    this.cy = pose.cy;
    const cp = Math.cos(pose.pitch);
    cam.fov = fov;
    cam.aspect = w / h;
    cam.position.set(dist * Math.sin(pose.yaw) * cp, dist * Math.sin(pose.pitch), dist * Math.cos(pose.yaw) * cp);
    cam.up.set(0, 1, 0);
    cam.lookAt(0, 0, 0);
    if (pose.roll) cam.rotateZ(pose.roll);
    cam.setViewOffset(w, h, w / 2 - pose.cx, h / 2 - pose.cy, w, h);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
  }

  /** world vector → { x, y (px, y down), depth (units along the view axis), k (px per world unit at that depth) }. */
  toScreen(v: Vector3, out: Partial<Projected> = {}): Projected {
    const q = this._v.copy(v).project(this.camera);
    out.x = (q.x * 0.5 + 0.5) * this.w;
    out.y = (-q.y * 0.5 + 0.5) * this.h;
    out.z = q.z;
    const d = this.depthOf(v);
    out.depth = d;
    out.k = this.h / (2 * Math.tan((this.camera.fov * Math.PI) / 360) * d);
    return out as Projected;
  }

  /** distance of a world point along the camera's forward axis. */
  depthOf(v: Vector3): number {
    const m = this.camera.matrixWorldInverse.elements;
    return -(m[2] * v.x + m[6] * v.y + m[10] * v.z + m[14]);
  }

  /** screen px + depth → world position (inverse of toScreen). */
  fromScreen(x: number, y: number, depth: number, out: Vector3 = new Vector3()): Vector3 {
    const nx = (x / this.w) * 2 - 1;
    const ny = -(y / this.h) * 2 + 1;
    const dir = this._d.set(nx, ny, 0.5).unproject(this.camera).sub(this.camera.position).normalize();
    // scale the ray so its component along the forward axis equals depth
    const fwd = this._v.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const t = depth / dir.dot(fwd);
    return out.copy(this.camera.position).addScaledVector(dir, t);
  }

  /** px per world unit at a given depth. */
  pxPerUnit(depth: number): number {
    return this.h / (2 * Math.tan((this.camera.fov * Math.PI) / 360) * depth);
  }
}
