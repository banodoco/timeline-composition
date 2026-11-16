import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

test('package renderers use the placement owner and only its input fields', () => {
  const files = ['typescript/src/VisualClip.tsx','typescript/src/TimelineComposition.tsx','typescript/src/lib/modifier-bounds.ts'];
  for (const file of files) {
    const source = readFileSync(file,'utf8');
    const tree = ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    assert.doesNotMatch(source,/computeViewportMediaLayout|normalizeRenderCropValues|getVisibleBoundsFromCrop|computeRenderBounds|hasPositionOverride/);
    assert.doesNotMatch(source,/track\.fit|clip\.(?:cropTop|cropBottom|cropLeft|cropRight|width|height|x|y)\b/);
    let calls = 0;
    const visit = node => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'resolveClipPlacement') {
        calls++;
        assert.equal(node.arguments.length,1, file);
        const arg = node.arguments[0]; assert.ok(ts.isObjectLiteralExpression(arg),file);
        const keys = arg.properties.map(p => p.name?.getText(tree));
        assert.deepEqual(keys.sort(), ['canvas','clip','intrinsic','track'],file);
      }
      ts.forEachChild(node,visit);
    };
    visit(tree);
    if (!file.endsWith('TimelineComposition.tsx')) assert.equal(calls,1,file);
    else assert.match(source,/resolveTrackTransform\(/);
  }
});

// These are the complete drawing-adapter expressions, not merely resolver calls.
const assertVisualAdapter = source => {
  const tree = ts.createSourceFile('VisualClip.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  assert.doesNotMatch(source,/track\.fit|clip\.(?:x|y|width|height|cropTop|cropBottom|cropLeft|cropRight)\b/);
  const expected = {outerStyle:{left:'viewport.x',top:'viewport.y',width:'viewport.width',height:'viewport.height'},
    innerStyle:{left:'media.x - viewport.x',top:'media.y - viewport.y',width:'media.width',height:'media.height'}};
  const found = {};
  const visit = node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && expected[node.name.text]) {
      assert.ok(ts.isObjectLiteralExpression(node.initializer));
      found[node.name.text] = Object.fromEntries(node.initializer.properties.filter(ts.isPropertyAssignment).map(p=>[p.name.getText(tree),p.initializer.getText(tree)]));
    }
    ts.forEachChild(node,visit);
  };
  visit(tree);
  for (const [style,props] of Object.entries(expected)) for (const [key,value] of Object.entries(props)) assert.equal(found[style]?.[key],value,`${style}.${key}`);
  assert.match(source,/<div style=\{outerStyle\}>/);
  assert.match(source,/<Img src=\{fileUrl\} style=\{innerStyle\}/);
  assert.match(source,/<Video[\s\S]*?style=\{innerStyle\}/);
};
test('drawing adapter consumes exact placement and rejects mutations', () => {
  const source=readFileSync('typescript/src/VisualClip.tsx','utf8');
  assertVisualAdapter(source);
  const shifted=source.replace('left: media.x - viewport.x,','left: media.x - viewport.x + 10,');
  assert.notEqual(shifted,source); assert.throws(()=>assertVisualAdapter(shifted));
  const fit=source.replace('left: media.x - viewport.x,',"left: track.fit === 'cover' ? 0 : media.x - viewport.x,");
  assert.notEqual(fit,source); assert.throws(()=>assertVisualAdapter(fit));
});
