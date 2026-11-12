import { useState } from "react";
import { requestAvatarTicket, confirmAvatarUpload } from "@/app/profile/mediaActions";
import type { IntakeState } from "@/lib/intake/state";

/**
 * Avatar upload, extracted out of IntakeFlow (structural only, no behavior
 * change) — see IntakeFlow's own header comment for why this round trip
 * lives outside screens.tsx: it uploads the moment a crop is confirmed
 * (screen 01), not deferred to Finish.
 */
export function useAvatarUpload(
  patch: (p: Partial<IntakeState>) => void,
  photoPreview: string | null,
) {
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState("");

  const onCropAvatar = async (blob: Blob) => {
    setAvatarError("");
    setAvatarUploading(true);
    try {
      const ticket = await requestAvatarTicket();
      if (!ticket.ok) { setAvatarError(ticket.error); return; }

      const form = new FormData();
      form.append("file", blob, "avatar.jpg");
      const res = await fetch(ticket.data.uploadUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${ticket.data.token}` },
        body: form,
        // Without this, a hung gateway leaves avatarUploading stuck true
        // forever with no error — the catch below never fires.
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        setAvatarError(detail?.detail ?? "That photo couldn't be uploaded. Try a JPEG, PNG or WebP.");
        return;
      }
      const stored = await res.json();

      const confirmed = await confirmAvatarUpload(stored.key);
      if (!confirmed.ok) { setAvatarError(confirmed.error); return; }

      if (photoPreview) URL.revokeObjectURL(photoPreview);
      patch({ photoPreview: URL.createObjectURL(blob) });
    } catch {
      setAvatarError("Couldn't reach the photo service. Try again in a moment.");
    } finally {
      setAvatarUploading(false);
    }
  };

  return { avatarUploading, avatarError, onCropAvatar };
}
