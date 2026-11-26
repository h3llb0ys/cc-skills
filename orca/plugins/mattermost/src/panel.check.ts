import { defineCheck } from 'orca/testing'
const watch = {id:'sample',title:'Вопрос QA',kind:'thread',url:'https://mm.example/team/pl/post',owner:'helper',chat:'chat-1',rule:'Когда нужен мой ответ',interval:10,timezone:'UTC',draft:true,schedule_state:'active',processing_pending:true,last_checked_at:1800000000,next:1800000600}
function scenario(rows:any[]) {
  return {requests:{mattermost:(data:any)=>data.op==='list'?{watches:rows}:data.op==='inbox'?{rows:[],more:false,before:null}:{url:'https://mm.example',hasCookie:true}}}
}
export default defineCheck({
  populated:scenario([watch]),
  empty:scenario([]),
  paused:scenario([{...watch,suspended:true}]),
  expired:scenario([{...watch,paused:true}]),
  broken:scenario([{...watch,schedule_state:'missing'}]),
  failed:scenario([{...watch,source_problem:'Сессия истекла'}]),
})
