'use strict';
// Source-level layout contracts only. These do not claim actual browser rendering,
// screenshot validation, keyboard interaction, native import, or model inference.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../src/index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../src/styles.css'), 'utf8');

function adjustmentSections() {
  const source = html.slice(html.indexOf('<div id="parameters"'), html.indexOf('<div class="right-footer"'));
  const sections = [];
  let depth = 0;
  for (const match of source.matchAll(/<\/?details\b[^>]*>/g)) {
    if (match[0].startsWith('</')) { depth--; continue; }
    if (depth++ === 0) sections.push({ id: /\bid="([^"]+)"/.exec(match[0])?.[1], open: /\sopen(?:\s|>|=)/.test(match[0]) });
  }
  assert.equal(depth, 0, 'adjustment details remain balanced');
  return sections;
}

function lastRule(selector) {
  const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(match => match[1].trim() === selector);
  assert.ok(rules.length, `${selector} has a CSS rule`);
  return rules.at(-1)[2];
}

test('desktop layout: everyday editing precedes local layers and experimental models in DOM order', () => {
  assert.deepEqual(adjustmentSections().map(section => section.id), [
    'framingSection', 'straightenSection', 'perspectiveSection', 'paddingSection','imageLayerSection','textSection', 'colorSection', 'lightBalanceSection', 'levelsSection', 'advancedToneSection', 'sharpnessSection', 'peopleSection', 'skinSection', 'faceColorSection', 'paintSection', 'redactionSection', 'manualSection', 'shapeSection',
    'healSection', 'backgroundSection', 'localSection', 'learnedSection',
  ]);
  assert.deepEqual(adjustmentSections().filter(section => section.open).map(section => section.id), ['colorSection', 'peopleSection', 'skinSection']);
  assert.match(html, /<details id="learnedSection"[^>]*><summary>/);
  assert.match(html, /<details id="localSection"[^>]*><summary>/);
});

test('desktop layout: unique IDs and label destinations survive inspector reorganization', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  const known = new Set(ids);
  assert.equal(known.size, ids.length, 'no duplicate IDs');
  for (const match of html.matchAll(/<label\b[^>]*\bfor="([^"]+)"/g)) {
    assert.ok(known.has(match[1]), `label target ${match[1]} exists`);
  }
  for (const id of ['importBtn', 'welcomeImport', 'fileInput', 'stripImport',
    'previewCanvas', 'compareDivider', 'parameters', 'colorControls', 'skinControls',
    'faceColorControls', 'facePalette', 'shapeControls', 'backgroundModes',
    'peopleEnable', 'peopleRedetect', 'peopleCancel', 'peopleDisable', 'peopleFaceSelect', 'peopleInspect', 'peopleResetFace', 'peopleStatus',
    'localLayerList', 'localLayerEditor', 'learnedParseBtn', 'learnedMatteBtn',
    'exportPlan', 'exportQueueList', 'retryExport', 'copyBtn', 'selectAll', 'removeBtn']) {
    assert.ok(known.has(id), `preserved UI contract: ${id}`);
  }
});

test('desktop layout: narrow and short windows scroll instead of permanently hiding desktop tools', () => {
  assert.match(lastRule('body'), /min-width:\s*0\s*;/);
  assert.match(lastRule('body'), /overflow:\s*auto\s*;/);
  assert.match(lastRule('.app'), /min-width:\s*960px\s*;/);
  assert.match(lastRule('.app'), /height:\s*100dvh\s*;/);
  assert.match(lastRule('.app'), /min-height:\s*680px\s*;/);
  assert.match(css, /\.parameters\{overflow-y:auto;flex:1/);
  assert.match(css, /\.presets\{overflow-y:auto;/);
  assert.match(lastRule('.local-layer-list'), /max-height:\s*250px/);
  assert.match(lastRule('.local-layer-list'), /overflow-y:\s*auto/);
});

test('desktop layout: all width breakpoints retain a three-column desktop workbench', () => {
  const columns = [...css.matchAll(/grid-template-columns:\s*(\d+)px\s+minmax\(\s*(\d+)px,\s*1fr\)\s+(\d+)px/g)]
    .map(match => match.slice(1).map(Number));
  assert.ok(columns.length >= 3);
  for (const [left, center, right] of columns) {
    assert.ok(left + center + right <= 960, `${left}/${center}/${right} fit the desktop minimum width`);
    assert.ok(center >= 420 && left >= 160 && right >= 270);
  }
  assert.match(lastRule('.canvas-tools'), /min-width:\s*0/);
  assert.match(lastRule('.zoom-tools'), /flex-shrink:\s*0/);
  assert.match(lastRule('.viewport:focus-visible'), /outline:\s*2px solid var\(--mint\)\s*!important/);
});
