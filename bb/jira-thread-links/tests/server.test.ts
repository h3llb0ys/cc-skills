import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakePluginHost, makeThreadResponse } from '@get-bb/plugin-sdk/testing';
import plugin from '../server';
test('wire edit validates Jira, caches details, scopes tool and refuses stale writes', async () => {
 let calls=0;
 const {bb,harness} = createFakePluginHost({pluginId:'jira-thread-links', settings:{projectPrefixes:'{"proj_test":"AFT"}'}, sdk:{threads:{get:async ({threadId})=>makeThreadResponse({id:threadId,projectId:'proj_test'})}, plugins:{callRpc:async ({input})=>{calls++;const key=(input as {key:string}).key;if(key==='AFT-404')throw new Error('not found');return {issue:{key,summary:'Task',url:`https://jira.example/browse/${key}`}};}}}});
 plugin(bb);
 try {
   const edit=(keys:string[],expectedRevision:number)=>harness.behavior.callRpc('edit',{threadId:'thr_test',keys,expectedRevision,operation:'replace',reason:'manual'});
   await edit(['1196'],0);
   assert.equal(calls,1);
   await assert.rejects(edit(['AFT-404'],1),/not found/);
   await edit([],1);
   await assert.rejects(edit(['AFT-1196'],1),/changed/);
   const result = await harness.behavior.callRpc('list',{threadIds:['thr_test']}) as any;
   assert.equal(result.thr_test.revision,2);
   assert.deepEqual(result.thr_test.keys,[]);
   await harness.behavior.callAgentTool('jira_thread_tasks',{operation:'add',keys:['AFT-2'],expectedRevision:0,reason:'user asked'}, {threadId:'thr_other'});
   const other = await harness.behavior.callRpc('list',{threadIds:['thr_other','thr_test']}) as any;
   assert.deepEqual(other.thr_other.keys,['AFT-2']);
   assert.deepEqual(other.thr_test.keys,[]);
 } finally {await harness.lifecycle.dispose();}
});
test('expired issue cache refreshes the title and URL', async () => {
 let calls=0;
 const {bb,harness}=createFakePluginHost({pluginId:'jira-thread-links',sdk:{threads:{get:async ({threadId})=>makeThreadResponse({id:threadId})},plugins:{callRpc:async()=>{calls++;return {issue:{key:'AFT-1',summary:'New title',url:'https://new-jira.example/browse/AFT-1'}};}}}});
 plugin(bb);
 try {
   await bb.storage.kv.set('binding:thr_test',{keys:['AFT-1'],revision:1,reason:'test',updatedAt:1});
   await bb.storage.kv.set('issue:AFT-1',{key:'AFT-1',summary:'Old title',url:'https://old-jira.example/browse/AFT-1'});
   const result = await harness.behavior.callRpc('list',{threadIds:['thr_test']}) as any;
   assert.equal(calls,1);
   assert.equal(result.thr_test.issues[0].summary,'New title');
 } finally {await harness.lifecycle.dispose();}
});
test('saved badges survive a Jira outage and explicit refresh reports it', async () => {
 const {bb,harness}=createFakePluginHost({pluginId:'jira-thread-links',sdk:{threads:{get:async ({threadId})=>makeThreadResponse({id:threadId})},plugins:{callRpc:async()=>{throw new Error('Jira offline');}}}});
 plugin(bb);
 try {
   await bb.storage.kv.set('binding:thr_test',{keys:['AFT-1'],revision:1,reason:'test',updatedAt:1});
   await bb.storage.kv.set('issue:AFT-1',{issue:{key:'AFT-1',summary:'Saved title',url:'https://jira.example/browse/AFT-1'},checkedAt:0});
   const result=await harness.behavior.callRpc('list',{threadIds:['thr_test']}) as any;
   assert.equal(result.thr_test.issues[0].summary,'Saved title');
   await assert.rejects(harness.behavior.callRpc('refresh',{threadId:'thr_test'}),/offline/);
   await harness.behavior.callRpc('edit',{threadId:'thr_test',expectedRevision:1,operation:'replace',keys:[],reason:'manual'});
 } finally {await harness.lifecycle.dispose();}
});

