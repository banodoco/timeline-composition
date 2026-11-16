import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createElement, type ReactElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Internals} from 'remotion';
import {TimelineComposition, prepareCompositionScene, renderVisualClipContent} from '../src/TimelineComposition';
import {DEFAULT_THEME, ThemeProvider, toRuntimeTheme} from '../src/ThemeContext';
import {resolveElementRegistries, ElementRegistryProvider, type CompositionRegistries} from '../src/registries';
import {composeAnimations, resolveAnimationReferences} from '../src/lib/animations';
import {resolveTransitionReference} from '../src/lib/transitions';
import {querySceneFrame} from '../src/evaluation';
import {BUNDLED_THEMES, BUNDLED_THEME_VERSIONS} from '../src/registry.generated';
import type {EffectProps, HookAnimationProps} from '../src/effects-types';
import type {AssetRegistry, TimelineClip, TrackDefinition} from '../src/types';
import type {ComponentCapabilityContext} from '../src/scene-capabilities';

const theme = toRuntimeTheme(DEFAULT_THEME);
const branded = toRuntimeTheme(BUNDLED_THEMES['2rp']);
const assets: AssetRegistry = {assets: {}};
const track: TrackDefinition = {id: 'visual', kind: 'visual', label: 'Visual'};
const clip: TimelineClip = {id: 'title', track: 'visual', at: 0, hold: 2, clipType: 'text-card',
  params: {content: 'Title', typewriter: false, entrance: 'none', exit: 'none'}};
const prepare = (clips: TimelineClip[], registries?: CompositionRegistries, selectedTheme = theme) =>
  prepareCompositionScene([{track, clips}], assets, 30, selectedTheme, 1920, 1080, undefined,
    Object.fromEntries(clips.map(clip => [clip.id, 'picture'])), {}, 'renderer@1', {}, registries);

// Remotion's ordinary contexts supply the same frame/config used by Player.
// No browser or alternate copy of the component implementation is involved.
const render = (content: ReactElement, selectedTheme = DEFAULT_THEME, registries: CompositionRegistries = {}) => {
  const video = {id: 'test', width: 1920, height: 1080, fps: 30, durationInFrames: 60,
    defaultProps: {}, folderName: null, parentFolderName: null, component: () => null,
    nonce: [], schema: null, calculateMetadata: null, stack: null};
  return renderToStaticMarkup(createElement(Internals.CompositionManager.Provider, {
    value: {compositions: [video], currentCompositionMetadata: null, folders: [],
      canvasContent: {type: 'composition', compositionId: 'test'}},
  }, createElement(Internals.TimelineContext.Provider, {
    value: {frame: {test: 24}, playing: false, imperativePlaying: {current: false}, audioAndVideoTags: {current: []}},
  }, createElement(Internals.CanUseRemotionHooksProvider, null,
    createElement(ThemeProvider, {value: selectedTheme, children:
      createElement(ElementRegistryProvider, {value: registries, children: content})})))));

};

test('bundled core and selected theme effects use the same scoped dispatch and stay conservative', () => {
  assert.equal(BUNDLED_THEME_VERSIONS['2rp'], '0.1.0');
  assert.deepEqual(Object.keys(resolveElementRegistries(theme).effects), ['text-card']);
  assert.equal(resolveElementRegistries(theme).clipTypeAliases.text, 'text-card');
  const text = renderVisualClipContent(track, {...clip, clipType: 'text', text: {content: 'Alias'}},
    assets, 30, theme, 0, {width: 1920, height: 1080});
  assert.deepEqual((text?.props as {children: ReactElement<EffectProps>}).children.props.params, {content: 'Alias'});
  assert.equal(Object.keys(resolveElementRegistries(branded).effects).length, 5);
  for (const id of ['text-card', 'art-card', 'cta-card', 'resource-card', 'section-hook']) {
    const scene = prepare([{...clip, clipType: id}], undefined, branded);
    assert.ok(scene.elements.has(id));
    assert.equal(querySceneFrame(scene, 0).layers[0].visible, 'unknown');
    assert.ok(querySceneFrame(scene, 0).findings.some(finding => finding.code === 'unknown-component-internals'));
    const node = renderVisualClipContent(track, {...clip, clipType: id}, assets, 30, branded, 0, {width: 1920, height: 1080});
    assert.ok(node);
  }
  const unknown = querySceneFrame(prepare([{...clip, clipType: 'not-installed'}]), 0);
  assert.equal(unknown.coverage, 'UNKNOWN');
  assert.ok(unknown.findings.some(finding => finding.code === 'unknown-component-internals'));
});

