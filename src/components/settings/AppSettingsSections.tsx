"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import { desktopApi } from "@/lib/desktopApi";
import type { AppSettingsResponse, ClaudeCodeStatus, HostInfo, ImportCheckResponse, ImportResult, SaveAppSettingBody } from "@/shared/desktop";

const DEFAULT_SOURCE = "postgres://farabi:farabi@127.0.0.1:5432/farabi";

const message = (err: unknown) => (err instanceof ApiError ? err.message : "Something went wrong. Try again.");

const PROVIDERS = [
  { id: "claude-code", label: "Claude Code", help: "Uses your Claude subscription through the claude program on this computer." },
  { id: "claude", label: "Claude API", help: "Uses your API key; calls are billed to your Anthropic account." },
  { id: "fake", label: "Fake", help: "Canned replies, for trying Farabi out. No AI is called." },
] as const;

const REFUSALS: Record<string, string> = {
  destination_not_empty: "This Farabi already has projects or feedback, so nothing can be imported into it.",
  already_imported: "That database was already imported.",
  source_unreachable: "Farabi couldn't connect to that database. Is the web app's Postgres running?",
  schema_behind: "That database is older than this Farabi. Run its migrations first (npm run db:migrate).",
  schema_ahead: "That database is newer than this Farabi. Update Farabi first.",
};

function claudeCodeLine(s: ClaudeCodeStatus | null): string {
  if (!s) return "Checking…";
  if (s.status === "not_found") return "Not found";
  return `Found · ${s.status === "signed_out" ? "signed out" : "signed in"}${s.version ? ` · ${s.version}` : ""}`;
}

/**
 * The settings that used to be environment variables, the API key, and (in the desktop app) the
 * data folder, snapshots and the import (feature 11, US4, contracts/ui additions). Controls that
 * need the desktop shell become text fields in the web app, or are hidden.
 */
