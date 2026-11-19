"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Panel } from "@/components/ui/Panel";
import { Textarea } from "@/components/ui/Textarea";
import { Field } from "@/components/forms/Field";
import { Icon } from "@/design-system/icons/Icon";
import {
  POST_ALT_MAX,
  POST_BODY_MAX,
  POST_MAX_IMAGES,
  POST_TITLE_MAX,
} from "@/lib/validation/posts";
import { createPost, requestUploadTicket } from "./actions";
import type { FeedPostView } from "./feedView";
import { ErrorBanner } from "@/components/forms/Banners";
import { track } from "@/lib/analytics/track";

// ════════════════════════════════════════════════════════════════════
// Foundry · The composer
//
// Images go STRAIGHT TO THE GATEWAY, not through a Next.js action. The
// server action only issues a 5-minute signed ticket; the bytes never
// touch Vercel, which keeps us clear of serverless body limits and
// function timeouts and keeps bandwidth off the web tier.
//
// Alt text is required rather than optional. LinkedIn makes it optional,
// which is why most images there have none. On a members-only feed at an
// engineering school it costs one field and it is the difference between
// an image being content and being a blank.
//
// If the gateway is unconfigured or unreachable, the image control is
// hidden and posting still works. A storage outage must not be able to
// take down the Community tab.
//
// The look: one calm panel with two fields. The body grows with what is
// written (field-sizing, where the browser has it) instead of scrolling in a
// small box; the one hairline separates the writing from the actions.
// ════════════════════════════════════════════════════════════════════

type Attached = {
  blob_key: string;
  alt_text: string;
  width: number;
  height: number;
  byte_size: number;
};

const ACCEPT = "image/jpeg,image/png,image/webp";

export default function PostComposer({
  uploadsAvailable,
  onPosted,
}: {
  uploadsAvailable: boolean;
  onPosted: (post: FeedPostView) => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [images, setImages] = useState<Attached[]>([]);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setError("");
    setUploading(true);
    try {
      const ticket = await requestUploadTicket();
      if (!ticket.ok) { setError(ticket.error); return; }

      // Client-side size check is a courtesy, not a control — the gateway
      // enforces the real cap while streaming, because a limit the browser
      // owns is a limit an attacker skips.
      if (file.size > ticket.data.maxBytes) {
        setError("That image is over the 8MB limit.");
        return;
      }

      const form = new FormData();
      form.append("file", file);

      const res = await fetch(ticket.data.uploadUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${ticket.data.token}` },
        body: form,
        // Without this, a hung gateway leaves `uploading` stuck true
        // forever with no error — the catch below never fires.
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        setError(detail?.detail ?? "That image couldn't be uploaded. Try a JPEG, PNG or WebP.");
        return;
      }

      const stored = await res.json();
      setImages((prev) => [
        ...prev,
        {
          blob_key: stored.key,
          alt_text: "",
          width: stored.width,
          height: stored.height,
          byte_size: stored.bytes,
        },
      ]);
    } catch {
      setError("Couldn't reach the image service. You can still post without an image.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const missingAlt = images.some((i) => !i.alt_text.trim());
  const canPost = title.trim().length >= 3 && body.trim().length >= 10 && !missingAlt;

  return (
    <Panel as="section" className="anim-panel p-5 sm:p-7">
      <h2 className="font-display text-title text-text-primary">
        Post to the community
      </h2>

      <div className="mt-5 grid gap-5">
        <Field label="Title">
          <Input
            id="post-title"
            value={title}
            maxLength={POST_TITLE_MAX}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What's this about?"
          />
        </Field>

        {/* The counter stays outside the label: it is not part of the field's name. */}
        <div>
          <Field label="Post">
            <Textarea
              id="post-body"
              rows={5}
              value={body}
              maxLength={POST_BODY_MAX}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Share what you're building, ask for help, or point people at something."
              className="max-h-[60vh] field-sizing-content"
            />
          </Field>
          <p className="data mt-2 text-right text-small text-text-muted">
            {body.length}/{POST_BODY_MAX}
          </p>
        </div>
      </div>

      {images.length > 0 && (
        <ul className="mt-5 grid gap-5">
          {images.map((image, i) => (
            <li key={image.blob_key} className="grid gap-3 border-t border-border-subtle pt-5">
              <div className="flex items-center justify-between gap-3">
                <p className="data inline-flex items-center gap-2 text-small text-text-secondary">
                  <Icon name="image" size={16} />
                  Image {i + 1} · {image.width}×{image.height}
                </p>
                <Button
                  variant="dangerGhost"
                  size="sm"
                  onClick={() => setImages((prev) => prev.filter((_, n) => n !== i))}
                >
                  Remove
                </Button>
              </div>
              <Field label="Describe this image (required)">
                <Input
                  id={`alt-${i}`}
                  compact
                  value={image.alt_text}
                  maxLength={POST_ALT_MAX}
                  onChange={(e) =>
                    setImages((prev) =>
                      prev.map((img, n) => (n === i ? { ...img, alt_text: e.target.value } : img)),
                    )
                  }
                  placeholder="e.g. Our team demoing at the showcase"
                />
              </Field>
            </li>
          ))}
        </ul>
      )}

      {error && <div className="mt-5"><ErrorBanner>{error}</ErrorBanner></div>}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle pt-5">
        {uploadsAvailable && images.length < POST_MAX_IMAGES ? (
          <>
            <input
              ref={fileRef}
              id="post-image"
              type="file"
              accept={ACCEPT}
              aria-label="Add an image"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
              }}
            />
            <Button
              variant="ghost"
              size="sm"
              loading={uploading}
              leading={<Icon name="image" size={18} />}
              onClick={() => fileRef.current?.click()}
            >
              Add image
            </Button>
          </>
        ) : (
          <span className="text-small text-text-muted">
            {uploadsAvailable ? `Maximum ${POST_MAX_IMAGES} images` : "Images unavailable"}
          </span>
        )}

        <Button
          variant="primary"
          size="sm"
          loading={pending}
          disabled={!canPost}
          onClick={() =>
            start(async () => {
              setError("");
              const res = await createPost({ title, body, images });
              if (!res.ok) { setError(res.error); return; }
              track("post_created", { imageCount: images.length });
              setTitle("");
              setBody("");
              setImages([]);
              onPosted(res.data);
            })
          }
        >
          Post
        </Button>
      </div>

      {missingAlt && (
        <p className="mt-3 text-small text-text-muted">
          Add a description for each image before posting.
        </p>
      )}
    </Panel>
  );
}
