import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createElement, type ComponentProps, type ReactElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Internals, useCurrentFrame} from 'remotion';
import {Video} from '@remotion/media';
import {TimelineComposition, prepareCompositionScene, compileCanonicalTransitions, querySceneFrame, DEFAULT_THEME, toRuntimeTheme,
  type TimelineClip, type TrackDefinition, type AssetRegistry, type CompositionRegistries,
  type ModifierRegistry, type EffectProps, type CompiledCanonicalTransitions} from '../src/index';
import {VisualClip} from '../src/VisualClip';

const theme = toRuntimeTheme(DEFAULT_THEME);
const track: TrackDefinition = {id: 'visual', kind: 'visual', label: 'Visual', volume: .8};
const assets: AssetRegistry = {assets: {video: {file: 'https://example.test/video.mp4', type: 'video/mp4', resolution: '1920x1080'}}};
const pair = (policy = true, id = 'fade'): TimelineClip[] => [
  {id: 'outgoing', track: track.id, at: 2, from: 1, to: 3, speed: 2, asset: 'video',
    transition: {id, durationFrames: 12, ...(policy ? {incomingPolicy: 'preroll-crossfade'} : {})}},
  {id: 'incoming', track: track.id, at: 3, from: 3, to: 5, speed: 2, volume: .5, asset: 'video',
    params: {fadeIn: .4, fadeOut: .4}},
];

const render = (content: ReactElement, frame: number, fps = 30) => {
  const video = {id: 'test', width: 1920, height: 1080, fps, durationInFrames: 200,
    defaultProps: {}, folderName: null, parentFolderName: null, component: () => null,
    nonce: [], schema: null, calculateMetadata: null, stack: null};
  return renderToStaticMarkup(createElement(Internals.CompositionManager.Provider, {
    value: {compositions: [video], currentCompositionMetadata: null, folders: [],
      canvasContent: {type: 'composition', compositionId: 'test'}},
  }, createElement(Internals.TimelineContext.Provider, {
    value: {frame: {test: frame}, playing: false, imperativePlaying: {current: false}, audioAndVideoTags: {current: []}},
  }, createElement(Internals.CanUseRemotionHooksProvider, null, content))));
};

const composition = (clips: TimelineClip[], registries: CompositionRegistries = {}, modifierRegistry?: ModifierRegistry,
  selectedTrack = track, selectedAssets = assets) => createElement(TimelineComposition, {
  timeline: {theme: 'default', output: {resolution: '1920x1080'}, tracks: [selectedTrack], clips}, assets: selectedAssets, registries, modifierRegistry,
});
const prepare = (clips: TimelineClip[], registries: CompositionRegistries = {}, fps = 30) =>
  prepareCompositionScene([{track, clips}], assets, fps, theme, 1920, 1080, undefined, undefined, {}, '', {}, registries);

