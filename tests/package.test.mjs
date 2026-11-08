import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { readConfig, DEFAULTS } from '../shared/core.ts';
const archive=gunzipSync(readFileSync('dist/app.unipheas.skywatch.tgz'));
const entries=new Map();
for(let offset=0;offset+512<=archive.length;){
  const header=archive.subarray(offset,offset+512);
  const name=header.subarray(0,100).toString().split('\0')[0];if(!name)break;
  const prefix=header.subarray(345,500).toString().split('\0')[0];
  const full=prefix?`${prefix}/${name}`:name;
  const size=parseInt(header.subarray(124,136).toString().replace(/\0/g,'').trim()||'0',8);
  assert.ok(Number.isFinite(size));
  assert.ok(!entries.has(full));
  entries.set(full,{type:String.fromCharCode(header[156]),body:archive.subarray(offset+512,offset+512+size)});
  offset+=512+Math.ceil(size/512)*512;
}
const root='app.unipheas.skywatch/';
test('archive contains exactly one app root, required metadata and icons, and no macOS metadata or links',()=>{
  const allowed=new Set([root,root+'appmeta/',root+'scripts/',root+'scripts/main.js',...['manifest.json','settings.json','icon_front_8x8.png','icon_back_11x11.png'].map(x=>root+'appmeta/'+x)]);
  assert.deepEqual(new Set(entries.keys()),allowed);
  for(const e of entries.values())assert.ok(['0','5','\0'].includes(e.type));
  const manifest=JSON.parse(entries.get(root+'appmeta/manifest.json').body);
  assert.equal(manifest.id,'app.unipheas.skywatch');assert.equal(manifest.version,JSON.parse(readFileSync('package.json')).version);
  for(const [name,size] of [['front_8x8',8],['back_11x11',11]]){
    const png=entries.get(root+'appmeta/icon_'+name+'.png').body;
    assert.equal(png.subarray(1,4).toString(),'PNG');assert.equal(png.readUInt32BE(16),size);assert.equal(png.readUInt32BE(20),size);
  }
});
test('native settings defaults agree with runtime and contain no fixed private location',()=>{
  const settings=JSON.parse(entries.get(root+'appmeta/settings.json').body);
  assert.equal(settings.version,1);
  const defaults=Object.fromEntries(Object.entries(settings.fields).map(([k,v])=>[k,v.default]));
  assert.deepEqual(readConfig(defaults),DEFAULTS);
  assert.equal(defaults.location.mode,'auto');assert.equal(defaults.location.lat,undefined);
});
