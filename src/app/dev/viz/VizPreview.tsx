"use client";
// Gallery, paste-to-render and paste-to-generate (feature 014, US3, US4).
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { GALLERY, perfScene } from "@/viz/examples";
import type { Scene, VizProblem } from "@/viz/schema";
import { parseScene } from "@/viz/validate";
import { VizPlayer } from "@/viz/react/VizPlayer";
import styles from "./preview.module.css";

type Entry = { id: string; family: string; scene: Scene };
type GenError = { message: string; settingsPath?: string };

const FAMILY_LABEL: Record<string, string> = { code: "Code", algorithm: "Algorithms", argument: "Arguments", general: "Stress test" };

export function VizPreview({ initialId }: { initialId?: string }) {
  const entries = useMemo<Entry[]>(() => [...GALLERY, { id: "perf", family: "general", scene: perfScene() }], []);
  const [selected, setSelected] = useState<string>(entries.some((e) => e.id === initialId) ? initialId! : entries[0].id);
  const [custom, setCustom] = useState<Scene | null>(null);
  const [json, setJson] = useState("");
  const [problems, setProblems] = useState<VizProblem[] | null>(null);
  const [source, setSource] = useState("");
  const [family, setFamily] = useState("auto");
  const [busy, setBusy] = useState(false);
  const [genError, setGenError] = useState<GenError | null>(null);
  const pending = useRef<AbortController | null>(null);

  const scene = custom ?? entries.find((e) => e.id === selected)!.scene;
  const families = ["code", "algorithm", "argument", "general"];

  const pick = (id: string) => {
    setSelected(id);
    setCustom(null);
  };

  const render = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (err) {
      setProblems([{ path: "(json)", message: err instanceof Error ? err.message : "not JSON" }]);
      return;
    }
    const result = parseScene(parsed);
    if (!result.ok) {
      setProblems(result.problems);
      return;
    }
    setProblems(null);
    setCustom(result.scene);
  };

  const generate = async () => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setGenError(null);
    try {
      const res = await fetch("/api/viz/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: source, family }),
        signal: controller.signal,
      });
      const body = await res.json().catch(() => ({}));
      if (controller.signal.aborted) return;
      if (!res.ok) {
        setGenError({ message: body?.error?.message ?? `Request failed (${res.status})`, settingsPath: body?.settingsPath });
        return;
      }
      const result = parseScene(body.scene);
      if (!result.ok) {
        setGenError({ message: "The server returned a scene this page can't read. Nothing was shown." });
        return;
      }
      setCustom(result.scene);
    } catch (err) {
      if ((err as Error).name !== "AbortError") setGenError({ message: "The request failed. Nothing was created. Try again." });
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setBusy(false);
      }
    }
  };

  return (
    <div className={styles.page}>
      <nav className={styles.gallery} aria-label="Example visualizations">
        <h2 className={styles.heading}>Visualization engine</h2>
        <p className={styles.note}>Preview of feature 014. Hand-written examples; nothing here is saved.</p>
        {families.map((f) => (
          <div key={f}>
            <h3 className={styles.family}>{FAMILY_LABEL[f]}</h3>
            <ul className={styles.list}>
              {entries
                .filter((e) => e.family === f)
                .map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      className={styles.item}
                      aria-pressed={!custom && selected === e.id}
                      onClick={() => pick(e.id)}
                      data-testid={`viz-example-${e.id}`}
                    >
                      {e.scene.title}
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </nav>
      <section className={styles.main}>
        <VizPlayer scene={scene} />
        <div className={styles.tools}>
          <section className={styles.tool} aria-labelledby="viz-gen-h">
            <h3 id="viz-gen-h" className={styles.family}>
              Generate from text
            </h3>
            <p className={styles.note}>
              Paste code, an algorithm, or two conflicting statements. The configured AI proposes a scene; it is marked AI-suggested.
            </p>
            <textarea
              className={styles.textarea}
              value={source}
              onChange={(e) => setSource(e.target.value)}
              rows={7}
              aria-label="Text to visualize"
              data-testid="viz-source"
            />
            <div className={styles.row}>
              <label>
                Kind{" "}
                <select value={family} onChange={(e) => setFamily(e.target.value)}>
                  <option value="auto">Automatic</option>
                  <option value="code">Code</option>
                  <option value="algorithm">Algorithm</option>
                  <option value="argument">Argument</option>
                </select>
              </label>
              <button type="button" className="btn btn-primary" onClick={generate} disabled={busy || !source.trim()} data-testid="viz-generate">
                {busy ? "Generating…" : "Generate"}
              </button>
            </div>
            {genError && (
              <p className={styles.error} role="alert" data-testid="viz-gen-error">
                {genError.message}{" "}
                {genError.settingsPath && <Link href={genError.settingsPath}>Open Settings</Link>}
              </p>
            )}
          </section>
          <section className={styles.tool} aria-labelledby="viz-json-h">
            <h3 id="viz-json-h" className={styles.family}>
              Render a scene description
            </h3>
            <textarea
              className={`${styles.textarea} ${styles.mono}`}
              value={json}
              onChange={(e) => setJson(e.target.value)}
              rows={7}
              aria-label="Scene JSON"
              data-testid="viz-json"
              spellCheck={false}
            />
            <div className={styles.row}>
              <button type="button" className="btn" onClick={render} data-testid="viz-render">
                Render
              </button>
              <button type="button" className="btn" onClick={() => setJson(JSON.stringify(scene, null, 2))}>
                Copy current scene here
              </button>
            </div>
            {problems && (
              <div role="alert" className={styles.error} data-testid="viz-problems">
                <p>This scene can&apos;t be drawn:</p>
                <ul>
                  {problems.map((p, i) => (
                    <li key={i}>
                      <code>{p.path}</code>: {p.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}
