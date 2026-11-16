# @banodoco/timeline-composition

Version 0.0.18 ships built ESM and declarations for the timeline evaluator,
Remotion composition, theme API and default registries. Plain Node can import
`@banodoco/timeline-composition/evaluation` without React, Remotion or a TypeScript
loader. The renderer uses host peers React/React DOM 18.3.1 and
Remotion/media/layout-utils 4.0.509; those runtimes are never bundled.

Every build writes a root `source.json` containing the repository URL, full
source commit SHA and whether the checkout had tracked or untracked changes.
The file contains no build time, so the metadata is stable for a given checkout.
Release CI requires a clean checkout and checks the SHA against `GITHUB_SHA`.

The package owns text-card (including the `text` alias), six animations, two
transitions and four 2rp effects relocated from App. The bundled 2rp source is
**0.1.0**; equivalence to the separately referenced 0.1.1 theme is unverified.
Fonts, media and project pack admission remain host responsibilities. The
historically qualified 0.0.14 archive was 80 regular members, SHA-256
`21fde4d2a5d62a83f97a85d4b8d9f9d3f707a6489c07eb421c6331eccf893e6e`, from
source commit `df7b86308902fae90eda1dc3080d17d8fc30ea78`.

## Evaluator ownership and host adapters

The public pure evaluator is exported by `typescript/src/evaluation.ts`; its
scene implementation is `typescript/src/scene-evaluation.ts`, including
`prepareScene`, `querySceneFrame` and `querySceneOcclusion`. The React/Remotion
adapter is `typescript/src/TimelineComposition.tsx`. Host registry and theme
adaptation are the scoped seams in `typescript/src/registries.ts`,
`typescript/src/RegistryContext.tsx` and `typescript/src/theme-api.ts`. These
are legitimate adapters around the one evaluator, not second evaluators or
source loaders. Shared clip-look and render geometry live in
`typescript/src/lib/clip-look.ts` and `typescript/src/lib/render-bounds.ts`.

The external normal-route adapters remain host-owned: Agent's
`astrid/packs/rendering/rendering/renderers/remotion/root_preparation.py` and
`astrid/packs/rendering/shared/rendering_backend/__init__.py` consume admitted
inputs, while App's `src/tools/video-editor/compositions/TimelineRenderer.tsx`
supplies its preview projection. No vendored Composition source is a valid
adapter.

In 0.0.9, `ComponentCapabilityContext.assetEntry?: Readonly<AssetRegistryEntry>`
is the same selected entry passed to the rendered component, resolved by the
existing asset lookup. The context always owns this property: `undefined` means
no entry resolved (no asset or a missing reference). Older hosts may omit it,
which means selection is unknown. Selection alone proves no media alpha; it
does not fetch assets or change their authored registry.

## Scoped host elements

`TimelineComposition` accepts an optional `registries` prop. The same input is
the `registries` argument of `prepareCompositionScene`. Effects and aliases, animations
and their defaults/meta, and transitions and their defaults/meta use the public
`CompositionRegistries` contract from the root or `./registries` export.
Every supplied member is the host's **complete resolved map** for that category;
omitted members use bundled defaults. `resolveElementRegistries(theme, input)`
returns these maps, admitting core effects plus effects for the selected runtime
theme. Hosts resolve pack/theme precedence before passing the maps.

```tsx
import {
  TimelineComposition, resolveElementRegistries,
  type EffectProps, type RuntimeTheme,
} from '@banodoco/timeline-composition';

const Title = ({params}: EffectProps<{title: string}>) => <h1>{params.title}</h1>;
const registriesFor = (theme: RuntimeTheme) => ({
  effects: {...resolveElementRegistries(theme).effects, 'project-title': Title},
});
// <TimelineComposition {...input} registries={registriesFor(runtimeTheme)} />
```

