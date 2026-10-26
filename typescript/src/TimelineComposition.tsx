import type {SceneCapabilities} from './scene-capabilities';
// Sprint 5: physically moved + renamed from
// tools/remotion/src/HypeComposition.tsx → TimelineComposition.tsx.
//
// Composition id rename: `HypeComposition` → `TimelineComposition`.
// Banodoco's CLI render path passes the new id; the in-tree shell at
// tools/remotion/src/Root.tsx imports this composition from the package.

import {useMemo, type ReactElement} from 'react';
import {AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig} from 'remotion';
import {AudioTrack} from './AudioTrack';
import {ClipLook} from './ClipLook';
import {resolveElementRegistries, type CompositionRegistries} from './registries';
import {ElementRegistryProvider} from './RegistryContext';
import type {EffectComponent} from './effects-types';
import {DEFAULT_THEME, ThemeProvider, useTheme} from './ThemeContext';
import {VisualClip} from './VisualClip';
import {resolveParams} from './lib/effect-params';
import {getClipDurationInFrames} from './lib/duration';
import {assertLoopCoverage, type ResolvedLoop} from './lib/beat-loop';
import {getAudioTracks, getVisualTracks} from './lib/tracks';
import {validateCompiledCanonicalTransitions, type CompiledCanonicalTransitions} from './lib/transition-spans';
import {resolveTransitionReference} from './lib/transitions';
import {
  prepareScene,
  querySceneFrame,
  type DrawPlan,
  type TransitionSpec,
} from './evaluation';
import {TransitionLayer} from './TransitionLayer';
import {mediaModifierBounds} from './lib/modifier-bounds';
import type {ModifierRegistry, ModifierFinding, ModifierBounds} from './modifier-types';
import {ModifierAdmissionError, hasModifierKeyframes} from './modifiers';
import type {
  AssetRegistryEntry,
  HypeCompositionProps,
  TimelineClip,
  TimelineCompositionProps,
  TrackDefinition,
} from './types';

type ModifierHostOptions = {
  width: number;
  height: number;
  registry?: ModifierRegistry;
  onFinding?: (finding: ModifierFinding) => void;
  registries?: CompositionRegistries;
  compiledTransitions?: CompiledCanonicalTransitions;
};

const sortClipsByAt = (clips: TimelineClip[]): TimelineClip[] => {
  return [...clips].sort((left, right) => left.at - right.at);
};

const hasPositionOverride = (clip: TimelineClip): boolean => {
  return (
    clip.x !== undefined
    || clip.y !== undefined
    || clip.width !== undefined
    || clip.height !== undefined
    || clip.cropTop !== undefined
    || clip.cropBottom !== undefined
    || clip.cropLeft !== undefined
    || clip.cropRight !== undefined
  );
};

const getAssetEntry = (
  clip: TimelineClip,
  assets: TimelineCompositionProps['assets'],
): AssetRegistryEntry | undefined => {
  return clip.asset ? assets.assets[clip.asset] : undefined;
};

export const renderVisualClipContent = (
  track: TrackDefinition,
  clip: TimelineClip,
  assets: TimelineCompositionProps['assets'],
  fps: number,
  theme: ReturnType<typeof useTheme>,
  globalFrame: number,
  modifiers: ModifierHostOptions,
): ReactElement | null => {
  if (clip.clipType === 'effect-layer') {
    if (clip.modifiers?.length || hasModifierKeyframes(clip)) throw new ModifierAdmissionError('unsupported-host', 'Effect layers are not owning visual clip subtrees');
    return null;
  }

  const registries = resolveElementRegistries(theme, modifiers.registries);
  const id = clip.clipType ?? '';
  const effectId = Object.prototype.hasOwnProperty.call(registries.effects, id)
    ? id : registries.clipTypeAliases[id];
  const effect = effectId && Object.prototype.hasOwnProperty.call(registries.effects, effectId)
    ? registries.effects[effectId] : undefined;
  if (effect) {
    const EffectComponent = effect as EffectComponent;
    const assetEntry = getAssetEntry(clip, assets);
    return (
      <ClipLook registries={registries} clip={clip} fps={fps} kind="element" globalFrame={globalFrame}
        modifierRegistry={modifiers.registry} onModifierFinding={modifiers.onFinding}>
        <EffectComponent
          clip={clip}
          params={resolveParams(clip)}
          theme={theme}
          fps={fps}
          assetEntry={assetEntry}
          globalFrame={globalFrame}
        />
      </ClipLook>
    );
  }

  const assetEntry = getAssetEntry(clip, assets);
  const modifierBounds: ModifierBounds = mediaModifierBounds(clip, track, assetEntry, modifiers.width, modifiers.height);
  const lookProps = {registries, clip, fps, globalFrame, modifierBounds, modifierRegistry: modifiers.registry,
    onModifierFinding: modifiers.onFinding};
  const baseVisual = (
    <VisualClip clip={clip} track={track} assetEntry={assetEntry} fps={fps}
      applyOpacity={(clip.modifiers?.length ?? 0) === 0} />
  );

  if (hasPositionOverride(clip)) {
    return <ClipLook {...lookProps} kind="media">{baseVisual}</ClipLook>;
  }

  if ((track.scale ?? 1) !== 1) {
    return (
      <ClipLook {...lookProps} kind="media">
        <AbsoluteFill
          style={{
            transform: `scale(${track.scale})`,
            transformOrigin: 'center center',
            overflow: 'hidden',
            isolation: 'isolate',
          }}
        >
          {baseVisual}
        </AbsoluteFill>
      </ClipLook>
    );
  }

  return <ClipLook {...lookProps} kind="media">{baseVisual}</ClipLook>;
};

