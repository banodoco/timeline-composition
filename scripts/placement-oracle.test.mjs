import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {test} from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Internals} from 'remotion';

const SOURCE_COMMIT = '14628ad5dee19e7a456b060426a4c8cbf4446ebc';
const node = process.execPath;

const git = (cwd, ...args) => execFileSync('git', args, {cwd, encoding: 'utf8'}).trim();
// Keep source out of the test harness: each side is archived from its commit,
// built in a temporary directory, and shares only the repository's locked deps.
const buildBaseline = (repo, revision, root, dependencyDirectory) => {
  const destination = path.join(root, 'source-0.0.17');
  const archivePath = path.join(root, `${path.basename(destination)}.tar`);
  mkdirSync(destination);
  const fd = execFileSync('git', ['archive', '--format=tar', revision], {cwd: repo});
  writeFileSync(archivePath, fd);
  execFileSync('tar', ['-xf', archivePath, '-C', destination], {cwd: root});
  symlinkSync(dependencyDirectory, path.join(destination, 'node_modules'), 'dir');
  execFileSync(node, ['scripts/build.mjs'], {cwd: destination, stdio: 'inherit'});
  return path.join(destination, 'dist', 'index.js');
};

const publicResults = async (entry) => {
  const api = await import(pathToFileURL(entry));
  const width = 1280;
  const height = 720;
  // The image decoder path shares VisualClip's layout/geometry implementation
  // and avoids requiring a Player media session just to inspect the rendered DOM.
  const asset = {file: 'https://example.test/matrix.png', type: 'image/png', resolution: '1920x800'};
  const assets = {assets: {matrix: asset}};
  const baseTrack = {id: 'v1', kind: 'visual', label: 'V1'};
  const clip = (id, overrides = {}) => ({id, at: 0, hold: 2, track: 'v1', asset: 'matrix', ...overrides});
  const bounds = (track, item) => api.mediaModifierBounds(item, track, asset, width, height);
  const render = (track, clips, frame = 0) => {
    const composition = createElement(api.TimelineComposition, {
      timeline: {theme: 'default', tracks: [track], clips}, assets,
    });
    const video = {id: 'placement', width, height, fps: 30, durationInFrames: 60,
      defaultProps: {}, folderName: null, parentFolderName: null, component: () => null,
      nonce: [], schema: null, calculateMetadata: null, stack: null};
    return renderToStaticMarkup(createElement(Internals.CompositionManager.Provider, {
      value: {compositions: [video], currentCompositionMetadata: null, folders: [],
        canvasContent: {type: 'composition', compositionId: 'placement'}},
    }, createElement(Internals.TimelineContext.Provider, {
      value: {frame: {placement: frame}, playing: false,
        imperativePlaying: {current: false}, audioAndVideoTags: {current: []}},
    }, createElement(Internals.CanUseRemotionHooksProvider, null, composition))));
  };

  const layoutCases = [
    ['unpositioned-contain', {fit: 'contain'}, clip('contain')],
    ['unpositioned-cover', {fit: 'cover'}, clip('cover')],
    ['unpositioned-manual', {fit: 'manual'}, clip('manual')],
    ['explicit-neutral-x-zero', {fit: 'cover', scale: 1.6}, clip('x-zero', {x: 0})],
    ['crop-only', {fit: 'contain'}, clip('crop', {cropLeft: .1, cropRight: .1})],
    ['crop-with-geometry', {fit: 'cover'}, clip('crop-geometry', {x: 100, y: 80, width: 900, height: 500, cropTop: .1})],
    ['track-scale-alone', {fit: 'cover', scale: 1.4}, clip('scaled')],
    ['track-scale-no-positioned-siblings', {fit: 'cover', scale: 1.4}, clip('ordinary')],
    ['track-scale-positioned-sibling-unpositioned', {fit: 'cover', scale: 1.4}, clip('ordinary')],
    ['track-scale-positioned-sibling-positioned', {fit: 'cover', scale: 1.4}, clip('sibling', {x: 0})],
  ];
  const layouts = Object.fromEntries(layoutCases.map(([name, track, item]) => [name, bounds({...baseTrack, ...track}, item)]));
  const renderedLayouts = Object.fromEntries(layoutCases.map(([name, trackValues, item]) => {
    const track = {...baseTrack, ...trackValues};
    const clips = name === 'track-scale-no-positioned-siblings'
      ? [item, clip('ordinary-sibling')]
      : name.startsWith('track-scale-positioned-sibling')
      ? [item, clip('positioned-sibling', {x: 0, at: 0})]
      : [item];
    return [name, render(track, clips)];
  }));

  const theme = api.toRuntimeTheme(api.DEFAULT_THEME);
  const opacityCase = (trackOverrides, clipOverrides, frame) => {
    const track = {...baseTrack, ...trackOverrides};
    const item = clip('opacity', clipOverrides);
    const scene = api.prepareCompositionScene([{track, clips: [item]}], assets, 30, theme, width, height);
    const layer = api.querySceneFrame(scene, frame).layers[0];
    return {opacity: layer.opacity, bounds: layer.bounds, visible: layer.visible,
      rendered: render(track, [item], frame)};
  };
  const appearances = {
    clipOpacity: opacityCase({}, {opacity: .4}, 0),
    trackOpacity: opacityCase({opacity: .5}, {}, 0),
    clipAndTrackOpacity: opacityCase({opacity: .5}, {opacity: .4}, 0),
    fadeInStart: opacityCase({}, {effects: {fade_in: .2}}, 0),
    fadeInMidpoint: opacityCase({}, {effects: {fade_in: .2}}, 3),
    fadeOutStart: opacityCase({}, {effects: {fade_out: .2}}, 54),
    fadeOutEnd: opacityCase({}, {effects: {fade_out: .2}}, 59),
  };
  return {layouts, renderedLayouts, appearances};
};

