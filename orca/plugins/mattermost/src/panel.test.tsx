import { assert, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'
test('native panel creates, pauses, checks and shows inbox without publishing', async()=>{
 const calls:any[]=[]
 const w={id:'watch',title:'QA',kind:'thread',url:'https://mm.example/t/pl/p',owner:'bot',chat:'chat',interval:5,rule:'QA',timezone:'UTC',schedule_state:'active'}
 const host=mockHost({requests:{mattermost:(input:any)=>{calls.push(input);return input.op==='list'?{watches:[w]}:input.op==='inbox'?{rows:[{id:1,headline:'QA replied',body:'Ready',draft:'Thanks',source:'QA',url:w.url,created:1800000000}],more:false,before:null}:input.op==='connection'?{url:'https://mm.example',hasCookie:true}:{outcome:'quiet'}}}})
 const view=await mount(panel,{host})
 await view.press({text:'Проверить сейчас'});assert.ok(calls.some(c=>c.op==='check'&&c.id==='watch'))
 await view.press({text:'Пауза'});assert.ok(calls.some(c=>c.op==='pause'))
 await view.press({text:'Новая подписка'})
 await view.type({label:'Ветка или канал — ссылка'},w.url)
 await view.type({label:'Бот Orca'},'helper')
 await view.type({label:'ID чата бота'},'chat-2')
 await view.type({label:'Когда уведомлять'},'Нужен мой ответ')
 await view.press({text:'Сохранить'})
 assert.ok(calls.some(c=>c.op==='create'&&c.form.owner==='helper'))
 await view.select({label:'Mattermost'},'inbox')
 assert.ok(view.find({type:'Card',label:'QA replied'}))
 assert.deepEqual(view.errors,[]);assert.deepEqual(view.warnings,[]);assert.deepEqual(view.refusals,[])
 await view.unmount()
})

test('testing a fresh cookie preserves it until Save succeeds', async()=>{
 const calls:any[]=[]
 const host=mockHost({requests:{mattermost:(input:any)=>{
  calls.push(input)
  if(input.op==='list')return {watches:[]}
  if(input.op==='inbox')return {rows:[],more:false,before:null}
  if(input.action==='status')return {url:'',hasCookie:false}
  if(input.action==='test')return {username:'tester'}
  return {url:input.data.url,hasCookie:true}
 }}})
 const view=await mount(panel,{host})
 await view.select({label:'Mattermost'},'connection')
 await view.type({label:'Адрес Mattermost'},'https://mm.example')
 await view.type({label:'Cookie сессии'},'MMAUTHTOKEN=fixture')
 await view.press({text:'Проверить соединение'})
 await view.press({text:'Сохранить соединение'})
 assert.equal(calls.find(c=>c.action==='save').data.cookie,'MMAUTHTOKEN=fixture')
 assert.deepEqual(view.errors,[])
 await view.unmount()
})

test('inbox paging replaces the page and exposes complete draft copy', async()=>{
 const calls:any[]=[]
 const host=mockHost({requests:{mattermost:(input:any)=>{
  calls.push(input)
  if(input.op==='list')return {watches:[]}
  if(input.op==='inbox')return {rows:[{id:input.before?1:2,headline:input.before?'Older':'Latest',source:'QA',body:'Preview',draft:'Reply',url:'https://mm.example/t/pl/p',created:1800000000}],more:!input.before,before:input.before?1:2}
  return {url:'',hasCookie:false}
 }}})
 const view=await mount(panel,{host})
 await view.select({label:'Mattermost'},'inbox')
 await view.press({text:'Предыдущие сводки'})
 assert.ok(view.find({type:'Card',label:'Older'}))
 assert.equal(view.find({type:'Card',label:'Latest'}),null)
 await view.press({text:'Копировать черновик'})
 assert.ok(calls.some(c=>c.op==='copy'&&c.id===1))
 await view.press({text:'Последние сводки'})
 assert.ok(view.find({type:'Card',label:'Latest'}))
 assert.deepEqual(view.errors,[]);assert.deepEqual(view.warnings,[])
 await view.unmount()
})

test('partial pause failure refreshes the committed suspended state',async()=>{
 const w:any={id:'watch',title:'QA',kind:'thread',url:'https://mm.example/t/pl/p',owner:'bot',chat:'chat',interval:5,rule:'QA',timezone:'UTC',schedule_state:'active'}
 const host=mockHost({requests:{mattermost:(input:any)=>{
  if(input.op==='list')return {watches:[{...w}]}
  if(input.op==='inbox')return {rows:[],more:false,before:null}
  if(input.op==='pause'){w.suspended=true;throw new Error('Schedule timeout')}
  return {url:'',hasCookie:false}
 }}})
 const view=await mount(panel,{host})
 await view.press({text:'Пауза'})
 assert.ok(view.find({text:'Возобновить'}))
 assert.ok(view.find({text:'Schedule timeout'}))
 await view.unmount()
})

test('expired subscription removal requires confirmation and refreshes the list',async()=>{
 let removed=false
 const w={id:'ended',title:'Expired QA',kind:'thread',url:'https://mm.example/t/pl/p',owner:'bot',chat:'chat',interval:5,rule:'QA',timezone:'UTC',schedule_state:'disabled',paused:true}
 const host=mockHost({requests:{mattermost:(input:any)=>{
  if(input.op==='list')return {watches:removed?[]:[w]}
  if(input.op==='inbox')return {rows:[],more:false,before:null}
  if(input.op==='unwatch'){assert.equal(input.id,'ended');removed=true;return {stopped:'ended'}}
  return {url:'',hasCookie:false}
 }}})
 const view=await mount(panel,{host})
 await view.press({text:'Удалить завершённую'})
 assert.equal(removed,false)
 await view.press({text:'Подтвердить удаление'})
 assert.equal(removed,true)
 assert.ok(view.find({text:'Подписок пока нет'}))
 assert.deepEqual(view.errors,[]);assert.deepEqual(view.warnings,[])
 await view.unmount()
})
