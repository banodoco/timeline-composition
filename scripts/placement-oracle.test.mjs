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
      timeline: {theme: 'default', output: {resolution: '1280x720'}, tracks: [track], clips}, assets,
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
      "unpositioned-contain": "c688726b92bb983429ee69ea38ce1b5199138df8de0d5a0481fc577c2234939a",
      "unpositioned-cover": "7683ee6857a30872d6fa5d37912204ab3fc4567deeb5ebc5243b449e59811bdb",
      "unpositioned-manual": "dbbbbb2d2288672f69a59941a867af485838603cd2aae9548dd0a6c5e80ee144",
      "explicit-neutral-x-zero": "12a2015792dcc1f5772744fa8c7644d9061ea6e767d1f6d7a692e58623c989d1",
      "crop-only": "fe902cf2044d5cead7d1b4e69c8cb849593e299bb6c38d7aac1b5f8bbd79a032",
      "crop-with-geometry": "ffc9a8d9004bcfea6865624819bf0369be44a63d6b8040a07579cb00b7c16eab",
      "track-scale-alone": "483bddcd117accb77613805f5e799eb3080ae9704eff5e1e8119b9400513c989",
      "track-scale-no-positioned-siblings": "335cd8800279fd0b790df771677125207cb722da350c719e12edda39f00e2fee",
      "track-scale-positioned-sibling-unpositioned": "667e973106a7de80090dc0709693b6f71166a1a5970f1be5224fb5d690041e00",
      "track-scale-positioned-sibling-positioned": "c93cdb45ef8b2c0f8b91c60abd1f0d1e6480c72fbd2c4454aaf947dbec4448b1"
};
    const expectedAppearanceDom = {
      "clipOpacity": "918327f256c98cd57fee6b18ce216cde7e66e4bef2cd0cf228f6b2c4502d380b",
      "trackOpacity": "d6be0c5eab05b5bb4ca820c7a2156c5f2d241da20e288764d4a1eebb61e552de",
      "clipAndTrackOpacity": "d01a345813bcf524783b892ae45adccb5b812159283d5fe6b156283b41b6c2fa",
      "fadeInStart": "b17be625c7f53f3ab635a1713d3c58f65e880fbb0afed8cb4cb31bbdfe63e8f1",
      "fadeInMidpoint": "a64876af6fb033a2aabf8589b173dda259b36f4b84b12345351a50c213dc89d9",
      "fadeOutStart": "b9e7c3fdc991d22e186e66e55c53147181fd90051c1794fedfdab8e10b26ff0f",
      "fadeOutEnd": "6f88fce2bef4036b25d3f781be9bd6bdf5d2afd26f20682572dc4166cd620f84"
};
    const digest = text => createHash('sha256').update(text).digest('hex');
    for (const [name, expected] of Object.entries(expectedLayoutDom)) {
      assert.equal(digest(integration.renderedLayouts[name]), expected, `approved layout DOM: ${name}`);
      if (['unpositioned-manual','crop-only','crop-with-geometry'].includes(name)) assert.equal(integration.renderedLayouts[name], baseline.renderedLayouts[name], `unchanged layout: ${name}`);
      else assert.notEqual(integration.renderedLayouts[name], baseline.renderedLayouts[name], `layout changed: ${name}`);
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
