// Keeps the API key and the per-launch session secret out of logs (feature 11, SC-008).
const g = globalThis as unknown as { __farabiSecrets?: Set<string>; __farabiRedacting?: boolean };
g.__farabiSecrets ??= new Set();
const secrets = g.__farabiSecrets;

/** Registers a value that must never appear in output. Values under 20 chars are ignored. */
export function registerSecret(value: string | undefined | null): void {
  if (value && value.length >= 20) secrets.add(value);
}

export function forgetSecret(value: string): void {
  secrets.delete(value);
}

export function redact(text: string): string {
  let out = text;
  for (const s of secrets) if (out.includes(s)) out = out.split(s).join("[redacted]");
  return out;
}

/**
 * Desktop mode: stdout belongs to the bridge, so console.log/info go to stderr, and everything
 * written to stderr is redacted first. The shell writes stderr to the log file.
 */
export function installLogRedaction(): void {
  if (g.__farabiRedacting) return;
  g.__farabiRedacting = true;
  const write = process.stderr.write.bind(process.stderr) as (chunk: unknown, ...rest: unknown[]) => boolean;
  process.stderr.write = ((chunk: unknown, ...rest: unknown[]) => {
    const text = typeof chunk === "string" ? chunk : Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    return write(redact(text), ...rest);
  }) as typeof process.stderr.write;
  console.log = console.error;
  console.info = console.error;
  console.debug = console.error;
}
