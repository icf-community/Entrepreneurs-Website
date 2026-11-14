import { Avatar, type AvatarSize } from "@/components/ui/Avatar";

// ════════════════════════════════════════════════════════════════════
// Foundry · A member's face, shared by the directory grid, the newest-members
// strip, the committee gallery and the profile dialog.
//
// A person is drawn in a ring (Avatar): their photo, or their initials in the
// display face. The avatar is already a 512×512 square blob (AvatarCropper's
// OUTPUT), so the ring crops only its corners and shows the whole face. The
// photo is a real <img alt=""> (the name is always written beside it); a signed
// URL that has expired falls back to the initials by itself.
//
// `lit` is for the person who is the chosen one (the open profile).
// ════════════════════════════════════════════════════════════════════

export function MemberPhoto({
  member,
  size = "lg",
  lit = false,
  className = "",
}: {
  member: {
    firstName: string;
    surname: string;
    avatarUrl: string | null;
  };
  size?: AvatarSize;
  lit?: boolean;
  className?: string;
}) {
  // The same two letters the square placeholder always showed.
  const initials = `${member.firstName[0] ?? ""}${member.surname[0] ?? ""}`.toUpperCase();
  return <Avatar src={member.avatarUrl} name={member.firstName} initials={initials} size={size} lit={lit} className={className} />;
}
