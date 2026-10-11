import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TissueSystem } from '../src/tissue-physics.js';
import { BodyMorph, DEFAULT_PROPORTIONS, readCharacter } from '../src/body-proportions.js';
import { buttockSamples, ButtockMap } from '../src/buttock-map.js';
for (const sex of ['female','male']) test(`${sex} composition remains reversible and bounded, and map reports actual motion`,()=>{
 const d=JSON.parse(fs.readFileSync(new URL(`../public/bodies/${sex}-cage.json`,import.meta.url)));
 const morph=new BodyMorph(d.positions,d.genitalWeights,d);
 for(const muscle of [.75,1.4])for(const fat of [.5,1.75]){
  const shape={...DEFAULT_PROPORTIONS,gluteMuscle:muscle,buttFat:fat};
  const rest=morph.apply(shape).slice();assert.ok(rest.every(Number.isFinite));
  for(let i=0;i<rest.length/3;i++)if(morph.base[i*3+2]>=0)assert.deepEqual(Array.from(rest.slice(i*3,i*3+3)),Array.from(morph.base.slice(i*3,i*3+3)));
  const s=new TissueSystem(d);s.configure({buttMuscle:muscle,buttFat:fat,region:9,strength:3,buttSide:2});s.setRest(rest);
  assert.ok(buttockSamples(s).every(p=>p.mm===0));s.impulse();for(let i=0;i<90;i++)s.step(1/60);
  const samples=buttockSamples(s);assert.ok(samples.length>10);assert.ok(samples.some(p=>p.mm>0));
  for(const p of samples){assert.ok(Number.isFinite(p.mm));assert.ok(p.mm<=s.limits[p.id]*1000+1e-4);}
  s.reset();assert.ok(buttockSamples(s).every(p=>p.mm===0));
 }
 assert.deepEqual(morph.apply(DEFAULT_PROPORTIONS),morph.base);
 const legacy=readCharacter({version:1,sex,proportions:{buttocks:1.25}});
 assert.equal(legacy.proportions.buttocks,1.25);assert.equal(legacy.proportions.gluteMuscle,1);assert.equal(legacy.proportions.buttFat,1);
 assert.deepEqual(readCharacter(JSON.parse(JSON.stringify(legacy))),legacy);
});
test('map stays synchronized when paused and throttles redraws',()=>{
 const d=JSON.parse(fs.readFileSync(new URL('../public/bodies/female-cage.json',import.meta.url)));const s=new TissueSystem(d);
 let paints=0;const context={fillRect(){paints++;},beginPath(){},moveTo(){},lineTo(){},stroke(){},fillText(){},arc(){},fill(){}};
 const canvas={width:320,height:190,getContext:()=>context,setAttribute(){}};const status={textContent:''};const map=new ButtockMap(canvas,status);map.setSystem(s);
 const id=buttockSamples(s)[0].id;s.offset[id*3]=.012;s.paused=true;map.update(1);
 assert.match(status.textContent,/Paused/);assert.match(status.textContent,/12.0 mm/);const before=paints;map.update(50);assert.equal(paints,before);
 s.reset();map.update(101);assert.match(status.textContent,/peak 0.0 mm/);map.clear();assert.equal(map.system,null);
});
