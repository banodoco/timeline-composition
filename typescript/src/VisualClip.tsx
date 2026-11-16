import type {CSSProperties, FC} from 'react';
import {Img, staticFile, useVideoConfig} from 'remotion';
import {Video} from '@remotion/media';
import type {AssetRegistryEntry, TimelineClip, TrackDefinition} from './types';
import {
  getSanitizedPlaybackRate,
  getSanitizedVolume,
} from './lib/duration';
import {intrinsicMediaSize, resolveClipPlacement} from './lib/placement';
import {useFadeOpacity} from './lib/fade';
import {computeMediaTrim} from './lib/trim';

type VisualClipProps = {
  clip: TimelineClip;
  track: TrackDefinition;
  assetEntry?: AssetRegistryEntry;
  fps: number;
  applyOpacity?: boolean;
};

const toRenderableFileUrl = (file: string | undefined): string | null => {
  if (typeof file !== 'string' || file.trim().length === 0) {
    return null;
  }

  if (file.startsWith('http://') || file.startsWith('https://')) {
    return file;
  }

  return staticFile(file);
};

export const VisualClip: FC<VisualClipProps> = ({clip, track, assetEntry, fps, applyOpacity = true}) => {
  const {width: compositionWidth, height: compositionHeight} = useVideoConfig();
  const fileUrl = toRenderableFileUrl(assetEntry?.file);
  if (!fileUrl || !assetEntry) {
    return null;
  }

  const effectiveVolume = track.muted
    ? 0
    : getSanitizedVolume(track.volume ?? 1) * getSanitizedVolume(clip.volume ?? 1);
  const fadedOpacity = useFadeOpacity(clip, fps) * (clip.opacity ?? 1);
  const opacity = applyOpacity ? fadedOpacity : undefined;
  const isImage = assetEntry.type?.startsWith('image');
  const intrinsic = intrinsicMediaSize(assetEntry);
  if (![intrinsic.width, intrinsic.height].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error(`Clip '${clip.id}' asset '${clip.asset ?? '(unknown)'}' property resolution is missing or invalid; record the media resolution before rendering`);
  }
  const placement = resolveClipPlacement({clip, track, canvas: {width: compositionWidth, height: compositionHeight}, intrinsic});
  const {clip: viewport, media} = placement.local;
  if (viewport.width <= 0 || viewport.height <= 0) return null;

  const outerStyle: CSSProperties = {
    position: 'absolute',
    left: viewport.x,
    top: viewport.y,
    width: viewport.width,
    height: viewport.height,
    overflow: 'hidden',
    opacity,
  };
  const innerStyle: CSSProperties = {
    position: 'absolute',
    left: media.x - viewport.x,
    top: media.y - viewport.y,
    width: media.width,
    height: media.height,
    maxWidth: 'none',
    maxHeight: 'none',
    mixBlendMode: track.blendMode && track.blendMode !== 'normal' ? track.blendMode : undefined,
  };

  if (isImage) {
    return (
      <div style={outerStyle}>
        <Img src={fileUrl} style={innerStyle} crossOrigin="anonymous" />
      </div>
    );
  }

  return (
    <div style={outerStyle}>
      <Video
        src={fileUrl}
        {...computeMediaTrim(clip, fps)}
        playbackRate={getSanitizedPlaybackRate(clip.speed)}
        volume={effectiveVolume}
        muted={effectiveVolume <= 0}
        style={innerStyle}
      />
    </div>
  );
};
