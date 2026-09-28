"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Top-bar link to Settings, reachable from every view (Feature 6, FR-001). */
export function SettingsLink() {
  const current = usePathname() === "/settings";
  return (
    <Link
      href="/settings"
      className="btn settings-link"
      aria-label="Settings"
      title="Settings"
      aria-current={current ? "page" : undefined}
    >
      <span aria-hidden="true">⚙</span>
    </Link>
  );
}
