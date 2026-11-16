import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createElement, type ComponentProps, type ReactElement} from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {Internals} from 'remotion';
import {DEFAULT_THEME, TimelineComposition, toRuntimeTheme} from '../src/index';
import type {ComponentCapabilityContext} from '../src/scene-capabilities';
import type {EffectProps} from '../src/effects-types';
import type {TimelineClip, TimelineConfig, AssetRegistry, CompositionRegistries, ModifierRegistry} from '../src/index';

const track = {id: 'visual', kind: 'visual', label: 'Visual'} as const;
const baseClip: TimelineClip = {id: 'counted', track: track.id, at: 0, hold: 20, clipType: 'counted', asset: 'asset',
  params: {revision: 0}};
const baseAssets: AssetRegistry = {assets: {asset: {file: 'asset-0.png', type: 'image/png'}}};
const baseTheme = toRuntimeTheme(DEFAULT_THEME);
const support = {presence: 'present' as const, opaqueSupport: 'rect' as const,
  bounds: {status: 'known' as const, rect: {x: 0, y: 0, width: 1920, height: 1080}}};

const video = (fps: number, width: number, height: number) => ({id: 'test', width, height, fps, durationInFrames: 60,
  defaultProps: {}, folderName: null, parentFolderName: null, component: () => null,
  nonce: [], schema: null, calculateMetadata: null, stack: null});

const wrap = (content: ReactElement, frame: number, fps: number, width: number, height: number) =>
  createElement(Internals.CompositionManager.Provider, {
    value: {compositions: [video(fps, width, height)], currentCompositionMetadata: null, folders: [],
      canvasContent: {type: 'composition', compositionId: 'test'}},
  }, createElement(Internals.TimelineContext.Provider, {
    value: {frame: {test: frame}, playing: false, imperativePlaying: {current: false}, audioAndVideoTags: {current: []}},
  }, createElement(Internals.CanUseRemotionHooksProvider, null, content)));

test('visual scene preparation is reused across frames and rebuilt for composition input revisions', () => {
  const contexts: ComponentCapabilityContext[] = [];
  const Counted = Object.assign(({globalFrame}: EffectProps) => createElement('span', null, String(globalFrame)), {
    prepareSceneCapability: (context: ComponentCapabilityContext) => {
      contexts.push(context);
      return {identity: 'counted@1', frame: () => support};
    },
  });
  const registries: CompositionRegistries = {effects: {counted: Counted}};
  const initialTimeline: TimelineConfig = {theme: 'default', tracks: [track], clips: [baseClip]};
  let current: ReactTestRenderer;
  const render = (frame: number, options: {
    timeline?: TimelineConfig; assets?: AssetRegistry; theme?: ReturnType<typeof toRuntimeTheme>;
    registries?: CompositionRegistries; modifierRegistry?: ModifierRegistry;
    fps?: number; width?: number; height?: number;
    compiledTransitions?: ComponentProps<typeof TimelineComposition>['compiledTransitions'];
  } = {}) => wrap(createElement(TimelineComposition, {
    timeline: options.timeline ?? initialTimeline,
    assets: options.assets ?? baseAssets,
    theme: options.theme ?? baseTheme,
    registries: options.registries ?? registries,
    modifierRegistry: options.modifierRegistry,
    compiledTransitions: options.compiledTransitions,
  }), frame, options.fps ?? 30, options.width ?? 1920, options.height ?? 1080);

  act(() => { current = create(render(0)); });
  assert.equal(contexts.length, 1);
  assert.equal(current!.root.findByType('span').children.join(''), '0');

  act(() => current!.update(render(1)));
  assert.equal(current!.root.findByType('span').children.join(''), '1');
  assert.equal(contexts.length, 1, 'frame-only updates query the prepared scene without preparing it again');

  const updates: Array<[string, Parameters<typeof render>[1]]> = [
    ['timeline', {timeline: {...initialTimeline, clips: [{...baseClip, params: {revision: 1}}]} }],
    ['assets', {assets: {assets: {asset: {file: 'asset-1.png', type: 'image/png'}}}}],
    ['theme', {theme: toRuntimeTheme({...DEFAULT_THEME, id: 'other-theme'})}],
    ['registries', {registries: {...registries}}],
    ['modifier registry', {modifierRegistry: {}}],
    ['fps', {fps: 24}],
    ['dimensions', {width: 1280, height: 720}],
    ['compiled transitions', {compiledTransitions: {fps: 30, tracks: [
      {trackId: track.id, clipIds: [baseClip.id], incomingTransitions: [null]},
    ]}}],
  ];
  for (const [input, options] of updates) {
    const prior: number = contexts.length;
    act(() => current!.update(render(1, options)));
    assert.equal(contexts.length, prior + 1, `${input} changes invalidate prepared scene state`);
    if (input === 'timeline') assert.equal(contexts.at(-1)?.clip.params?.revision, 1);
    if (input === 'assets') assert.equal(contexts.at(-1)?.assetEntry?.file, 'asset-1.png');
    if (input === 'fps') assert.equal(contexts.at(-1)?.fps, 24);
    if (input === 'dimensions') {
      assert.equal(contexts.at(-1)?.width, 1280);
      assert.equal(contexts.at(-1)?.height, 720);
    }
  }
  current!.unmount();
});
