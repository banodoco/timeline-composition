import type {ModifierBounds} from '../modifier-types';
import type {AssetRegistryEntry, TimelineClip, TrackDefinition} from '../types';
import {intrinsicMediaSize, resolveClipPlacement} from './placement';
export const mediaModifierBounds = (clip: TimelineClip, track: TrackDefinition, asset: AssetRegistryEntry | undefined,
  width: number, height: number, space: 'local' | 'output' = 'output'): ModifierBounds => {
  if (!asset?.file) return {status: 'unknown', reason: 'Target media is unresolved'};
  const intrinsic = intrinsicMediaSize(asset);
  if (![intrinsic.width, intrinsic.height].every(value => Number.isFinite(value) && value > 0)) return {status:'unknown', reason: `Clip '${clip.id}' property asset.resolution / intrinsic is unresolved`};
  const placement = resolveClipPlacement({clip, track, canvas: {width, height}, intrinsic});
  return {status: 'known', rect: placement[space].content};
};
