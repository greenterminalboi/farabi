"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useViewStore } from "@/state/viewStore";

export function ViewToggle() {
  const pathname = usePathname();
  const lastNodeId = useViewStore((s) => s.lastNodeId);
  const onMap = pathname === "/map";
  return (
    <nav className="view-toggle" aria-label="View">
      <Link href={lastNodeId ? `/n/${lastNodeId}` : "/"} aria-current={onMap ? undefined : "page"}>
        Chat
      </Link>
      <Link href="/map" aria-current={onMap ? "page" : undefined}>
        Map
      </Link>
    </nav>
  );
}
