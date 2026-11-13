"use client";

import { useEffect, useId, useRef, useState } from "react";
import { labelCls } from "@/components/forms/styles";
import { FieldError } from "@/components/forms/Field";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";

// ════════════════════════════════════════════════════════════════════
// Foundry · Avatar cropper
//
// Hand-rolled rather than a dependency (see ethereal-fluttering-blossom.md
// §4c for why): drag to pan, a labelled range input to zoom. The zoom
// slider is simultaneously the accessibility answer and removes every
// pinch-gesture edge case, which is the only genuinely fiddly part of a
// cropper — what's left is around 40 lines of drag math.
//
// THE SELECTED REGION IS WHAT IS STORED. There is no "original" kept
// anywhere: onCropped hands back exactly the square the member framed,
// and re-adjusting later means re-picking the source file.
//
// EXIF ORIENTATION: loaded via createImageBitmap(file, { imageOrientation:
// "from-image" }) so a portrait iPhone photo (orientation tag 6) doesn't
// draw sideways before the member even starts cropping.
// ════════════════════════════════════════════════════════════════════

const MAX_BOX = 288; // on-screen crop box ceiling, px — shrinks to fit narrow containers
const OUTPUT = 512; // stored square, px — matches server AVATAR_MAX_EDGE
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;
const NUDGE = 12;

// A pure "cover" fit at zoom 1 makes the image's shorter axis land
// exactly on BOX, which forces clamp()'s minX/minY to 0 on that axis —
// drag has zero range until the member manually zooms in, and for a
// square-ish photo (the common case for a re-uploaded avatar) both
// axes lock at once, so drag looks completely dead. This overscan
// guarantees real pan room on both axes from the start, at every zoom
// level, regardless of the source photo's aspect ratio.
const OVERSCAN = 1.15;

type Offset = { x: number; y: number };