Pass the same maps to scene preparation and rendering. A component's existing
`prepareSceneCapability` hook is used for both packaged and host effects;
undeclared internals, alpha and geometry remain unknown. Registry inputs never
assign module globals or modify installed files. Packaged effects' internal
animations and clip entrance/exit animations read the instance's scope. Hosts
mounting packaged components themselves can wrap them in `ElementRegistryProvider`
(and the shared `ThemeProvider`) from `./theme-api`. Pure animation helpers take
an optional registry input (`composeAnimations` takes it in its input object;
`normalizeAnimationReferences` and `resolveAnimationReferences` take it last).
Unknown animation/transition IDs and invalid animation phases still throw.

Animation metadata declares `supportsEasing: true` when the registered component
consumes explicit easing. The composer passes canonical `easing` and clamped,
eased `progress` over `elapsedFrames / durationFrames`, under any registered ID.
Components can use `easing` with their own timing window; bundled type-on owns
its `startFrame` / `durationFraction` reveal window. With no authored easing,
both props are undefined and bundled components retain their normal motion.
Omitted or false support refuses explicit easing. Supply the matching metadata
and defaults when overriding a registration; names confer no private behavior.
This declaration does not establish scene geometry, alpha or visibility.

```tsx
import type {AnimationRegistries, WrapperAnimationProps} from '@banodoco/timeline-composition/theme-api';

const Sweep = ({children, progress}: WrapperAnimationProps) => (
  <div style={{opacity: progress ?? 1}}>{children}</div>
);
const animations = {
  animations: {'project-sweep': Sweep},
  animationMeta: {'project-sweep': {kind: 'wrapper', phase: 'entrance', supportsEasing: true}},
  animationDefaults: {'project-sweep': {durationFrames: 20}},
} satisfies AnimationRegistries;
// composeAnimations({...input, refs: {id: 'project-sweep', easing: 'ease-in'}, registries: animations})
```

## Transitions

A clip's `transition` (on the clip that starts the boundary, i.e. the outgoing clip) joins it to the next clip on the same track. The next clip must start within one frame of the outgoing clip's end (or exactly at it); otherwise the transition is ignored and the boundary is a cut. A transition longer than either clip is also ignored.

