// Manual integration proof; uses installed Remotion toolchain, never package dependencies.
// Run: node scripts/placement-pixel-oracle.mjs --toolchain /path/to/remotion --out /path/to/evidence
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdtempSync, mkdirSync, readdirSync, symlinkSync, writeFileSync, readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const flag = name => {const i=process.argv.indexOf(name); if(i<0 || !process.argv[i+1]) throw new Error(`Missing ${name}`); return path.resolve(process.argv[i+1]);};
const toolchain=flag('--toolchain'), output=flag('--out');
const oldTar=process.env.C2_OLD_TARBALL ?? '/home/user/work/c2/astrid-agent/remotion/artifacts/banodoco-timeline-composition-0.0.17.tgz';
const newTar=process.env.C2_NEW_TARBALL ?? '/home/user/work/c2/artifacts/banodoco-timeline-composition-0.0.19.tgz';
const browser=process.env.C2_BROWSER ?? '/opt/pw-browsers/chromium';
const req=createRequire(path.join(toolchain,'package.json'));
const {bundle}=req('@remotion/bundler'), {selectComposition,renderStill}=req('@remotion/renderer');
for (const pkg of ['@remotion/bundler','@remotion/renderer','remotion']) if(req(`${pkg}/package.json`).version !== '4.0.509') throw new Error(`${pkg} must be 4.0.509`);
mkdirSync(output,{recursive:true});
const root=mkdtempSync(path.join(tmpdir(),'c2-pixel-oracle-'));
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="800"><rect width="1920" height="800" fill="#eee"/><path d="M0 0h960v400H0z M960 400h960v400H960z" fill="#e32"/><path d="M960 0h960v400H960z M0 400h960v400H0z" fill="#26b"/><path d="M950 0h20v800h-20z M0 390h1920v20H0z" fill="#1d2"/><circle cx="960" cy="400" r="160" fill="#ff0" fill-opacity=".5"/></svg>`;
const server=createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'image/svg+xml','Access-Control-Allow-Origin':'*'});res.end(svg);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/grid.svg`;
const clip=(id,more={})=>({id,track:'v1',asset:'grid',at:0,hold:2,...more});
const cases=[
 ['unpositioned-contain',{fit:'contain'},clip('contain')],['unpositioned-cover',{fit:'cover'},clip('cover')],
 ['unpositioned-manual',{fit:'manual'},clip('manual')],['explicit-neutral-x-zero',{fit:'cover',scale:1.6},clip('x-zero',{x:0})],
 ['crop-only',{fit:'contain'},clip('crop',{cropLeft:.1,cropRight:.1})],
 ['crop-with-geometry',{fit:'cover'},clip('crop-geometry',{x:100,y:80,width:900,height:500,cropTop:.1})],
 ['track-scale-alone',{fit:'cover',scale:1.4},clip('scaled')],
 ['track-scale-no-positioned-siblings',{fit:'cover',scale:1.4},clip('ordinary')],
 ['track-scale-positioned-sibling-unpositioned',{fit:'cover',scale:1.4},clip('ordinary')],
 ['track-scale-positioned-sibling-positioned',{fit:'cover',scale:1.4},clip('sibling',{x:0})],
];
try {
 for (const [label,archive] of [['old',oldTar],['new',newTar]]) {
  const dir=path.join(root,label), nm=path.join(dir,'node_modules'); mkdirSync(nm,{recursive:true});
  for(const name of readdirSync(path.join(toolchain,'node_modules'))) if(name !== '@banodoco') symlinkSync(path.join(toolchain,'node_modules',name),path.join(nm,name),'dir');
  mkdirSync(path.join(nm,'@banodoco'),{recursive:true});
  execFileSync('tar',['-xzf',archive,'-C',dir]);
  symlinkSync(path.join(dir,'package'),path.join(nm,'@banodoco','timeline-composition'),'dir');
  const entry=path.join(dir,'entry.jsx');
  writeFileSync(entry,`import React from 'react'; import {registerRoot,Composition} from 'remotion'; import * as pkg from '@banodoco/timeline-composition';\nconst Root=()=> <Composition id="Oracle" component={pkg.TimelineComposition} width={1280} height={720} fps={30} durationInFrames={60} defaultProps={{timeline:{theme:'default',tracks:[],clips:[]},assets:{assets:{}}}}/>; registerRoot(Root);`);
  const serveUrl=await bundle({entryPoint:entry,enableCaching:false});
  for(const [name,values,item] of cases) {
   const track={id:'v1',kind:'visual',label:'V1',...values};
   const clips=name === 'track-scale-no-positioned-siblings' ? [item,clip('ordinary-sibling')] : name.startsWith('track-scale-positioned-sibling') ? [item,clip('positioned-sibling',{x:0})] : [item];
   let timeline={theme:'default',output:{resolution:'1280x720'},tracks:[track],clips};
   if(label==='new') {const api=await import(pathToFileURL(path.join(dir,'package/dist/index.js')));timeline=api.normalizeClipPlacement(timeline);}
   const inputProps={timeline,assets:{assets:{grid:{file:url,type:'image/svg+xml',resolution:'1920x800'}}}};
   const composition=await selectComposition({serveUrl,id:'Oracle',inputProps,browserExecutable:browser});
   await renderStill({serveUrl,composition,inputProps,frame:0,output:path.join(output,`${name}-${label}.png`),imageFormat:'png',browserExecutable:browser});
  }
 }
 // Exact pixels except RGB channel differences <= 2 (antialiasing tolerance).
 // Any larger delta is a finding, including scale-bake differences, until adjudicated.
 const py=`from PIL import Image\nimport json,sys,os\nroot=sys.argv[1]; names=json.loads(sys.argv[2]); result={}\nfor n in names:\n a=Image.open(os.path.join(root,n+'-old.png')).convert('RGBA'); b=Image.open(os.path.join(root,n+'-new.png')).convert('RGBA'); assert a.size==b.size\n p=list(a.getdata()); q=list(b.getdata()); diffs=[max(abs(x-y) for x,y in zip(u,v)) for u,v in zip(p,q)]; result[n]={'pixels':len(diffs),'over_2':sum(d>2 for d in diffs),'max_channel_delta':max(diffs)}\nprint(json.dumps(result,indent=2))\n`;
 const report=execFileSync('python3',['-c',py,output,JSON.stringify(cases.map(c=>c[0]))],{encoding:'utf8'});writeFileSync(path.join(output,'comparison.json'),report);process.stdout.write(report);
 if(Object.values(JSON.parse(report)).some(v=>v.over_2)) process.exitCode=1;
} finally {server.close();}
