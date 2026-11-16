import assert from 'node:assert/strict';
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

    // Add a case here only when a deliberate behavior change is approved and
    // named. These are compared at the public geometry/evaluation boundary.
    const intendedDifferences = {};
    assert.deepEqual(Object.keys(intendedDifferences), [], 'unreviewed placement behavior difference');
    assert.deepEqual(integration, baseline, 'placement/layout/opacity result differs from built 0.0.17 source');
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
