/** Shared timeline rendering, evaluation and theme contracts. */

export const TIMELINE_COMPOSITION_SCAFFOLD = "sprint-5" as const;
export type TimelineCompositionScaffoldTag = typeof TIMELINE_COMPOSITION_SCAFFOLD;

// Composition surface (renamed Sprint 5: HypeComposition → TimelineComposition).
export { TimelineComposition, HypeComposition } from "./TimelineComposition";
export type { TimelineCompositionProps, HypeCompositionProps } from "./types";

// Theme api re-exports (the Sprint 4 stable sub-path also still works).
export {
  composeAnimations,
  normalizeAnimationReferences,
  resolveAnimationReferences,
} from "./lib/animations";
export {
  ThemeProvider,
  useTheme,
  DEFAULT_THEME,
  toRuntimeTheme,
} from "./ThemeContext";
export type {
  EffectProps,
  EffectComponent,
  AnimationReference,
  AnimationReferenceList,
  AnimationSlots,
  AnimationMeta,
  AnimationPhase,
  AnimationKind,
  WrapperAnimationProps,
  HookAnimationProps,
  HookAnimationResult,
  TransitionProps,
  TransitionReference,
  TransitionReferenceObject,
  TransitionComponent,
} from "./effects-types";
export type { Theme, RuntimeTheme } from "./ThemeContext";

// Duration helper used by the bundle root for calculateMetadata.
export { getTimelineDurationInFrames } from "./lib/duration";

// Bundled theme defaults; additional host elements use scoped registry input.
export {
  THEME_PACKAGE_REGISTRY,
  THEME_PACKAGE_CLIP_TYPES,
} from "./registry.generated.js";
export type {
  ThemePackageRegistryEntry,
  ThemePackageClipType,
} from "./registry.generated.js";

export {MODIFIER_REGISTRY, composeModifiers, declareModifier, ModifierAdmissionError} from './modifiers';
export type {
  ClipModifierReference, ModifierBounds, ModifierContext, ModifierDeclaration,
  ModifierDefinition, ModifierFinding, ModifierProps, ModifierRegistry,
} from './modifier-types';

export {mediaModifierBounds} from './lib/modifier-bounds';

export {prepareCompositionScene, compileCanonicalTransitions} from './TimelineComposition';
export {prepareScene, querySceneFrame, queryCompositionSceneFrame, querySceneOcclusion} from './evaluation';
export type {PreparedScene, SceneFrame, SceneLayer, SceneFinding, SceneTrackInput, SceneOcclusion,
  ComponentDiagnostics, ComponentFrameSupport, PreparedComponentCapability, ComponentCapabilityContext} from './evaluation';

export type {TimelineClip, TimelineConfig, TrackDefinition, AssetRegistry, AssetRegistryEntry, ClipKeyframe} from './types';
export {resolveElementRegistries, ElementRegistryProvider, useElementRegistries} from './registries';
export type {CompositionRegistries, ResolvedCompositionRegistries, AnimationRegistries, TransitionRegistries} from './registries';

export type {CompiledCanonicalTransitions} from './evaluation';

export * from './lib/placement';

export {computeRenderBounds, getVisibleBoundsFromCrop, normalizeRenderCropValues, hasRenderableBounds, computeViewportMediaLayout} from './lib/render-bounds';
export type {RenderBounds, RenderCropValues, ViewportMediaLayout} from './lib/render-bounds';
