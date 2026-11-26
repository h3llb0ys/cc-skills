import { atom, read, set, Stack, Row, Heading, Text, Button, IconButton, Input, Textarea, Switch, Select, Collapsible, Card, Tabs, Tab, Callout, RelativeTime, EmptyState, CodeView, shell, plugin, type PanelContext } from 'orca'
import type { Form, Watch, Summary } from './protocol'
const connectionNotice=atom(''), inboxCursor=atom<number|null>(null)
const watches=atom<Watch[]>([]), summaries=atom<Summary[]>([]), tab=atom('subscriptions'), busy=atom(false), error=atom(''), notice=atom('')
const form=atom<Form|null>(null), editing=atom<string|null>(null), bots=atom<any[]>([]), chats=atom<any[]>([]), preview=atom<any>(null)
const url=atom(''), cookie=atom(''), connected=atom(false), more=atom(false), before=atom<number|null>(null), removing=atom<string|null>(null)
const selectedSummary=atom<number|null>(null)
const progress=atom<Record<string,string>>({}), detail=atom<Record<number,Summary>>({}), preferred=atom('recipient',{owner:'',chat:''},{persist:'plugin'})
let inboxRequest=0
let previewTimer:ReturnType<typeof setTimeout>|undefined
const rule='Уведоми, если в обсуждении остался вопрос, на который нужен мой ответ. Не уведомляй об уже решённых вопросах.'
const blank=():Form=>({url:'',owner:'',chat:'',timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,interval:'10',rule,until:'',draft:false,firstReview:'open'})
async function call(data:any):Promise<any>{return plugin.request('mattermost',data,{timeoutMs:120000})}
async function act(fn:()=>Promise<void>){if(read(busy))return;set(busy,true);set(error,'');try{await fn()}catch(e){set(error,e instanceof Error?e.message:'Ошибка действия')}finally{set(busy,false)}}
export async function loadInbox(cursor?:number|null){const request=++inboxRequest;const p=await call({op:'inbox',before:cursor??null});if(request!==inboxRequest)return;set(summaries,p.rows);set(more,p.more);set(before,p.before);set(inboxCursor,cursor??null)}
export async function refresh(){const d=await call({op:'list'});set(watches,d.watches);if(d.problem)set(error,d.problem);await loadInbox(read(inboxCursor))}
let timer:ReturnType<typeof setTimeout>|undefined, disposed=false, deadline=0
function updateProgress(){
 const p={...read(progress)}
 for(const id of Object.keys(p)){
  if(!['Проверяем…','Ждём разбора'].includes(p[id]))continue
  const w=read(watches).find(x=>x.id===id)
  if(!w||w.paused||w.suspended){delete p[id];continue}
  p[id]=w.processing_pending?'Ждём разбора':w.delivery_problem?'Сводка сохранена во Входящих':w.last_review_notified?'Доставлено · '+w.owner+' / '+destination(w):'Новых событий нет'
 }
 set(progress,p)
 const failed=read(watches).find(w=>p[w.id]&&w.delivery_problem&&w.latest_summary)
 if(failed){set(selectedSummary,failed.latest_summary!.id);set(tab,'inbox')}
}
function follow(){
 if(timer||disposed||Date.now()>deadline)return
 timer=setTimeout(()=>{
  timer=undefined
  void (async()=>{
   try{
    await refresh()
    updateProgress()
    if(read(watches).some(w=>w.processing_pending&&!w.suspended))follow()
   }catch(e){set(error,String(e))}
  })()
 },4000)
}
export function setup(ctx:PanelContext){disposed=false;ctx.subscriptions.push({dispose(){disposed=true;if(timer)clearTimeout(timer);if(previewTimer)clearTimeout(previewTimer);timer=undefined}});void act(async()=>{const c=await call({op:'connection',action:'status'});set(url,c.url);set(connected,c.hasCookie);await refresh();if(read(watches).some(w=>w.processing_pending)){deadline=Date.now()+20*60*1000;follow()}})}
function change(k:keyof Form,v:any){set(form,{...read(form)!,[k]:v});if(['url','owner','chat'].includes(k))set(preview,null)}
async function chooseBot(owner:string){change('owner',owner);change('chat','');const options=await call({op:'recipients',owner});set(chats,options);const saved=read(preferred);const exact=options.filter((c:any)=>c.label==='Ответы на Q&A по сервисам');const match=options.find((c:any)=>owner===saved.owner&&c.value===saved.chat);if(match)change('chat',match.value);else if(owner==='magabot'&&exact.length===1)change('chat',exact[0].value);else if(options.length===1)change('chat',options[0].value)}
async function newForm(){set(editing,null);set(form,blank());set(preview,null);const options=await call({op:'recipients'});set(bots,options);const saved=read(preferred);const owner=options.find((b:any)=>b.value===saved.owner)?.value||options.find((b:any)=>b.value==='magabot')?.value||(options.length===1?options[0].value:'');if(owner)await chooseBot(owner)}
async function edit(w:Watch){set(editing,w.id);set(preview,null);set(form,{...w,interval:String(w.interval),until:w.until?new Date(Number(w.until)*1000).toISOString():''});set(bots,[{value:w.owner,label:w.owner}]);set(chats,await call({op:'recipients',owner:w.owner}))}
async function inspect(){const f=read(form)!;const result=await call({op:'preview',url:f.url,owner:f.owner,chat:f.chat});const current=read(form);if(current&&current.url===f.url&&current.chat===f.chat&&current.owner===f.owner)set(preview,result)}
function destination(w:Watch){return read(chats).find(c=>c.value===w.chat)?.label||w.chat}
function state(w:Watch){if(w.paused)return 'Завершена';if(w.suspended)return 'На паузе';if(w.source_problem||w.dispatch_problem||w.delivery_problem)return 'Ошибка';if(w.schedule_state!=='active')return 'Разрыв расписания';if(w.processing_pending)return 'Ожидает разбора';return 'Активна'}
async function action(w:Watch,op:string){if(op==='check')set(progress,{...read(progress),[w.id]:'Проверяем…'});await act(async()=>{try{const r=await call({op,id:w.id});if(op==='check')set(progress,{...read(progress),[w.id]:r?.problem||(r?.outcome==='quiet'?'Новых событий нет':'Ждём разбора')})}catch(e){if(op==='check')set(progress,{...read(progress),[w.id]:e instanceof Error?e.message:'Ошибка проверки'});throw e}finally{await refresh();if(op==='check'){deadline=Date.now()+20*60*1000;follow()}}})}
const icon=(name:any,label:string,fn:()=>unknown,disabled=false)=><IconButton icon={name} label={label} tooltip={label} disabled={disabled} onPress={fn}/>
export default function Panel(){const f=read(form),locked=read(busy),p=read(preview)
return <Stack gap="md"><Row justify="between"><Heading>Mattermost</Heading>{icon('refresh','Обновить',()=>act(refresh),locked)}</Row>
{read(error)&&<Callout tone="danger"><Text>{read(error)}</Text></Callout>}{read(notice)&&<Text>{read(notice)}</Text>}
<Tabs label="Mattermost" value={read(tab)} onChange={v=>set(tab,v)}>
<Tab value="subscriptions" label="Подписки"><Stack gap="sm">
<Button disabled={locked} onPress={()=>act(newForm)}>Создать подписку</Button>
{!read(watches).length&&!f&&<EmptyState title={read(connected)?'Следи за нужной веткой или каналом':'Подключи Mattermost'} description="Укажи источник и условие — важное придёт в выбранный чат.">{!read(connected)&&<Button onPress={()=>set(tab,'connection')}>Подключить</Button>}</EmptyState>}
{f&&<Card title={read(editing)?'Изменить подписку':'Новая подписка'}><Stack gap="sm">
<Input label="Ссылка на ветку или канал" value={f.url} disabled={!!read(editing)||locked} onChange={v=>{change('url',v);if(previewTimer)clearTimeout(previewTimer);previewTimer=setTimeout(()=>{if(read(form)?.chat)void act(inspect)},700)}} onSubmit={()=>act(inspect)}/>
{!read(editing)&&<Button disabled={locked||!f.url||!f.chat} onPress={()=>act(inspect)}>Проверить ссылку</Button>}
{p&&<Callout><Text>{p.kind==='channel'?'Канал':'Ветка'} · {p.title}</Text><Text muted>{p.url}</Text>{p.existing&&<Button onPress={()=>act(async()=>{const w=read(watches).find(w=>w.id===p.existing);if(w)await edit(w)})}>Перейти к существующей подписке</Button>}</Callout>}
<Select label="Условие" value={f.rule===rule?'answer':'custom'} options={[{value:'answer',label:'Ждут моего ответа'},{value:'custom',label:'Своё правило'}]} onChange={v=>change('rule',v==='answer'?rule:'')}/>
{f.rule!==rule&&<Textarea label="Когда уведомлять" value={f.rule} onChange={v=>change('rule',v)}/>}
<Select label="Бот" value={f.owner} options={read(bots)} disabled={locked||!!read(editing)} onChange={v=>act(()=>chooseBot(v))}/>
<Select label="Чат доставки" value={f.chat} options={read(chats)} disabled={locked} onChange={v=>change('chat',v)}/>
<Text muted>Важное → {f.owner||'выбери бота'} · {read(chats).find(c=>c.value===f.chat)?.label||'выбери чат'} · каждые {f.interval} мин</Text>
<Input label="Интервал, минут" value={String(f.interval)} onChange={v=>change('interval',v)}/>
{!read(editing)&&<Select label="Первый разбор" value={f.firstReview||'open'} options={[{value:'new',label:'Только новое'},{value:'open',label:'Учесть открытые вопросы'}]} onChange={v=>change('firstReview',v)}/>}
<Collapsible title="Дополнительно"><Stack gap="sm"><Switch label="Готовить черновик ответа" checked={f.draft} onChange={v=>change('draft',v)}/><Select label="Срок подписки" value={f.until?'limited':'none'} options={[{value:'none',label:'Без срока'},{value:'day',label:'На сутки'},{value:'week',label:'На неделю'},...(f.until?[{value:'limited',label:'До '+new Date(f.until).toLocaleString()}]:[])]} onChange={v=>change('until',v==='none'?'':new Date(Date.now()+(v==='day'?1:7)*86400000).toISOString())}/><Input label="Часовой пояс" value={f.timezone} disabled={!!read(editing)} onChange={v=>change('timezone',v)}/>{read(editing)&&<Text muted>Для другого бота создай подписку. Смена чата сохраняет историю и уже прочитанные сообщения.</Text>}</Stack></Collapsible>
<Row><Button disabled={locked||!f.chat||!f.rule||(!read(editing)&&(!p||!!p.existing))} onPress={()=>act(async()=>{try{await call({op:read(editing)?'edit':'create',id:read(editing),form:{...f,url:p?.url||f.url}});set(preferred,{owner:f.owner,chat:f.chat});set(form,null)}finally{await refresh()}})}>{read(editing)?'Сохранить':'Создать подписку'}</Button><Button disabled={locked} onPress={()=>set(form,null)}>Отмена</Button></Row>
</Stack></Card>}
{read(watches).map(w=><Card><Stack gap="xs"><Row justify="between" wrap><Stack gap="xs"><Text weight="semibold">{w.title||'Mattermost'}</Text><Text muted>{state(w)} · {w.interval} мин</Text></Stack><Row gap="xs">{icon('refresh','Проверить сейчас',()=>action(w,'check'),locked||w.paused||w.suspended||w.schedule_state!=='active')}{icon('open-external','Открыть Mattermost',()=>shell.openExternal(w.url))}</Row></Row>
{read(progress)[w.id]&&<Text>{read(progress)[w.id]}</Text>}
{w.dispatch_problem&&<Callout tone="warning"><Text>{w.dispatch_problem}</Text></Callout>}
{w.source_problem&&<Callout tone="warning"><Text>{w.source_problem}</Text><Button onPress={()=>set(tab,'connection')}>Обновить подключение</Button></Callout>}
{w.delivery_problem&&<Callout tone="warning"><Text>Доставка не подтверждена. Сводка сохранена.</Text><Button onPress={()=>act(async()=>{await loadInbox();if(w.latest_summary){const s=await call({op:'summary',id:w.latest_summary.id});set(summaries,[s,...read(summaries).filter(x=>x.id!==s.id)]);set(selectedSummary,s.id)}set(tab,'inbox')})}>Открыть локальную сводку</Button></Callout>}
{!w.paused&&!w.suspended&&w.schedule_state!=='active'&&<Button disabled={locked} onPress={()=>action(w,'enable')}>Восстановить</Button>}
<Collapsible title="Подробности"><Stack gap="xs"><Text>{w.rule}</Text><Text>Доставка → {w.owner} / {destination(w)}</Text>{w.last_checked_at&&<Row><Text muted>Проверено</Text><RelativeTime at={w.last_checked_at*1000}/></Row>}{w.next&&!w.processing_pending&&!w.suspended&&!w.paused&&<Row><Text muted>Следующая</Text><RelativeTime at={w.next*1000}/></Row>}</Stack></Collapsible>
<Collapsible title="⋯ Действия"><Row gap="xs" wrap><Button disabled={locked||w.paused} onPress={()=>act(()=>edit(w))}>Изменить</Button><Button disabled={locked||w.paused} onPress={()=>action(w,w.suspended?'resume':'pause')}>{w.suspended?'Возобновить':'Пауза'}</Button><Button disabled={locked} onPress={()=>set(removing,w.id)}>Удалить</Button></Row></Collapsible>
{read(removing)===w.id&&<Callout tone="warning" title="Удалить подписку?"><Text>История входящих сохранится.</Text><Row><Button disabled={locked} tone="danger" onPress={()=>action(w,'unwatch')}>Подтвердить удаление</Button><Button onPress={()=>set(removing,null)}>Отмена удаления</Button></Row></Callout>}
</Stack></Card>)}
</Stack></Tab>
<Tab value="inbox" label="Входящие"><Stack gap="sm">{!read(summaries).length&&<EmptyState title="Важных сводок пока нет"/>}{read(summaries).map(s=><Card title={s.headline}><Stack gap="xs"><Text>{s.body.slice(0,180)}</Text><Row justify="between" wrap><Text muted>{s.source}</Text><RelativeTime at={s.created*1000}/><Row gap="xs">{icon('open-external','Открыть оригинал',()=>shell.openExternal(s.url))}{s.draft&&icon('copy','Копировать черновик',()=>act(async()=>{await call({op:'copy',id:s.id});set(notice,'Черновик скопирован')}),locked)}</Row></Row><Collapsible title="Сводка и черновик" defaultOpen={read(selectedSummary)===s.id} onChange={open=>{if(open)void act(async()=>set(detail,{...read(detail),[s.id]:await call({op:'summary',id:s.id})}))}}><Stack><Text>{read(detail)[s.id]?.body||s.body}</Text>{(read(detail)[s.id]?.draft||s.draft)&&<CodeView label="Черновик ответа" code={read(detail)[s.id]?.draft||s.draft} wrap/>}</Stack></Collapsible></Stack></Card>)}<Row>{read(inboxCursor)!==null&&<Button disabled={locked} onPress={()=>act(()=>loadInbox())}>Последние сводки</Button>}{read(more)&&<Button disabled={locked} onPress={()=>act(()=>loadInbox(read(before)))}>Предыдущие сводки</Button>}</Row></Stack></Tab>
<Tab value="connection" label="Соединение"><Stack gap="sm">{read(connectionNotice)&&<Text>{read(connectionNotice)}</Text>}<Text>{read(connected)?'Cookie сохранена':'Нужно подключение'}</Text><Input label="Адрес Mattermost" value={read(url)} onChange={v=>set(url,v)}/><Input label="Cookie сессии" type="password" value={read(cookie)} onChange={v=>set(cookie,v)}/><Text muted>Пустое поле сохраняет прежнюю cookie для этого адреса. Настройка общая с BB и CLI.</Text><Row>{['test','save'].map(action=><Button disabled={locked} onPress={()=>act(async()=>{const c=await call({op:'connection',action,data:{url:read(url),cookie:read(cookie)}});if(action==='save'){set(cookie,'');set(connected,true)}set(connectionNotice,action==='test'?`Соединение работает: ${c.username}`:'Соединение сохранено')})}>{action==='test'?'Проверить соединение':'Сохранить соединение'}</Button>)}</Row></Stack></Tab>
</Tabs></Stack>
}
