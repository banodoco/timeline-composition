import type {ReactElement, ReactNode} from 'react';
import {AbsoluteFill, Freeze, useCurrentFrame} from 'remotion';
import {layerOpacity, ownFrame, type DrawPlan} from './lib/transition-spans';

// Wraps one clip's content inside its draw Sequence. Frames here are draw-local.
// Extension frames (added by a transition) show the clip frozen at its boundary
// frame; opacity applies the transition ramp.
export const TransitionLayer = ({
  plan,
  children,
}: {
  plan: DrawPlan;
  children: ReactNode;
}): ReactElement => {
  const frame = useCurrentFrame();
  const extended = plan.drawDuration > plan.ownDuration;
  const body = extended
    ? <Freeze frame={ownFrame(plan, frame)}>{children}</Freeze>
    : children;

  // Decided per plan, not per frame, so the wrapper does not mount and unmount
  // (and remount media) when a ramp reaches 1.
  if (!plan.fadeIn && !plan.fadeOut) {
    return <>{body}</>;
  }
  return (
    <AbsoluteFill style={{opacity: layerOpacity(plan, frame)}}>
      {body}
    </AbsoluteFill>
  );
};