test('host effects, aliases and capabilities are instance scoped, including default overrides', () => {
  const seen: EffectProps[] = [];
  const Custom = Object.assign((props: EffectProps) => {seen.push(props); return createElement('b', null, 'host');}, {
    prepareSceneCapability: ({rendererIdentity}: {rendererIdentity: string}) => ({
      identity: rendererIdentity,
      frame: () => ({presence: 'present' as const, opaqueSupport: 'rect' as const,
        bounds: {status: 'known' as const, rect: {x: 0, y: 0, width: 1920, height: 1080}}}),
    }),
  });
  const registries = {effects: {'text-card': Custom}, clipTypeAliases: {custom: 'text-card'}};
  const alias = {...clip, clipType: 'custom'};
  assert.equal(querySceneFrame(prepare([alias], registries), 0).coverage, 'COVERED');
  assert.equal(querySceneFrame(prepare([alias]), 0).coverage, 'UNKNOWN');
  assert.equal(querySceneFrame(prepare([clip], registries), 0).layers[0].visible, true);
  assert.equal(querySceneFrame(prepare([clip]), 0).layers[0].visible, 'unknown');
  const content = renderVisualClipContent(track, alias, assets, 30, theme, 7, {width: 1920, height: 1080, registries});
  assert.ok(content);
  const effect = (content.props as {children: ReactElement<EffectProps>}).children;
  assert.strictEqual(effect.type, Custom);
  assert.equal(effect.props.globalFrame, 7);
  assert.deepEqual(effect.props.params, clip.params);
  assert.equal(seen.length, 0);
  assert.deepEqual(Object.keys(resolveElementRegistries(branded, {effects: {}}).effects), []);
});

test('component capability receives the exact renderer-selected asset, including explicit absence', () => {
  const contexts: ComponentCapabilityContext[] = [];
  const rendered: EffectProps[] = [];
  const Custom = Object.assign((props: EffectProps) => {rendered.push(props); return createElement('b', null, 'asset');}, {
    prepareSceneCapability: (context: ComponentCapabilityContext) => {
      contexts.push(context);
      return {identity: 'asset@1', frame: () => ({presence: 'unknown' as const, opaqueSupport: 'unknown' as const,
        bounds: {status: 'unknown' as const, reason: 'Asset selection alone proves no alpha'}})};
    },
  });
  const registries = {effects: {'text-card': Custom}};
  const entry = Object.freeze({file: 'https://example.test/selected.mp4', url: 'https://example.test/source',
    resolution: '1920x1080', type: 'video/mp4'});
  const selectedAssets = Object.freeze({assets: Object.freeze({selected: entry,
    other: Object.freeze({file: 'other.jpg', type: 'image/jpeg'})})});
  const before = JSON.stringify(selectedAssets);
  for (const asset of ['selected', 'missing', undefined]) {
    const selected = Object.freeze({...clip, asset});
    const scene = prepareCompositionScene([{track, clips: [selected]}], selectedAssets, 30, theme, 1920, 1080,
      undefined, undefined, {}, '', {}, registries);
    const context = contexts.at(-1)!;
    assert.ok(Object.hasOwn(context, 'assetEntry'));
    assert.strictEqual(context.assetEntry, asset === 'selected' ? entry : undefined);
    const content = renderVisualClipContent(track, selected, selectedAssets, 30, theme, 24,
      {width: 1920, height: 1080, registries});
    assert.ok(content);
    render(content, DEFAULT_THEME, registries);
    assert.strictEqual(rendered.at(-1)!.assetEntry, context.assetEntry);
    assert.equal(querySceneFrame(scene, 24).layers[0].opaqueSupport, 'unknown');
    assert.equal(selected.asset, asset);
  }
  assert.equal(JSON.stringify(selectedAssets), before);
});

