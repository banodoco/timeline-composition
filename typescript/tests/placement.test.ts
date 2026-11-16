import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveClipPlacement, normalizeClipPlacement, transformPlacementPoint} from '../src/lib/placement';
import type {TimelineClip, TrackDefinition} from '../src/types';
const clip: TimelineClip = {id:'c', track:'v', at:0};
const track: TrackDefinition = {id:'v', kind:'visual', label:'V'};
const canvas = {width:1280, height:720}, intrinsic = {width:1920,height:800};
const resolve = (c = clip, t = track) => resolveClipPlacement({clip:c, track:t, canvas, intrinsic});
test('fit override, inheritance, crop independence and provenance', () => {
  for (const [c,t,fit,source] of [[clip,track,'contain','default'],[clip,{...track,fit:'manual'},'cover','track'],[{...clip,fit:'contain'},{...track,fit:'cover'},'contain','clip']] as const) {
    const p = resolve(c,t); assert.equal(p.fit,fit); assert.equal(p.provenance.fit,source);
  }
  const cover = resolve({...clip,fit:'cover'});
  assert.deepEqual(cover.local.media,{x:-224,y:0,width:1728,height:720});
  const cropped = resolve({...clip,fit:'cover',cropLeft:.1});
  assert.deepEqual(cropped.local.media,cover.local.media); assert.equal(cropped.local.visible.x,128);
  assert.equal(resolve({...clip,x:0}).fit,'contain');
});
test('track transform preserves pre-scale clip and maps handles back', () => {
  const p = resolve({...clip,x:-100,width:500}, {...track,scale:2,opacity:.5});
  assert.equal(p.local.clip.x,0); assert.equal(p.output.clip.x,-640);
  assert.equal(p.output.finalClip.x,0); assert.equal(p.opacity.product,.5);
  const point = {x:123,y:456}; assert.deepEqual(transformPlacementPoint(transformPlacementPoint(point,p.transform.forward),p.transform.inverse),point);
});
test('normalizer bakes and stamps once, respects explicit fit and markers', () => {
  const input = {theme:'default', output:{resolution:'1280x720'}, tracks:[{...track,scale:2}], clips:[{...clip,x:0},{...clip,id:'other',fit:'contain' as const,cropTop:0}]};
  const once = normalizeClipPlacement(input); assert.equal(once.clips[0].fit,'cover'); assert.equal(once.clips[1].fit,'contain');
  assert.equal(once.clips[0].x,320); assert.deepEqual(normalizeClipPlacement(once),once);
  assert.throws(() => normalizeClipPlacement({...input,tracks:[{...track,app:{clipPlacementVersion:2}}]}),/v.*clipPlacementVersion/);
  assert.throws(() => resolve({...clip, fit:'invalid' as never}),/c.*fit/);
});