- **Placement** is set by `align` on the transition object. `'end'` (the default, upstream's placement) puts the overlap window in the `T` frames before the boundary, so the incoming clip starts inside it. `'start'` puts it in the `T` frames after the boundary, and `'center'` centres it on the boundary.
- **Dissolve** (any id other than `fade`, e.g. `cross-fade`): the incoming clip ramps 0 to 1 over the window while the outgoing clip stays fully opaque underneath, so there is no hole in the frame.
- **Dip** (`fade`): the outgoing clip ramps 1 to 0 over the first half of the window, then the incoming clip ramps 0 to 1 over the second half. The background shows through at the midpoint, on purpose.
- **Extension frames**: a clip that is pulled into a window beyond its own span is drawn over the extra frames but shows itself frozen at its boundary frame, so its own timing never shifts. The outgoing clip is extended past its end; the incoming clip is extended back before its start.
- **Chains** (A to B to C): each boundary is planned independently. B is extended back for the A to B window and, if its own boundary to C runs past B's end, forward too. Each clip is drawn in track order, so later clips sit on top.

The planning is pure and lives in `typescript/src/lib/transition-spans.ts`.

For existing App films, each transition object can explicitly set
`incomingPolicy: 'preroll-crossfade'`. This one opt-in advances incoming content
from its draw origin throughout its half-open draw span and ramps incoming
opacity over the whole window, keeping the outgoing transition contribution at
1 even for `fade`. Omit it to retain the own-span clock and dip behavior above.
It is supported on resolved `TransitionSpec`, `declareAppTransition` input, and
renderer `TransitionReferenceObject` (`fade` or `cross-fade`). Unknown/custom
implementations do not acquire support through this flag. No clip fields are
rewritten, no endpoint is mounted, and the visual ramp never multiplies audio gain.

At 30 fps, incoming authored frames 90..120 with a 12-frame end-aligned window
start drawing at 78. With source trim 90..150 and speed 2, the opt-in supplies
source-clock input 102 at frame 84 and 114 at frame 90; the default supplies 90
at both frames. Source trim/end handling remains the media backend's responsibility.

Canonical parent/internal documents define `clip.transition` as incoming for every
producer. After resolving that document to projected tracks/clips, call
`compileCanonicalTransitions(tracks, fps, theme, registries?)` once. Pass its
serializable `CompiledCanonicalTransitions` result as the `compiledTransitions`
prop of `TimelineComposition` and as the last argument of
`prepareCompositionScene` (after `registries`). Both entry points consume the
same resolved per-clip declarations. Native `TimelineConfig` inputs omit this
compiler output and keep the outgoing behavior above. The compiler never
rewrites authored clips or selects a contract from aliases or occurrence metadata.

The canonical compiler supports registered `fade`, `crossfade` and `cross-fade`
with linear opacity. It includes first clips, gaps, overlaps and oversized
windows. For own start/duration S/D and rounded positive transition duration T,
P is T with a same-track predecessor, otherwise zero. The draw origin is
R=max(0,S−P) and the exclusive end is R+D+P, capped by existing admitted
`app.canonicalTiming.occurrenceStartMs + occurrenceDurationMs` when present.
Content advances from R; own frames remain clamped. The ramp is (frame−R)/T,
clamped to [0,1]; outgoing opacity and audio gain stay unchanged. Unsupported
implementations, parameters, conflicting policies and malformed durations fail
explicitly. No caller-selected ownership policy is needed.

Outgoing pair declarations cannot represent a transition on a lone first clip,
a nonadjacent gap/overlap or a transition longer than a clip. Their admission
and fit checks stay intact. The resolved compiler output therefore carries a
separate incoming vector, which `prepareTrack` accepts as its optional third
argument: one `{T}` or `null` per clip, with optional `ClipSpan.endCap` frame
bounds. The scene API exposes it as `SceneTrackInput.incomingTransitions`.
Incoming and outgoing vectors cannot both declare transitions.

## Pure planner API

Import `@banodoco/timeline-composition/evaluation` to prepare one visual track
and query individual frames without loading React, Remotion, theme components
or generated registries:

```ts
import {prepareTrack, queryTrackFrame} from '@banodoco/timeline-composition/evaluation';

const track = prepareTrack(
  [{start: 0, duration: 30}, {start: 30, duration: 30}],
  [{T: 10, kind: 'dissolve', align: 'end'}],
);
const at25 = queryTrackFrame(track, 25);
// {frame: 25, layers: [
//   {clipIndex: 0, drawLocalFrame: 25, ownFrame: 25, contentFrame: 25, opacity: 1},
//   {clipIndex: 1, drawLocalFrame: 5, ownFrame: 0, contentFrame: 0, opacity: 0.5},
// ]}
```

`prepareTrack(spans, transitions)` delegates to the existing `planTrack`. Inputs
are frame spans in track/painter order, with already resolved transition specs;
`transitions[i]` joins clip `i` to clip `i + 1`, and a missing/null entry is a cut.
The caller owns clip sorting, seconds-to-frames conversion, duration calculation
and theme transition resolution, as `TimelineComposition` does today. Prepare
again when these inputs change. The returned `plans` snapshot can be reused;
treat it and its nested plans as read-only.

`queryTrackFrame(track, frame)` accepts one finite track-absolute frame (including
fractional frames) and returns mounted layers in input order. Each layer retains
its input `clipIndex`. Mount intervals are `[drawStart, drawStart + drawDuration)`;
gaps and empty tracks return no layers. Mounted zero-opacity layers remain in
the answer. The result contains only the requested frame, with no film-length
enumeration or serialization. Preparation and each query scale with clip count,
not film duration; no cache is installed by this API.

`queryDrawFrame(plan, drawLocalFrame)` returns the same `drawLocalFrame`, clamped
`ownFrame`, content clock `contentFrame`, and transition `opacity` for a single plan. It does not filter by
mount interval: its caller supplies a frame inside the clip's draw Sequence.
`contentFrame` equals `ownFrame` by default. Opted-in incoming plans use the
nonnegative draw-local frame instead, before media playback rate or element
speed remapping. `TransitionLayer` freezes default extensions at this clock and
leaves opted-in incoming content advancing; scene component capabilities receive
the same clock after element speed remapping. `SceneLayer` also exposes
`contentFrame`. `TimelineComposition` uses the same prepared plans for its Sequences. The subpath also
exports the planner input/output types, including `ClipSpan`, `TransitionSpec`
and `DrawPlan`.

This API describes transition mounting and timing. Its opacity excludes
track opacity, clip fades, component opacity, transforms, bounds, pixel coverage
and occlusion. It does not establish rendered visibility. Component internals
and coverage remain unknown here. Renderer-owner/Python caching and consumers,
coverage findings, and App Player integration are separate work.

## Scene occlusion and declared diagnostics

`prepareCompositionScene` admits the selected component hooks; `querySceneFrame`
evaluates each mounted component once at its speed-remapped content clock. The
answer includes canvas `width`/`height` and layers in bottom-to-top painter order
(within a track, the same draw order as rendering; `z=0` is frontmost).

Root and `./evaluation` export
`querySceneOcclusion(answer: SceneFrame, clipId: string, minimumFraction: number)`:

```ts
type SceneOcclusion =
  | {status: 'known'; occluderId: string | null; fraction: number}
  | {status: 'unknown'; reason: string};
```

It reads an existing frame answer, without invoking hooks again, and shares the
canonical visibility pass. Supply a finite threshold in `(0, 1]`, such as `.90`
or `.98`. It names the frontmost qualifying **single** upper layer whose admitted
support is an opaque rectangle at opacity exactly 1. Fraction is intersection
area divided by the target's **canvas-clipped output rectangle** area, in canvas
units. This is rectangular support overlap, not pixel coverage of glyphs, holes,
or media alpha. Partial offscreen target area is excluded from the denominator.
It never unions upper layers or accumulates translucent alpha.

Known no qualifying upper layer returns `known/null/0`, including when all known
overlaps fall below the threshold. Undeclared upper bounds/alpha remain unknown
unless known geometry rules out the threshold or a proven qualifying upper
layer exists. Glyph/layout support (`none`) cannot establish an opaque rectangle;
an overlapping glyph can leave the answer unknown. Missing/unmounted, declared
absent, zero-opacity, zero-area and wholly offscreen targets return `known/null/0`;
unknown target output bounds return unknown. `visible=false` alone is never an
occlusion explanation. Visibility uses the same support calculation at threshold
1; fraction thresholds remain consumer check policy.

The existing `PreparedComponentCapability.frame(contentFrame)` may return
`diagnostics?: ComponentDiagnostics`, forwarded to `SceneLayer.diagnostics`:

```ts
type ComponentDiagnostics = {
  motion?: Readonly<Record<string, number>>;
  face?: ModifierBounds;
  mouth?: ModifierBounds;
  text?: {bounds: ModifierBounds; minPx?: number};
};
```

Each omitted field is unknown, never static motion or an empty region. Motion
contains component-owned intrinsic scalars with component-defined names/units;
it does not assert final positions or visibility. Face/mouth/text regions are
declared canvas rectangles at that callback clock, using the same pure helpers
as drawing. Text bounds describe declared layout, not glyph alpha; `minPx` is
the component's minimum drawn font size in canvas pixels. Real measured glyph
bounds still require the actual admitted fonts. No type name or font string
produces geometry. These declarations do not establish opaque support.

Semantic regions and `minPx` become unknown for undeclared animation/crop or
modifier geometry. Even a bounds-preserving modifier does not establish internal
region positions or text scale, so all modified semantic regions conservatively
become unknown. Intrinsic motion remains available. Nonfinite motion/size values
are omitted, invalid rectangles become unknown, and the layer reports
`invalid-component-diagnostics`; diagnostic validation does not change visibility.
No hook means no diagnostic field. These optional facts add no support to an
uninstrumented component: AM/Personal owners still need real render helpers,
admitted fonts/media and component tests before private viewer retirement.

## Transition authoring admission

The evaluation subpath also exports `declareAppTransition` and
`prepareDeclaredTrack`. These are explicit authoring admission calls; existing
renderer callers continue to use `prepareTrack` with legacy semantics.

```ts
import {declareAppTransition, prepareDeclaredTrack} from '@banodoco/timeline-composition/evaluation';

const host = 'timeline-composition';
const declaration = declareAppTransition(
  'visual', 'a', {type: 'crossfade', duration: 0.3, params: {easing: 'linear'}}, 30, host,
);
const admitted = prepareDeclaredTrack('visual', [
  {id: 'a', start: 0, duration: 30},
  {id: 'b', start: 30, duration: 30},
], [declaration], host);
```

A declaration names one outgoing clip on one track, the supported host and
implementation, resolved frame spec, and preserved App params. App duration is
in seconds and rounds once to frames. `crossfade` maps to `cross-fade`
(dissolve); `fade` maps to dip. Other implementations or hosts throw
`TransitionAdmissionError` with a `code` and actionable `nextStep`.

Admission requires ordered, non-overlapping own clip spans; gaps are valid.
Duplicate owners, cross-track owners and owners without a successor are refused.
Admission never sorts, moves, trims or repairs clips. After validation it calls
the existing planner, including its cut behavior for gaps and transition lengths
that do not fit. Planner draw extensions may overlap by design. Params are
preserved as declaration data; this pure API does not execute custom components.
This API does not wire the App editor or change legacy rendering automatically.

## Speed

`clip.speed` is a playback rate, and the clip's length is its hold divided by `speed` (speed 2 halves the length).

- **Media clips** (`VisualClip`, `AudioTrack`) apply `speed` as `playbackRate` on the media itself, so the footage plays faster or slower.
- **Element clips** do not use `playbackRate`. The element sees `useCurrentFrame() = floor(local × speed)`, so speed 2 plays its animation twice as fast in half the length, and speed 0.5 plays it at half speed over twice the length. The entrance and exit windows stay in timeline frames, as before.
- A footage element (`am-footage`) reads the current frame for its video, so it plays at the clip's speed with no element change. An element must not set `playbackRate` itself, or the speed would apply twice.
- Invalid speeds (not a finite number above 0) act as 1.

The element remap is a `<Freeze>` around the element content, applied in `ClipLook.tsx`. The sanitising and frame math is pure and lives in `typescript/src/lib/clip-look.ts` (`clipSpeed`, `remappedFrame`).

## Media clock helpers

The public `./evaluation` entry exports the existing pure media clock helpers:

```ts
import {
  computeMediaTrim,
  getSanitizedPlaybackRate,
} from '@banodoco/timeline-composition/evaluation';

const trim = computeMediaTrim({from: 0.5, to: 1.5}, 30);
// {trimBefore: 15, trimAfter: 45}
const rate = getSanitizedPlaybackRate(2);
// 2
```

`computeMediaTrim` rounds source seconds to frames with `Math.round`, clamps a
negative or invalid `from` to zero, and includes `trimAfter` only when `to` is
strictly greater than the effective start. `getSanitizedPlaybackRate` returns
the finite positive speed unchanged and otherwise returns `1`. These helpers
are the same functions used by the media renderers; the public export does not
change their math or behavior.

## Viewing integration route

Composition is the one evaluator for the supplied scene; it is not a source
loader, Runtime admission service, save path, or authority store. The normal
host route is source-bound:

1. The Agent host obtains the accepted or candidate timeline and asset closure
   through `inherited_source(timeline_path, assets_path)`, the existing
   verified-source path. It does not mint source identity from package metadata
   or a stale snapshot.
2. For the normal Main imported-theme route, Runtime's imported `theme.json`
   descriptor is admitted as the existing `theme` input; Agent's
   `astrid/core/execution/generic_host.py` materializes it,
   `_resolved_theme_for_render()` in
   `astrid/packs/rendering/shared/rendering_backend/__init__.py` resolves it,
   and the result becomes `merged_props["theme"]`. The route is
   `media.import_file`/CAS descriptor -> `inputs.theme` -> GenericHost ->
   existing resolver -> Root props. A theme slug alone is not a Theme
   document and must not trigger checkout lookup. App's selected-theme
   authority is `src/tools/video-editor/compositions/installed-themes.ts`,
   with the existing render payload assembly in
   `src/tools/video-editor/lib/renderRouter.ts`.
3. The existing `_prepared_remotion_root` materializes that source and passes
   its compiled tracks, assets, resolved theme/registries, canvas and rational
   frame rate to `prepareCompositionScene`.
4. Root rendering and `querySceneFrame` queries use that same prepared scene. A
   private advisory `scene_only` request may write the existing
   `filmstrip_bundle` entrypoint (`scene-answers.json`); it does not render PNGs
   or create a new public route.

The advisory Scene result is usable only when its source-bound label, complete
frame extent, and compiled clip map validate before and after the query. A
missing, stale, forged, or malformed source is `UNAVAILABLE`: its
`snapshot_label.status` is `unavailable`, its label is `revision unavailable`,
and both `answers` and `scene_clips` are empty. Empty answers are not a
successful empty scene, and the advisory result must not block save or rewrite
authored data.

Saving is renderer-free. Commit, reload, retry, rebase, undo, and history
acceptance must work with Node, Root, and the renderer stopped. Preview and
Scene availability are separate reports.

Owner-film inspection remains deliberately bounded. `VW-D09b`/`VW-D09c` are
deferred solely for heavy proof: the private `model.mouth_box` fallback and
legacy PNG crop selection remain, along with their existing statistics and
strict thresholds. The retained partial case is not equivalent to the
explicit case (697 vs 799 pixels; padding ratios 16/697 vs 16/799, both above
0.02, with 15 vs 16 strict threshold crossings), and the
387-pixel erase control remains separate. `InspectionMouth` is not in 0.0.14;
no public geometry/crop field, fallback retirement, or statistic rewrite is
implied by this package.

## Build, package and verify

Release CI builds and tests the source, packs the artifact, writes a SHA-256
checksum, and verifies that the archive contains `package/source.json`. The
metadata records its source commit and dirty state. The 0.0.14 and 0.0.13
archives below remain historical qualification evidence, not current setup
instructions.

The canonical checks from the real Composition root are:

```sh
npm ci
make build
make test
npm pack
```

`make build` runs registry-drift checks, strict TypeScript/declaration checks,
and the ESM build; `make test` runs the repository suite. The package smoke
receives the path of the artifact under test and checks public Node imports,
scoped registration/capabilities, peer identity, declarations and installed
file immutability. It does not prove browser pixels, Player audio, or film
parity.

Every production, declaration, and test build regenerates the internal
`typescript/src/lib/remotion-primitives.generated.js` module with esbuild from
the installed Remotion spring/interpolate dependency leaves. Resolution uses
Remotion's exported `package.json` and requires exactly `4.0.509`. The module
is ignored build output, contains no runtime peer imports, and is removed before
resolution so failed or missing inputs cannot reuse an older calculation.
Test compilation copies the current module beside the emitted helpers;
production bundles it into the ESM graph. `make clean` removes these outputs.

`npm run test:package -- /absolute/path/to/artifact.tgz` installs that actual
artifact and exact peers in a fresh temporary consumer. It checks plain Node
imports of every public entry, the evaluator's peer-free import graph, bundled
resource-card rendering, scoped host registration/capabilities, shared
ThemeProvider and React/Remotion identity, NodeNext declaration consumption,
installed-file immutability and dependency deduplication. It removes its temporary
consumer on exit. The declaration probe uses `skipLibCheck` for upstream Remotion
4 declarations (which reference the legacy global `Timer`); the package source
itself receives the strict build check using the existing Timer compatibility
interface. This smoke does not prove browser pixels, Player audio or film parity.

Registry generation uses only `scripts/builtin-inputs.json` and the listed local
components/defaults/meta under `typescript/src/builtins`. `npm run gen-registry`
updates checked-in generated source; `gen-registry:check` refuses drift in any of
the five files. Installed themes and neighboring workspaces cannot affect this
output. Optional host discovery/generation stays in the host and supplies maps
through the same scoped input.

Release14's duration surface is intentionally generic over any object carrying
the required clip list: `getTimelineDurationInFrames<T extends
Pick<TimelineConfig, "clips">>(timeline: T, fps: number): number`, implemented
in `typescript/src/lib/duration.ts`. The duration body is unchanged; full
timeline configs and narrower clip-bearing callers remain valid.

The public ESM/declaration exports are `.`, `./evaluation`, `./theme-api`,
`./registries`, `./registry.generated`, `./effects.generated`,
`./animations.generated`, `./transitions.generated` and `./package.json`.
There are no source/deep-path or CommonJS exports and no npm schema or separately
installed theme dependency.

Focused checks for the packaging/registry change:

```sh
npm run build:test
node --import ./typescript/tests/register-extensionless.mjs --test \
  typescript/test-dist/tests/registries.test.js \
  typescript/test-dist/tests/animations.test.js \
  typescript/test-dist/tests/scene-evaluation.test.js scripts/gen-registry.test.mjs
```

`npm test` is equivalent to `make test`; orchestration workers request full
suites through the central test service. Consumer migrations, existing-film
comparison and real Player/export frame/audio parity remain separate integration
gates. The historical 0.0.11/0.0.12 package records remain historical; they are
not setup instructions for the current route.

## Historical 0.0.14 qualification record

The last previously qualified package source was Composition commit
`df7b86308902fae90eda1dc3080d17d8fc30ea78`, tree
`71d8e95edb1bb2d187c3193ef3462d4cfde277fa`, published as 0.0.14. Its source
full suite recorded 85 passed, zero failed/skipped, and the exact package smoke
passed plain Node ESM/SSR, peer identity, scoped host capability, strict
NodeNext declarations and installed-file integrity. Version 0.0.18 requires
its own CI qualification; this historical result does not qualify it or
consumer adoption.

At the time of that qualification, Physical Gate 6 was **OPEN**. The corrected
readiness/physical attempt failed before all five comparison bodies: 0
executed, 5 not run, and no media was produced. This historical status does
not describe the current release candidate.

The 0.0.14 record also listed Agent/App consumer pin and route journey
evidence, whole-project ZIP application to fresh main, and owner-film viewing
as unrun. Those were release-specific follow-ups, not status claims for 0.0.18.
Scanner108 payload `204a` and `instructions969` were immutable inputs to that
historical qualification.

## Keyframe origin

`clip.keyframeOrigin` is key-time zero in **seconds relative to the clip's
start on the timeline**. Zero means clip start. It is independent of media
`from`/`to` and playback `speed`; trimming changes source sampling, never this
origin or authored keys. Keys retain their payload units (App seconds, sprite
frames). For a declared origin `o`, App key time at timeline second `t` is
`t - (clip.at + o)`; sprite key frame at own local frame `f` is `f - o * fps`.
The sprite then applies its existing step quantization and held-pose selection.
Default transition extensions use the evaluator's existing clamped own frame;
the explicit incoming policy uses its advancing content clock.

The pure `./evaluation` and component `./theme-api` subpaths expose
`timelineKeyframeTime`, `spriteKeyframeFrame` and `declareKeyframeOrigin`.
`declareKeyframeOrigin(clip, 'app-seconds')` stamps legacy origin `-clip.at`;
`'sprite-frames'` stamps zero. Both preserve keys without conversion, rounding or
mutation, and preserve an already declared origin. Missing origins keep each
legacy consumer's existing domain. New clip-local seconds keys use origin zero.
A later timeline move carries a declared origin with its clip. An undeclared App
clip retains the old absolute-timeline behavior. This contract is available to
component consumers; it introduces no easing, loops or modifiers.