export const renderVisualSequence = (
  track: TrackDefinition,
  clip: TimelineClip,
  assets: TimelineCompositionProps['assets'],
  fps: number,
  theme: ReturnType<typeof useTheme>,
  plan: DrawPlan,
  globalFrame: number,
  modifiers: ModifierHostOptions,
): ReactElement | null => {
  if (clip.clipType === 'am-sprite' && clip.params?.loop !== undefined) {
    assertLoopCoverage(clip.params.loop as ResolvedLoop, plan.drawStart, plan.drawDuration);
  }
  const content = renderVisualClipContent(track, clip, assets, fps, theme, globalFrame, modifiers);
  if (!content) {
    return null;
  }
  // A clip with no transition on either side renders exactly as before.
  const needsLayer = plan.drawDuration > plan.ownDuration || plan.fadeIn !== null || plan.fadeOut !== null;
  return (
    <Sequence
      key={clip.id}
      from={plan.drawStart}
      durationInFrames={plan.drawDuration}
    >
      {needsLayer ? <TransitionLayer plan={plan}>{content}</TransitionLayer> : content}
    </Sequence>
  );
};

const clipsCanTransition = (fromClip: TimelineClip, toClip: TimelineClip, fps: number): boolean => {
  if (!fromClip.transition || fromClip.clipType === 'effect-layer' || toClip.clipType === 'effect-layer') {
    return false;
  }
  const fromStart = Math.round(fromClip.at * fps);
  const fromEnd = fromStart + getClipDurationInFrames(fromClip, fps);
  const toStart = Math.round(toClip.at * fps);
  return toStart >= fromStart && toStart <= fromEnd;
};

const resolveTransitionSpec = (
  fromClip: TimelineClip,
  toClip: TimelineClip,
  fps: number,
  theme: ReturnType<typeof useTheme>,
  registries: CompositionRegistries,
): TransitionSpec | null => {
  if (!clipsCanTransition(fromClip, toClip, fps)) {
    return null;
  }
  const resolved = resolveTransitionReference(fromClip.transition as never, theme, fps, registries);
  if (!resolved) {
    return null;
  }
  return {
    T: resolved.durationFrames,
    kind: resolved.id === 'fade' ? 'dip' : 'dissolve',
    align: resolved.align,
    ...(resolved.incomingPolicy ? {incomingPolicy: resolved.incomingPolicy} : {}),
  };
};