test('opaque meta does not change scene timing, asset selection, or rendered output', () => {
  const baseTrack: TrackDefinition = {id: 'visual', kind: 'visual', label: 'Visual'};
  const baseClips: TimelineClip[] = [
    {id: 'first', track: baseTrack.id, at: 0, hold: 1, asset: 'selected', clipType: 'asset-probe'},
    {id: 'second', track: baseTrack.id, at: 1, hold: 1, asset: 'other', clipType: 'asset-probe'},
  ];
  const baseAssets: AssetRegistry = {assets: {
    selected: {file: 'https://example.test/selected.mp4', type: 'video/mp4', resolution: '1920x1080'},
    other: {file: 'https://example.test/other.mp4', type: 'video/mp4', resolution: '1920x1080'},
  }};
  const meta = {
    'com.other.tool': {
      foreign_asset_id: 'other',
      foreign_clip_id: 'second',
      nested: {asset: 'missing'},
      ids: ['selected', 'other'],
      nullable: null,
    },
    'org.example.notes': {reviewed: true},
  };
  const opaqueTrack: TrackDefinition = {...baseTrack, meta};
  const opaqueClips: TimelineClip[] = baseClips.map(clip => ({...clip, meta}));
  const opaqueAssets: AssetRegistry = {assets: Object.fromEntries(
    Object.entries(baseAssets.assets).map(([id, asset]) => [id, {...asset, meta}]),
  )};
  const AssetProbe = ({assetEntry}: EffectProps) => createElement('b', {'data-file': assetEntry?.file}, 'asset');
  const registries = {effects: {'asset-probe': AssetProbe}};
  const baseTimeline = {theme: 'default', output: {resolution: '1920x1080'}, tracks: [baseTrack], clips: baseClips};
  const opaqueTimeline = {theme: 'default', output: {resolution: '1920x1080'}, tracks: [opaqueTrack], clips: opaqueClips, meta};
  const before = JSON.stringify({timeline: opaqueTimeline, assets: opaqueAssets});
  const baseScene = prepareCompositionScene([{track: baseTrack, clips: baseClips}], baseAssets,
    30, theme, 1920, 1080, undefined, undefined, {}, '', {}, registries);
  const opaqueScene = prepareCompositionScene([{track: opaqueTrack, clips: opaqueClips}], opaqueAssets,
    30, theme, 1920, 1080, undefined, undefined, {}, '', {}, registries);
  assert.deepEqual(opaqueScene.tracks.map(track => track.prepared), baseScene.tracks.map(track => track.prepared));
  for (const [frame, clipId] of [[0, 'first'], [30, 'second'], [59, 'second']] as const) {
    const baseFrame = querySceneFrame(baseScene, frame);
    const opaqueFrame = querySceneFrame(opaqueScene, frame);
    assert.deepEqual(opaqueFrame, baseFrame);
    assert.deepEqual(opaqueFrame.layers.map(layer => layer.clipId), [clipId]);
  }
  const baseMarkup = render(createElement(TimelineComposition, {timeline: baseTimeline, assets: baseAssets, registries}), DEFAULT_THEME, registries);
  const opaqueMarkup = render(createElement(TimelineComposition, {timeline: opaqueTimeline, assets: opaqueAssets, registries}), DEFAULT_THEME, registries);
  assert.equal(opaqueMarkup, baseMarkup);
  assert.match(opaqueMarkup, /selected\.mp4/);
  assert.doesNotMatch(opaqueMarkup, /other\.mp4/);
  assert.equal(JSON.stringify({timeline: opaqueTimeline, assets: opaqueAssets}), before);
});

