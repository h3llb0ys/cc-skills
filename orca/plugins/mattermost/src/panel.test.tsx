import { assert, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'
test('native form discovers recipients, previews source and creates subscription',async()=>{
 const calls:any[]=[]
 const host=mockHost({requests:{mattermost:(input:any)=>{
 calls.push(input)
 if(input.op==='list')return {watches:[]}
 if(input.op==='inbox')return {rows:[],more:false,before:null}
 if(input.op==='recipients')return input.owner?[{value:'chat',label:'Ответы на Q&A по сервисам'}]:[{value:'magabot',label:'magabot'}]
 if(input.op==='preview')return {url:input.url,title:'QA thread',kind:'thread',existing:null}
 return {url:'',hasCookie:true}
 }}})
 const view=await mount(panel,{host})
 await view.press({type:'Button',text:'Создать подписку'})
 await view.type({label:'Ссылка на ветку или канал'},'https://mm.example/t/pl/p')
 await view.press({text:'Проверить ссылку'})
 await view.select({label:'Первый разбор'},'new')
 const save=view.findAll({type:'Button',text:'Создать подписку'}).at(-1)!
 await view.press(save)
 assert.ok(calls.some(c=>c.op==='create'&&c.form.owner==='magabot'&&c.form.chat==='chat'&&c.form.firstReview==='new'))
 assert.deepEqual(view.errors,[]);assert.deepEqual(view.warnings,[])
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
 assert.equal(view.find({text:'Последние сводки'}),null)
 await view.press({text:'Предыдущие сводки'})
 assert.ok(view.find({type:'Card',label:'Older'}))
 assert.equal(view.find({type:'Card',label:'Latest'}),null)
 await view.press({label:'Копировать черновик'})
 assert.ok(calls.some(c=>c.op==='copy'&&c.id===1))
 await view.press({text:'Последние сводки'})
 assert.ok(view.find({type:'Card',label:'Latest'}))
 assert.equal(view.find({text:'Последние сводки'}),null)
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
 await view.toggle({type:'Collapsible',label:'⋯ Действия'})
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
 await view.toggle({type:'Collapsible',label:'⋯ Действия'})
 await view.press({text:'Удалить'})
 assert.equal(removed,false)
 await view.press({text:'Подтвердить удаление'})
 assert.equal(removed,true)
 assert.ok(view.find({type:'EmptyState'}))
 assert.deepEqual(view.errors,[]);assert.deepEqual(view.warnings,[])
 await view.unmount()
})

test('existing recipient can be changed by named chat in the action editor',async()=>{
 const calls:any[]=[]
 const w={id:'watch',title:'QA',kind:'thread',url:'https://mm.example/t/pl/p',owner:'bot',chat:'old',interval:5,rule:'Custom rule',timezone:'UTC',schedule_state:'active'}
 const host=mockHost({requests:{mattermost:(i:any)=>{calls.push(i);if(i.op==='list')return {watches:[w]};if(i.op==='inbox')return {rows:[],more:false,before:null};if(i.op==='recipients')return [{value:'old',label:'Old chat'},{value:'new',label:'New chat'}];return {url:'',hasCookie:false}}}})
 const view=await mount(panel,{host})
 await view.toggle({type:'Collapsible',label:'⋯ Действия'})
 await view.press({text:'Изменить'})
 await view.select({label:'Чат доставки'},'new')
 await view.press({text:'Сохранить'})
 assert.ok(calls.some(c=>c.op==='edit'&&c.id==='watch'&&c.form.chat==='new'))
 assert.deepEqual(view.errors,[]);assert.deepEqual(view.warnings,[])
 await view.unmount()
})

test('manual quiet check shows row result while status remains active',async()=>{
 const w={id:'watch',title:'QA',kind:'thread',url:'https://mm.example/t/pl/p',owner:'bot',chat:'chat',interval:5,rule:'QA',timezone:'UTC',schedule_state:'active',last_check_quiet:true}
 const host=mockHost({requests:{mattermost:(i:any)=>i.op==='list'?{watches:[w]}:i.op==='inbox'?{rows:[],more:false,before:null}:i.op==='check'?{outcome:'quiet'}:{url:'',hasCookie:true}}})
 const view=await mount(panel,{host})
 await view.press({label:'Проверить сейчас'})
 assert.ok(view.find({text:'Новых событий нет'}))
 assert.ok(view.find({text:/Активна/}))
 assert.deepEqual(view.errors,[]);assert.deepEqual(view.warnings,[])
 await view.unmount()
})


test('connection success stays in its tab while copy feedback stays global',async()=>{
 const host=mockHost({requests:{mattermost:(i:any)=>{
 if(i.op==='list')return {watches:[]}
 if(i.op==='inbox')return {rows:[{id:1,headline:'QA',source:'QA',body:'Ready',draft:'Reply',url:'https://mm.example/t/pl/p',created:1800000000}],more:false,before:1}
 if(i.action==='test')return {username:'tester'}
 return {url:'',hasCookie:true}
 }}})
 const view=await mount(panel,{host})
 await view.select({label:'Mattermost'},'connection')
 await view.press({text:'Проверить соединение'})
 assert.ok(view.find({text:'Соединение работает: tester'}))
 await view.select({label:'Mattermost'},'subscriptions')
 assert.equal(view.find({text:'Соединение работает: tester'}),null)
 await view.select({label:'Mattermost'},'inbox')
 assert.equal(view.find({text:'Соединение работает: tester'}),null)
 await view.press({label:'Копировать черновик'})
 await view.select({label:'Mattermost'},'subscriptions')
 assert.ok(view.find({text:'Черновик скопирован'}))
 await view.select({label:'Mattermost'},'connection')
 await view.press({text:'Сохранить соединение'})
 assert.ok(view.find({text:'Соединение сохранено'}))
 await view.select({label:'Mattermost'},'inbox')
 assert.equal(view.find({text:'Соединение сохранено'}),null)
 assert.deepEqual(view.errors,[]);assert.deepEqual(view.warnings,[])
 await view.unmount()
})

test('empty inbox has no return-to-latest control and connection errors remain global',async()=>{
 const host=mockHost({requests:{mattermost:(i:any)=>{
 if(i.op==='list')return {watches:[]}
 if(i.op==='inbox')return {rows:[],more:false,before:null}
 if(i.action==='test')throw new Error('Сессия недействительна')
 return {url:'',hasCookie:false}
 }}})
 const view=await mount(panel,{host})
 await view.select({label:'Mattermost'},'inbox')
 assert.equal(view.find({text:'Последние сводки'}),null)
 await view.select({label:'Mattermost'},'connection')
 await view.press({text:'Проверить соединение'})
 await view.select({label:'Mattermost'},'subscriptions')
 assert.ok(view.find({text:'Сессия недействительна'}))
 await view.unmount()
})

test('background review updates do not replace the selected inbox history page',async()=>{
 const w={id:'pending',title:'QA',owner:'bot',chat:'chat',interval:5,rule:'QA',timezone:'UTC',url:'https://mm.example/t/pl/p',schedule_state:'active',processing_pending:true}
 const host=mockHost({requests:{mattermost:(i:any)=>i.op==='list'?{watches:[w]}:i.op==='inbox'?{rows:[{id:i.before?1:2,headline:i.before?'History':'Latest',source:'QA',body:'Preview',draft:'',url:w.url,created:1800000000}],more:!i.before,before:i.before?1:2}:{url:'',hasCookie:true}}})
 const view=await mount(panel,{host})
 await view.select({label:'Mattermost'},'inbox')
 await view.press({text:'Предыдущие сводки'})
 await panel.refresh()
 await view.select({label:'Mattermost'},'inbox')
 assert.ok(view.find({type:'Card',label:'History'}))
 assert.ok(view.find({text:'Последние сводки'}))
 await view.unmount()
})

test('late background inbox response cannot overwrite a newer navigation',async()=>{
 let block=false, release!:(value:any)=>void, started!:()=>void
 const waiting=new Promise<void>(resolve=>{started=resolve})
 const page=(history:boolean)=>({rows:[{id:history?1:2,headline:history?'History':'Latest',source:'QA',body:'Preview',draft:'',url:'https://mm.example/t/pl/p',created:1800000000}],more:!history,before:history?1:2})
 const host=mockHost({requests:{mattermost:(i:any)=>{
  if(i.op==='list')return {watches:[]}
  if(i.op==='inbox'){
   if(block&&!i.before){started();return new Promise(resolve=>{release=resolve})}
   return page(!!i.before)
  }
  return {url:'',hasCookie:true}
 }}})
 const view=await mount(panel,{host})
 await view.select({label:'Mattermost'},'inbox')
 block=true
 const background=panel.refresh()
 await waiting
 await panel.loadInbox(2)
 release(page(false));await background
 await view.select({label:'Mattermost'},'inbox')
 assert.ok(view.find({type:'Card',label:'History'}))
 assert.ok(view.find({text:'Последние сводки'}))
 await view.unmount()
})
