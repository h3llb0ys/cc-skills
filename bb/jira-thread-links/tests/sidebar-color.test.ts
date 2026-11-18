import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createFakePluginHost} from '@get-bb/plugin-sdk/testing';
import plugin from '../server';
test('sidebar color is persisted, validated, reset and broadcast without changing bindings',async()=>{
 const {bb,harness}=createFakePluginHost({pluginId:'jira-thread-links'});
 plugin(bb);
 try {
  assert.deepEqual(await harness.behavior.callRpc('sidebarAppearance',null),{color:null});
  await harness.behavior.callRpc('saveSidebarAppearance',{color:'#8b5cf6'});
  assert.deepEqual(await harness.behavior.callRpc('sidebarAppearance',null),{color:'#8b5cf6'});
  assert.deepEqual(await bb.storage.kv.get('sidebar-appearance'),{color:'#8b5cf6'});
  await assert.rejects(harness.behavior.callRpc('saveSidebarAppearance',{color:'red; display:none'}));
  await harness.behavior.callRpc('saveSidebarAppearance',{color:null});
  assert.deepEqual(await harness.behavior.callRpc('sidebarAppearance',null),{color:null});
 }finally{await harness.lifecycle.dispose();}
});
