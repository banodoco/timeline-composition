import type {TimelineClip, TrackDefinition, TimelineConfig, AssetRegistryEntry} from '../types';
import {computeRenderBounds, getIntrinsicMediaSize, getVisibleBoundsFromCrop, normalizeRenderCropValues, type RenderBounds} from './render-bounds';

export type PlacementTransform = {scale: number; tx: number; ty: number};
export const transformPlacementPoint = (p: {x: number; y: number}, t: PlacementTransform) => ({x: p.x * t.scale + t.tx, y: p.y * t.scale + t.ty});
export const transformPlacementRect = (r: RenderBounds, t: PlacementTransform): RenderBounds => ({...transformPlacementPoint(r, t), width: r.width * t.scale, height: r.height * t.scale});
export const resolveTrackTransform = (track: TrackDefinition, canvas: {width: number; height: number}) => {
  const scale = track.scale ?? 1;
  if (!Number.isFinite(scale) || scale <= 0) throw new Error(`Track '${track.id}' property scale must be positive`);
  const forward = {scale, tx: canvas.width * (1-scale)/2, ty: canvas.height * (1-scale)/2};
  return {forward, inverse: {scale: 1/scale, tx: -forward.tx/scale, ty: -forward.ty/scale}};
};
export const intrinsicMediaSize = (asset?: AssetRegistryEntry) => getIntrinsicMediaSize(asset?.resolution);
export const resolveClipPlacement = ({clip, track, canvas, intrinsic = {}}: {clip: TimelineClip; track: TrackDefinition; canvas: {width: number; height: number}; intrinsic?: {width?: number; height?: number}}) => {
  const fail = (property: string) => {throw new Error(`Clip '${clip.id}' property ${property} is invalid`);};
  if (clip.fit !== undefined && clip.fit !== 'contain' && clip.fit !== 'cover') fail('fit');
  if (track.fit !== undefined && !['contain','cover','manual'].includes(track.fit)) fail('track.fit');
  for (const key of ['x','y','width','height','cropTop','cropBottom','cropLeft','cropRight','opacity'] as const) {
    if (clip[key] !== undefined && !Number.isFinite(clip[key])) fail(key);
  }
  if (![canvas.width,canvas.height].every(v => Number.isFinite(v) && v > 0)) fail('canvas');
  const full = {x: clip.x ?? 0, y: clip.y ?? 0, width: clip.width ?? canvas.width, height: clip.height ?? canvas.height};
  if (full.width <= 0) fail('width'); if (full.height <= 0) fail('height');
  const fit = clip.fit ?? (track.fit === 'manual' ? 'cover' : track.fit) ?? 'contain';
  const crop = normalizeRenderCropValues(clip);
  const visible = getVisibleBoundsFromCrop(full, crop);
  const clipped = computeRenderBounds(visible, canvas.width, canvas.height);
  const iw = intrinsic.width && Number.isFinite(intrinsic.width) && intrinsic.width > 0 ? intrinsic.width : full.width;
  const ih = intrinsic.height && Number.isFinite(intrinsic.height) && intrinsic.height > 0 ? intrinsic.height : full.height;
  const factor = (fit === 'cover' ? Math.max : Math.min)(full.width/iw, full.height/ih);
  const media = {x: full.x + (full.width-iw*factor)/2, y: full.y+(full.height-ih*factor)/2, width: iw*factor, height: ih*factor};
  const transform = resolveTrackTransform(track, canvas);
  const output = {full: transformPlacementRect(full, transform.forward), visible: transformPlacementRect(visible, transform.forward), clip: transformPlacementRect(clipped, transform.forward), media: transformPlacementRect(media, transform.forward)};
  const provenance = {fit: clip.fit !== undefined ? 'clip' : track.fit !== undefined ? 'track' : 'default',
    ...Object.fromEntries((['x','y','width','height','cropTop','cropBottom','cropLeft','cropRight'] as const).map(k => [k, clip[k] !== undefined ? 'clip' : 'default'])),
    scale: track.scale !== undefined ? 'track' : 'default', clipOpacity: clip.opacity !== undefined ? 'clip' : 'default', trackOpacity: track.opacity !== undefined ? 'track' : 'default',
    intrinsicWidth: iw === intrinsic.width ? 'media' : 'default', intrinsicHeight: ih === intrinsic.height ? 'media' : 'default'};
  return {fit, crop, local: {full, visible, clip: clipped, media}, output: {...output, finalClip: computeRenderBounds(output.clip, canvas.width, canvas.height)}, transform, scale: transform.forward.scale, opacity: {clip: clip.opacity ?? 1, track: track.opacity ?? 1, product: (clip.opacity ?? 1)*(track.opacity ?? 1)}, provenance};
};
const geometry = ['x','y','width','height','cropTop','cropBottom','cropLeft','cropRight'] as const;
export const normalizeClipPlacement = (config: TimelineConfig): TimelineConfig => {
  const output = config.output as {resolution?: string} | undefined;
  const [w,h] = (output?.resolution ?? '').toLowerCase().split('x').map(Number);
  const canvas = {width: Number.isFinite(w) && w > 0 ? w : 1920, height: Number.isFinite(h) && h > 0 ? h : 1080};
  let clips = config.clips;
  const tracks = (config.tracks ?? []).map(track => {
    if (track.kind !== 'visual') return track;
    const version = track.app?.clipPlacementVersion;
    if (version !== undefined && version !== 1) throw new Error(`Track '${track.id}' property clipPlacementVersion is invalid`);
    const bake = track.app?.scaleAppliesToPositionedClips !== true;
    const transform = resolveTrackTransform(track, canvas);
    clips = clips.map(clip => {
      if (clip.track !== track.id) return clip;
      const positioned = geometry.some(k => clip[k] !== undefined);
      let result = clip;
      if (bake && positioned && transform.forward.scale !== 1) {
        const full = {x: clip.x ?? 0, y: clip.y ?? 0, width: clip.width ?? canvas.width, height: clip.height ?? canvas.height};
        const rect = transformPlacementRect(full, transform.inverse);
        const round = (v: number) => Math.round(v*100)/100;
        result = {...result, x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height)};
      }
      if (version === undefined && positioned && clip.fit === undefined) result = {...result, fit: 'cover'};
      return result;
    });
    return {...track, app: {...track.app, scaleAppliesToPositionedClips: true, clipPlacementVersion: 1}};
  });
  return {...config, tracks, clips};
};