// Convert the admitted canonical projection once. Ownership is a source-layer
// contract; the result contains resolved declarations, not a caller policy flag.
export const compileCanonicalTransitions = (tracks: {track: TrackDefinition; clips: TimelineClip[]}[],
  fps: number, theme: ReturnType<typeof useTheme>, registries: CompositionRegistries = {}): CompiledCanonicalTransitions => {
  if (!Number.isFinite(fps) || fps <= 0) throw new Error('transition/invalid-duration: Expected a positive finite frame rate');
  const resolved = resolveElementRegistries(theme, registries);
  const ids = new Set<string>();
  return {fps, tracks: tracks.map(({track, clips}) => {
    if (!track.id || ids.has(track.id)) throw new Error('transition/invalid-owner: Canonical tracks need unique IDs');
    ids.add(track.id);
    const sorted = sortClipsByAt(clips);
    if (new Set(sorted.map(clip => clip.id)).size !== sorted.length || sorted.some(clip => !clip.id || clip.track !== track.id)) {
      throw new Error('transition/invalid-owner: Canonical clips need unique IDs on their owning track');
    }
    return {trackId: track.id, clipIds: sorted.map(clip => clip.id), incomingTransitions: sorted.map(clip => {
      if (clip.transition === undefined) return null;
      if (clip.clipType === 'effect-layer') throw new Error('transition/unsupported-implementation: Effect layers cannot own incoming transitions');
      const transition = resolveTransitionReference(clip.transition as never, theme, fps, resolved, true);
      return transition ? {T: Math.round(transition.durationFrames)} : null;
    })};
  })};
};

// Both native requested-frame metadata and drawing use this exact preparation boundary.
export const prepareCompositionScene = (tracks: {track: TrackDefinition; clips: TimelineClip[]}[],
  assets: TimelineCompositionProps['assets'], fps: number, theme: ReturnType<typeof useTheme>,
  width: number, height: number, registry?: ModifierRegistry, roles?: Readonly<Record<string, string>>,
  capabilities: SceneCapabilities = {}, rendererIdentity = '', fontDigests: Readonly<Record<string, string>> = {},
  registries: CompositionRegistries = {}, compiledTransitions?: CompiledCanonicalTransitions) => {
  validateCompiledCanonicalTransitions(compiledTransitions, fps);
  const resolved = resolveElementRegistries(theme, registries);
  return prepareScene(tracks.map(({track, clips}) => {
    const sorted = sortClipsByAt(clips);
    if (compiledTransitions !== undefined) {
      const compiled = compiledTransitions.tracks.find(input => input.trackId === track.id);
      if (!compiled || !Array.isArray(compiled.clipIds) || compiled.clipIds.length !== sorted.length
          || compiled.clipIds.some((id, index) => id !== sorted[index].id) || !Array.isArray(compiled.incomingTransitions)) {
        throw new Error('transition/invalid-compilation: Compiled clip identities differ from the prepared track');
      }
      return {track, clips: sorted, transitions: [], incomingTransitions: compiled.incomingTransitions};
    }
    return {track, clips: sorted, transitions: sorted.slice(0, -1).map((clip, index) =>
      resolveTransitionSpec(clip, sorted[index + 1], fps, theme, resolved))};
  }), assets, fps, width, height, {elements: new Set(Object.keys(resolved.effects).concat(
    Object.keys(resolved.clipTypeAliases).filter(alias => Object.prototype.hasOwnProperty.call(resolved.effects, resolved.clipTypeAliases[alias])))),
    modifiers: registry, roles, capabilities: {...capabilities, components: {...capabilities.components, ...Object.fromEntries(tracks.flatMap(({clips}) =>
      clips.flatMap(clip => {
        const name = clip.clipType ?? '';
        const id = Object.prototype.hasOwnProperty.call(resolved.effects, name) ? name : resolved.clipTypeAliases[name];
        const component = Object.prototype.hasOwnProperty.call(resolved.effects, id) ? resolved.effects[id] : undefined;
        const prepared = component?.prepareSceneCapability?.({clip: {...clip, params: resolveParams(clip) as Record<string, unknown> | undefined},
          assetEntry: getAssetEntry(clip, assets), fps, width, height, rendererIdentity, fontDigests});
        return prepared ? [[clip.id, prepared]] : [];
      })))}}});
};

const renderVisualTrack = (
  track: TrackDefinition,
  clips: TimelineClip[],
  assets: TimelineCompositionProps['assets'],
  fps: number,
  theme: ReturnType<typeof useTheme>,
  globalFrame: number,
  modifiers: ModifierHostOptions,
  prepared: ReturnType<typeof prepareCompositionScene>,
): ReactElement | null => {
  if (clips.length === 0) {
    return null;
  }

  const evaluated = querySceneFrame(prepared, globalFrame);
  const rendered = evaluated.layers.map(layer => renderVisualSequence(track, clips[layer.clipIndex],
    assets, fps, theme, prepared.tracks[0].prepared.plans[layer.clipIndex], globalFrame, modifiers));

  return (
    <AbsoluteFill
      key={track.id}
      style={{
        opacity: track.opacity ?? 1,
        mixBlendMode: track.blendMode && track.blendMode !== 'normal' ? track.blendMode : undefined,
      }}
    >
      {rendered}
    </AbsoluteFill>
  );
};

