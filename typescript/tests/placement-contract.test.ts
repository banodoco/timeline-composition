import {test} from 'node:test';
import type {PlacementInput} from '../src/lib/placement';
const valid: PlacementInput = {clip:{id:'c',x:1},track:{id:'v',fit:'cover'},canvas:{width:1,height:1},intrinsic:{width:1,height:1}};
// @ts-expect-error render profiles are not placement inputs
const extra: PlacementInput = {...valid,profile:'preview'};
// @ts-expect-error theme is not an authored placement field
const clipTheme: PlacementInput = {...valid,clip:{id:'c',theme:'dark'}};
// @ts-expect-error media facts must have both dimensions
const missingIntrinsic: PlacementInput = {...valid,intrinsic:{width:1}};
test('placement input type is limited to authored fields and facts', () => { void valid; void extra; void clipTheme; void missingIntrinsic; });
