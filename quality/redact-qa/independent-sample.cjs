'use strict';
// Reproducible artifact builder. Authored DOM + installed NativeCanvas executes
// production app.js; output bytes are production Sharp native export, not a mock.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),sharp=require('sharp');
const {harness}=require('./app-harness.cjs'),R=require('../../src/redaction-layers.cjs'),T=require('../../src/text-overlay.cjs'),{createExportRenderer}=require('../../export-renderer.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),file=name=>path.join(__dirname,'independent-'+name),flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
(async()=>{
 const renderer=createExportRenderer(),captured=[],output=[];
 try{
  const h=harness({bridge:{renderExport:async value=>{const request=structuredClone(value);captured.push(request);const result=await renderer.render(request);output.push(result);return result;}}});await flush();
  const source=h.canvas(800,520),ctx=source.getContext('2d');
  for(let y=0;y<520;y+=20)for(let x=0;x<800;x+=20){ctx.fillStyle=(x/20+y/20)%2?'#bed8cf':'#1f4556';ctx.fillRect(x,y,20,20);}
  ctx.fillStyle='#ffffff';ctx.font='bold 24px monospace';ctx.fillText('SYNTHETIC SOURCE 0042',35,58);ctx.font='16px monospace';ctx.fillText('NO PERSONAL IMAGE OR REAL IDENTIFIER',35,86);
  ctx.clearRect(0,450,210,70); // Transparent source plus transparent final padding.
  const p=h.photo('independent-synthetic');p.originalWidth=800;p.originalHeight=520;p.name='independent-synthetic.png';p.blob=new Blob([source._native.toBuffer('image/png')],{type:'image/png'});
  p.settings.exposure=8;p.settings.saturation=-10;p.settings.framing={version:1,crop:{x:.05,y:.05,w:.9,h:.9},quarterTurns:1,flipX:true,flipY:false};p.settings.canvasPadding={version:1,top:.14,right:.12,bottom:.14,left:.12,color:'#f5e6c7',opacity:0};
  p.settings.textLayers=[
   {id:'title',enabled:true,recipe:{...T.defaults(),text:'GENERATED TEST / NO PERSONAL DATA',x:.5,y:.04,size:.025,color:'#12362e',fontFamily:'mono'}},
   {id:'identifier',enabled:true,recipe:{...T.defaults(),text:'SYNTHETIC-ID-0042',x:.5,y:.43,size:.055,color:'#ffffff',outlineWidth:.04,outlineColor:'#111111',fontFamily:'mono'}},
   {id:'footnote',enabled:true,recipe:{...T.defaults(),text:'MOSAIC IS NOT RELIABLE REDACTION',x:.5,y:.96,size:.024,color:'#12362e',fontFamily:'mono'}}
  ];
  p.settings.redactions={version:1,sourceRevision:p.sourceRevision,geometryKey:R.geometryKey(p.settings),layers:[
   {id:'sample-cover',name:'Opaque cover over synthetic text',enabled:true,selection:null,recipe:{version:1,mode:'cover',blockSize:.06,color:'#12362e',strokes:[{radius:.07,points:[{x:.17,y:.43},{x:.83,y:.43}]}]}},
   {id:'sample-mosaic',name:'Mosaic visual effect only',enabled:true,selection:null,recipe:{version:1,mode:'mosaic',blockSize:.07,color:'#12362e',strokes:[{radius:.1,points:[{x:.2,y:.72},{x:.8,y:.72}]}]}}
  ]};p.committed=structuredClone(p.settings);h.activate(p);h.api.set({source});h.api.setTool('pan');await flush();await h.api.renderCurrent();assert.ok(h.api.get().acceptedRender,h.api.get().renderFailure);
  h.get('exportScope').value='current';h.get('exportFormat').value='png';h.get('exportQuality').value='100';h.get('exportMode').value='original';await h.api.startExport();assert.equal(output.length,1,JSON.stringify(h.api.get().exportQueue?.items.map(i=>i.error)));assert.equal(h.calls.writes.length,1);
  const request=captured[0],png=output[0],sourceBytes=new Uint8Array(await p.blob.arrayBuffer());assert.equal(sha(sourceBytes),sha(request.bytes));
  fs.writeFileSync(file('source.png'),sourceBytes);fs.writeFileSync(file('native-cover.png'),png.bytes);
  const jpeg=await renderer.render({...request,requestId:'independent-jpeg',format:'jpeg',textOverlay:{...request.textOverlay,requestId:'independent-jpeg'}});fs.writeFileSync(file('native-cover.jpg'),jpeg.bytes);
  const resize=await renderer.render({...request,requestId:'independent-downsize',outputSize:{version:1,mode:'long-edge',longEdge:320},textOverlay:{...request.textOverlay,requestId:'independent-downsize'}});fs.writeFileSync(file('native-cover-downsize.png'),resize.bytes);
  const baseline=await renderer.render({...request,requestId:'independent-baseline',settings:{...request.settings,redactions:null},textOverlay:{...request.textOverlay,requestId:'independent-baseline'}});fs.writeFileSync(file('native-before-cover.png'),baseline.bytes);
  const records=[];
  for(const [name,result]of [['native-before-cover.png',baseline],['native-cover.png',png],['native-cover.jpg',jpeg],['native-cover-downsize.png',resize]]){
   const meta=await sharp(result.bytes).metadata(),raw=await sharp(result.bytes).ensureAlpha().raw().toBuffer();let zeroAlpha=0,hiddenRGB=0,hardCover=0;for(let i=0;i<raw.length;i+=4){if(raw[i+3]===0){zeroAlpha++;if(raw[i]||raw[i+1]||raw[i+2])hiddenRGB++;}if(raw[i]===18&&raw[i+1]===54&&raw[i+2]===46&&raw[i+3]===255)hardCover++;}assert.equal(hiddenRGB,0);records.push({file:'independent-'+name,sha256:sha(result.bytes),width:result.width,height:result.height,zeroAlphaPixels:zeroAlpha,nonzeroHiddenRGBPixels:hiddenRGB,exactOpaqueCoverRGBPixels:hardCover,exif:!!meta.exif,xmp:!!meta.xmp,iptc:!!meta.iptc,details:result.details});
  }
  const center=await sharp(png.bytes).ensureAlpha().raw().toBuffer(),at=(Math.round((png.height-1)*.43)*png.width+Math.round((png.width-1)*.5))*4;assert.deepEqual([...center.subarray(at,at+4)],[18,54,46,255]);
  const manifest={created:new Date().toISOString(),method:'Unmodified production app.js export orchestration in authored DOM plus installed NativeCanvas; production export-renderer/worker with Sharp. JPEG, downsized, and no-cover baseline reuse the captured validated request.',claimLimits:['Not a browser, Windows, installer, screenshot or native input-event test.','Mosaic is a visual effect, not reliable anonymization.','JPEG and output downsampling alter boundary colors.','Source/project/recovery retain original pixels; share only an inspected exported copy.','Preview downsampling is not proof of original-resolution export.'],source:{file:'independent-source.png',sha256:sha(sourceBytes),width:800,height:520},records,sourceHashes:Object.fromEntries(['src/app.js','src/redact-core.cjs','src/redaction-layers.cjs','src/project-document.cjs','export-render-core.cjs','export-render-worker.cjs'].map(f=>[f,sha(fs.readFileSync(path.resolve(__dirname,'../..',f)))]))};fs.writeFileSync(file('sample-manifest.json'),JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify(manifest,null,2));
 }finally{renderer.dispose();}
})().catch(error=>{console.error(error);process.exitCode=1;});
