import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakePluginHost } from '@get-bb/plugin-sdk/testing';
import plugin from '../server';
const appearance={color:'#ec4899',icon:'folder',emoji:null};
test('persists independent overrides, broadcasts and resets without core writes',async()=>{
 const {bb,harness}=createFakePluginHost({pluginId:'section-style'});
 let current=harness;
 try {
  await plugin(bb);
  await Promise.all([
   harness.behavior.callRpc('save',{target:'section:sec_a',appearance}),
   harness.behavior.callRpc('save',{target:'section:sec_b',appearance:{...appearance,icon:null,emoji:'🚀'}}),
  ]);
  assert.equal(harness.realtimeSignals.length,2);
  current=(await harness.lifecycle.reload(plugin)).harness;
  assert.equal(Object.keys(await current.behavior.callRpc('list',null) as object).length,2);
  await current.behavior.callRpc('save',{target:'section:sec_a',appearance:null});
  assert.deepEqual(await current.behavior.callRpc('list',null),{'section:sec_b':{...appearance,icon:null,emoji:'🚀'}});
  assert.equal(current.realtimeSignals.length,1);
  assert.equal(harness.inspection.sdk.calls.length,0);
 } finally {await current.lifecycle.dispose();}
});
test('rejects unknown icons, CSS input, invalid emoji and invalid targets',async()=>{
 const {bb,harness}=createFakePluginHost({pluginId:'section-style'});
 try {
  await plugin(bb);
  for(const input of [
   {target:'section:sec_a',appearance:{...appearance,icon:'unknown'}},
   {target:'section:sec_a',appearance:{...appearance,color:'red;display:none'}},
   {target:'section:sec_a',appearance:{...appearance,icon:null,emoji:'🚀 hello'}},
   {target:'section:sec_a',appearance:{...appearance,emoji:'🚀'}},
   {target:'thread:thr_a',appearance},
  ]) await assert.rejects(()=>harness.behavior.callRpc('save',input));
  assert.deepEqual(await harness.behavior.callRpc('list',null),{});
 } finally {await harness.lifecycle.dispose();}
});
