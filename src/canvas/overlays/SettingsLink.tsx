import Link from "next/link";

/** "Open Settings" beside an error that Settings can fix (provider_not_ready, feature 11 FR-014). */
export function SettingsLink({ href }: { href: string }) {
  return (
    <Link href={href} className="btn btn-small" data-testid="provider-settings-link">
      Open Settings
    </Link>
  );
}
