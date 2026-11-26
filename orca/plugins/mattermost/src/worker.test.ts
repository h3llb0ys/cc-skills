import { assert, mockHost, mountWorker, test } from 'orca/testing'
import * as worker from './worker'
test('worker and Python bridge reject unknown operations without running CLI',async()=>{
 const mounted=await mountWorker(worker,{host:mockHost()})
 await assert.rejects(()=>mounted.request('mattermost',{op:'invalid'}),/Неизвестное действие/)
 await mounted.deactivate()
})
