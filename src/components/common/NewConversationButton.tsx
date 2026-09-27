"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";

export function NewConversationButton({ label = "New conversation" }: { label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-primary"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const { node } = await api.createTree();
          router.push(`/n/${node.id}`);
        } finally {
          setBusy(false);
        }
      }}
    >
      {label}
    </button>
  );
}
