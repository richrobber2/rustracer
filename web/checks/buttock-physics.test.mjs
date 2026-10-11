import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {TissueSystem} from '../src/tissue-physics.js';
import {BodyMorph,DEFAULT_PROPORTIONS} from '../src/body-proportions.js';
const run=(s,t)=>{for(let i=0;i<t*60;i++)s.step(1/60);};
for(const sex of ['female','male'])test(`${sex} buttock controls isolate rear hips, stabilize support and recover`,()=>{
 const data=JSON.parse(fs.readFileSync(new URL(`../public/bodies/${sex}-cage.json`,import.meta.url)));
 const soft=new TissueSystem(data),firm=new TissueSystem(data);
 const ids=Array.from(soft.regions.keys()).filter(i=>soft.regions[i]===9);
 assert.ok(ids.length>10);
 for(const i of ids){assert.equal(data.regions[i],3);assert.ok(data.positions[i*3+2]<0);}
 let id=ids.reduce((a,b)=>soft.buttAttachment[a]<soft.buttAttachment[b]?a:b);
 const point=data.positions.slice(id*3,id*3+3),normal=data.normals.slice(id*3,id*3+3);
 soft.configure({region:9,gravity:0,buttCompliance:2});firm.configure({region:9,gravity:0,buttCompliance:.5});
 soft.beginGrab(point,normal);firm.beginGrab(point,normal);
 assert.ok(soft.grab.ids.every(i=>soft.regions[i]===9));
 run(soft,1);run(firm,1);
 const magnitude=s=>Math.hypot(...s.offset.slice(id*3,id*3+3));
 assert.ok(magnitude(soft)>magnitude(firm));
 soft.endGrab();run(soft,3);assert.ok(magnitude(soft)<.0002);
 soft.configure({buttCompliance:2,buttDamping:0,stiffness:1,gravity:2,strength:3});soft.vibration=true;run(soft,1);
 assert.ok(soft.offset.every(Number.isFinite));
 for(const i of ids)assert.ok(Math.hypot(...soft.offset.slice(i*3,i*3+3))<=soft.limits[i]+1e-7);
 const morph=new BodyMorph(data.positions,data.genitalWeights,data);
 const full=morph.apply({...DEFAULT_PROPORTIONS,buttocks:1.4}).slice();
 let changed=0;for(let i=0;i<data.regions.length;i++){const j=i*3;assert.equal(full[j],morph.base[j]);assert.equal(full[j+1],morph.base[j+1]);if(full[j+2]!==morph.base[j+2]){changed++;assert.ok(morph.base[j+2]<0);assert.ok(full[j+2]<=morph.base[j+2]);}}
 assert.ok(changed>0);assert.deepEqual(morph.apply(DEFAULT_PROPORTIONS),morph.base);
});