test('actual native render inputs use preroll source clock, unchanged trims/rate/gain, and no extra mount', () => {
  const seen: {id: string; frame: number; source: number; volume: number; muted: boolean; trimAfter: number}[] = [];
  // Observe the real VisualClip result under the real Sequence/TransitionLayer
  // clock, before handing it to the decoder. No decoder, browser or pixels claimed.
  const NativeProbe = ({content}: {content: ReactElement<ComponentProps<typeof VisualClip>>}) => {
    assert.equal(content.type, VisualClip);
    const wrapper = VisualClip(content.props) as ReactElement<{style: {overflow: string}; children: ReactElement}>;
    assert.equal(wrapper.type, 'div');
    assert.equal(wrapper.props.style.overflow, 'hidden');
    assert.ok(!Array.isArray(wrapper.props.children));
    const video = wrapper.props.children as ReactElement<{
      trimBefore: number; trimAfter: number; playbackRate: number; volume: number; muted: boolean;
    }>;
    assert.equal(video.type, Video);
    const frame = useCurrentFrame();
    const {trimBefore, trimAfter, playbackRate, volume, muted} = video.props;
    seen.push({id: content.props.clip.id, frame, source: trimBefore + frame * playbackRate, volume, muted, trimAfter});
    return createElement('i', {'data-source': trimBefore + frame * playbackRate});
  };
  const modifiers: ModifierRegistry = {probe: {kind: 'modifier', element: 'probe', hosts: ['composition'],
    bounds: 'preserve', alpha: 'preserve', support: 'preserve',
    wrap: (_instance, _context, content) => createElement(NativeProbe, {content: content as ReactElement<ComponentProps<typeof VisualClip>>})}};
  for (const id of ['fade', 'cross-fade']) {
    for (const policy of [false, true]) {
      for (const [align, beforeDraw, midpoint, clocks] of [
        ['end', 77, 84, [[78, 0, 90, 0, 90], [84, 6, 102, 0, 90], [89, 11, 112, 0, 90],
          [90, 12, 114, 0, 90], [119, 41, 172, 29, 148]]],
        ['center', 83, 90, [[84, 0, 90, 0, 90], [90, 6, 102, 0, 90], [95, 11, 112, 5, 100],
          [96, 12, 114, 6, 102], [119, 35, 160, 29, 148]]],
        ['start', 89, 96, [[90, 0, 90, 0, 90], [96, 6, 102, 6, 102], [101, 11, 112, 11, 112],
          [102, 12, 114, 12, 114], [119, 29, 148, 29, 148]]],
      ] as const) {
        const clips = pair(policy, id).map(clip => Object.freeze({...clip,
          ...(clip.transition ? {transition: {...clip.transition as object, align}} : {}),
          modifiers: [{id: 'probe', element: 'probe', params: {}}]}));
        const before = JSON.stringify(clips);
        const scene = prepareCompositionScene([{track, clips}], assets, 30, theme, 1920, 1080, modifiers);
        for (const [frame, nativeFrame, source, legacyFrame, legacySource] of clocks) {
          seen.length = 0;
          render(composition(clips, {}, modifiers), frame);
          const incoming = seen.find(item => item.id === 'incoming')!;
          assert.deepEqual(incoming, {id: 'incoming', frame: policy ? nativeFrame : legacyFrame,
            source: policy ? source : legacySource, volume: .4, muted: false, trimAfter: 150});
          const layer = querySceneFrame(scene, frame).layers.find(layer => layer.clipId === 'incoming')!;
          assert.equal(layer.contentFrame, policy ? nativeFrame : legacyFrame);
          if (frame === midpoint) {
            assert.deepEqual(querySceneFrame(scene, frame).layers.map(layer => layer.transitionOpacity),
              !policy && id === 'fade' ? [0, 0] : [1, .5]);
          }
        }
        for (const [frame, expected] of [[beforeDraw, ['outgoing']], [120, []]] as const) {
          seen.length = 0;
          render(composition(clips, {}, modifiers), frame);
          assert.deepEqual(seen.map(item => item.id), expected);
          assert.deepEqual(querySceneFrame(scene, frame).layers.map(layer => layer.clipId), expected);
        }
        seen.length = 0;
        render(composition(clips, {}, modifiers, {...track, muted: true}), midpoint);
        assert.equal(seen.find(item => item.id === 'incoming')!.volume, 0);
        assert.equal(seen.find(item => item.id === 'incoming')!.muted, true);
        assert.equal(JSON.stringify(clips), before);
      }
    }
  }
});

