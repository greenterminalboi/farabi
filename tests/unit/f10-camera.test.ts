import { describe, expect, it } from "vitest";
import { Camera, type CameraView } from "@/canvas/camera";

// The camera follows the user, or nothing (research R11, FR-025, SC-008).

class FakeView implements CameraView {
  s = 1;
  scale() {
    return this.s;
  }
  private c = { x: 0, y: 0 };
  minScale = 0.02;
  calls: Array<{ x: number; y: number; scale: number; ms: number }> = [];
  center() {
    return { ...this.c };
  }
  screen() {
    return { width: 1200, height: 800 };
  }
  moveTo(to: { x: number; y: number; scale: number }, ms: number) {
    this.calls.push({ ...to, ms });
    this.c = { x: to.x, y: to.y };
    this.s = to.scale;
  }
  setMinScale(min: number) {
    this.minScale = min;
  }
  /** A user's drag or wheel: the view moves, then the input layer tells the camera. */
  manualPan(camera: Camera, dx: number) {
    this.c.x += dx;
    camera.onManual();
  }
}

const box = (x: number, y: number, w = 480, h = 300) => ({ x, y, w, h });

describe("Feature 10 · camera", () => {
  it("a send or walk follows the target with one glide", () => {
    const view = new FakeView();
    const camera = new Camera(view);
    camera.follow("a1", box(1000, 2000));
    expect(camera.state()).toMatchObject({ mode: "follow", target: "a1", moves: 1, x: 1240, y: 2150, scale: 1 });
    expect(view.calls).toHaveLength(1);
    expect(view.calls[0].ms).toBe(350);
  });

  it("glides instantly with reduced motion, and fits a wide box", () => {
    const view = new FakeView();
    const camera = new Camera(view, { reducedMotion: () => true });
    camera.follow("x", box(0, 0, 4000, 100));
    expect(view.calls[0].ms).toBe(0);
    expect(view.scale()).toBeCloseTo((1200 - 96) / 4000);
  });

  it("shows the top of a box taller than the screen", () => {
    const view = new FakeView();
    const camera = new Camera(view);
    camera.follow("long", box(0, 1000, 480, 5000));
    expect(view.center().y).toBe(1000 + (800 - 96) / 2);
  });

  it("a manual pan sets free, and then nothing else moves the camera (SC-008)", () => {
    const view = new FakeView();
    const camera = new Camera(view);
    camera.follow("a1", box(0, 0));
    view.manualPan(camera, 300);
    expect(camera.mode).toBe("free");
    const moves = camera.moves;
    const calls = view.calls.length;
    // Elements added, a relayout, a function output, another tree changing, a stream growing.
    camera.relayoutCompensate("a1", 0, 400);
    camera.onTargetResized("a1", box(0, 0, 480, 3000));
    camera.setBounds({ minX: 0, minY: 0, maxX: 10000, maxY: 10000 });
    expect(camera.moves).toBe(moves);
    expect(view.calls.length).toBe(calls);
  });

  it("the next walk follows again", () => {
    const view = new FakeView();
    const camera = new Camera(view);
    view.manualPan(camera, 100);
    camera.follow("q2", box(500, 500));
    expect(camera.state()).toMatchObject({ mode: "follow", target: "q2" });
  });

  it("while following, a relayout keeps the target put and a streaming answer keeps its bottom in view", () => {
    const view = new FakeView();
    let t = 0;
    const camera = new Camera(view, { now: () => t });
    camera.follow("a1", box(0, 0, 480, 200));
    t = 1000; // the glide has finished
    const before = view.center();
    camera.relayoutCompensate("a1", 0, 120);
    expect(view.center()).toEqual({ x: before.x, y: before.y + 120 });
    camera.relayoutCompensate("other", 0, 120);
    expect(view.center()).toEqual({ x: before.x, y: before.y + 120 });

    const camera2 = new Camera(new FakeView(), { now: () => t });
    const v2 = (camera2 as unknown as { view: FakeView }).view;
    t = 0;
    camera2.follow("s", box(0, 0, 480, 200));
    t = 1000;
    const y0 = v2.center().y;
    camera2.onTargetResized("s", box(0, 0, 480, 250));
    expect(v2.center().y).toBe(y0); // still fits
    camera2.onTargetResized("s", box(0, 0, 480, 1400));
    expect(v2.center().y).toBeGreaterThan(y0);
    // Never scrolls the element's top out of view.
    camera2.onTargetResized("s", box(0, 0, 480, 9000));
    expect(v2.center().y - (800 / 2 - 48)).toBeLessThanOrEqual(0.0001);
  });

  it("clamps zoom to 0.02..4 and keeps the project at least a quarter of the screen", () => {
    const view = new FakeView();
    const camera = new Camera(view);
    camera.setBounds({ minX: 0, minY: 0, maxX: 1_000_000, maxY: 1_000_000 });
    expect(view.minScale).toBe(0.02);
    camera.setBounds({ minX: 0, minY: 0, maxX: 3000, maxY: 2000 });
    expect(view.minScale).toBeCloseTo(Math.min(300 / 3000, 200 / 2000));
    camera.setBounds({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
    expect(view.minScale).toBe(1);
  });

  it("a relayout during a glide retargets the glide instead of cutting it short", () => {
    const view = new FakeView();
    let t = 0;
    const camera = new Camera(view, { now: () => t });
    camera.follow("e", box(0, 0, 360, 46));
    t = 100;
    camera.onTargetResized("e", box(400, 0, 360, 46));
    camera.relayoutCompensate("e", 400, 0, box(400, 0, 360, 46));
    // Each call glides to the element's new place in the time left, never jumping mid-way.
    expect(view.calls.slice(1).every((c) => c.ms === 250 && c.x === 580)).toBe(true);
    t = 400;
    camera.relayoutCompensate("e", 0, 50, box(400, 50, 360, 46));
    expect(view.calls.at(-1)).toMatchObject({ ms: 0, y: view.calls.at(-2)!.y + 50 });
  });
});
