import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectCandidates } from '../lib/candidates';
import { createFakePluginHost, makeThreadResponse } from '@get-bb/plugin-sdk/testing';
import plugin from '../server';

test('extracts keys and URLs, deduplicates case, ignores numbers and key fragments', () => {
 const found = new Map();
 collectCandidates(`PRGROW-589 https://jira.example/browse/prgrow-589, AFT-12; 123 2026 xPRGROW-0 _AFT-3 AFT-4-extra KEY-1 ${'A'.repeat(100)}-1`,found);
 assert.deepEqual([...found.keys()],['PRGROW-589','AFT-12']);
 assert.match(found.get('PRGROW-589').context,/PRGROW-589/);
});

test('discovery pages through conversation, includes title, and does not change bindings', async () => {
 const calls: unknown[]=[];
 const {bb,harness}=createFakePluginHost({pluginId:'jira-thread-links',sdk:{threads:{
   get:async ({threadId})=>makeThreadResponse({id:threadId,title:'PRGROW-589'}),
   timeline:async (args:any)=>{
     calls.push(args);
     return {rows:args.beforeAnchorId ? [{kind:'conversation',role:'user',initiator:'user',text:'https://jira.example/browse/AFT-2'}] : [
       {kind:'turn',children:[{kind:'conversation',role:'assistant',text:'PRGROW-588, PRGROW-589'}]},
       {kind:'work',text:'IGNORE-1'}, {kind:'conversation',role:'user',initiator:'system',text:'IGNORE-2'}],
       timelinePage:{olderCursor:args.beforeAnchorId ? null : {anchorId:'old',anchorSeq:5}}} as any;
   }
 }}});
 plugin(bb);
 try {
   const result=await harness.behavior.callRpc('candidates',{threadId:'thr_test'}) as any;
   assert.deepEqual(result.candidates.map((c:any)=>c.key),['PRGROW-589','PRGROW-588','AFT-2']);
   assert.equal(result.truncated,false);
   assert.equal(calls.length,2);
   const view=await harness.behavior.callRpc('list',{threadIds:['thr_test']}) as any;
   assert.equal(view.thr_test.revision,0);
   assert.deepEqual(view.thr_test.keys,[]);
 } finally {await harness.lifecycle.dispose();}
});