test('public scene capability and actual element clock share preroll plus speed remap at rational fps', () => {
  const rendered: number[] = [];
  const queried: number[] = [];
  const Clock = Object.assign((_props: EffectProps) => {
    rendered.push(useCurrentFrame());
    return createElement('b', null, 'clock');
  }, {prepareSceneCapability: () => ({identity: 'clock@1', frame: (frame: number) => {
    queried.push(frame);
    return {presence: 'present' as const, opaqueSupport: 'rect' as const,
      bounds: {status: 'known' as const, rect: {x: 0, y: 0, width: 1920, height: 1080}}};
  }})});
  const registries = {effects: {clock: Clock}};
  for (const [fps, outgoingAt, incomingAt, from, to, T, middle, boundary, end, nativeClock, boundaryClock] of [
    [30, 2, 3, 3, 5, 12, 84, 90, 120, 12, 24],
    [24000 / 1001, 0, 1001 / 1000, 1001 / 1000, 3003 / 1000, 6, 21, 24, 48, 6, 12],
  ]) {
    for (const policy of [false, true]) {
      const clips: TimelineClip[] = [
        {id: 'outgoing', track: track.id, at: outgoingAt, from, to, speed: 2,
          transition: {id: 'fade', durationFrames: T, ...(policy ? {incomingPolicy: 'preroll-crossfade'} : {})}},
        {id: 'incoming', track: track.id, at: incomingAt, from, to, speed: 2, clipType: 'clock'},
      ];
      const scene = prepare(clips, registries, fps);
      for (const [frame, expected] of [[middle, policy ? nativeClock : 0], [boundary, policy ? boundaryClock : 0]]) {
        rendered.length = 0;
        render(composition(clips, registries), frame, fps);
        assert.deepEqual(rendered, [expected]);
        queried.length = 0;
        querySceneFrame(scene, frame);
        assert.deepEqual(queried, [expected]);
      }
      rendered.length = 0;
      render(composition(clips, registries), end, fps);
      assert.deepEqual(rendered, []);
      assert.deepEqual(querySceneFrame(scene, end).layers, []);
    }
  }
});