test('imported Codex thread IDs work alongside native threads', async () => {
 const imported = 'thr_cdx_c79cd1ce30ad51ddbcbd1e9415444562';
 const {bb,harness} = createFakePluginHost({pluginId:'jira-thread-links',sdk:{threads:{get:async ({threadId})=>makeThreadResponse({id:threadId})}}});
 plugin(bb);
 try {
   await harness.behavior.callRpc('edit',{threadId:imported,expectedRevision:0,operation:'replace',keys:[],reason:'manual'});
   const result = await harness.behavior.callRpc('list',{threadIds:['thr_test',imported]}) as any;
   assert.equal(result[imported].revision,1);
   assert.deepEqual(result[imported].keys,[]);
   assert.equal(result.thr_test.revision,0);
   const refreshed = await harness.behavior.callRpc('refresh',{threadId:imported}) as any;
   assert.equal(refreshed.revision,1);
   await assert.rejects(harness.behavior.callRpc('list',{threadIds:['../thr_bad']}),/validation/);
 } finally {await harness.lifecycle.dispose();}
});

test('batch reads isolate failed threads and keep bindings with unavailable details editable', async () => {
 const {bb,harness} = createFakePluginHost({
   pluginId:'jira-thread-links',
   sdk:{
     threads:{get:async ({threadId})=>{
       if (threadId === 'thr_missing') throw new Error('Thread missing');
       return makeThreadResponse({id:threadId});
     }},
     plugins:{callRpc:async()=>{throw new Error('Jira offline');}},
   },
 });
 plugin(bb);
 try {
   await bb.storage.kv.set('binding:thr_test',{keys:['AFT-1','AFT-2'],revision:1,reason:'test',updatedAt:1});
   const result = await harness.behavior.callRpc('list',{threadIds:['thr_missing','thr_test']}) as Record<string, {keys:string[]; issues:unknown[]}>;
   assert.deepEqual(Object.keys(result), ['thr_test']);
   assert.deepEqual(result.thr_test.keys, ['AFT-1','AFT-2']);
   assert.deepEqual(result.thr_test.issues, []);
   await assert.rejects(harness.behavior.callRpc('list',{threadIds:['thr_missing']}),/Thread missing/);
   const updated = await harness.behavior.callRpc('edit',{
     threadId:'thr_test',expectedRevision:1,operation:'remove',keys:['AFT-1'],reason:'manual',
   }) as {keys:string[]; revision:number};
   assert.deepEqual(updated.keys, ['AFT-2']);
   assert.equal(updated.revision, 2);
 } finally {await harness.lifecycle.dispose();}
});

test('edit returns the committed revision without rereading the thread', async () => {
 let reads = 0;
 const {bb,harness} = createFakePluginHost({
   pluginId:'jira-thread-links',
   sdk:{threads:{get:async ({threadId})=>{
     if (++reads > 1) throw new Error('Thread temporarily unavailable');
     return makeThreadResponse({id:threadId});
   }}},
 });
 plugin(bb);
 try {
   const updated = await harness.behavior.callRpc('edit',{
     threadId:'thr_test',expectedRevision:0,operation:'replace',keys:[],reason:'manual',
   }) as {revision:number};
   assert.equal(updated.revision, 1);
   assert.equal(reads, 1);
 } finally {await harness.lifecycle.dispose();}
});

test('simultaneous cache misses for a shared issue make one Jira request', async () => {
 let calls = 0;
 const {bb,harness} = createFakePluginHost({
   pluginId:'jira-thread-links',
   sdk:{
     threads:{get:async ({threadId})=>makeThreadResponse({id:threadId})},
     plugins:{callRpc:async()=>{
       calls++;
       await new Promise(resolve=>setImmediate(resolve));
       return {issue:{key:'AFT-1',summary:'Task',url:'https://jira.example/browse/AFT-1'}};
     }},
   },
 });
 plugin(bb);
 try {
   const binding = {keys:['AFT-1'],revision:1,reason:'test',updatedAt:1};
   await bb.storage.kv.set('binding:thr_one',binding);
   await bb.storage.kv.set('binding:thr_two',binding);
   await harness.behavior.callRpc('list',{threadIds:['thr_one','thr_two']});
   assert.equal(calls, 1);
 } finally {await harness.lifecycle.dispose();}
});