export const renderAudioTrack = (
  track: TrackDefinition,
  clips: TimelineClip[],
  assets: TimelineCompositionProps['assets'],
  fps: number,
): ReactElement[] => {
  return sortClipsByAt(clips).map((clip) => {
    if (clip.modifiers?.length || hasModifierKeyframes(clip)) throw new ModifierAdmissionError('unsupported-host', 'Audio tracks do not support visual modifiers');
    const assetEntry = getAssetEntry(clip, assets);
    return (
      <Sequence
        key={clip.id}
        from={Math.round(clip.at * fps)}
        durationInFrames={getClipDurationInFrames(clip, fps)}
      >
        <AudioTrack clip={clip} track={track} assetEntry={assetEntry} fps={fps} />
      </Sequence>
    );
  });
};

export const TimelineComposition = (props: TimelineCompositionProps): ReactElement => {
  const {timeline, assets} = props;
  const {fps, width, height} = useVideoConfig();
  // Props are immutable snapshots. Validate once per compiled input / render
  // clock instead of repeating a whole-vector walk on every Remotion frame.
  useMemo(() => validateCompiledCanonicalTransitions(props.compiledTransitions, fps),
    [props.compiledTransitions, fps]);
  const visualTracks = useMemo(() => [...getVisualTracks(timeline)].reverse(), [timeline]);
  const audioTracks = useMemo(() => getAudioTracks(timeline), [timeline]);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: props.theme?.visual.color.bg ?? DEFAULT_THEME.visual.color.bg,
        width,
        height,
        overflow: 'hidden',
      }}
    >
      <ThemeProvider value={props.theme ?? DEFAULT_THEME}>
        <ElementRegistryProvider value={resolveElementRegistries(props.theme ?? DEFAULT_THEME, props.registries)}>
          <TimelineCompositionBody
            timeline={timeline}
            assets={assets}
            visualTracks={visualTracks}
            audioTracks={audioTracks}
            fps={fps}
            modifiers={{width, height, registry: props.modifierRegistry, onFinding: props.onModifierFinding, registries: props.registries, compiledTransitions: props.compiledTransitions}}
          />
        </ElementRegistryProvider>
      </ThemeProvider>
    </AbsoluteFill>
  );
};

// Backwards-compatibility alias for callers that haven't migrated off the
// HypeComposition name yet. The exported component identity is the same.
export const HypeComposition = TimelineComposition;
export type {HypeCompositionProps, TimelineCompositionProps};

const TimelineCompositionBody = ({
  timeline,
  assets,
  visualTracks,
  audioTracks,
  fps,
  modifiers,
}: {
  timeline: TimelineCompositionProps['timeline'];
  assets: TimelineCompositionProps['assets'];
  visualTracks: TrackDefinition[];
  audioTracks: TrackDefinition[];
  fps: number;
  modifiers: ModifierHostOptions;
}): ReactElement => {
  const theme = useTheme();
  const globalFrame = useCurrentFrame();
  // Scene preparation contains sorting, transition planning, registry
  // resolution and component capability setup. Those depend on composition
  // inputs, not the current frame. Keep a prepared scene per track and only
  // query its frame-dependent result below.
  const preparedVisualTracks = useMemo(() => visualTracks.map(track => {
    const clips = sortClipsByAt(timeline.clips.filter(clip => clip.track === track.id));
    const prepared = prepareCompositionScene([{track, clips}], assets, fps, theme,
      modifiers.width, modifiers.height, modifiers.registry, undefined, {}, '', {},
      modifiers.registries, modifiers.compiledTransitions);
    return {track, clips, prepared};
  }), [timeline, assets, visualTracks, fps, theme, modifiers.width, modifiers.height,
    modifiers.registry, modifiers.registries, modifiers.compiledTransitions]);
  return (
    <>
      <AbsoluteFill style={{position: 'relative', overflow: 'hidden'}}>
        {preparedVisualTracks.map(({track, clips, prepared}) =>
          renderVisualTrack(track, clips, assets, fps, theme, globalFrame, modifiers, prepared))}
      </AbsoluteFill>
      {audioTracks.map((track) => {
        const clips = timeline.clips.filter((clip) => clip.track === track.id);
        return renderAudioTrack(track, clips, assets, fps);
      })}
    </>
  );
};
