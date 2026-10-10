import {test} from "node:test";
import assert from "node:assert/strict";
import {
  animationElapsed,
  clipOpacity,
  cropClipPath,
  fadeMultiplier,
  normalizeAnimationRefs,
} from "../src/lib/clip-look.js";
import type {TimelineClip} from "../src/types.js";

const clip = (overrides: Partial<TimelineClip> = {}): TimelineClip => ({
  id: "c1",
  at: 0,
  track: "v1",
  from: 0,
  to: 2,
  ...overrides,
});

const FPS = 30;
const near = (actual: number, expected: number) => {
  assert.ok(Math.abs(actual - expected) < 1e-9, `expected ${expected}, got ${actual}`);
};

test("fadeMultiplier: fade_in 0.4s at 30fps (12 frames) ramps linearly and clamps", () => {
  const c = clip({effects: {fade_in: 0.4}});
  near(fadeMultiplier(c, 0, FPS), 0);
  near(fadeMultiplier(c, 6, FPS), 0.5);
  near(fadeMultiplier(c, 12, FPS), 1);
  near(fadeMultiplier(c, 20, FPS), 1);
});

test("fadeMultiplier: fade_out 0.4s on a 2s clip (60 frames) ramps down over the last 12 frames", () => {
  const c = clip({effects: {fade_out: 0.4}});
  near(fadeMultiplier(c, 0, FPS), 1);
  near(fadeMultiplier(c, 48, FPS), 1);
  near(fadeMultiplier(c, 54, FPS), 0.5);
  near(fadeMultiplier(c, 60, FPS), 0);
  near(fadeMultiplier(c, 70, FPS), 0);
});

test("fadeMultiplier: fade_in and fade_out multiply", () => {
  const c = clip({effects: {fade_in: 0.4, fade_out: 0.4}});
  near(fadeMultiplier(c, 6, FPS), 0.5);
  near(fadeMultiplier(c, 54, FPS), 0.5);
  near(fadeMultiplier(c, 30, FPS), 1);
});

test("fadeMultiplier: array form of effects is read the same way", () => {
  const c = clip({effects: [{fade_in: 0.4}, {fade_out: 0.4}]});
  near(fadeMultiplier(c, 6, FPS), 0.5);
  near(fadeMultiplier(c, 54, FPS), 0.5);
});

test("fadeMultiplier: no effects, or non-positive / non-numeric fades, give 1", () => {
  near(fadeMultiplier(clip(), 0, FPS), 1);
  near(fadeMultiplier(clip({effects: {fade_in: 0}}), 0, FPS), 1);
  near(fadeMultiplier(clip({effects: {fade_out: "1"}}), 0, FPS), 1);
});

test("clipOpacity: fade multiplied by clip.opacity, clamped to [0, 1]", () => {
  near(clipOpacity(clip(), 0, FPS), 1);
  near(clipOpacity(clip({opacity: 0.5}), 0, FPS), 0.5);
  near(clipOpacity(clip({opacity: 0.5, effects: {fade_in: 0.4}}), 6, FPS), 0.25);
  near(clipOpacity(clip({opacity: 2}), 0, FPS), 1);
  near(clipOpacity(clip({opacity: -1}), 0, FPS), 0);
  near(clipOpacity(clip({opacity: 0.8, effects: {fade_in: 0.4}}), 0, FPS), 0);
});

test("cropClipPath: undefined when no crop field is set", () => {
  assert.equal(cropClipPath(clip()), undefined);
});

test("cropClipPath: inset(top right bottom left) in percent", () => {
  assert.equal(
    cropClipPath(clip({cropTop: 0.1, cropRight: 0.2, cropBottom: 0.3, cropLeft: 0.4})),
    "inset(10% 20% 30% 40%)",
  );
  assert.equal(cropClipPath(clip({cropTop: 0.25})), "inset(25% 0% 0% 0%)");
});

test("cropClipPath: values clamp to 0..1", () => {
  assert.equal(cropClipPath(clip({cropLeft: 1.5, cropBottom: -0.5})), "inset(0% 0% 0% 99%)");
});

test("cropClipPath: L+R and T+B above 0.99 are scaled down to 0.99", () => {
  assert.equal(
    cropClipPath(clip({cropLeft: 0.5, cropRight: 0.5})),
    "inset(0% 49.5% 0% 49.5%)",
  );
  assert.equal(
    cropClipPath(clip({cropTop: 0.6, cropBottom: 0.6})),
    "inset(49.5% 0% 49.5% 0%)",
  );
});

test("normalizeAnimationRefs: undefined stays undefined", () => {
  assert.equal(normalizeAnimationRefs(undefined, FPS), undefined);
});

test("normalizeAnimationRefs: string passes through unchanged", () => {
  assert.equal(normalizeAnimationRefs("fade_in", FPS), "fade_in");
});

test("normalizeAnimationRefs: {id, ...} passes through unchanged", () => {
  const ref = {id: "slide", durationFrames: 9, params: {dir: "left"}};
  assert.deepEqual(normalizeAnimationRefs(ref, FPS), ref);
});

test("normalizeAnimationRefs: {type, duration} maps to {id, durationFrames} (seconds x fps, rounded)", () => {
  assert.deepEqual(
    normalizeAnimationRefs({type: "fade", duration: 0.5}, FPS),
    {id: "fade", durationFrames: 15, params: undefined},
  );
  assert.deepEqual(
    normalizeAnimationRefs({type: "fade", duration: 0.51}, FPS),
    {id: "fade", durationFrames: 15, params: undefined},
  );
});

test("normalizeAnimationRefs: {type} without duration leaves durationFrames undefined; params kept", () => {
  assert.deepEqual(
    normalizeAnimationRefs({type: "fade"}, FPS),
    {id: "fade", durationFrames: undefined, params: undefined},
  );
  assert.deepEqual(
    normalizeAnimationRefs({type: "slide", duration: 1, params: {dir: "up"}}, FPS),
    {id: "slide", durationFrames: 30, params: {dir: "up"}},
  );
});

test("normalizeAnimationRefs: arrays map each entry in the same way", () => {
  assert.deepEqual(
    normalizeAnimationRefs(["fade", {type: "slide", duration: 0.2}, {id: "x", durationFrames: 3}], FPS),
    [
      "fade",
      {id: "slide", durationFrames: 6, params: undefined},
      {id: "x", durationFrames: 3},
    ],
  );
});

test("animationElapsed: entrance window is [0, durationFrames)", () => {
  assert.equal(animationElapsed("entrance", 0, 60, 12), 0);
  assert.equal(animationElapsed("entrance", 11, 60, 12), 11);
  assert.equal(animationElapsed("entrance", 12, 60, 12), null);
  assert.equal(animationElapsed("entrance", 0, 60, 0), null);
});

test("animationElapsed: exit window is the last durationFrames of the clip", () => {
  assert.equal(animationElapsed("exit", 47, 60, 12), null);
  assert.equal(animationElapsed("exit", 48, 60, 12), 0);
  assert.equal(animationElapsed("exit", 59, 60, 12), 11);
  assert.equal(animationElapsed("exit", 60, 60, 12), 12);
  assert.equal(animationElapsed("exit", 10, 60, 0), null);
});
