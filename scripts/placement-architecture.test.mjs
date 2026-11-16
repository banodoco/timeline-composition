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
