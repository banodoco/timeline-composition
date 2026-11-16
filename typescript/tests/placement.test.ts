import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveClipPlacement, normalizeClipPlacement, normalizeClipPlacementWithFindings, transformPlacementPoint} from '../src/lib/placement';
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
test('mixed fit, crop normalization, scale migration and invalid facts', () => {
  const fit = resolve({...clip,fit:'contain'}, {...track,fit:'cover'});
  const fill = resolve({...clip,id:'fill',fit:'cover'}, {...track,fit:'cover'});
  assert.equal(fit.fit,'contain'); assert.equal(fill.fit,'cover');
  const crop = resolve({...clip,cropLeft:.8,cropRight:.8});
  assert.ok(Math.abs(crop.crop.cropLeft + crop.crop.cropRight - .99) < 1e-12);
  for (const scale of [.5,2]) {
    const input = {theme:'default',output:{resolution:'1280x720'},tracks:[{...track,scale}],clips:[{...clip,x:100}]};
    const once = normalizeClipPlacement(input);
    assert.notEqual(once.clips[0].x,100);
    const marked = normalizeClipPlacement({...input,tracks:[{...track,scale,app:{scaleAppliesToPositionedClips:true,clipPlacementVersion:1}}]});
    assert.equal(marked.clips[0].x,100);
  }
  assert.throws(() => resolve(clip,{...track,opacity:2}),/c.*track.opacity/);
  assert.throws(() => resolve({...clip,opacity:-.1}),/c.*opacity/);
  assert.throws(() => resolve(clip,{...track,scale:0}),/c.*track.scale/);
  for (const fit of ['contain','cover'] as const) for (const size of [{width:0,height:1},{width:NaN,height:NaN}]) assert.throws(() => resolveClipPlacement({clip:{...clip,fit},track,canvas,intrinsic:size}),/c.*asset.resolution/);
  assert.throws(() => resolveClipPlacement({clip,track,canvas,intrinsic:{width:0,height:800}}),/c.*asset.resolution/);
  const p = resolve({...clip,x:-200,width:500},{...track,scale:.5});
  assert.equal(p.local.clip.x,0);
  const r = p.local.full;
  const forward = {x:r.x*p.transform.forward.scale+p.transform.forward.tx,y:r.y*p.transform.forward.scale+p.transform.forward.ty,width:r.width*p.scale,height:r.height*p.scale};
  const back = {x:forward.x*p.transform.inverse.scale+p.transform.inverse.tx,y:forward.y*p.transform.inverse.scale+p.transform.inverse.ty,width:forward.width*p.transform.inverse.scale,height:forward.height*p.transform.inverse.scale};
  assert.deepEqual(back,r);
});

test('migration findings expose changes and vanish after normalization', () => {
  const input = {theme:'default',output:{resolution:'1280x720'},tracks:[{...track,scale:2}],clips:[{...clip,x:0}]};
  const result = normalizeClipPlacementWithFindings(input);
  assert.deepEqual(result.findings.map(item => item.kind),['scale-bake','explicit-fit','markers']);
  assert.equal(result.findings[2].markerCount,2);
  assert.deepEqual(normalizeClipPlacementWithFindings(result.config).findings,[]);
});

test('media normalization requires its authored output resolution', () => {
  assert.throws(() => normalizeClipPlacement({theme:'default',tracks:[track],clips:[{...clip,asset:'a'}]}),/output.resolution/);
});
