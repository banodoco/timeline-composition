import {test} from "node:test";
import assert from "node:assert/strict";
import {
  layerOpacity,
  overlapWindow,
  ownFrame,
  planTrack,
} from "../src/lib/transition-spans.js";
import type {DrawPlan} from "../src/lib/transition-spans.js";

const near = (actual: number, expected: number) => {
  assert.ok(Math.abs(actual - expected) < 1e-9, `expected ${expected}, got ${actual}`);
};

const plain = (start: number, duration: number): DrawPlan => ({
  drawStart: start,
  drawDuration: duration,
  ownOffset: 0,
  ownDuration: duration,
  fadeIn: null,
  fadeOut: null,
});

test("overlapWindow: end (default placement) sits before the boundary", () => {
  assert.deepEqual(overlapWindow(30, 10, "end"), {start: 20, end: 30});
});

test("overlapWindow: start sits after the boundary", () => {
  assert.deepEqual(overlapWindow(30, 10, "start"), {start: 30, end: 40});
});

test("overlapWindow: center is centred on the boundary, floor(T/2) before it", () => {
  assert.deepEqual(overlapWindow(30, 10, "center"), {start: 25, end: 35});
  assert.deepEqual(overlapWindow(30, 9, "center"), {start: 26, end: 35});
});

test("planTrack: a cut (null transition) leaves both clips untouched", () => {
  const plans = planTrack(
    [{start: 0, duration: 30}, {start: 30, duration: 30}],
    [null],
  );
  assert.deepEqual(plans, [plain(0, 30), plain(30, 30)]);
});

test("planTrack: single dissolve A(0-30) -> B(30-60): B extended back, A untouched", () => {
  const plans = planTrack(
    [{start: 0, duration: 30}, {start: 30, duration: 30}],
    [{T: 10, kind: "dissolve", align: "end"}, null],
  );
  assert.deepEqual(plans[0], plain(0, 30));
  assert.deepEqual(plans[1], {
    drawStart: 20,
    drawDuration: 40,
    ownOffset: 10,
    ownDuration: 30,
    fadeIn: {from: 0, to: 10, kind: "dissolve"},
    fadeOut: null,
  });
});

test("planTrack: chain A(0-30) -> B(30-60) -> C(60-90): both boundaries planned", () => {
  const plans = planTrack(
    [{start: 0, duration: 30}, {start: 30, duration: 30}, {start: 60, duration: 30}],
    [{T: 10, kind: "dissolve", align: "end"}, {T: 10, kind: "dissolve", align: "end"}, null],
  );
  assert.deepEqual(plans[0], plain(0, 30));
  // B is extended back for the A->B window only; its own end is unchanged.
  assert.deepEqual(plans[1], {
    drawStart: 20,
    drawDuration: 40,
    ownOffset: 10,
    ownDuration: 30,
    fadeIn: {from: 0, to: 10, kind: "dissolve"},
    fadeOut: null,
  });
  // C is extended back for the B->C window (50-60).
  assert.deepEqual(plans[2], {
    drawStart: 50,
    drawDuration: 40,
    ownOffset: 10,
    ownDuration: 30,
    fadeIn: {from: 0, to: 10, kind: "dissolve"},
    fadeOut: null,
  });
});

test("planTrack: a dissolve with the outgoing window past its end extends the outgoing clip", () => {
  const plans = planTrack(
    [{start: 0, duration: 30}, {start: 30, duration: 30}],
    [{T: 10, kind: "dissolve", align: "start"}, null],
  );
  assert.equal(plans[0].drawDuration, 40);
  assert.equal(plans[0].ownOffset, 0);
  assert.deepEqual(plans[1], {
    ...plain(30, 30),
    fadeIn: {from: 0, to: 10, kind: "dissolve"},
  });
});

test("planTrack: a transition longer than either clip is ignored (a cut)", () => {
  const plans = planTrack(
    [{start: 0, duration: 30}, {start: 30, duration: 30}],
    [{T: 40, kind: "dissolve", align: "end"}, null],
  );
  assert.deepEqual(plans, [plain(0, 30), plain(30, 30)]);
});

test("planTrack: a non-adjacent pair is ignored (a cut)", () => {
  const plans = planTrack(
    [{start: 0, duration: 30}, {start: 40, duration: 30}],
    [{T: 10, kind: "dissolve", align: "end"}, null],
  );
  assert.deepEqual(plans, [plain(0, 30), plain(40, 30)]);
});

test("planTrack: a dip gives the outgoing clip a fadeOut in the first half and the incoming a fadeIn in the second", () => {
  const plans = planTrack(
    [{start: 0, duration: 30}, {start: 30, duration: 30}],
    [{T: 10, kind: "dip", align: "end"}, null],
  );
  assert.deepEqual(plans[0].fadeOut, {from: 20, to: 25, kind: "dip"});
  assert.deepEqual(plans[1].fadeIn, {from: 5, to: 10, kind: "dip"});
});

test("ownFrame: clamps to the clip's own span and freezes extension frames", () => {
  const plan: DrawPlan = {...plain(20, 40), ownOffset: 10, ownDuration: 30};
  assert.equal(ownFrame(plan, 0), 0); // extension, frozen at own frame 0
  assert.equal(ownFrame(plan, 9), 0);
  assert.equal(ownFrame(plan, 10), 0); // own frame 0 at drawStart + ownOffset
  assert.equal(ownFrame(plan, 25), 15);
  assert.equal(ownFrame(plan, 39), 29); // last own frame
});

test("ownFrame: an outgoing extension freezes at the last own frame", () => {
  const plan: DrawPlan = {...plain(0, 40), ownDuration: 30};
  assert.equal(ownFrame(plan, 29), 29);
  assert.equal(ownFrame(plan, 35), 29);
  assert.equal(ownFrame(plan, 39), 29);
});

test("layerOpacity: dissolve incoming ramps 0 -> 1 across the window; outgoing stays 1", () => {
  const incoming: DrawPlan = {
    ...plain(20, 40),
    ownOffset: 10,
    ownDuration: 30,
    fadeIn: {from: 0, to: 10, kind: "dissolve"},
  };
  near(layerOpacity(incoming, 0), 0);
  near(layerOpacity(incoming, 5), 0.5);
  near(layerOpacity(incoming, 10), 1);
  near(layerOpacity(incoming, 30), 1);

  const outgoing: DrawPlan = plain(0, 30);
  near(layerOpacity(outgoing, 20), 1);
  near(layerOpacity(outgoing, 25), 1);
});

test("layerOpacity: dip outgoing ramps 1 -> 0 over the first half; incoming 0 -> 1 over the second", () => {
  const outgoing: DrawPlan = {...plain(0, 30), fadeOut: {from: 20, to: 25, kind: "dip"}};
  near(layerOpacity(outgoing, 20), 1);
  near(layerOpacity(outgoing, 22.5), 0.5);
  near(layerOpacity(outgoing, 25), 0);
  near(layerOpacity(outgoing, 29), 0);

  const incoming: DrawPlan = {
    ...plain(20, 40),
    ownOffset: 10,
    ownDuration: 30,
    fadeIn: {from: 5, to: 10, kind: "dip"},
  };
  near(layerOpacity(incoming, 0), 0);
  near(layerOpacity(incoming, 5), 0);
  near(layerOpacity(incoming, 7.5), 0.5);
  near(layerOpacity(incoming, 10), 1);
});