export function AppSettingsSections() {
  const [settings, setSettings] = useState<AppSettingsResponse | null>(null);
  const [info, setInfo] = useState<HostInfo | null>(null);
  const [keyPresent, setKeyPresent] = useState<boolean | null>(null);
  const [claudeCode, setClaudeCode] = useState<ClaudeCodeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(() => {
    Promise.all([desktopApi.appSettings(), desktopApi.hostInfo(), desktopApi.apiKey()]).then(
      ([s, i, k]) => {
        setSettings(s);
        setInfo(i);
        setKeyPresent(k.present);
      },
      (err) => setError(message(err)),
    );
    desktopApi.claudeCode().then(setClaudeCode, () => setClaudeCode(null));
  }, []);

  useEffect(refresh, [refresh]);

  async function save(body: SaveAppSettingBody, done = "Saved") {
    setError(null);
    setNotice(null);
    try {
      setSettings(await desktopApi.saveAppSetting(body));
      setNotice(done);
      if (body.key === "claude_code_path" || body.key === "ai_provider") setClaudeCode(await desktopApi.claudeCode(true));
    } catch (err) {
      setError(message(err));
    }
  }

  if (!settings || !info) return error ? <p className="composer-error" role="alert">{error}</p> : null;
  const desktop = info.mode === "desktop";
  const { config } = settings;
  const provider = config.ai_provider.value;

  return (
    <div className="app-settings" data-testid="app-settings">
      <div className="settings-section" id="provider">
        <h2>AI provider</h2>
        <p className="muted">Who writes replies, summaries and definitions.</p>
        <div className="app-settings-choices" role="radiogroup" aria-label="AI provider">
          {PROVIDERS.map((p) => (
            <label key={p.id} className="app-settings-choice">
              <input
                type="radio"
                name="ai_provider"
                value={p.id}
                checked={provider === p.id}
                data-testid={`provider-${p.id}`}
                onChange={() => void save({ key: "ai_provider", value: p.id })}
              />
              <span>
                <strong>{p.label}</strong>
                <span className="muted"> · {p.help}</span>
              </span>
            </label>
          ))}
        </div>
        {provider === "claude-code" && (
          <ClaudeCodeControls
            status={claudeCode}
            path={config.claude_code_path.value}
            desktop={desktop}
            onRecheck={async () => setClaudeCode(await desktopApi.claudeCode(true).catch(() => null))}
            onPath={(value) => void save({ key: "claude_code_path", value })}
          />
        )}
        {provider === "claude" && keyPresent === false && <p className="composer-error">Add your API key below to use the Claude API.</p>}
      </div>

      <ApiKeySection desktop={desktop} present={keyPresent} onChange={(present) => setKeyPresent(present)} />

      <div className="settings-section">
        <h2>Default model</h2>
        <ModelField key={config.default_model.value ?? ""} value={config.default_model.value} onSave={(value) => void save({ key: "default_model", value })} />
      </div>

      <div className="settings-section" id="lexicon">
        <h2>Lexicon</h2>
        <label className="app-settings-choice">
          <input
            type="checkbox"
            checked={config.lexicon_autodetect.value}
            data-testid="lexicon-autodetect"
            onChange={(e) => void save({ key: "lexicon_autodetect", value: e.target.checked })}
          />
          <span>
            <strong>Pick up lexicon words automatically</strong>
            <span className="muted">
              {" "}
              · Lexicon terms you type, like &ldquo;summarize&rdquo; or &ldquo;table&rdquo;, are added as chips you can remove before sending.
              When off, only chips you add yourself are used.
            </span>
          </span>
        </label>
      </div>

      <div className="settings-section">
        <h2>Feedback export</h2>
        <p className="muted">
          Where FEEDBACK.md and its screenshots are written for Claude Code. Usually your Farabi checkout&apos;s feedback folder.
        </p>
        <p data-testid="export-dir">{config.feedback_export_dir.value ?? <span className="muted">Not exported</span>}</p>
        <FolderField
          desktop={desktop}
          value={config.feedback_export_dir.value}
          purpose="feedback_export"
          onSave={(value) => void save({ key: "feedback_export_dir", value }, "Saved. FEEDBACK.md was written there.")}
        />
        {settings.exportStatus && !settings.exportStatus.ok && (
          <p className="composer-error" role="alert">
            The last export failed: {settings.exportStatus.error}
          </p>
        )}
      </div>

      {desktop && <DataSection info={info} onImported={refresh} />}

      {notice && (
        <p className="settings-status" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="composer-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function ClaudeCodeControls(props: {
  status: ClaudeCodeStatus | null;
  path: string | null;
  desktop: boolean;
  onRecheck: () => Promise<void>;
  onPath: (value: string | null) => void;
}) {
  const [draft, setDraft] = useState(props.path ?? "");
  return (
    <div className="app-settings-row">
      <p data-testid="claude-code-status">
        Claude Code: <strong>{claudeCodeLine(props.status)}</strong>
        {props.status?.path && <span className="muted"> · {props.status.path}</span>}
      </p>
      {props.status?.status === "signed_out" && <p className="muted">Open a terminal, run claude, and sign in. Then press Recheck.</p>}
      <div className="app-settings-buttons">
        <button className="btn btn-small" onClick={() => void props.onRecheck()}>
          Recheck
        </button>
        {props.desktop ? (
          <button
            className="btn btn-small"
            onClick={async () => {
              const { path } = await desktopApi.pick("claude_code");
              if (path) props.onPath(path);
            }}
          >
            Choose file…
          </button>
        ) : (
          <>
            <input aria-label="Claude Code path" placeholder="/path/to/claude" value={draft} onChange={(e) => setDraft(e.target.value)} />
            <button className="btn btn-small" onClick={() => props.onPath(draft.trim() || null)}>
              Save path
            </button>
          </>
        )}
        {props.path && (
          <button className="btn btn-small" onClick={() => props.onPath(null)}>
            Find automatically
          </button>
        )}
      </div>
    </div>
  );
}

function ApiKeySection({ desktop, present, onChange }: { desktop: boolean; present: boolean | null; onChange: (present: boolean) => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="settings-section" id="api-key">
      <h2>Claude API key</h2>
      {!desktop ? (
        <p className="muted">In the web app the key comes from ANTHROPIC_API_KEY in .env.local. {present ? "A key is set." : "No key is set."}</p>
      ) : (
        <>
          <p className="muted">Kept in your {navigator.userAgent.includes("Windows") ? "Windows Credential Manager" : "macOS Keychain"}, never in Farabi&apos;s data.</p>
          {present && <p data-testid="api-key-saved">Key saved.</p>}
          <form
            className="app-settings-buttons"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setStatus(null);
              try {
                await desktopApi.saveApiKey(value.trim());
                setValue("");
                onChange(true);
                setStatus({ ok: true, text: "Key saved." });
              } catch (err) {
                setStatus({ ok: false, text: message(err) });
              } finally {
                setBusy(false);
              }
            }}
          >
            <input
              type="password"
              autoComplete="off"
              aria-label="Claude API key"
              placeholder={present ? "Replace the saved key" : "sk-ant-…"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <button className="btn btn-small btn-primary" disabled={busy || value.trim().length < 20}>
              {busy ? "Checking…" : "Save"}
            </button>
            {present && (
              <button
                type="button"
                className="btn btn-small"
                onClick={async () => {
                  await desktopApi.removeApiKey().catch((err) => setStatus({ ok: false, text: message(err) }));
                  onChange(false);
                }}
              >
                Remove
              </button>
            )}
          </form>
          {status && <p className={status.ok ? "settings-status" : "composer-error"}>{status.text}</p>}
        </>
      )}
    </div>
  );
}

function ModelField({ value, onSave }: { value: string | null; onSave: (value: string | null) => void }) {
  // Keyed by the stored value, so a save elsewhere resets the draft.
  const [draft, setDraft] = useState(value ?? "");
  return (
    <form
      className="kind-setting"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(draft.trim() || null);
      }}
    >
      <span>Default model</span>
      <span className="muted">Leave empty for the provider&apos;s default. Reply detail settings can still pick a model per reply.</span>
      <span className="app-settings-buttons">
        <input aria-label="Default model" placeholder="Provider default" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button className="btn btn-small" disabled={(draft.trim() || null) === value}>
          Save
        </button>
      </span>
    </form>
  );
}

