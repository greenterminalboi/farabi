"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** The canvas replaced the chat and map views (FR-023); Definitions stays its own page. */
export function TopNav() {
  const pathname = usePathname();
  return (
    <nav className="view-toggle" aria-label="View">
      <Link href="/" aria-current={pathname === "/" ? "page" : undefined}>
        Canvas
      </Link>
      <Link href="/definitions" aria-current={pathname === "/definitions" ? "page" : undefined}>
        Definitions
      </Link>
    </nav>
  );
}
