"use client";

import { ConfirmDialog } from "@/components/connections/ConfirmDialog";

type ConfirmResult = Promise<{ ok: true } | { ok: false; error: string }>;

export function AiHistoryDialogs({
  showDeleteChat, showDeleteAll, onDeleteChat, onDeleteAll, onChatDeleted, onAllDeleted, onCloseChat, onCloseAll,
}: {
  showDeleteChat: boolean;
  showDeleteAll: boolean;
  onDeleteChat: () => ConfirmResult;
  onDeleteAll: () => ConfirmResult;
  onChatDeleted: () => void;
  onAllDeleted: () => void;
  onCloseChat: () => void;
  onCloseAll: () => void;
}) {
  return (
    <>
      {showDeleteChat && (
        <ConfirmDialog
          title="Delete this chat?"
          body={<p>Its messages, criteria and results are deleted now.</p>}
          confirmLabel="Delete chat"
          onConfirm={onDeleteChat}
          onSuccess={onChatDeleted}
          onClose={onCloseChat}
        />
      )}
      {showDeleteAll && (
        <ConfirmDialog
          title="Delete all AI history?"
          body={<p>Every AI chat, criterion and saved match you have is deleted now. Today&apos;s search count stays.</p>}
          confirmLabel="Delete everything"
          onConfirm={onDeleteAll}
          onSuccess={onAllDeleted}
          onClose={onCloseAll}
        />
      )}
    </>
  );
}
