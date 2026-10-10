# @banodoco/timeline-composition

Scaffold (Sprint 4). The eventual home of:

- `HypeComposition.tsx` and the rest of the Remotion composition.
- `EFFECT_REGISTRY` / `TRANSITION_REGISTRY` dispatch.
- The stable theme public API.

Sprint 4 ships **only the scaffold** plus the `./theme-api` sub-path —
re-exports of `effects.types`, `lib/animations`, and `ThemeContext` from
the in-tree `tools/remotion/src/` location. Theme components migrate off
the deep relative imports onto `@banodoco/timeline-composition/theme-api`
via the codemod at `tools/scripts/codemod-theme-api-imports.ts`.

The actual composition extraction lands in Sprint 5 (Phase 4d).

## Transitions

A clip's `transition` (on the clip that starts the boundary, i.e. the outgoing clip) joins it to the next clip on the same track. The next clip must start within one frame of the outgoing clip's end (or exactly at it); otherwise the transition is ignored and the boundary is a cut. A transition longer than either clip is also ignored.

- **Placement** is set by `align` on the transition object. `'end'` (the default, upstream's placement) puts the overlap window in the `T` frames before the boundary, so the incoming clip starts inside it. `'start'` puts it in the `T` frames after the boundary, and `'center'` centres it on the boundary.
- **Dissolve** (any id other than `fade`, e.g. `cross-fade`): the incoming clip ramps 0 to 1 over the window while the outgoing clip stays fully opaque underneath, so there is no hole in the frame.
- **Dip** (`fade`): the outgoing clip ramps 1 to 0 over the first half of the window, then the incoming clip ramps 0 to 1 over the second half. The background shows through at the midpoint, on purpose.
- **Extension frames**: a clip that is pulled into a window beyond its own span is drawn over the extra frames but shows itself frozen at its boundary frame, so its own timing never shifts. The outgoing clip is extended past its end; the incoming clip is extended back before its start.
- **Chains** (A to B to C): each boundary is planned independently. B is extended back for the A to B window and, if its own boundary to C runs past B's end, forward too. Each clip is drawn in track order, so later clips sit on top.

The planning is pure and lives in `typescript/src/lib/transition-spans.ts`.

## Build / test

```
cd packages/timeline-composition
npm install
npm run build
npm test
```
