'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { CLASSES, decodeParsingResult, makeClassMask, colorizeLabels, makeConservativeSkinMasks } = require('../backend/adapters/segface/mask.cjs');
const manifest = require('../backend/adapters/segface/manifest.json');

function fixture(w = 2, h = 1) {
  const bytes = new Uint8Array(w * h * CLASSES.length * 4);
  const view = new DataView(bytes.buffer);
  for (let p = 0; p < w * h; p++) {
    view.setFloat32(p * 4, 0.25, true);
    view.setFloat32((2 * w * h + p) * 4, 0.75, true);
  }
  return { kind: 'parsing', width: w, height: h, classes: [...CLASSES], data: bytes,
    layout: 'planar', encoding: 'unit-float32-le', space: 'roi-original-pixels' };
}

test('desktop Float32Array results require explicit layout and encoding', () => {
  const wire = fixture();
  const data = decodeParsingResult(wire).probabilities;
  const typed = { ...wire, data, encoding: 'unit-float32' };
  assert.deepEqual([...makeClassMask(typed).data], [0.75, 0.75]);
  for (const patch of [{encoding: undefined}, {encoding: 'unit-float32-le'}, {layout:'interleaved'}, {space:'image'}]) {
    assert.throws(() => decodeParsingResult({...typed,...patch}));
  }
  assert.throws(() => decodeParsingResult({...wire,encoding:'unit-float32'}));
  assert.throws(() => decodeParsingResult({...wire,encoding:undefined}));
});

test('SegFace pins exact official code and checkpoint identities', () => {
  assert.equal(manifest.code.revision, '9416628e7b5a3e4b9a1068b8467bdc0cf0be7a7d');
  assert.equal(manifest.weights.variants.mobilenet.bytes, 84928824);
  assert.equal(manifest.weights.variants.swin_base.bytes, 1093095540);
  for (const asset of Object.values(manifest.weights.variants)) assert.match(asset.sha256, /^[a-f0-9]{64}$/);
  assert.equal(manifest.runtimeStatus, 'not_validated');
});

test('skin mask uses class 2 and preserves exact ROI geometry with owned bytes', () => {
  const source = fixture();
  const mask = makeClassMask(source);
  assert.deepEqual([...mask.data], [0.75, 0.75]);
  assert.equal(mask.width, 2); assert.equal(mask.height, 1);
  assert.equal(mask.space, 'roi-original-pixels');
  assert.deepEqual(mask.analysis.classIds, [2]);
  source.data.fill(0);
  assert.deepEqual([...mask.data], [0.75, 0.75]);
});

test('union class mask is explicit, normalized, and not an image edit', () => {
  assert.deepEqual([...makeClassMask(fixture(), ['skin', 'background']).data], [1, 1]);
  assert.throws(() => makeClassMask(fixture(), ['skin', 'skin']));
  assert.throws(() => makeClassMask(fixture(), ['face']));
  assert.throws(() => makeClassMask(fixture(), []));
});

test('malformed, nonfinite, out-of-range and unnormalized probabilities fail closed', () => {
  const wrong = fixture(); wrong.classes[2] = 'face'; assert.throws(() => decodeParsingResult(wrong));
  for (const v of [NaN, Infinity, -0.1, 1.1, 0.1]) {
    const f = fixture(); new DataView(f.data.buffer).setFloat32(0, v, true);
    assert.throws(() => decodeParsingResult(f));
  }
  assert.throws(() => decodeParsingResult({ ...fixture(), data: new Uint8Array(1) }));
  assert.throws(() => decodeParsingResult({ ...fixture(), width: 1048577 }));
});

test('label visualization is explicitly separate from retouched photo', () => {
  const palette = CLASSES.map((_, i) => [i, 0, 0]);
  const image = colorizeLabels(fixture(), palette);
  assert.deepEqual([...image.data], [2, 0, 0, 255, 2, 0, 0, 255]);
  assert.match(image.purpose, /not-retouched-photo/);
});

test('conservative masks protect an eye neighborhood, ROI edge and uncertainty', () => {
  const width = 9, height = 9, pixels = width * height;
  const data = new Float32Array(pixels * CLASSES.length);
  data.fill(1, 2 * pixels, 3 * pixels);
  const eye = 4 * width + 4; data[2 * pixels + eye] = 0; data[8 * pixels + eye] = 1;
  const result = { kind:'parsing', width, height, classes:[...CLASSES], data,
    layout:'planar',encoding:'unit-float32',space:'roi-original-pixels' };
  const masks = makeConservativeSkinMasks(result, {guardRadiusPx:1});
  for (let y=3;y<=5;y++) for(let x=3;x<=5;x++) assert.equal(masks.skin[y*width+x],0);
  for (let x=0;x<width;x++) assert.equal(masks.skin[x],0);
  assert.equal(masks.skin[2*width+2],1);
  for (let i=0;i<pixels;i++) assert.equal(masks.skin[i]+masks.protected[i],1);
  assert.deepEqual(masks.policy.maskClasses.skin,['skin','nose']);
  assert.equal(masks.policy.guard.units,'original-roi-pixels');
  assert.match(masks.policy.kind,/not-a-retouch-model/);
  data.fill(0);data.fill(0.6,2*pixels,3*pixels);data.fill(0.4,0,pixels);
  assert.ok(makeConservativeSkinMasks(result,{guardRadiusPx:1}).skin.every(v=>v===0));
});

test('conservative mask policy is bounded and caller choices are explicit', () => {
  for(const options of [{guardRadiusPx:0},{guardRadiusPx:33},{lowConfidence:.9,fullConfidence:.8},{lowConfidence:NaN},{unreviewedOption:1}]) {
    assert.throws(()=>makeConservativeSkinMasks(fixture(),options));
  }
});

test('fast square guard matches a naive original-pixel neighborhood reference', () => {
  for (const [width,height] of [[3,7],[11,9],[4,4]]) for(const radius of [1,2,3]) {
    const pixels=width*height, values=new Float32Array(pixels*CLASSES.length);
    for(let i=0;i<pixels;i++) { values[2*pixels+i]=.7+((i*17)%29)/100; values[i]=1-values[2*pixels+i]; }
    const result={kind:'parsing',width,height,classes:[...CLASSES],data:values,layout:'planar',encoding:'unit-float32',space:'roi-original-pixels'};
    const actual=makeConservativeSkinMasks(result,{guardRadiusPx:radius}).skin;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      let min=1;
      for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){
        const px=x+dx,py=y+dy;min=Math.min(min,px<0||py<0||px>=width||py>=height?0:values[2*pixels+py*width+px]);
      }
      const t=Math.max(0,Math.min(1,(min-.65)/.3)),expected=Math.min(min,t*t*(3-2*t));
      assert.ok(Math.abs(actual[y*width+x]-expected)<1e-6);
    }
  }
});

test('stdlib-only Python adapter safety tests use no model or third-party execution', () => {
  const run = spawnSync(process.env.PYTHON || 'python', [path.join(__dirname, 'segface-synthetic.py')], {
    cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 30000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }
  });
  assert.equal(run.status, 0, run.stdout + run.stderr);
});