export function AvatarCropper({
  file,
  onCropped,
  onCancel,
}: {
  file: File;
  onCropped: (blob: Blob) => void;
  onCancel: () => void;
}) {
  const zoomId = useId();
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; origin: Offset } | null>(null);
  const [prevFile, setPrevFile] = useState(file);

  // BOX was a fixed 288px constant — wider than the available card width on
  // an ordinary phone once real padding is accounted for, so the circle
  // overflowed its card on narrow viewports. Measuring the actual
  // container keeps it a true "cover" fit at any width, up to MAX_BOX.
  const containerRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState(MAX_BOX);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setBox(Math.min(MAX_BOX, Math.floor(el.clientWidth)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Reset for a new file during render, not in an effect — this is the
  // "adjusting state when a prop changes" case React's own docs steer away
  // from an effect for: it runs once per actual file change, synchronously,
  // rather than as a render-then-effect-then-render round trip. Refs can't
  // be read or written during render, which is why this is state.
  if (file !== prevFile) {
    setPrevFile(file);
    setError("");
    setBitmap(null);
  }

  useEffect(() => {
    let cancelled = false;
    createImageBitmap(file, { imageOrientation: "from-image" })
      .then((bmp) => {
        if (cancelled) return;
        setBitmap(bmp);
        setZoom(MIN_ZOOM);
        // Centre immediately, computed from this bitmap and zoom=1 — not a
        // separate effect reacting to `bitmap`, which would show one frame
        // clamped to a corner before re-centring.
        const s = (box / Math.min(bmp.width, bmp.height)) * OVERSCAN;
        setOffset({ x: (box - bmp.width * s) / 2, y: (box - bmp.height * s) / 2 });
      })
      .catch(() => {
        if (!cancelled) setError("That image couldn't be read. Try a different file.");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-centering on every box resize (e.g. rotating a phone) would fight an in-progress crop; only a new file should re-run this.
  }, [file]);

  // Scale that makes the image cover the crop box at zoom = 1, like
  // object-fit: cover, plus OVERSCAN so there's already pan room at
  // zoom = 1 — then zoom multiplies on top of that.
  const baseScale = bitmap ? (box / Math.min(bitmap.width, bitmap.height)) * OVERSCAN : 1;
  const scale = baseScale * zoom;
  const dw = bitmap ? bitmap.width * scale : 0;
  const dh = bitmap ? bitmap.height * scale : 0;

  const clamp = (o: Offset, w: number, h: number): Offset => {
    const minX = Math.min(0, box - w);
    const minY = Math.min(0, box - h);
    return { x: Math.min(0, Math.max(minX, o.x)), y: Math.min(0, Math.max(minY, o.y)) };
  };

  const nudge = (dx: number, dy: number) => setOffset((prev) => clamp({ x: prev.x + dx, y: prev.y + dy }, dw, dh));

  // Re-clamp right where zoom actually changes, rather than in an effect
  // watching it — the box's display size is a function of the new zoom
  // value, computed here rather than read back from state next render.
  const applyZoom = (z: number) => {
    setZoom(z);
    if (!bitmap) return;
    const s = (box / Math.min(bitmap.width, bitmap.height)) * OVERSCAN * z;
    setOffset((prev) => clamp(prev, bitmap.width * s, bitmap.height * s));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, origin: offset };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setOffset(clamp({ x: dragRef.current.origin.x + dx, y: dragRef.current.origin.y + dy }, dw, dh));
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };

  const confirm = () => {
    if (!bitmap) return;
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT;
    canvas.height = OUTPUT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const k = OUTPUT / box;
    ctx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, offset.x * k, offset.y * k, dw * k, dh * k);
    canvas.toBlob(
      (blob) => {
        if (blob) onCropped(blob);
      },
      "image/jpeg",
      0.92,
    );
  };

  return (
    <Panel className="p-5">
      <div className="mb-3 empty:hidden">
        <FieldError>{error || undefined}</FieldError>
      </div>

      {/* Always rendered (not gated on bitmap) so containerRef can measure
          the real available width before the first image ever loads —
          an empty flex container still spans its parent's full width. */}
      <div ref={containerRef} className="flex justify-center">
        {bitmap && (
          <div
            tabIndex={0}
            role="group"
            aria-label="Photo position — drag, or use the arrow keys, to choose what shows in the circle"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onKeyDown={(e) => {
              const step = e.shiftKey ? NUDGE * 3 : NUDGE;
              if (e.key === "ArrowLeft") { e.preventDefault(); nudge(step, 0); }
              if (e.key === "ArrowRight") { e.preventDefault(); nudge(-step, 0); }
              if (e.key === "ArrowUp") { e.preventDefault(); nudge(0, step); }
              if (e.key === "ArrowDown") { e.preventDefault(); nudge(0, -step); }
            }}
            style={{ width: box, height: box }}
            className="relative cursor-move touch-none select-none overflow-hidden rounded-full border border-border-strong bg-bg-secondary"
          >
            <CropperImage bitmap={bitmap} width={dw} height={dh} x={offset.x} y={offset.y} />
          </div>
        )}
      </div>

      {bitmap && (
        <>
          <div className="mt-5">
            <label htmlFor={zoomId} className={`${labelCls} mb-2`}>
              Zoom
            </label>
            <input
              id={zoomId}
              type="range"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={0.01}
              value={zoom}
              onChange={(e) => applyZoom(parseFloat(e.target.value))}
              className="w-full accent-[var(--color-accent)]"
            />
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button type="button" variant="primary" size="md" onClick={confirm}>
              Use this photo
            </Button>
            <Button type="button" variant="ghost" size="md" onClick={onCancel}>
              Choose a different photo
            </Button>
          </div>
        </>
      )}
    </Panel>
  );
}

/** Draws the bitmap into a small canvas positioned like an <img> would be —
 *  a canvas rather than an <img src> because the source is a decoded
 *  ImageBitmap, not a URL. */
function CropperImage({
  bitmap,
  width,
  height,
  x,
  y,
}: {
  bitmap: ImageBitmap;
  width: number;
  height: number;
  x: number;
  y: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  }, [bitmap, width, height, dpr]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      style={{
        position: "absolute",
        left: x,
        top: y,
        width,
        height,
        pointerEvents: "none",
      }}
    />
  );
}