function FolderField(props: {
  desktop: boolean;
  value: string | null;
  purpose: "feedback_export" | "import_attachments";
  onSave: (value: string | null) => void;
}) {
  const [draft, setDraft] = useState(props.value ?? "");
  return (
    <div className="app-settings-buttons">
      {props.desktop ? (
        <button
          className="btn btn-small"
          onClick={async () => {
            const { path } = await desktopApi.pick(props.purpose);
            if (path) props.onSave(path);
          }}
        >
          Choose…
        </button>
      ) : (
        <>
          <input aria-label="Folder" placeholder="/path/to/folder" value={draft} onChange={(e) => setDraft(e.target.value)} />
          <button className="btn btn-small" onClick={() => props.onSave(draft.trim() || null)}>
            Save
          </button>
        </>
      )}
      {props.desktop && props.value && (
        <>
          <button className="btn btn-small" onClick={() => void desktopApi.reveal("export")}>
            Show
          </button>
          <button className="btn btn-small" onClick={() => props.onSave(null)}>
            Stop exporting
          </button>
        </>
      )}
    </div>
  );
}

function DataSection({ info, onImported }: { info: HostInfo; onImported: () => void }) {
  const reveal = info.platform === "windows" ? "Show in Explorer" : "Show in Finder";
  const [snapshots, setSnapshots] = useState<Array<{ name: string; takenAt: string; bytes: number }> | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  useEffect(() => {
    desktopApi.snapshots().then((s) => setSnapshots(s.snapshots), () => setSnapshots([]));
  }, []);
  return (
    <div className="settings-section" id="data">
      <h2>Data</h2>
      <p className="muted">Everything you make is stored on this computer.</p>
      <div className="app-settings-row">
        <span>Data folder: {info.dataDir}</span>
        <button className="btn btn-small" onClick={() => void desktopApi.reveal("data")}>
          {reveal}
        </button>
      </div>
      <div className="app-settings-row">
        <span>Logs: {info.logDir}</span>
        <button className="btn btn-small" onClick={() => void desktopApi.reveal("logs")}>
          {reveal}
        </button>
      </div>

      <h3>Snapshots</h3>
      <p className="muted">Taken every 10 minutes while something changes, and when Farabi quits. The newest 6 are kept.</p>
      {snapshots?.length === 0 && <p className="muted">None yet.</p>}
      <ul className="app-settings-list">
        {snapshots?.map((s) => (
          <li key={s.name}>
            {new Date(s.takenAt).toLocaleString()} <span className="muted">· {(s.bytes / 1e6).toFixed(1)} MB</span>{" "}
            {restoring === s.name ? (
              <>
                <span>Replace everything with this snapshot? Farabi restarts; the current data is kept in the backups folder.</span>{" "}
                <button className="btn btn-small btn-danger" onClick={() => void desktopApi.restoreSnapshot(s.name)}>
                  Restore and restart
                </button>{" "}
                <button className="btn btn-small" onClick={() => setRestoring(null)}>
                  Cancel
                </button>
              </>
            ) : (
              <button className="btn btn-small" onClick={() => setRestoring(s.name)}>
                Restore…
              </button>
            )}
          </li>
        ))}
      </ul>

      <ImportSection onImported={onImported} />
    </div>
  );
}