test('placement oracle: built 0.0.17 source and integration preserve public appearance', async () => {
  const repo = git(process.cwd(), 'rev-parse', '--show-toplevel');
  const integrationCommit = git(repo, 'rev-parse', 'HEAD');
  const dependencyDirectory = path.join(repo, 'node_modules');
  assert.ok(readFileSync(path.join(dependencyDirectory, 'typescript', 'package.json')),
    'install the repository dependencies before running the placement oracle');
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'timeline-placement-oracle-'));
  try {
    const baselineEntry = buildBaseline(repo, SOURCE_COMMIT, temporaryRoot, dependencyDirectory);
    // Build the candidate from the actual worktree so uncommitted edits cannot
    // accidentally be hidden by archiving HEAD. CI runs this on a clean commit.
    execFileSync(node, ['scripts/build.mjs'], {cwd: repo, stdio: 'inherit'});
    const integrationEntry = path.join(repo, 'dist', 'index.js');
    const [baseline, integration] = await Promise.all([
      publicResults(baselineEntry), publicResults(integrationEntry),
    ]);

    // Approved changes: numeric media layout replaces object-fit; scale and
    // blend live on the track group. Exact DOM pins make each change reviewable.
    const expectedLayoutDom = {
      "unpositioned-contain": "4d7f09285345fa4494f1d1e49af23be49b7e1b599b18bdd1eb783b8e46b35e92",
      "unpositioned-cover": "df3a79ba7f119b8357ad0378249b367dd3420f74ca4250dea5da5409e63eb959",
      "unpositioned-manual": "fb89f8bc934034d30df7cbbcc87636f787d509e1072646424f8162ec302606b3",
      "explicit-neutral-x-zero": "12a2015792dcc1f5772744fa8c7644d9061ea6e767d1f6d7a692e58623c989d1",
      "crop-only": "0c8f5d1a0b6f01655b79cb5f122449f64e3031c2330be6234fd2d412964a4f09",
      "crop-with-geometry": "9fe969b129a98a134f2749166a69ecc771065215855e0a65476602ab1db60fdf",
      "track-scale-alone": "483bddcd117accb77613805f5e799eb3080ae9704eff5e1e8119b9400513c989",
      "track-scale-no-positioned-siblings": "335cd8800279fd0b790df771677125207cb722da350c719e12edda39f00e2fee",
      "track-scale-positioned-sibling-unpositioned": "667e973106a7de80090dc0709693b6f71166a1a5970f1be5224fb5d690041e00",
      "track-scale-positioned-sibling-positioned": "c93cdb45ef8b2c0f8b91c60abd1f0d1e6480c72fbd2c4454aaf947dbec4448b1"
};
    const expectedAppearanceDom = {
      "clipOpacity": "1833a6e6dcfcac1a9432e8bb8c293d968869893c2b2ab0983296956a4ff5523c",
      "trackOpacity": "52070c0a4635065a896b221fdc9d31518d28bf53a02cf1a0e7b237e869f835de",
      "clipAndTrackOpacity": "ce96313dbf53dce898974c86a16f91027eeb90be85db269be21caa176457724b",
      "fadeInStart": "9ef20152a63e9258c0179387561ec6a2ff171a5b45a4faa4efb466136dad7ad4",
      "fadeInMidpoint": "e982e41715cf2cd5f1495fe0f8df71c1b06db10a228e380aab58d14805ea7437",
      "fadeOutStart": "49c3ef81803aec48e0c8d8b4ea836deb7b36a8b795fca94f77350f4ac5234d2d",
      "fadeOutEnd": "22611cf82a63235d54fb8ac2022cc32db4264e12a5a054b6c169625cd32d5006"
};
    const digest = text => createHash('sha256').update(text).digest('hex');
    for (const [name, expected] of Object.entries(expectedLayoutDom)) {
      assert.equal(digest(integration.renderedLayouts[name]), expected, `approved layout DOM: ${name}`);
      assert.notEqual(integration.renderedLayouts[name], baseline.renderedLayouts[name], `layout changed: ${name}`);
    }
    for (const [name, expected] of Object.entries(expectedAppearanceDom)) {
      const {rendered, ...actual} = integration.appearances[name];
      const {rendered: oldRendered, ...old} = baseline.appearances[name];
      assert.deepEqual(actual, old, `appearance evaluation: ${name}`);
      assert.equal(digest(rendered), expected, `approved appearance DOM: ${name}`);
      assert.notEqual(rendered, oldRendered, `appearance DOM changed: ${name}`);
    }
    for (const name of Object.keys(baseline.layouts)) {
      if (name === 'crop-only') {
        // Evaluation no longer infers cover from crop; normalization writes it for old projects.
        assert.deepEqual(integration.layouts[name], {status: 'known', rect: {x:128,y:93.33333333333337,width:1024,height:533.3333333333333}});
      } else assert.deepEqual(integration.layouts[name], baseline.layouts[name], `geometry: ${name}`);
    }
    assert.match(baseline.renderedLayouts['unpositioned-contain'], /<img/);
    assert.match(baseline.renderedLayouts['unpositioned-contain'], /object-fit:contain/);
    assert.match(baseline.renderedLayouts['unpositioned-cover'], /object-fit:cover/);
    assert.notEqual(baseline.renderedLayouts['unpositioned-contain'], baseline.renderedLayouts['unpositioned-cover']);
    assert.equal((baseline.renderedLayouts['track-scale-no-positioned-siblings'].match(/transform:scale\(1\.4\)/g) ?? []).length, 2);
    assert.equal((baseline.renderedLayouts['track-scale-positioned-sibling-unpositioned'].match(/transform:scale\(1\.4\)/g) ?? []).length, 1);
    assert.equal((baseline.renderedLayouts['track-scale-positioned-sibling-positioned'].match(/transform:scale\(1\.4\)/g) ?? []).length, 0);
    console.log(`Placement oracle matched ${Object.keys(baseline.layouts).length} geometry cases, ${Object.keys(baseline.renderedLayouts).length} rendered layouts, and ${Object.keys(baseline.appearances).length} appearance cases (source ${SOURCE_COMMIT} vs worktree at ${integrationCommit}).`);
  } finally {
    rmSync(temporaryRoot, {recursive: true, force: true});
  }
});