test('public render keeps plain image cuts/crossfades and default dip, refusing unknown opt-in implementations', () => {
  const images: AssetRegistry = {assets: {video: {file: 'https://example.test/image.jpg', type: 'image/jpeg', resolution: '1920x1080'}}};
  const clips = pair(false).map(clip => ({...clip, from: undefined, to: undefined, speed: undefined, hold: 1}));
  const cut = clips.map(clip => ({...clip, transition: undefined}));
  assert.equal((render(composition(cut, {}, undefined, track, images), 84).match(/<img /g) ?? []).length, 1);
  assert.equal((render(composition(cut, {}, undefined, track, images), 90).match(/<img /g) ?? []).length, 1);
  const crossfade = [{...clips[0], transition: {id: 'cross-fade', durationFrames: 12}}, clips[1]];
  const dissolve = render(composition(crossfade, {}, undefined, track, images), 84);
  assert.equal((dissolve.match(/<img /g) ?? []).length, 2);
  assert.match(dissolve, /opacity:0\.5/);
  const dip = render(composition(clips, {}, undefined, track, images), 84);
  assert.equal((dip.match(/opacity:0[;"]/g) ?? []).length, 2);
  const native = [{...clips[0], transition: {id: 'fade', durationFrames: 12, incomingPolicy: 'preroll-crossfade'}}, clips[1]];
  assert.match(render(composition(native, {}, undefined, track, images), 84), /opacity:0\.5/);
  assert.throws(() => prepare(pair(true, 'custom')), /Unknown transition/);
  const custom = {transitions: {custom: () => ({presentation: null, timing: null})}};
  assert.throws(() => prepare(pair(true, 'custom'), custom), /Unsupported incoming transition policy or implementation/);
});

test('overlapping windows use the same per-boundary clocks in the public scene and render', () => {
  const rendered: [string, number][] = [];
  const queried: [string, number][] = [];
  const Clock = Object.assign(({clip}: EffectProps) => {
    rendered.push([clip.id, useCurrentFrame()]);
    return createElement('b', null, clip.id);
  }, {prepareSceneCapability: ({clip}: {clip: TimelineClip}) => ({identity: clip.id, frame: (frame: number) => {
    queried.push([clip.id, frame]);
    return {presence: 'present' as const, opaqueSupport: 'rect' as const,
      bounds: {status: 'known' as const, rect: {x: 0, y: 0, width: 1920, height: 1080}}};
  }})});
  const registries = {effects: {clock: Clock}};
  for (const policy of [false, true]) {
    const clips: TimelineClip[] = [
      {id: 'a', track: track.id, clipType: 'clock', at: 0, hold: 1,
        transition: {id: 'fade', durationFrames: 12, align: 'start', incomingPolicy: 'preroll-crossfade'}},
      {id: 'b', track: track.id, clipType: 'clock', at: 1, hold: .4,
        transition: {id: 'fade', durationFrames: 12, ...(policy ? {incomingPolicy: 'preroll-crossfade'} : {})}},
      {id: 'c', track: track.id, clipType: 'clock', at: 1.4, hold: 1},
    ];
    const scene = prepare(clips, registries);
    for (const [frame, expected] of [[36, [['a', 29], ['b', 6], ['c', policy ? 6 : 0]]],
      [42, [['c', policy ? 12 : 0]]]] as const) {
      rendered.length = 0;
      render(composition(clips, registries), frame);
      assert.deepEqual(rendered, expected);
      queried.length = 0;
      const answer = querySceneFrame(scene, frame);
      assert.deepEqual(queried, expected);
      assert.deepEqual(answer.layers.map(layer => layer.transitionOpacity), frame === 42 ? [1] : policy ? [1, .5, .5] : [1, 0, 0]);
    }
  }
});

const compileIncoming = (clips: TimelineClip[], registries: CompositionRegistries = {}, fps = 30) =>
  compileCanonicalTransitions([{track, clips}], fps, theme, registries);
const prepareIncoming = (clips: TimelineClip[], registries: CompositionRegistries = {}, fps = 30,
  compiled = compileIncoming(clips, registries, fps)) =>
  prepareCompositionScene([{track, clips}], assets, fps, theme, 1920, 1080, undefined, undefined, {}, '', {}, registries, compiled);
const incomingComposition = (clips: TimelineClip[], registries: CompositionRegistries = {}, modifierRegistry?: ModifierRegistry,
  fps = 30, compiled = compileIncoming(clips, registries, fps)) =>
  createElement(TimelineComposition, {timeline: {theme: 'default', output: {resolution: '1920x1080'}, tracks: [track], clips}, assets,
    registries, modifierRegistry, compiledTransitions: compiled});

const incomingCases: {name: string; S: number; T: number; predecessor: boolean; R: number; H: number; middle: number; cap?: number}[] = [
  {name: 'adjacent', S: 30, T: 12, predecessor: true, R: 18, H: 60, middle: 24},
  {name: 'first', S: 60, T: 12, predecessor: false, R: 60, H: 90, middle: 66},
  {name: 'gap', S: 60, T: 12, predecessor: true, R: 48, H: 90, middle: 54},
  {name: 'overlap', S: 15, T: 12, predecessor: true, R: 3, H: 45, middle: 9},
  {name: 'oversized', S: 30, T: 60, predecessor: true, R: 0, H: 90, middle: 30},
  {name: 'capped oversized', S: 30, T: 60, predecessor: true, R: 0, H: 60, middle: 30, cap: 60},
];

for (const {name, S, T, predecessor, R, H, middle, cap} of incomingCases) {
  test(`explicit incoming ${name}: real registered component, Sequence mount, opacity and scene agree`, () => {
    const seen: [string, number][] = [];
    const queried: [string, number][] = [];
    const Clock = Object.assign(({clip}: EffectProps) => {
      const frame = useCurrentFrame();
      seen.push([clip.id, frame]);
      return createElement('b', {'data-clock': frame}, clip.id);
    }, {prepareSceneCapability: ({clip}: {clip: TimelineClip}) => ({identity: clip.id,
      frame: (frame: number) => {
        queried.push([clip.id, frame]);
        return {presence: 'present' as const, opaqueSupport: 'none' as const,
          bounds: {status: 'known' as const, rect: {x: 0, y: 0, width: 1920, height: 1080}}};
      }})});
    const registries = {effects: {clock: Clock}};
    for (const id of ['fade', 'crossfade', 'cross-fade']) {
      const clips: TimelineClip[] = [
        ...(predecessor ? [{id: 'outgoing', track: track.id, at: 0, hold: 1, clipType: 'clock'}] : []),
        {id: 'incoming', track: track.id, at: S / 30, hold: 1, clipType: 'clock', transition: {type: id, duration: T / 30},
          ...(cap === undefined ? {} : {app: {canonicalTiming: {occurrenceStartMs: 0, occurrenceDurationMs: cap * 1000 / 30}}})},
      ];
      const before = JSON.stringify(clips);
      const compiled = compileIncoming(clips, registries);
      const scene = prepareIncoming(clips, registries, 30, compiled);
      const plan = scene.tracks[0].prepared.plans.at(-1)!;
      assert.equal(plan.drawStart, R);
      assert.equal(plan.drawDuration, H - R);
      for (const frame of [R - 1, R, middle, H - 1, H].filter(frame => frame >= 0)) {
        seen.length = 0;
        queried.length = 0;
        const html = render(incomingComposition(clips, registries, undefined, 30, compiled), frame);
        queried.length = 0;
        const answer = querySceneFrame(scene, frame);
        assert.deepEqual(seen, queried);
        const incoming = answer.layers.find(layer => layer.clipId === 'incoming');
        const mounted = frame >= R && frame < H;
        assert.equal(Boolean(incoming), mounted);
        assert.equal(seen.some(([id]) => id === 'incoming'), mounted);
        if (incoming) {
          assert.equal(incoming.contentFrame, frame - R);
          assert.equal(incoming.ownFrame, Math.min(29, Math.max(0, frame - S)));
          if (frame === R) assert.equal(incoming.transitionOpacity, 0);
          if (frame === middle) {
            assert.equal(incoming.transitionOpacity, .5);
            assert.match(html, /opacity:0\.5/);
            assert.match(html, new RegExp(`data-clock="${middle - R}"`));
          }
        }
        assert.ok(answer.layers.filter(layer => layer.clipId === 'outgoing').every(layer => layer.transitionOpacity === 1));
      }
      assert.equal(JSON.stringify(clips), before);
    }
  });
}

test('explicit incoming occurrence cap excludes its endpoint and can mount nothing', () => {
  for (const T of [12, 60]) {
    const clips: TimelineClip[] = [
      {id: 'a', at: 0, hold: 1, track: track.id},
      {id: 'b', at: 1, hold: 1, track: track.id, transition: {id: 'fade', durationFrames: T},
        ...{app: {canonicalTiming: {occurrenceStartMs: 0, occurrenceDurationMs: 2000}}}},
    ];
    const scene = prepareIncoming(clips);
    assert.equal(scene.tracks[0].prepared.plans[1].drawStart, Math.max(0, 30 - T));
    assert.equal(querySceneFrame(scene, 59).layers.at(-1)!.clipId, 'b');
    assert.deepEqual(querySceneFrame(scene, 60).layers, []);
    const ended = {...clips[1], app: {canonicalTiming: {occurrenceStartMs: 0, occurrenceDurationMs: 0}}};
    assert.deepEqual(querySceneFrame(prepareIncoming([clips[0], ended]), 0).layers.map(layer => layer.clipId), ['a']);
    // The cap also applies to a cut; omission preserves the original own span.
    const cut = {...clips[1], transition: undefined, app: {canonicalTiming: {occurrenceStartMs: 0, occurrenceDurationMs: 1500}}};
    assert.equal(querySceneFrame(prepareIncoming([cut]), 44).layers.length, 1);
    assert.deepEqual(querySceneFrame(prepareIncoming([cut]), 45).layers, []);
    assert.equal(querySceneFrame(prepare([cut]), 45).layers.length, 1);
  }
});

test('canonical compiler rejects malformed/conflicting input, duration, parameters and unsupported registry implementations', () => {
  const clip: TimelineClip = {id: 'b', at: 1, hold: 1, track: track.id, transition: {id: 'fade', durationFrames: 12}};
  const compiled = compileIncoming([clip]);
  const withCompiled = (value: unknown) => prepareCompositionScene([{track, clips: [clip]}], assets, 30,
    theme, 1920, 1080, undefined, undefined, {}, '', {}, {}, value as never);
  for (const value of [null, false, [], {}, 'incoming', {fps: 24, tracks: compiled.tracks},
    {fps: 30, tracks: null}, {fps: 30, tracks: []}, {fps: 30, tracks: [...compiled.tracks, ...compiled.tracks]},
    {fps: 30, tracks: [{...compiled.tracks[0], clipIds: ['wrong']}]},
    {fps: 30, tracks: [{...compiled.tracks[0], incomingTransitions: null}]}]) {
    assert.throws(() => withCompiled(value), /transition\/invalid-compilation/);
    assert.throws(() => render(createElement(TimelineComposition, {timeline: {theme: 'default', tracks: [track], clips: [clip]},
      assets, compiledTransitions: value as never}), 0), /transition\/invalid-compilation/);
  }
  for (const durationFrames of [0, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, .1, '12', null]) {
    assert.throws(() => prepareIncoming([{...clip, transition: {id: 'fade', durationFrames}}]), /transition\/invalid-duration/);
  }
  for (const transition of [null, false, 12, {id: 'fade', duration: 0}, {id: 'fade', duration: NaN},
    {id: 'fade', duration: .00001}, {id: 'fade', duration: 'bad'}]) {
    assert.throws(() => prepareIncoming([{...clip, transition}]));
  }
  for (const transition of [{id: 'fade', align: 'center'}, {id: 'fade', incomingPolicy: 'other'}, {id: 'fade', type: 'cross-fade'}]) {
    assert.throws(() => prepareIncoming([{...clip, transition}]), /transition\/conflicting-policy/);
  }
  for (const params of [null, [], {easing: 'ease-in'}, {ignored: 1}, {durationFrames: 30}]) {
    assert.throws(() => prepareIncoming([{...clip, transition: {id: 'fade', params}}]), /transition\/unsupported-params/);
  }
  assert.throws(() => prepareIncoming([{...clip, transition: {id: 'unknown'}}]), /Unknown transition id 'unknown'/);
  assert.throws(() => prepareIncoming([{...clip, transition: {id: 'custom'}}],
    {transitions: {custom: () => ({presentation: null, timing: null})}}), /transition\/unsupported-implementation/);
  assert.throws(() => prepareIncoming([clip], {transitions: {fade: () => ({presentation: null, timing: null})}}), /transition\/unsupported-implementation/);
  assert.throws(() => prepareIncoming([{...clip, app: {canonicalTiming: {occurrenceDurationMs: 1000}}} as TimelineClip]), /transition\/invalid-span/);
  assert.throws(() => prepareIncoming([{...clip, at: Number.MAX_SAFE_INTEGER}]), /transition\/invalid-span/);
  const selected = {...clip, transition: {id: 'fade', durationFrames: 12, duration: 2, params: {easing: 'linear'}}};
  assert.equal(prepareIncoming([selected]).tracks[0].prepared.plans[0].fadeIn!.to, 12);
});

test('explicit incoming rational fps shares speed-remapped registered clock and native trim/gain', () => {
  const fps = 24000 / 1001;
  const clips: TimelineClip[] = [
    {id: 'a', at: 0, hold: 1001 / 1000, track: track.id},
    {id: 'b', at: 1001 / 1000, from: 1001 / 1000, to: 3003 / 1000, speed: 2,
      track: track.id, asset: 'video', volume: .5, transition: {id: 'fade', duration: 1001 / 4000}},
  ];
  const seen: number[] = [];
  const queried: number[] = [];
  const Clock = Object.assign(() => {seen.push(useCurrentFrame()); return createElement('b', null, 'clock');},
    {prepareSceneCapability: () => ({identity: 'clock', frame: (frame: number) => {
      queried.push(frame);
      return {presence: 'present' as const, opaqueSupport: 'none' as const, bounds: {status: 'unknown' as const, reason: 'test'}};
    }})});
  const elements = [clips[0], {...clips[1], clipType: 'clock'}];
  const scene = prepareIncoming(elements, {effects: {clock: Clock}}, fps);
  const nativeSeen: {frame: number; trimBefore: number; trimAfter?: number; playbackRate: number; volume: number}[] = [];
  const Probe = ({content}: {content: ReactElement<ComponentProps<typeof VisualClip>>}) => {
    const wrapper = VisualClip(content.props) as ReactElement<{style: {overflow: string}; children: ReactElement}>;
    assert.equal(wrapper.type, 'div');
    assert.equal(wrapper.props.style.overflow, 'hidden');
    assert.ok(!Array.isArray(wrapper.props.children));
    const video = wrapper.props.children as ReactElement<{trimBefore: number; trimAfter?: number; playbackRate: number; volume: number}>;
    assert.equal(video.type, Video);
    const {trimBefore, trimAfter, playbackRate, volume} = video.props;
    nativeSeen.push({frame: useCurrentFrame(), trimBefore, trimAfter, playbackRate, volume});
    return createElement('i');
  };
  const modifiers: ModifierRegistry = {probe: {kind: 'modifier', element: 'probe', hosts: ['composition'],
    bounds: 'preserve', alpha: 'preserve', support: 'preserve',
    wrap: (_instance, _context, content) => createElement(Probe, {content: content as ReactElement<ComponentProps<typeof VisualClip>>})}};
  const media = [clips[0], {...clips[1], modifiers: [{id: 'probe', element: 'probe', params: {}}]}];
  for (const frame of [18, 21, 47, 48]) {
    seen.length = 0; queried.length = 0; nativeSeen.length = 0;
    render(incomingComposition(elements, {effects: {clock: Clock}}, undefined, fps), frame, fps);
    queried.length = 0;
    const answer = querySceneFrame(scene, frame);
    render(incomingComposition(media, {}, modifiers, fps), frame, fps);
    assert.deepEqual(seen, queried);
    const incoming = answer.layers.find(layer => layer.clipId === 'b');
    if (frame === 48) {
      assert.equal(incoming, undefined);
      assert.deepEqual(nativeSeen, []);
    } else {
      assert.equal(incoming!.contentFrame, frame - 18);
      assert.deepEqual(seen, [(frame - 18) * 2]);
      assert.deepEqual(nativeSeen, [{frame: frame - 18, trimBefore: 24, trimAfter: 72, playbackRate: 2, volume: .4}]);
      if (frame === 21) assert.equal(incoming!.transitionOpacity, .5);
    }
  }
});

test('canonical conversion of [a,b(fade),c] is deterministic and both public entry points consume its same result', () => {
  const seen: [string, number][] = [];
  const Clock = ({clip}: EffectProps) => {
    seen.push([clip.id, useCurrentFrame()]);
    return createElement('b', null, clip.id);
  };
  const registries = {effects: {clock: Clock}};
  const clips: TimelineClip[] = [
    {id: 'a', track: track.id, at: 0, hold: 1, clipType: 'clock'},
    {id: 'b', track: track.id, at: 1, hold: 1, clipType: 'clock', transition: {type: 'fade', duration: .4}},
    {id: 'c', track: track.id, at: 2, hold: 1, clipType: 'clock'},
  ];
  const before = JSON.stringify(clips);
  const compiled = compileIncoming(clips, registries);
  assert.deepEqual(compiled, {fps: 30, tracks: [{trackId: track.id, clipIds: ['a', 'b', 'c'],
    incomingTransitions: [null, {T: 12}, null]}]});
  assert.deepEqual(compileIncoming(clips, registries), compiled);
  const transferred = JSON.parse(JSON.stringify(compiled)) as CompiledCanonicalTransitions;
  const scene = prepareIncoming(clips, registries, 30, transferred);
  assert.deepEqual(querySceneFrame(scene, 24).layers.map(layer => [layer.clipId, layer.contentFrame, layer.transitionOpacity]),
    [['a', 24, 1], ['b', 6, .5]]);
  assert.deepEqual(querySceneFrame(scene, 54).layers.map(layer => [layer.clipId, layer.transitionOpacity]), [['b', 1]]);
  const html = render(incomingComposition(clips, registries, undefined, 30, transferred), 24);
  assert.deepEqual(seen, [['a', 24], ['b', 6]]);
  assert.match(html, /opacity:0\.5/);
  seen.length = 0;
  render(incomingComposition(clips, registries, undefined, 30, transferred), 54);
  assert.deepEqual(seen, [['b', 36]]);
  // Ordinary native inputs retain b's outgoing interpretation toward c.
  assert.deepEqual(querySceneFrame(prepare(clips, registries), 24).layers.map(layer => layer.clipId), ['a']);
  assert.deepEqual(querySceneFrame(prepare(clips, registries), 54).layers.map(layer => [layer.clipId, layer.transitionOpacity]), [['b', 0], ['c', 0]]);
  assert.equal(JSON.stringify(clips), before);
});

test('omitted canonical transition durations use the eight-frame default for both incoming IDs and legacy references', () => {
  for (const id of ['fade', 'cross-fade']) {
    const makeClips = (transition: TimelineClip['transition']): TimelineClip[] => [
      {id: 'a', track: track.id, at: 0, hold: 1},
      {id: 'b', track: track.id, at: 1, hold: 1, transition},
      {id: 'c', track: track.id, at: 2, hold: 1},
    ];
    const canonical = compileIncoming(makeClips({id}));
    const legacy = compileIncoming(makeClips({type: id, duration: undefined}));
    const explicit = compileIncoming(makeClips({id, durationFrames: 8}));

    assert.deepEqual(canonical.tracks[0].incomingTransitions, [null, {T: 8}, null]);
    assert.deepEqual(canonical, legacy);
    assert.deepEqual(canonical, explicit);
    assert.equal(prepareIncoming(makeClips({id})).tracks[0].prepared.plans[1].fadeIn?.to, 8);
  }
});

test('compiled incoming ownership must match the current clips and all visual tracks', () => {
  const clips: TimelineClip[] = [
    {id: 'a', track: track.id, at: 0, hold: 1},
    {id: 'b', track: track.id, at: 1, hold: 1, transition: {id: 'fade', durationFrames: 12}},
    {id: 'c', track: track.id, at: 2, hold: 1},
  ];
  const compiled = compileIncoming(clips);
  const vector = (incomingTransitions: unknown) => ({fps: 30, tracks: [{...compiled.tracks[0], incomingTransitions}]} as CompiledCanonicalTransitions);
  for (const stale of [vector([null, {T: 6}, null]), vector([null, null, {T: 12}]),
    vector([null, {T: 12}]), vector([null, {T: 12, ignored: true}, null]),
    {...compiled, tracks: [...compiled.tracks, {trackId: 'extra', clipIds: [], incomingTransitions: []}]}]) {
    assert.throws(() => prepareIncoming(clips, {}, 30, stale), /transition\/invalid-compilation/);
    assert.throws(() => render(incomingComposition(clips, {}, undefined, 30, stale), 24), /transition\/invalid-compilation/);
  }
  const moved = clips.map(clip => clip.id === 'b' ? {...clip, transition: undefined}
    : clip.id === 'c' ? {...clip, transition: {id: 'fade', durationFrames: 12}} : clip);
  assert.throws(() => prepareIncoming(moved, {}, 30, compiled), /transition\/invalid-compilation/);
  assert.throws(() => render(incomingComposition(moved, {}, undefined, 30, compiled), 24), /transition\/invalid-compilation/);
  const emptyTrack: TrackDefinition = {...track, id: 'empty'};
  const tracks = [{track, clips}, {track: emptyTrack, clips: []}];
  const both = compileCanonicalTransitions(tracks, 30, theme);
  const timeline = {theme: 'default', tracks: [track, emptyTrack], clips};
  assert.doesNotThrow(() => render(createElement(TimelineComposition, {timeline, assets, compiledTransitions: both}), 24));
  assert.throws(() => render(createElement(TimelineComposition, {timeline, assets, compiledTransitions: compiled}), 24), /transition\/invalid-compilation/);
});
