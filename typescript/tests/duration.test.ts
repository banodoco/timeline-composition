import assert from 'node:assert/strict';
import {test} from 'node:test';
import {getClipDurationInFrames, getClipTimelineDuration, getSanitizedPlaybackRate} from '../src/lib/duration';
import type {TimelineClip} from '../src/types';

test('clip duration uses the same sanitized playback rate as media playback', () => {
  const clip = {id: 'clip', track: 'visual', at: 0, from: 2, to: 8} satisfies TimelineClip;
  assert.equal(getClipTimelineDuration({...clip, speed: 2}), 3);
  assert.equal(getClipDurationInFrames({...clip, speed: 2}, 30), 90);
  assert.equal(getClipTimelineDuration(clip), 6);

  for (const speed of [0, -2, NaN, Infinity, -Infinity]) {
    assert.equal(getSanitizedPlaybackRate(speed), 1);
    assert.equal(getClipTimelineDuration({...clip, speed}), 6);
    assert.equal(getClipDurationInFrames({...clip, speed}, 30), 180);
  }
});
