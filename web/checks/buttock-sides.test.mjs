import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {TissueSystem} from '../src/tissue-physics.js';
import {BodyMorph,DEFAULT_PROPORTIONS,readCharacter} from '../src/body-proportions.js';
import {SurfaceDeformer} from '../src/surface-deformer.js';
import {isolateButtockWeights} from '../src/buttock-sides.js';
const run=(s,t)=>{for(let i=0;i<t*60;i++)s.step(1/60);};
for(const sex of ['female','male']) {
 const data=JSON.parse(fs.readFileSync(new URL(`../public/bodies/${sex}-cage.json`,import.meta.url)));
 test(`${sex} wide one-sided touches, pulses, and vibration avoid opposite buttock`,()=>{
  for(const region of [-1,9])for(const side of [-1,1])for(const tool of ['press','pull']){
   const s=new TissueSystem(data);s.configure({region,gravity:0,radius:.25});
   const ids=Array.from(s.regions.keys()).filter(i=>s.regions[i]===9&&s.rest[i*3]*side>.02);
   const id=ids.reduce((a,b)=>Math.abs(s.rest[a*3])<Math.abs(s.rest[b*3])?a:b);
   assert.ok(s.beginGrab(Array.from(s.rest.slice(id*3,id*3+3)),Array.from(s.normals.slice(id*3,id*3+3)),tool)>0);
   assert.ok(s.grab.ids.every(i=>s.rest[i*3]*side>0));run(s,1);
   let active=0,opposite=0;for(let i=0;i<s.count;i++)if(s.regions[i]===9){const v=Math.hypot(...s.offset.slice(i*3,i*3+3));if(s.rest[i*3]*side>0)active=Math.max(active,v);else opposite=Math.max(opposite,v);}
   assert.ok(active>.005);assert.ok(opposite<.00005,`${sex} opposite ${opposite} region ${region}`);
  }
  for(const side of [-1,1]) {
   const s=new TissueSystem(data);s.configure({region:9,gravity:0,buttSide:side});s.impulse();
   assert.ok(Array.from(s.regions.keys()).some(i=>s.regions[i]===9&&s.rest[i*3]*side>0&&s.velocity[i*3]!==0));
   for(let i=0;i<s.count;i++)if(s.regions[i]===9&&s.rest[i*3]*side<0)assert.equal(Math.hypot(...s.velocity.slice(i*3,i*3+3)),0);
   s.vibration=true;run(s,1);for(let i=0;i<s.count;i++)if(s.regions[i]===9&&s.rest[i*3]*side<0)assert.ok(Math.hypot(...s.offset.slice(i*3,i*3+3))<.00005);
  }
  const both=new TissueSystem(data);both.configure({region:9,buttSide:2});both.impulse();for(const side of [-1,1])assert.ok(Array.from(both.regions.keys()).some(i=>both.regions[i]===9&&both.rest[i*3]*side>0&&both.velocity[i*3]!==0));
 });
 test(`${sex} asymmetric composition preserves the opposite rest shape and saved values`,()=>{
  const morph=new BodyMorph(data.positions,data.genitalWeights,data);
  for(const side of ['Left','Right']){
   const p={...DEFAULT_PROPORTIONS,['gluteMuscle'+side]:1.4,['buttFat'+side]:1.75};
   const out=morph.apply(p);let changed=0;for(let i=0;i<out.length/3;i++){
    const active=side==='Left'?morph.base[i*3]>0:morph.base[i*3]<0;
    if(!active)for(let k=0;k<3;k++)assert.equal(out[i*3+k],morph.base[i*3+k]);
    else if(out[i*3+2]!==morph.base[i*3+2])changed++;
   }assert.ok(changed>0);
   const preset=readCharacter({version:1,sex,proportions:p,tissue:{buttSide:side==='Left'?1:-1}});
   assert.deepEqual(readCharacter(JSON.parse(JSON.stringify(preset))),preset);
  }
 });
 test(`${sex} actual GLB skin weights preserve seams and isolate all connected regions`,async()=>{
  globalThis.self=globalThis;const loader=new GLTFLoader();loader.register(()=>({name:'HeadlessTextures',loadTexture:()=>Promise.resolve(new THREE.Texture())}));
  const bytes=fs.readFileSync(new URL(`../public/bodies/${sex}.glb`,import.meta.url));const gltf=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');let g;gltf.scene.traverse(n=>{if(n.geometry?.attributes._cage_index)g=n.geometry;});
  const s=new TissueSystem(data);assert.ok(isolateButtockWeights(g,s)>0);const base=g.attributes.position.array.slice();
  const deformer=new SurfaceDeformer(g,s.count);
  for(const region of [3,4,9,10,11,12,13,14,15]){
   s.offset.fill(0);for(let i=0;i<s.count;i++)if(s.regions[i]===region&&s.rest[i*3]>0)s.offset[i*3+2]=-.02;
   deformer.update(s.offset,{force:true,normals:true});const out=g.attributes.position.array;let active=0;
   for(let i=0;i<g.attributes.position.count;i++){
    const j=i*3;if(base[j]<-1e-6)assert.equal(out[j+2],base[j+2]);else active=Math.max(active,Math.abs(out[j+2]-base[j+2]));
    let sum=0;for(let k=0;k<4;k++)sum+=g.attributes._cage_weight.array[i*4+k];assert.ok(Math.abs(sum-1)<1e-5);
   }assert.ok(active>.015);
   const seen=new Map();for(let i=0;i<g.attributes.position.count;i++){const id=g.attributes._weld_index.array[i],key=Array.from(out.slice(i*3,i*3+3));if(seen.has(id))assert.deepEqual(key,seen.get(id));else seen.set(id,key);}
  }
 });
}
test('unilateral shape edit keeps unchanged opposite tissue motion, bilateral reset clears it',()=>{
 const d=JSON.parse(fs.readFileSync(new URL('../public/bodies/female-cage.json',import.meta.url)));const s=new TissueSystem(d);run(s,1);
 const offset=s.offset.slice(),velocity=s.velocity.slice();const m=new BodyMorph(d.positions,d.genitalWeights,d);
 s.setRest(m.apply({...DEFAULT_PROPORTIONS,gluteMuscleLeft:1.3}),1,1);
 let preserved=0;for(let i=0;i<s.count;i++)if(s.rest[i*3]<0){for(let k=0;k<3;k++){assert.equal(s.offset[i*3+k],offset[i*3+k]);assert.equal(s.velocity[i*3+k],velocity[i*3+k]);}preserved++;}assert.ok(preserved>0);
 s.setRest(m.apply(DEFAULT_PROPORTIONS));assert.ok(s.offset.every(v=>v===0));
});