function ImportSection({ onImported }: { onImported: () => void }) {
  const [source, setSource] = useState(DEFAULT_SOURCE);
  const [attachments, setAttachments] = useState<string | null>(null);
  const [check, setCheck] = useState<ImportCheckResponse | null>(null);
  const [busy, setBusy] = useState<"check" | "import" | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const total = (counts: Record<string, number>) => Object.values(counts).reduce((a, b) => a + b, 0);

  async function run(kind: "check" | "import") {
    setBusy(kind);
    setError(null);
    try {
      if (kind === "check") setCheck(await desktopApi.checkImport(source, attachments ?? undefined));
      else {
        setResult(await desktopApi.runImport(source, attachments ?? undefined));
        setCheck(null);
        onImported();
      }
    } catch (err) {
      setError(err instanceof ApiError && REFUSALS[err.code] ? REFUSALS[err.code] : message(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div data-testid="import-section">
      <h3>Import from the web app</h3>
      <p className="muted">Copies everything from the web app&apos;s database into this Farabi, once. Only works while this Farabi is still empty.</p>
      <label className="kind-setting">
        <span>Database</span>
        <input aria-label="Web app database" value={source} onChange={(e) => setSource(e.target.value)} disabled={busy !== null} />
      </label>
      <div className="app-settings-row">
        <span>Screenshots folder: {attachments ?? <span className="muted">none (feedback screenshots won&apos;t be copied)</span>}</span>
        <button
          className="btn btn-small"
          disabled={busy !== null}
          onClick={async () => {
            const { path } = await desktopApi.pick("import_attachments");
            if (path) setAttachments(path);
          }}
        >
          Choose…
        </button>
      </div>
      <div className="app-settings-buttons">
        <button className="btn btn-small" disabled={busy !== null} onClick={() => void run("check")}>
          {busy === "check" ? "Checking…" : "Check"}
        </button>
        <button className="btn btn-small btn-primary" disabled={busy !== null || !check?.ready} onClick={() => void run("import")}>
          {busy === "import" ? "Importing… keep Farabi open" : "Import"}
        </button>
      </div>
      {check?.ready && <p className="settings-status">Ready: {total(check.counts).toLocaleString()} rows to copy.</p>}
      {check && !check.ready && <p className="composer-error">{REFUSALS[check.reason] ?? check.detail}</p>}
      {result && (
        <p className="settings-status" role="status">
          Imported {total(result.counts).toLocaleString()} rows and {result.attachmentsCopied} screenshot files. Every table matched.
        </p>
      )}
      {error && (
        <p className="composer-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
