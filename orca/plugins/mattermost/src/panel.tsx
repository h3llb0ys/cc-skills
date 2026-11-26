import { atom, read, set, Stack, Row, Heading, Text, Button, Input, Textarea, Switch, Card, Tabs, Tab, Callout, RelativeTime, EmptyState, CodeView, shell, plugin } from 'orca'
import type { Form, Watch, Summary } from './protocol'
const watches = atom<Watch[]>([]), summaries = atom<Summary[]>([]), tab = atom('subscriptions')
const removing = atom<string | null>(null)
const inboxMore = atom(false), inboxBefore = atom<number | null>(null)
const busy = atom(false), error = atom(''), notice = atom(''), editing = atom<string | null>(null)
const form = atom<Form | null>(null), url = atom(''), cookie = atom(''), connected = atom(false)
const blank = (): Form => ({url:'',owner:'',chat:'',timezone:'Europe/Moscow',interval:'10',rule:'',until:'',draft:false})
async function call(data: any): Promise<any> { return plugin.request('mattermost', data, {timeoutMs:120000}) }
async function refresh() {
  const data = await call({op:'list'}); set(watches,data.watches)
  if(data.problem) set(error,data.problem)
  await loadInbox()
}
async function loadInbox(before?: number | null) {
  const page = await call({op:'inbox',before:before ?? null})
  set(summaries,page.rows); set(inboxMore,page.more); set(inboxBefore,page.before)
}
async function act(fn: () => Promise<void>) {
  if(read(busy)) return
  set(busy,true); set(error,''); set(notice,'')
  try { await fn() } catch(e) { set(error,e instanceof Error ? e.message : 'Ошибка действия') }
  finally { set(busy,false) }
}
export function setup() { void act(async () => { const c = await call({op:'connection',action:'status'}); set(url,c.url); set(connected,c.hasCookie); await refresh() }) }
function change(key: keyof Form, value: string | boolean) { set(form,{...read(form)!,[key]:value}) }
function status(w: Watch) {
  if(w.paused) return 'Завершена'
  if(w.suspended) return 'На паузе'
  if(w.source_problem || w.dispatch_problem || w.delivery_problem) return 'Ошибка'
  if(w.schedule_state==='unknown') return 'Расписание не проверено'
  if(w.schedule_state!=='active') return 'Разрыв расписания'
  if(w.processing_pending) return 'Ожидает разбора'
  return w.last_check_quiet ? 'Тихая проверка' : 'Активна'
}
async function action(w: Watch, op: string) {
  await act(async () => {
    try {
      const result = await call({op,id:w.id})
      set(notice,result?.problem || (result?.outcome==='quiet'?'Новых событий нет':result?.outcome==='busy'?'Разбор уже идёт':'Готово'))
    } finally {
      await refresh()
    }
  })
}
export default function Panel() {
 const f=read(form), locked=read(busy)
 return <Stack gap="md">
  <Row justify="between"><Heading>Mattermost</Heading><Button disabled={locked} onPress={()=>act(refresh)}>Обновить</Button></Row>
  {read(error) && <Callout tone="danger" title="Не удалось выполнить действие"><Text>{read(error)}</Text></Callout>}
  {read(notice) && <Text>{read(notice)}</Text>}
  <Tabs label="Mattermost" value={read(tab)} onChange={v=>set(tab,v)}>
   <Tab value="subscriptions" label="Подписки"><Stack gap="md">
    <Button disabled={locked} onPress={()=>{set(editing,null);set(form,blank())}}>Новая подписка</Button>
    {f && <Card title={read(editing)?'Изменить подписку':'Новая подписка'}><Stack gap="sm">
      <Input label="Ветка или канал — ссылка" value={f.url} disabled={!!read(editing)||locked} onChange={v=>change('url',v)}/>
      <Input label="Бот Orca" value={f.owner} disabled={!!read(editing)||locked} onChange={v=>change('owner',v)}/>
      <Input label="ID чата бота" value={f.chat} disabled={!!read(editing)||locked} onChange={v=>change('chat',v)}/>
      <Input label="Интервал, минут" value={String(f.interval)} onChange={v=>change('interval',v)}/>
      <Textarea label="Когда уведомлять" value={f.rule} onChange={v=>change('rule',v)}/>
      <Input label="Часовой пояс" value={f.timezone} disabled={!!read(editing)} onChange={v=>change('timezone',v)}/>
      <Input label="До — ISO дата с часовым поясом, необязательно" value={f.until} onChange={v=>change('until',v)}/>
      <Switch label="Готовить черновик ответа" checked={f.draft} onChange={v=>change('draft',v)}/>
      <Text muted>Для другого бота или чата создай новую подписку. Ответы в Mattermost не отправляются.</Text>
      <Row><Button disabled={locked} onPress={()=>act(async()=>{try {await call({op:read(editing)?'edit':'create',id:read(editing),form:f});set(form,null)} finally {await refresh()}})}>Сохранить</Button><Button disabled={locked} onPress={()=>set(form,null)}>Отмена</Button></Row>
    </Stack></Card>}
    {!read(watches).length && <EmptyState title="Подписок пока нет"/>}
    {read(watches).map(w=><Card title={w.title || w.url}><Stack gap="sm">
      <Text weight="semibold">{status(w)}</Text><Text>{w.kind==='channel'?'Канал':'Ветка'} · {w.interval} мин · {w.owner} / {w.chat}</Text><Text>{w.rule}</Text>
      {(w.source_problem||w.dispatch_problem||w.delivery_problem) && <Text tone="danger">{w.source_problem||w.dispatch_problem||w.delivery_problem}</Text>}
      {w.last_checked_at && <Row><Text muted>Успешная проверка:</Text><RelativeTime at={w.last_checked_at*1000}/></Row>}
      {!w.paused&&!w.suspended&&!w.processing_pending&&w.schedule_state==='active'&&w.next && <Row><Text muted>Следующая проверка:</Text><RelativeTime at={w.next*1000}/></Row>}
      <Row wrap><Button onPress={()=>shell.openExternal(w.url)}>Оригинал</Button><Button disabled={locked||w.paused} onPress={()=>{set(editing,w.id);set(form,{...w,interval:String(w.interval),until:w.until?new Date(Number(w.until)*1000).toISOString():''})}}>Изменить</Button>
       <Button disabled={locked||w.paused||w.suspended||w.schedule_state!=='active'} onPress={()=>action(w,'check')}>Проверить сейчас</Button>
       <Button disabled={locked||w.paused} onPress={()=>action(w,w.suspended?'resume':'pause')}>{w.suspended?'Возобновить':'Пауза'}</Button>
       {w.paused&&<Button disabled={locked} onPress={()=>set(removing,w.id)}>Удалить завершённую</Button>}
       {!w.paused&&!w.suspended&&w.schedule_state!=='active'&&<Button disabled={locked} onPress={()=>action(w,'enable')}>Восстановить расписание</Button>}
      </Row>
      {read(removing)===w.id&&<Callout tone="warning" title="Удалить завершённую подписку?"><Text>Расписание будет удалено. История входящих сохранится.</Text><Row><Button disabled={locked} tone="danger" onPress={()=>action(w,'unwatch')}>Подтвердить удаление</Button><Button disabled={locked} onPress={()=>set(removing,null)}>Отмена удаления</Button></Row></Callout>}
    </Stack></Card>)}
   </Stack></Tab>
   <Tab value="inbox" label="Входящие"><Stack gap="md">
    {!read(summaries).length&&<EmptyState title="Важных сводок пока нет"/>}
    {read(summaries).map(s=><Card title={s.headline}><Stack gap="sm"><Text muted>{s.source}</Text><RelativeTime at={s.created*1000}/><Text>{s.body}</Text>{s.truncated&&<Text muted>Показано начало текста. Копирование берёт полный черновик.</Text>}<Button onPress={()=>shell.openExternal(s.url)}>Открыть оригинал</Button>{s.draft&&<Stack><Button disabled={locked} onPress={()=>act(async()=>{await call({op:"copy",id:s.id});set(notice,"Черновик скопирован")})}>Копировать черновик</Button><CodeView label="Черновик ответа" code={s.draft.slice(0,16000)} wrap/></Stack>}</Stack></Card>)}
    <Row><Button disabled={locked} onPress={()=>act(()=>loadInbox())}>Последние сводки</Button>{read(inboxMore)&&<Button disabled={locked} onPress={()=>act(()=>loadInbox(read(inboxBefore)))}>Предыдущие сводки</Button>}</Row>
   </Stack></Tab>
   <Tab value="connection" label="Соединение"><Stack gap="sm"><Text>{read(connected)?'Cookie сохранена':'Нужно подключение'}</Text>
    <Input label="Адрес Mattermost" value={read(url)} onChange={v=>set(url,v)}/><Input label="Cookie сессии" type="password" value={read(cookie)} onChange={v=>set(cookie,v)}/><Text muted>Пустое поле сохраняет существующую cookie для того же адреса. Настройка общая с CLI и BB.</Text>
    <Row>{['test','save'].map(action=><Button disabled={locked} onPress={()=>act(async()=>{const c=await call({op:'connection',action,data:{url:read(url),cookie:read(cookie)}});if(action==='save'){set(cookie,'');set(connected,true);}set(notice,action==='test'?`Соединение работает: ${c.username}`:'Соединение сохранено')})}>{action==='test'?'Проверить соединение':'Сохранить соединение'}</Button>)}</Row>
   </Stack></Tab>
  </Tabs>
 </Stack>
}