test('host animation maps keep defaults, phase validation and unknown errors scoped', () => {
  const custom = ({text}: HookAnimationProps) => ({text, content: 'host animation'});
  const registries: CompositionRegistries = {animations: {custom}, animationDefaults: {custom: {durationFrames: 3}},
    animationMeta: {custom: {kind: 'hook', phase: 'entrance'}}};
  assert.equal(resolveAnimationReferences('custom', 'entrance', registries)[0].durationFrames, 3);
  assert.throws(() => resolveAnimationReferences('custom', 'exit', registries), /phase/);
  assert.throws(() => resolveAnimationReferences('custom', 'entrance'), /Unknown animation/);
  assert.throws(() => resolveAnimationReferences('fade', 'exit', registries), /Unknown animation/);
  assert.throws(() => resolveAnimationReferences('toString', 'exit'), /Unknown animation/);
  assert.equal(composeAnimations({clip, refs: 'custom', phase: 'entrance', content: 'default',
    theme, fps: 30, elapsedFrames: 2, registries}), 'host animation');
  assert.equal(resolveAnimationReferences('fade', 'exit')[0].durationFrames, 12);
  const override = {animations: {'type-on': custom}};
  assert.equal(composeAnimations({clip, refs: {id: 'type-on', easing: 'linear'}, phase: 'entrance',
    content: 'default', theme, fps: 30, elapsedFrames: 2, registries: override}), 'host animation');
});

test('host transition resolution reaches preparation without changing another instance', () => {
  const calls: number[] = [];
  const registries: CompositionRegistries = {transitions: {custom: props => {
    calls.push(props.durationFrames); return {presentation: null, timing: null};
  }}, transitionDefaults: {custom: {durationFrames: 8}}};
  const pair = [{...clip, transition: 'custom'}, {...clip, id: 'next', at: 2}];
  const prepared = prepare(pair, registries);
  assert.equal(prepared.tracks[0].prepared.plans[1].drawStart, 52);
  assert.deepEqual(calls, [8]);
  assert.throws(() => prepare(pair), /Unknown transition/);
  assert.throws(() => resolveTransitionReference('toString', theme, 30), /Unknown transition/);
});

test('default animations retain real motion and type-on output', () => {
  const animated = composeAnimations({clip, refs: 'fade-up', phase: 'entrance', content: 'title',
    theme, fps: 30, elapsedFrames: 0}) as ReactElement;
  const wrapper = (animated.type as (props: unknown) => ReactElement)(animated.props);
  assert.equal((wrapper.props as {style: {opacity: number}}).style.opacity, 0);
  const early = composeAnimations({clip, refs: 'type-on', phase: 'entrance', text: 'hello', content: 'hello',
    theme, fps: 30, elapsedFrames: 0});
  const late = composeAnimations({clip, refs: 'type-on', phase: 'entrance', text: 'hello', content: 'hello',
    theme, fps: 30, elapsedFrames: 120});
  assert.notDeepEqual(early, late);
});

test('packaged effect internal animations and clip animations honor the rendering scope', () => {
  const Custom = ({children}: {children?: unknown}) => createElement('mark', null, 'scoped');
  const registries: CompositionRegistries = {animations: {'fade-up': Custom, fade: Custom, 'type-on': Custom},
    animationMeta: {'fade-up': {kind: 'wrapper', phase: 'entrance'}, fade: {kind: 'wrapper', phase: 'exit'},
      'type-on': {kind: 'wrapper', phase: 'entrance'}},
    animationDefaults: {'fade-up': {durationFrames: 18}, fade: {durationFrames: 12}, 'type-on': {durationFrames: 60}}};
  const content = renderVisualClipContent(track, {...clip, params: {content: 'Title', typewriter: false}}, assets,
    30, theme, 24, {width: 1920, height: 1080, registries});
  assert.ok(content);
  assert.match(render(content, DEFAULT_THEME, registries), /<mark>scoped<\/mark>/);
  const composition = createElement(TimelineComposition, {timeline: {theme: 'default', tracks: [track], clips: [clip]},
    assets, registries: {effects: {'text-card': () => createElement('b', null, 'host composition')}}});
  assert.match(render(composition), /host composition/);
  const animatedClip = createElement(TimelineComposition, {
    timeline: {theme: 'default', tracks: [track], clips: [{...clip, entrance: {id: 'fade-up', durationFrames: 60}}]}, assets,
    registries: {...registries, effects: {'text-card': () => createElement('b', null, 'host composition')}},
  });
  assert.match(render(animatedClip), /<mark>scoped<\/mark>/);
});
