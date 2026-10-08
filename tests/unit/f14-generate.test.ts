import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { getFakeCalls, registerFakeCompletion, resetFakeCalls, setFakeMode } from "@/server/ai/fake";
import { InvalidRequestError } from "@/server/errors";
import { fakeScene, generateScene, installVizFakes, VIZ_SYSTEM, VIZ_TAG, VizGenerationError } from "@/server/viz";
import { arraySort, parseScene } from "@/viz";

// Feature 014, US3: generation from text through the fake provider only (FR-013 to FR-018).

process.env.AI_PROVIDER = "fake";

const valid = JSON.stringify(arraySort({ values: [3, 1, 2] }));

beforeEach(() => {
  setFakeMode({ mode: "ok" });
  resetFakeCalls();
  installVizFakes(true);
});

describe("Feature 014 · generation", () => {
  it("returns a valid scene for each family from the fake, marked AI-suggested", async () => {
    const inputs = [
      { text: "def f(n):\n    return n * 2\n\nprint(f(3))", family: "auto" as const, expect: "code" },
      { text: "sort these: 9 4 7 1", family: "auto" as const, expect: "algorithm" },
      { text: "Remote work raises productivity.\nRemote work lowers productivity.", family: "auto" as const, expect: "argument" },
      { text: "anything at all", family: "algorithm" as const, expect: "algorithm" },
    ];
    for (const input of inputs) {
      const scene = await generateScene(input);
      expect(scene.family, input.text).toBe(input.expect);
      expect(scene.origin).toBe("ai-suggested");
      expect(parseScene(scene).ok).toBe(true);
    }
    const call = getFakeCalls().lastComplete!;
    expect(call).toMatchObject({ tag: VIZ_TAG, effort: "medium", maxTokens: 8000, model: null });
  });

  it("passes the requested model through", async () => {
    await generateScene({ text: "a vs b" }, { model: "claude-sonnet-5" });
    expect(getFakeCalls().lastComplete!.model).toBe("claude-sonnet-5");
  });

  it("forces origin ai-suggested whatever the AI claims (FR-016)", async () => {
    registerFakeCompletion(VIZ_TAG, () => valid.replace('"user-authored"', '"user-authored"'));
    const scene = await generateScene({ text: "x" });
    expect(scene.origin).toBe("ai-suggested");
  });

  it("accepts JSON wrapped in prose and fences", async () => {
    registerFakeCompletion(VIZ_TAG, () => `Here you go:\n\`\`\`json\n${valid}\n\`\`\`\nEnjoy!`);
    expect((await generateScene({ text: "x" })).family).toBe("algorithm");
  });

  it("retries once with the validation problem stated, then uses the second reply", async () => {
    let calls = 0;
    registerFakeCompletion(VIZ_TAG, () => (++calls === 1 ? JSON.stringify({ version: 1, title: "t" }) : valid));
    resetFakeCalls();
    const scene = await generateScene({ text: "x" });
    expect(scene.family).toBe("algorithm");
    const inputs = getFakeCalls().completeInputs;
    expect(inputs).toHaveLength(2);
    expect(inputs[1].prompt).toMatch(/Your previous reply couldn't be used: .*description: .*Reply with only the JSON object described above/s);
  });

  it("fails cleanly after two invalid replies", async () => {
    registerFakeCompletion(VIZ_TAG, () => JSON.stringify({ ...JSON.parse(valid), steps: [{ caption: "x", actions: [{ op: "swap", target: "arr", i: 0, j: 9 }] }] }));
    resetFakeCalls();
    const err = await generateScene({ text: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(VizGenerationError);
    expect(err.message).toBe("The AI couldn't produce a usable visualization. Nothing was created. Try again.");
    expect(err.detail).toMatch(/steps\.0\.actions\.0\.j: "arr" has no cell 9/);
    expect(getFakeCalls().completeInputs).toHaveLength(2);
  });

  it("fails cleanly when the provider fails", async () => {
    setFakeMode({ mode: "fail" });
    await expect(generateScene({ text: "x" })).rejects.toBeInstanceOf(VizGenerationError);
  });

  it("refuses empty, oversized or unknown-family input before any AI call", async () => {
    resetFakeCalls();
    await expect(generateScene({ text: "   " })).rejects.toBeInstanceOf(InvalidRequestError);
    await expect(generateScene({ text: "x".repeat(20_001) })).rejects.toBeInstanceOf(InvalidRequestError);
    await expect(generateScene({ text: "x", family: "poem" as never })).rejects.toBeInstanceOf(InvalidRequestError);
    expect(getFakeCalls().completeInputs).toHaveLength(0);
  });

  it("the fake handles hostile input without producing invalid scenes", () => {
    for (const text of ["", "x".repeat(20_000), "{".repeat(500), "1 2", "line\n".repeat(200)]) {
      for (const family of ["auto", "code", "algorithm", "argument"]) {
        const r = parseScene(fakeScene(family, text || "x"));
        expect(r.ok, `${family}: ${text.slice(0, 20)} ${JSON.stringify(r.ok ? "" : r.problems)}`).toBe(true);
      }
    }
  });

  it("Article III: the instructions confine the AI to the given text (FR-017)", () => {
    expect(VIZ_SYSTEM).toMatch(/Depict only what is in the given text/);
    expect(VIZ_SYSTEM).toMatch(/Never say which side of a contradiction is right or wrong/);
    expect(VIZ_SYSTEM).toMatch(/Never say anything about the person who wrote the text/);
    expect(VIZ_SYSTEM).toMatch(/"origin":"ai-suggested"/);
  });
});

describe("Feature 014 · guards", () => {
  const root = path.resolve(import.meta.dirname, "../..");
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      return statSync(full).isDirectory() ? files(full) : /\.(ts|tsx)$/.test(name) ? [full] : [];
    });

  it("FR-020: no string-to-code evaluation anywhere in the engine", () => {
    for (const file of [...files(path.join(root, "src/viz")), ...files(path.join(root, "src/server/viz")), ...files(path.join(root, "src/app/dev/viz"))]) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toMatch(/\beval\s*\(|new\s+Function\b|\bFunction\s*\(|setTimeout\s*\(\s*["'`]|dangerouslySetInnerHTML/);
    }
  });

  it("the pure engine has no DOM, React or server imports outside src/viz/react", () => {
    for (const file of files(path.join(root, "src/viz")).filter((f) => !f.includes(`${path.sep}react${path.sep}`))) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toMatch(/from "react"|from "@\/server|from "next|\bdocument\.[a-z]|\bwindow\.[a-z]/);
    }
  });

  it("FR-021: the engine writes nothing (no database access)", () => {
    for (const file of [...files(path.join(root, "src/viz")), ...files(path.join(root, "src/server/viz")), path.join(root, "src/app/api/viz/generate/route.ts")]) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/db\/client|kysely|insertInto|\bsql`/);
    }
  });
});
