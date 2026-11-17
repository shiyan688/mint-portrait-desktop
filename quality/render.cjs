'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=__dirname, enginePath=path.resolve(process.argv[2]||path.join(root,'../src/portrait-engine.cjs'));
const engine=require(enginePath), tag=process.argv[3]||'candidate';
const variants=[['original',{}],['brighten25',{brighten:25}],['brighten50',{brighten:50}],['brighten100',{brighten:100}],['smooth50',{smooth:50}],['smooth100',{smooth:100}],['combined50',{smooth:50,brighten:50}],['combined100',{smooth:100,brighten:100}],['warm100',{smooth:100,brighten:100,warmth:100}],['cool100',{smooth:100,brighten:100,warmth:-100}]];
const outDir=path.join(root,'comparisons',tag);fs.mkdirSync(outDir,{recursive:true});
const manifest={engine:enginePath,sha256:crypto.createHash('sha256').update(fs.readFileSync(enginePath)).digest('hex'),generatedAt:new Date().toISOString(),results:[]};
for(const id of ['victor','suni','eileen']){
 const meta=JSON.parse(fs.readFileSync(path.join(root,'fixtures',id+'.json')));
 const lm=JSON.parse(fs.readFileSync(path.join(root,'fixtures',id+'.landmarks.json')));
 if(!lm.faces.length||lm.faces[0].length<468)throw Error('Real landmarks missing');
 const image={width:meta.width,height:meta.height,data:new Uint8ClampedArray(fs.readFileSync(path.join(root,'fixtures',id+'.rgba')))};
 for(const [name,settings]of variants){
  const start=performance.now(),out=engine.beauty(image,settings,lm.faces[0]),ms=performance.now()-start;
  fs.writeFileSync(path.join(outDir,id+'-'+name+'.rgba'),out.data);
  manifest.results.push({id,name,settings,width:out.width,height:out.height,ms:Math.round(ms*10)/10});
 }
}
fs.writeFileSync(path.join(outDir,'run.json'),JSON.stringify(manifest,null,2));console.log(tag,manifest.sha256,manifest.results.length+' renders');
