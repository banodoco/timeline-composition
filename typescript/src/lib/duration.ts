import type {TimelineClip, TimelineConfig} from '../types';

export const secondsToFrames = (seconds: number, fps: number): number => {
  return Math.round(seconds * fps);
};

export const getClipSourceDuration = (clip: TimelineClip): number => {
  if (typeof clip.hold === 'number') {
    return clip.hold;
  }

  return (clip.to ?? 0) - (clip.from ?? 0);
};

export const getClipTimelineDuration = (clip: TimelineClip): number => {
  const speed = getSanitizedPlaybackRate(clip.speed);
  return getClipSourceDuration(clip) / speed;
};

export const getSanitizedPlaybackRate = (speed: TimelineClip['speed']): number => {
  return typeof speed === 'number' && Number.isFinite(speed) && speed > 0 ? speed : 1;
};

export const getSanitizedVolume = (volume: number | undefined, fallback = 1): number => {
  return typeof volume === 'number' && Number.isFinite(volume)
    ? Math.max(0, volume)
    : fallback;
};

export const getClipDurationInFrames = (clip: TimelineClip, fps: number): number => {
  return Math.max(1, secondsToFrames(getClipTimelineDuration(clip), fps));
};

export const getTimelineDurationInFrames = <T extends Pick<TimelineConfig, 'clips'>>(
  timeline: T, fps: number): number => {
  return Math.max(
    1,
    ...timeline.clips.map((clip) => {
      return secondsToFrames(clip.at, fps) + getClipDurationInFrames(clip, fps);
    }),
  );
};
