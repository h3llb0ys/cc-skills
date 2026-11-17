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
test('migrates legacy overrides on save and never resurrects a reset',async()=>{
 const {bb,harness}=createFakePluginHost({pluginId:'section-style'});
 try {
  await bb.storage.kv.set('appearance-index',['section:sec_a','section:sec_b']);
  await bb.storage.kv.set('appearance:section:sec_a',appearance);
  await bb.storage.kv.set('appearance:section:sec_b',appearance);
  plugin(bb);
  assert.equal(Object.keys(await harness.behavior.callRpc('list',null) as object).length,2);
  await harness.behavior.callRpc('save',{target:'section:sec_a',appearance:null});
  await harness.behavior.callRpc('save',{target:'section:sec_b',appearance:null});
  assert.deepEqual(await harness.behavior.callRpc('list',null),{});
  assert.deepEqual(await bb.storage.kv.get('appearances'),{});
 } finally {await harness.lifecycle.dispose();}
});
test('failed storage writes preserve old values and the queue recovers',async()=>{
 const {bb,harness}=createFakePluginHost({pluginId:'section-style'});
 let fail=false;
 const set=bb.storage.kv.set.bind(bb.storage.kv);
 plugin({...bb,storage:{...bb.storage,kv:{...bb.storage.kv,set:async(key,value)=>{
  if(fail)throw new Error('storage unavailable');
  await set(key,value);
 }}}});
 try {
  await harness.behavior.callRpc('save',{target:'section:sec_a',appearance});
  fail=true;
  await assert.rejects(()=>harness.behavior.callRpc('save',{target:'section:sec_a',appearance:null}),/storage unavailable/);
  await assert.rejects(()=>harness.behavior.callRpc('save',{target:'section:sec_b',appearance}),/storage unavailable/);
  assert.deepEqual(await harness.behavior.callRpc('list',null),{'section:sec_a':appearance});
  assert.equal(harness.realtimeSignals.length,1);
  fail=false;
  await harness.behavior.callRpc('save',{target:'section:sec_a',appearance:null});
  assert.deepEqual(await harness.behavior.callRpc('list',null),{});
 } finally {await harness.lifecycle.dispose();}
});
test('font sizes are bounded, saved with new icons, and old settings still load',async()=>{
 const {bb,harness}=createFakePluginHost({pluginId:'section-style'});
 try {
  await bb.storage.kv.set('appearances',{'section:sec_a':appearance});
  plugin(bb);
  assert.deepEqual(await harness.behavior.callRpc('list',null),{'section:sec_a':appearance});
  for(const fontSize of [9,19,12.5,'16']) await assert.rejects(()=>harness.behavior.callRpc('save',{target:'section:sec_a',appearance:{...appearance,fontSize}}));
  await harness.behavior.callRpc('save',{target:'section:sec_a',appearance:{...appearance,icon:'server',fontSize:18}});
  assert.deepEqual(await harness.behavior.callRpc('list',null),{'section:sec_a':{...appearance,icon:'server',fontSize:18}});
 } finally {await harness.lifecycle.dispose();}
});
