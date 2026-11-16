import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Internals} from 'remotion';
import {TimelineComposition} from '../dist/index.js';
const render = ({resolution='100x100', assetResolution='100x100', scale=1, blendMode='multiply', fit='contain'} = {}) => {
  const track = {id:'v',kind:'visual',label:'V',scale,blendMode,opacity:.5,app:{clipPlacementVersion:1,scaleAppliesToPositionedClips:true}};
  const clip = {id:'clip1',track:'v',asset:'asset1',at:0,hold:1,fit};
  const timeline = {theme:'default',output:{resolution},tracks:[track],clips:[clip]};
  const assets = {assets:{asset1:{file:'https://example.test/a.png',type:'image/png',resolution:assetResolution}}};
  const video = {id:'placement',width:100,height:100,fps:30,durationInFrames:30,defaultProps:{},folderName:null,parentFolderName:null,component:()=>null,nonce:[],schema:null,calculateMetadata:null,stack:null};
  return renderToStaticMarkup(createElement(Internals.CompositionManager.Provider,{value:{compositions:[video],currentCompositionMetadata:null,folders:[],canvasContent:{type:'composition',compositionId:'placement'}}},createElement(Internals.TimelineContext.Provider,{value:{frame:{placement:0},playing:false,imperativePlaying:{current:false},audioAndVideoTags:{current:[]}}},createElement(Internals.CanUseRemotionHooksProvider,null,createElement(TimelineComposition,{timeline,assets})))));
};
test('track and media blend remain distinct, group opacity and conditional scale', () => {
  const plain=render(); assert.equal((plain.match(/mix-blend-mode:multiply/g) ?? []).length,2); assert.match(plain,/opacity:0\.5/); assert.doesNotMatch(plain,/transform:scale\(1\)/);
  for (const scale of [.5,2]) assert.match(render({scale}),new RegExp(`transform:scale\\(${scale}\\).*overflow:hidden`));
});
test('render refuses missing intrinsic media or a different output canvas', () => {
  for (const fit of ['contain','cover']) for (const assetResolution of ['', 'bad']) assert.throws(()=>render({fit,assetResolution}),/clip1.*asset1.*resolution/);
  assert.throws(()=>render({resolution:'200x100'}),/output.resolution.*render canvas/);
  assert.throws(()=>render({resolution:''}),/output.resolution/);
});
