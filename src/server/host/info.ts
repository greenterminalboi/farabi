// What the desktop shell told the server at launch, for Settings (feature 11, FR-019).
import type { HostInfo } from "@/shared/desktop";
import { exportDir } from "../feedback/paths";
import { type Hello, isDesktop } from "./bridge";

const g = globalThis as unknown as { __farabiHostInfo?: { hello: Hello; schemaLevel: string | null } };

export function setHostInfo(hello: Hello, schemaLevel: string | null): void {
  g.__farabiHostInfo = { hello, schemaLevel };
}

export function hostInfo(): HostInfo {
  const info = g.__farabiHostInfo;
  if (!isDesktop() || !info) {
    return { mode: "web", appVersion: null, platform: process.platform, dataDir: null, logDir: null, schemaLevel: null };
  }
  const { hello, schemaLevel } = info;
  return { mode: "desktop", appVersion: hello.appVersion, platform: hello.platform, dataDir: hello.dataDir, logDir: hello.logDir, schemaLevel };
}

/** The folder behind a Reveal button. Only these three are ever shown, never an arbitrary path. */
export function revealTarget(target: "data" | "logs" | "export"): string | null {
  const info = hostInfo();
  if (target === "data") return info.dataDir;
  if (target === "logs") return info.logDir;
  return exportDir();
}
