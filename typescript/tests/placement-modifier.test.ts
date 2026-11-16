import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mediaModifierBounds} from '../src/lib/modifier-bounds';
test('modifier drawing uses local bounds while scene uses output bounds', () => {
  const clip = {id:'c',track:'v',at:0,x:25,y:25,width:25,height:25,fit:'cover' as const};
  const track = {id:'v',kind:'visual' as const,label:'V',scale:2};
  const asset = {file:'x.png',resolution:'100x100'};
  assert.deepEqual(mediaModifierBounds(clip,track,asset,100,100,'local'), {status:'known',rect:{x:25,y:25,width:25,height:25}});
  assert.deepEqual(mediaModifierBounds(clip,track,asset,100,100), {status:'known',rect:{x:0,y:0,width:50,height:50}});
});
