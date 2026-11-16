// Historical App static-image preview reference; run after placement-pixel-oracle.
// Source is extracted from immutable App commit, never from candidate placement code.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,readdirSync,symlinkSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import path from 'node:path';
const flag=n=>{const i=process.argv.indexOf(n);if(i<0||!process.argv[i+1])throw Error(`Missing ${n}`);return path.resolve(process.argv[i+1]);};
const app=flag('--app'), toolchain=flag('--toolchain'), out=flag('--out'), oldTar=flag('--old-tarball'), newTar=flag('--new-tarball'), browserExecutable=flag('--browser');
const rev='0b6ef16152dc3fa11246ccc2007da630c66d1a1a';
const actualRevision=execFileSync('git',['rev-parse',rev],{cwd:app,encoding:'utf8'}).trim();
if(actualRevision!==rev) throw Error(`Unexpected App source commit ${actualRevision}`);
const sha256=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const archives={old:sha256(oldTar),candidate:sha256(newTar)};
const allCases=['unpositioned-contain','unpositioned-cover','unpositioned-manual','explicit-neutral-x-zero','crop-only','crop-with-geometry','track-scale-alone','track-scale-no-positioned-siblings','track-scale-positioned-sibling-unpositioned','track-scale-positioned-sibling-positioned'];
for(const name of allCases) for(const side of ['old','new']) if(!existsSync(path.join(out,`${name}-${side}.png`))) throw Error(`Missing ${name}-${side}.png; rerun pixel oracle in this output directory`);
const comparisonPath=path.join(out,'comparison.json');
if(!existsSync(comparisonPath)) throw Error('Missing comparison.json; rerun pixel oracle first');
const proof=JSON.parse(readFileSync(path.join(out,'pixel-provenance.json'),'utf8'));
if(proof.tarballSha256.old!==archives.old || proof.tarballSha256.candidate!==archives.candidate || proof.comparisonSha256!==sha256(comparisonPath)) throw Error('Pixel evidence provenance does not match artifacts or comparison');
for(const name of allCases) for(const side of ['old','new']) { const filename=`${name}-${side}.png`; if(proof.images[filename]!==sha256(path.join(out,filename))) throw Error(`Pixel evidence hash mismatch: ${filename}`); }
const req=createRequire(path.join(toolchain,'package.json')); const ts=req('typescript');
const {bundle}=req('@remotion/bundler'),{selectComposition,renderStill}=req('@remotion/renderer');
const show=file=>execFileSync('git',['show',`${rev}:${file}`],{cwd:app,encoding:'utf8'});
const file=(name,source)=>ts.createSourceFile(name,source,ts.ScriptTarget.Latest,true,name.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
const variable=(tree,name)=>{let found;const walk=n=>{if(ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(tree)===name))found=n;ts.forEachChild(n,walk);};walk(tree);if(!found)throw Error(`Missing source declaration ${name}`);return found.getText(tree);};
const domainText=show('src/tools/video-editor/lib/timeline-domain.ts'),domain=file('domain.ts',domainText);
const visualText=show('src/tools/video-editor/compositions/VisualClip.tsx'),visual=file('visual.tsx',visualText);
const trackText=show('src/tools/video-editor/compositions/TimelineRenderer.tsx'),trackTree=file('track.tsx',trackText);
const assetDecl=(()=>{let result;const visit=n=>{if(ts.isVariableDeclaration(n)&&n.name.getText(visual)==='VisualAsset')result=n;ts.forEachChild(n,visit);};visit(visual);return assetDeclCheck(result);})();
function assetDeclCheck(x){if(!x?.initializer?.body?.statements)throw Error('VisualAsset AST missing');return x;}
const statements=assetDecl.initializer.body.statements; const start=statements.findIndex(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(visual)==='hasPositionOverride'));
const tail=statements.slice(start); const firstIf=tail.find(n=>ts.isIfStatement(n)&&n.expression.getText(visual)==='!useViewportLayout');
const imageIf=firstIf.thenStatement.statements.find(n=>ts.isIfStatement(n)&&n.expression.getText(visual)==='isImage');
const viewportImage=tail.find(n=>ts.isIfStatement(n)&&n.expression.getText(visual)==='isImage');
if(start<0||!imageIf||!viewportImage)throw Error('App image branch AST changed');
const beforeViewport=tail.slice(0,tail.indexOf(firstIf)).map(n=>n.getText(visual)).join('\n');
const firstBody=firstIf.thenStatement.statements.slice(0,firstIf.thenStatement.statements.indexOf(imageIf)+1).map(n=>n.getText(visual)).join('\n');
const viewport=tail.slice(tail.indexOf(firstIf)+1,tail.indexOf(viewportImage)+1).map(n=>n.getText(visual)).join('\n');
let trackStyle;const walkTrack=n=>{if(ts.isVariableDeclaration(n)&&n.name.getText(trackTree)==='VisualTrack'){const f=x=>{if(ts.isJsxOpeningElement(x)&&x.tagName.getText(trackTree)==='AbsoluteFill'){const a=x.attributes.properties.find(y=>y.name?.getText(trackTree)==='style');if(a&&!trackStyle)trackStyle=a.initializer.expression.getText(trackTree);}ts.forEachChild(x,f);};f(n);}ts.forEachChild(n,walkTrack);};walkTrack(trackTree);if(!trackStyle)throw Error('Track style AST missing');
const root=mkdtempSync(path.join(tmpdir(),'c2-app-ref-')),nm=path.join(root,'node_modules');mkdirSync(nm,{recursive:true});for(const n of readdirSync(path.join(toolchain,'node_modules')))symlinkSync(path.join(toolchain,'node_modules',n),path.join(nm,n),'dir');
for(const n of ['readiness-image.tsx','managed-media.tsx','managed-media-policy.ts'])writeFileSync(path.join(root,n),show(`vendor/astrid-browser/astrid/packs/rendering/shared/${n}`));
writeFileSync(path.join(root,'render-bounds.ts'),show('src/tools/video-editor/lib/render-bounds.ts'));
const config=file('config.ts',show('src/tools/video-editor/lib/config-utils.ts'));
const migration=['TRACK_SCALE_BAKE_MARKER','isFiniteNumber','isPositiveNumber','clipHasPositionOverride','roundBakedCoordinate','applyTrackScaleBakeMigration'].map(n=>variable(domain,n)).join('\n');
const src=`import React from 'react'; import {AbsoluteFill,Composition,registerRoot} from 'remotion'; import {ReadinessImage} from './readiness-image'; import {computeViewportMediaLayout} from './render-bounds';\n${variable(config,'parseResolution')}\n${variable(visual,'getClipBoxStyle')}\n${variable(visual,'getIntrinsicMediaSize')}\n${migration}\nconst AppImage=({clip,track,mediaSrc})=>{const compositionWidth=1280,compositionHeight=720,isImage=true; ${beforeViewport} if (!useViewportLayout) {${firstBody}} ${viewport} return null;};\nconst Scene=({timeline,assets})=>{const config=applyTrackScaleBakeMigration(timeline);const track=config.tracks[0],effectiveScale=track.scale??1;return <AbsoluteFill style={{backgroundColor:'#050814',overflow:'hidden'}}><AbsoluteFill style={{position:'relative',overflow:'hidden'}}><AbsoluteFill style={${trackStyle}}>{config.clips.map(clip=><AbsoluteFill key={clip.id}><AppImage clip={{...clip,assetEntry:assets.assets[clip.asset]}} track={track} mediaSrc={assets.assets[clip.asset].file}/></AbsoluteFill>)}</AbsoluteFill></AbsoluteFill></AbsoluteFill>};\nregisterRoot(()=> <Composition id="Oracle" component={Scene} width={1280} height={720} fps={30} durationInFrames={60} defaultProps={{timeline:{tracks:[],clips:[]},assets:{assets:{}}}}/>);`;
writeFileSync(path.join(root,'entry.tsx'),src);
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="800"><rect width="1920" height="800" fill="#eee"/><path d="M0 0h960v400H0z M960 400h960v400H960z" fill="#e32"/><path d="M960 0h960v400H960z M0 400h960v400H0z" fill="#26b"/><path d="M950 0h20v800h-20z M0 390h1920v20H0z" fill="#1d2"/><circle cx="960" cy="400" r="160" fill="#ff0" fill-opacity=".5"/></svg>`;
const server=createServer((_q,r)=>{r.writeHead(200,{'Content-Type':'image/svg+xml','Access-Control-Allow-Origin':'*'});r.end(svg);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
try {const serveUrl=await bundle({entryPoint:path.join(root,'entry.tsx'),enableCaching:false});const clip=(id,more={})=>({id,track:'v1',asset:'grid',at:0,hold:2,...more});const cases=[['explicit-neutral-x-zero',1.6,[clip('x-zero',{x:0})]],['track-scale-positioned-sibling-unpositioned',1.4,[clip('ordinary'),clip('positioned-sibling',{x:0})]],['track-scale-positioned-sibling-positioned',1.4,[clip('sibling',{x:0}),clip('positioned-sibling',{x:0})]]];for(const [name,scale,clips] of cases){const inputProps={timeline:{theme:'default',output:{resolution:'1280x720'},tracks:[{id:'v1',kind:'visual',label:'V1',fit:'cover',scale}],clips},assets:{assets:{grid:{file:`http://127.0.0.1:${server.address().port}/grid.svg`,type:'image/svg+xml',resolution:'1920x800'}}}};const composition=await selectComposition({serveUrl,id:'Oracle',inputProps,browserExecutable});await renderStill({serveUrl,composition,inputProps,frame:0,output:path.join(out,`${name}-app.png`),imageFormat:'png',browserExecutable});} } finally {server.close();}
// Candidate must equal the App reference in each pixel within RGB(A) delta 2.
const py=`from PIL import Image\nimport json,sys,os,hashlib\nroot=sys.argv[1]; names=json.loads(sys.argv[2]); result={}\nfor n in names:\n a=Image.open(os.path.join(root,n+'-app.png')).convert('RGBA'); b=Image.open(os.path.join(root,n+'-new.png')).convert('RGBA'); assert a.size==b.size\n ds=[max(abs(x-y) for x,y in zip(u,v)) for u,v in zip(a.getdata(),b.getdata())]; result[n]={'pixels':len(ds),'over_2':sum(d>2 for d in ds),'max_channel_delta':max(ds)}\nfor f in sorted(os.listdir(root)):\n if f.endswith('.png'):\n  result.setdefault('sha256',{})[f]=hashlib.sha256(open(os.path.join(root,f),'rb').read()).hexdigest()\nprint(json.dumps(result,indent=2))\n`;
const names=['explicit-neutral-x-zero','track-scale-positioned-sibling-unpositioned','track-scale-positioned-sibling-positioned'];
const metrics=JSON.parse(execFileSync('python3',['-c',py,out,JSON.stringify(names)],{encoding:'utf8'}));
const oldComparison=JSON.parse(readFileSync(comparisonPath,'utf8'));
const exactOldCases=allCases.filter(name=>!names.includes(name));
const okOld=exactOldCases.every(name=>oldComparison[name]?.max_channel_delta===0);
const okApp=names.every(name=>metrics[name].max_channel_delta===0);
const result={provenance:{appCommit:rev,tarballSha256:archives},qualification:{oldExactCases:exactOldCases,appBitExactCases:names,passed:okOld&&okApp},oldVsCandidate:oldComparison,appVsCandidate:metrics};
const report=JSON.stringify(result,null,2)+'\n';writeFileSync(path.join(out,'app-comparison.json'),report);process.stdout.write(report);
if(!result.qualification.passed) process.exitCode=1;
