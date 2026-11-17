'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const corePath=process.env.MANUAL_CORE || require('node:path').resolve(__dirname,'../../src/manual-tools.cjs');
if(!fs.existsSync(corePath))throw new Error('NOT RUN: implementation candidate has not been written: '+corePath);
const M=require(corePath),F=require('./fixtures.cjs'),rev='independent-qa-r1';
console.log('REVIEWED_CORE_SHA256',crypto.createHash('sha256').update(fs.readFileSync(corePath)).digest('hex'));
const options={sourceRevision:rev};
function recipe({base='none',inverted=false,feather=0,commands=[]}={}){return {version:1,sourceRevision:rev,base,inverted,feather,commands};}
function brush(mode='add',points=[{x:.5,y:.5}],radius=.15){return {kind:'brush',mode,radius,points};}
function lasso(mode='add'){return {kind:'lasso',mode,points:[{x:.2,y:.2},{x:.8,y:.2},{x:.8,y:.8},{x:.2,y:.8}]};}
function push(extra={}){return {kind:'push',sourceRevision:rev,radius:.22,strength:.8,points:[{x:.38,y:.5},{x:.58,y:.5}],selection:null,...extra};}
function dataEq(a,b){assert.equal(Buffer.compare(Buffer.from(a.data),Buffer.from(b.data)),0);}
function raster(r,w=128,h=96){return M.rasterizeSelection(w,h,r,options);}
test('empty selection is not unrestricted null',()=>{const a=raster(recipe()),b=raster(null);assert.equal(a.length,128*96);assert.ok(a.every(v=>v===0));if(b!==null)assert.ok(b.every(v=>v===1));});
test('all selection and inversion round-trip',()=>{assert.ok(raster(recipe({base:'all'})).every(v=>v===1));assert.ok(raster(recipe({base:'all',inverted:true})).every(v=>v===0));const r=recipe({commands:[brush()],feather:.025});const a=raster(r),b=raster({...r,inverted:true});for(let i=0;i<a.length;i++)assert.ok(Math.abs(a[i]+b[i]-1)<1e-6);assert.deepEqual(raster({...r,inverted:false}),a);});
test('brush union/subtract and lasso are actual masks',()=>{const a=raster(recipe({commands:[lasso()]}));assert.equal(a[48*128+64],1);assert.equal(a[5*128+5],0);const b=raster(recipe({commands:[lasso(),brush('subtract',undefined,.08)]}));assert.equal(b[48*128+64],0);assert.equal(b[35*128+40],1);});
test('feather produces bounded finite partial weights',()=>{const a=raster(recipe({commands:[brush()],feather:.03}));assert.ok(a.every(v=>Number.isFinite(v)&&v>=0&&v<=1));assert.ok(a.some(v=>v>0&&v<1));assert.ok(a.some(v=>v===0));});
test('selection rasterizer does not mutate recipe',()=>{const r=recipe({commands:[brush(),lasso('subtract')],feather:.02});const s=JSON.stringify(r);raster(r);assert.equal(JSON.stringify(r),s);});
test('stale selection/source revision rejected',()=>assert.throws(()=>raster({...recipe(),sourceRevision:'other-photo'})));
test('non-finite selection coordinate rejected',()=>assert.throws(()=>raster(recipe({commands:[brush('add',[{x:NaN,y:.5}])]}))));
test('unknown selection field rejected',()=>assert.throws(()=>raster({...recipe(),ignoreSelection:true})));
test('zero-area lasso rejected or has no selected pixels',()=>{let r;try{r=raster(recipe({commands:[{kind:'lasso',mode:'add',points:[{x:.5,y:.5},{x:.5,y:.5},{x:.5,y:.5}]}]}),129,97);}catch(e){assert.ok(e instanceof Error);return;}assert.ok(r.every(v=>v===0));});
test('cancelled rasterization stops, preserving recipe',()=>{const r=recipe({commands:[brush()]});const s=JSON.stringify(r);assert.throws(()=>M.rasterizeSelection(128,96,r,{...options,shouldCancel:()=>true}));assert.equal(JSON.stringify(r),s);});
test('liquify does not mutate input image or commands',()=>{const a=F.grid(),before=F.copy(a),cmd=[push()],s=JSON.stringify(cmd);const out=M.liquify(a,cmd,options);dataEq(a,before);assert.equal(JSON.stringify(cmd),s);assert.equal(out.width,a.width);assert.equal(out.height,a.height);assert.ok(F.changed(a,out)>0);});
test('zero strength and empty command list are byte-exact original',()=>{const a=F.grid();dataEq(M.liquify(a,[],options),a);dataEq(M.liquify(a,[push({strength:0})],options),a);});
test('explicit empty selection makes push exact no-op',()=>{const a=F.grid();dataEq(M.liquify(a,[push({selection:recipe()})],options),a);});
test('non-selected pixels and alpha are byte-exact after push',()=>{const a=F.grid();for(let i=3;i<a.data.length;i+=4)a.data[i]=(i*13)%256;const r=recipe({commands:[{kind:'lasso',mode:'add',points:[{x:0,y:0},{x:.5,y:0},{x:.5,y:1},{x:0,y:1}]}]});const mask=raster(r),out=M.liquify(a,[push({selection:r})],options);let selectedChanges=0;for(let p=0;p<mask.length;p++){const i=p*4;assert.equal(out.data[i+3],a.data[i+3]);if(mask[p]===0)assert.deepEqual(out.data.slice(i,i+4),a.data.slice(i,i+4));else if(out.data[i]!==a.data[i])selectedChanges++;}assert.ok(selectedChanges>0);});
test('liquify identical replay is deterministic',()=>{const a=F.grid(),cmd=[push(),push({points:[{x:.58,y:.5},{x:.4,y:.58}]}),push({kind:'restore',radius:.15,points:[{x:.5,y:.5}]})];dataEq(M.liquify(a,cmd,options),M.liquify(a,cmd,options));});
test('cancelled liquify preserves original',()=>{const a=F.grid(),b=F.copy(a);assert.throws(()=>M.liquify(a,[push()],{...options,shouldCancel:()=>true}));dataEq(a,b);});
test('liquify rejects stale command and invalid strength',()=>{const a=F.grid();assert.throws(()=>M.liquify(a,[push({sourceRevision:'wrong'})],options));assert.throws(()=>M.liquify(a,[push({strength:NaN})],options));});
test('liquify rejects oversize command list instead of truncating',()=>assert.throws(()=>M.liquify(F.grid(),Array.from({length:129},()=>push()),options)));
test('normalized non-square selection maps to expected center/radius',()=>{for(const [w,h] of [[128,96],[256,192],[96,128]]){const r=raster(recipe({commands:[brush('add',[{x:.25,y:.75}],.05)]}),w,h);const cx=Math.round(.25*(w-1)),cy=Math.round(.75*(h-1));assert.equal(r[cy*w+cx],1);assert.equal(r[Math.min(h-1,cy+Math.ceil(Math.min(w,h)*.1))*w+cx],0);}});
