import type { TimelineClip, TrackDefinition, TimelineConfig, AssetRegistryEntry } from '../types';
import { computeRenderBounds, getIntrinsicMediaSize, getVisibleBoundsFromCrop, normalizeRenderCropValues, type RenderBounds } from './render-bounds';
export type PlacementClip = Pick<TimelineClip, 'id' | 'x' | 'y' | 'width' | 'height' | 'cropTop' | 'cropBottom' | 'cropLeft' | 'cropRight' | 'fit' | 'opacity'>;
export type PlacementTrack = Pick<TrackDefinition, 'id' | 'fit' | 'scale' | 'opacity'>;
export type PlacementInput = {
    clip: PlacementClip;
    track: PlacementTrack;
    canvas: {
        width: number;
        height: number;
    };
    intrinsic: {
        width: number;
        height: number;
    };
};
export type PlacementTransform = {
    scale: number;
    tx: number;
    ty: number;
};
export const transformPlacementPoint = (p: {
    x: number;
    y: number;
}, t: PlacementTransform) => ({ x: p.x * t.scale + t.tx, y: p.y * t.scale + t.ty });
export const transformPlacementRect = (r: RenderBounds, t: PlacementTransform): RenderBounds => ({ ...transformPlacementPoint(r, t), width: r.width * t.scale, height: r.height * t.scale });
export const resolveTrackTransform = (track: PlacementTrack, canvas: {
    width: number;
    height: number;
}) => {
    const scale = track.scale ?? 1;
    if (!Number.isFinite(scale) || scale <= 0)
        throw new Error(`Track '${track.id}' property scale must be positive`);
    const forward = { scale, tx: canvas.width * (1 - scale) / 2, ty: canvas.height * (1 - scale) / 2 };
    return { forward, inverse: { scale: 1 / scale, tx: -forward.tx / scale, ty: -forward.ty / scale } };
};
export const intrinsicMediaSize = (asset?: AssetRegistryEntry) => {
    const size = getIntrinsicMediaSize(asset?.resolution);
    return { width: size.width ?? NaN, height: size.height ?? NaN };
};
export const resolveClipPlacement = ({ clip, track, canvas, intrinsic }: PlacementInput) => {
    const fail = (property: string) => {
        throw new Error(`Clip '${clip.id}' property ${property} is invalid`);
    };
    if (clip.fit !== undefined && clip.fit !== 'contain' && clip.fit !== 'cover')
        fail('fit');
    if (track.fit !== undefined && !['contain', 'cover', 'manual'].includes(track.fit))
        fail('track.fit');
    for (const key of ['x', 'y', 'width', 'height', 'cropTop', 'cropBottom', 'cropLeft', 'cropRight', 'opacity'] as const) {
        if (clip[key] !== undefined && !Number.isFinite(clip[key]))
            fail(key);
    }
    if (clip.opacity !== undefined && (clip.opacity < 0 || clip.opacity > 1))
        fail('opacity');
    if (track.scale !== undefined && (!Number.isFinite(track.scale) || track.scale <= 0))
        fail('track.scale');
    if (track.opacity !== undefined && (!Number.isFinite(track.opacity) || track.opacity < 0 || track.opacity > 1))
        fail('track.opacity');
    if (![canvas.width, canvas.height].every(v => Number.isFinite(v) && v > 0))
        fail('canvas');
    const full = { x: clip.x ?? 0, y: clip.y ?? 0, width: clip.width ?? canvas.width, height: clip.height ?? canvas.height };
    if (full.width <= 0)
        fail('width');
    if (full.height <= 0)
        fail('height');
    const fit = clip.fit ?? (track.fit === 'manual' ? 'cover' : track.fit) ?? 'contain';
    const crop = normalizeRenderCropValues(clip);
    const visible = getVisibleBoundsFromCrop(full, crop);
    const clipped = computeRenderBounds(visible, canvas.width, canvas.height);
    if (!intrinsic || !Number.isFinite(intrinsic.width) || intrinsic.width <= 0 || !Number.isFinite(intrinsic.height) || intrinsic.height <= 0)
        fail('asset.resolution / intrinsic');
    const iw = intrinsic.width, ih = intrinsic.height;
    const factor = (fit === 'cover' ? Math.max : Math.min)(full.width / iw, full.height / ih);
    const media = { x: full.x + (full.width - iw * factor) / 2, y: full.y + (full.height - ih * factor) / 2, width: iw * factor, height: ih * factor };
    const intersect = (a: RenderBounds, b: RenderBounds): RenderBounds => {
        const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
        return { x, y, width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x), height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y) };
    };
    const content = intersect(clipped, media);
    const transform = resolveTrackTransform(track, canvas);
    const output = { full: transformPlacementRect(full, transform.forward), visible: transformPlacementRect(visible, transform.forward), clip: transformPlacementRect(clipped, transform.forward), media: transformPlacementRect(media, transform.forward) };
    const provenance = { fit: clip.fit !== undefined ? 'clip' : track.fit !== undefined ? 'track' : 'default',
        ...Object.fromEntries((['x', 'y', 'width', 'height', 'cropTop', 'cropBottom', 'cropLeft', 'cropRight'] as const).map(k => [k, clip[k] !== undefined ? 'clip' : 'default'])),
        scale: track.scale !== undefined ? 'track' : 'default', clipOpacity: clip.opacity !== undefined ? 'clip' : 'default', trackOpacity: track.opacity !== undefined ? 'track' : 'default',
        intrinsicWidth: iw === intrinsic.width ? 'media' : 'default', intrinsicHeight: ih === intrinsic.height ? 'media' : 'default' };
    const finalClip = computeRenderBounds(output.clip, canvas.width, canvas.height);
    return { fit, crop, local: { full, visible, clip: clipped, media, content }, output: { ...output, finalClip, content: intersect(finalClip, output.media) }, transform, scale: transform.forward.scale, opacity: { clip: clip.opacity ?? 1, track: track.opacity ?? 1, product: (clip.opacity ?? 1) * (track.opacity ?? 1) }, provenance };
};
const geometry = ['x', 'y', 'width', 'height', 'cropTop', 'cropBottom', 'cropLeft', 'cropRight'] as const;
export type PlacementMigrationFinding = {
    trackId?: string;
    clipId?: string;
    kind: 'scale-bake' | 'explicit-fit' | 'markers' | 'canvas';
    source?: string;
    before?: unknown;
    after?: unknown;
    markerCount?: number;
};
export const normalizeClipPlacementWithFindings = (config: TimelineConfig): {
    config: TimelineConfig;
    findings: PlacementMigrationFinding[];
} => {
    const findings: PlacementMigrationFinding[] = [];
    let output = config.output as {resolution?: string; fps?: number; file?: string; [key: string]: unknown} | undefined;
    const overrides = config.theme_overrides as {visual?: {canvas?: unknown}} | undefined;
    const authoredCanvas = overrides?.visual?.canvas;
    if (output?.resolution === undefined && authoredCanvas !== undefined) {
        if (!authoredCanvas || typeof authoredCanvas !== 'object' || Array.isArray(authoredCanvas)) {
            throw new Error('Timeline property theme_overrides.visual.canvas must contain positive width, height and fps');
        }
        const source = authoredCanvas as {width?: unknown; height?: unknown; fps?: unknown};
        if (!Number.isSafeInteger(source.width) || (source.width as number) <= 0 || !Number.isSafeInteger(source.height) || (source.height as number) <= 0 || typeof source.fps !== 'number' || !Number.isFinite(source.fps) || source.fps <= 0) {
            throw new Error('Timeline property theme_overrides.visual.canvas must contain positive integer width and height and positive fps');
        }
        if (output?.fps !== undefined && output.fps !== source.fps) {
            throw new Error('Timeline property output.fps disagrees with theme_overrides.visual.canvas.fps');
        }
        const before = output;
        output = {...output, resolution: `${source.width}x${source.height}`, fps: output?.fps ?? source.fps, file: output?.file ?? 'output.mp4'};
        findings.push({kind:'canvas', source:'theme_overrides.visual.canvas', before, after:output});
    }
    const [w, h] = (output?.resolution ?? '').toLowerCase().split('x').map(Number);
    const hasCanvas = Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0 && /^\d+x\d+$/i.test(output?.resolution ?? '');
    const visualIds = new Set((config.tracks ?? []).filter(track => track.kind === 'visual').map(track => track.id));
    if (!hasCanvas && config.clips.some(clip => visualIds.has(clip.track) && !!clip.asset))
        throw new Error('Timeline property output.resolution is required for visual media');
    const canvas = { width: w, height: h };
    let clips = config.clips;
    const tracks = (config.tracks ?? []).map(track => {
        const version = track.app?.clipPlacementVersion;
        if (version !== undefined && version !== 1)
            throw new Error(`Track '${track.id}' property clipPlacementVersion is invalid`);
        const bake = track.app?.scaleAppliesToPositionedClips !== true;
        const needsBake = track.kind === 'visual' && bake && (track.scale ?? 1) !== 1 && clips.some(clip => clip.track === track.id && geometry.some(k => clip[k] !== undefined));
        if (needsBake && !hasCanvas)
            throw new Error(`Track '${track.id}' property output.resolution is required for scale migration`);
        const transform = resolveTrackTransform(track, hasCanvas ? canvas : { width: 0, height: 0 });
        clips = clips.map(clip => {
            if (track.kind !== 'visual' || clip.track !== track.id)
                return clip;
            const positioned = geometry.some(k => clip[k] !== undefined);
            let result = clip;
            if (bake && positioned && transform.forward.scale !== 1) {
                const full = { x: clip.x ?? 0, y: clip.y ?? 0, width: clip.width ?? canvas.width, height: clip.height ?? canvas.height };
                const rect = transformPlacementRect(full, transform.inverse);
                const round = (v: number) => Math.round(v * 100) / 100;
                result = { ...result, x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height) };
                findings.push({ trackId: track.id, clipId: clip.id, kind: 'scale-bake', before: full, after: { x: result.x, y: result.y, width: result.width, height: result.height } });
            }
            if (version === undefined && positioned && clip.fit === undefined && (!clip.clipType || ['media', 'image', 'video', 'hold'].includes(clip.clipType))) {
                result = { ...result, fit: 'cover' };
                findings.push({ trackId: track.id, clipId: clip.id, kind: 'explicit-fit', after: 'cover' });
            }
            return result;
        });
        const markerCount = Number(bake) + Number(version === undefined);
        if (markerCount)
            findings.push({ trackId: track.id, kind: 'markers', markerCount });
        return { ...track, app: { ...track.app, scaleAppliesToPositionedClips: true, clipPlacementVersion: 1 } };
    });
    return { config: { ...config, ...(output !== config.output ? {output} : {}), tracks, clips }, findings };
};
export const normalizeClipPlacement = (config: TimelineConfig): TimelineConfig => normalizeClipPlacementWithFindings(config).config;
