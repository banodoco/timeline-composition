import type {ModifierBounds} from '../modifier-types';
import type {AssetRegistryEntry, TimelineClip, TrackDefinition} from '../types';
import {intrinsicMediaSize, resolveClipPlacement} from './placement';
import {computeRenderBounds} from './render-bounds';
export const mediaModifierBounds = (clip: TimelineClip, track: TrackDefinition, asset: AssetRegistryEntry | undefined,
  width: number, height: number): ModifierBounds => {
  if (!asset?.file) return {status: 'unknown', reason: 'Target media is unresolved'};
  const placement = resolveClipPlacement({clip, track, canvas: {width, height}, intrinsic: intrinsicMediaSize(asset)});
  const media = placement.output.media;
  const bounds = placement.output.finalClip;
  const x = Math.max(media.x, bounds.x), y = Math.max(media.y, bounds.y);
  return {status: 'known', rect: computeRenderBounds({x, y, width: Math.max(0, Math.min(media.x+media.width, bounds.x+bounds.width)-x), height: Math.max(0, Math.min(media.y+media.height, bounds.y+bounds.height)-y)}, width, height)};
};
