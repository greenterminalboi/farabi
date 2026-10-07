// Gate G1 probe (feature 11, quickstart V1). A debug build of the shell injects this into the real
// window on every page load when FARABI_PROBE_JS points at it, because nothing can drive a
// WKWebView from outside. Results go to <data dir>/probe/*.json via /api/test/probe.
// Steps survive reloads through localStorage: stream → stop → open the scale project → frames.
(async () => {
  if (location.hostname !== "127.0.0.1" || location.pathname !== "/") return;
  const KEY = "farabi-g1-step";
  const step = localStorage.getItem(KEY) ?? "stream";
  const report = (name, data) =>
    fetch("/api/test/probe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, data }) });
  const json = async (method, url, body) => {
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body && JSON.stringify(body) });
    return res.json();
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = [];
  const progress = (msg) => {
    log.push(`${Math.round(performance.now())} ${msg}`);
    void report("progress", log);
  };
  window.addEventListener("error", (e) => progress(`window error: ${e.message}`));
  window.addEventListener("unhandledrejection", (e) => progress(`unhandled: ${e.reason}`));
  progress(`start step=${step}`);

  /** Starts a tree and collects the SSE deltas of its answer. */
  async function streamOnce(projectId, stopAfter) {
    const started = await json("POST", "/api/trees", { projectId, content: `G1 probe ${Date.now()}` });
    const answerId = started.answer.id;
    const t0 = performance.now();
    const deltas = [];
    const end = await new Promise((resolve) => {
      const es = new EventSource(`/api/answers/${answerId}/stream`);
      es.onopen = () => progress(`es open ${answerId}`);
      es.onerror = () => progress(`es error readyState=${es.readyState}`);
      es.addEventListener("snapshot", () => progress("es snapshot"));
      es.addEventListener("delta", async (e) => {
        if (deltas.length < 2) progress(`delta ${deltas.length}`);
        deltas.push({ t: Math.round(performance.now() - t0), n: JSON.parse(e.data).text.length });
        if (stopAfter && deltas.length === stopAfter) await fetch(`/api/answers/${answerId}/stop`, { method: "POST" });
      });
      es.addEventListener("end", (e) => {
        progress(`es end after ${deltas.length} deltas`);
        es.close();
        resolve(JSON.parse(e.data).answer);
      });
      setTimeout(() => {
        es.close();
        resolve(null);
      }, 20000);
    });
    return { answerId, deltas, final: end && { status: end.status, textLength: (end.text ?? "").length } };
  }

  try {
    if (step === "stream") {
      await json("POST", "/api/test/ai-mode", { mode: "slow", chunkDelayMs: 60 });
      const { projects } = await json("GET", "/api/projects");
      const own = projects.find((p) => p.name !== "Scale seed") ?? projects[0];
      const full = await streamOnce(own.id, 0);
      const stopped = await streamOnce(own.id, 3);
      await json("POST", "/api/test/ai-mode", { mode: "ok" });
      await report("stream", {
        userAgent: navigator.userAgent,
        full,
        stopped,
        tokenByToken: full.deltas.length >= 3 && full.deltas.at(-1).t - full.deltas[0].t > 100,
        stopKeptPartial: Boolean(stopped.final && stopped.final.textLength > 0 && stopped.final.status !== "complete"),
      });
      const seed = projects.find((p) => p.name === "Scale seed");
      if (!seed) {
        await report("frames", { skipped: "no 'Scale seed' project; run seed-large against this data folder first" });
        localStorage.setItem(KEY, "done");
        return;
      }
      await fetch(`/api/projects/${seed.id}/open`, { method: "POST" });
      localStorage.setItem(KEY, "frames");
      location.reload();
      return;
    }

    if (step === "frames") {
      localStorage.setItem(KEY, "done");
      const opened = performance.now();
      while ((window.__farabiCanvasDebug?.().elements.length ?? 0) < 5000) {
        if (performance.now() - opened > 30000) throw new Error("the 5,000-element canvas did not load in 30 s");
        await sleep(50);
      }
      const openMs = Math.round(performance.now() - opened);
      if (!window.__farabiFrameStats) throw new Error("test hooks are off: run with NEXT_PUBLIC_FARABI_TEST_HOOKS=1");
      const b = window.__farabiMinimap().bounds;
      const cx = (b.minX + b.maxX) / 2;
      const cy = (b.minY + b.maxY) / 2;
      /** Moves the camera every frame for `ms` while the probe samples frame times. */
      async function pan(scale, ms, dx, dy) {
        window.__farabiSetCamera(cx, cy, scale);
        await sleep(800);
        const stats = window.__farabiFrameStats(ms);
        const t0 = performance.now();
        let x = cx;
        let y = cy;
        await new Promise((resolve) => {
          const tick = () => {
            x += dx;
            y += dy;
            window.__farabiSetCamera(x, y, scale);
            if (performance.now() - t0 < ms - 50) requestAnimationFrame(tick);
            else resolve();
          };
          requestAnimationFrame(tick);
        });
        return stats;
      }
      async function zoom(ms) {
        window.__farabiSetCamera(cx, cy, 0.05);
        await sleep(800);
        const stats = window.__farabiFrameStats(ms);
        const t0 = performance.now();
        await new Promise((resolve) => {
          const tick = () => {
            const k = (performance.now() - t0) / ms;
            window.__farabiSetCamera(cx, cy, 0.05 * Math.pow(20, k));
            if (k < 0.98) requestAnimationFrame(tick);
            else resolve();
          };
          requestAnimationFrame(tick);
        });
        return stats;
      }
      await pan(0.05, 1000, 3, 2); // warm-up
      const panFar = await pan(0.02, 4000, 14 / 0.02 / 20, 22 / 0.02 / 20);
      const panNear = await pan(1, 4000, 0, 4);
      const zoomStats = await zoom(4000);
      await report("frames", {
        userAgent: navigator.userAgent,
        devicePixelRatio: window.devicePixelRatio,
        viewport: [innerWidth, innerHeight],
        openMs,
        panFar,
        panNear,
        zoom: zoomStats,
        pass: panFar.p95 <= 16.7 && panNear.p95 <= 16.7 && zoomStats.p95 <= 20,
      });
    }
  } catch (err) {
    localStorage.setItem(KEY, "done");
    await report("error", { step, message: String(err && err.stack ? err.stack : err) });
  }
})();
