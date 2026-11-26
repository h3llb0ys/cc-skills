"""Mock end-to-end: panel bridge -> canonical CLI -> SQLite -> scheduler stub."""
import importlib.util
import json
import subprocess
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

import test_mattermost as base
from test_mattermost import ROOT, watches

path = Path(__file__).resolve().parents[3] / 'orca/plugins/mattermost/scripts/bridge.py'
spec = importlib.util.spec_from_file_location('orca_bridge', path)
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class OrcaPluginTests(unittest.TestCase):
    def setUp(self):
        base.WatchTests.setUp(self)
        stub = patch.object(bridge, 'Client', return_value=self.client)
        stub.start()
        self.addCleanup(stub.stop)
    invoke = base.WatchTests.invoke

    def create(self):
        options = self.options[:-2]
        options[3] = 'orca'
        key = self.invoke(*options)['id']
        with closing(watches.connect()) as db, db:
            state = json.loads(db.execute('SELECT data FROM watches WHERE id=?', (key,)).fetchone()[0])
            state['schedule'] = 'auto'
            watches.save(db, key, state)
        return key

    def test_manual_check_prepares_before_dispatch_and_quiet_never_dispatches(self):
        key = self.create()
        def run(args, stdin=None):
            self.assertEqual(args, ['orca', 'automations', 'run', 'auto', '--json'])
            self.assertTrue(self.invoke('review', key)['token'])
            return subprocess.CompletedProcess(args, 0, '{}')
        self.calls.side_effect = run
        self.assertEqual(bridge.handle({'op':'check', 'id':key})['outcome'], 'reviewing')
        self.assertEqual(bridge.handle({'op':'check', 'id':key})['outcome'], 'busy')
        batch = self.invoke('review', key)
        self.invoke('resolve', key, batch['token'])
        self.calls.reset_mock()
        self.assertEqual(bridge.handle({'op':'check', 'id':key})['outcome'], 'quiet')
        self.calls.assert_not_called()

    def test_bb_mutations_rejected(self):
        for op in ('check', 'pause', 'resume', 'enable', 'edit', 'unwatch'):
            data = {'op':op,'id':self.key, 'form':{'interval':'5','rule':'new'}}
            with self.assertRaisesRegex(ValueError, 'другой платформе'):
                bridge.handle(data)
        self.calls.assert_not_called()

    def test_edit_invalidates_receipt_and_inbox_isolated_from_same_bb_chat(self):
        key = self.create()
        self.invoke('tick', key)
        batch = self.invoke('review', key)
        bridge.handle({'op':'edit','id':key,'form':{'interval':'7','rule':'changed','draft':True}})
        with self.assertRaises(ValueError):
            self.invoke('resolve', key, batch['token'])
        self.invoke('tick', key)
        batch = self.invoke('review', key)
        message = Path(self.folder.name) / 'message'; message.write_text('Important')
        draft = Path(self.folder.name) / 'draft'; draft.write_text('Reply')
        self.invoke('resolve', key, batch['token'], '--message-file', str(message), '--draft-file', str(draft))
        self.assertEqual(self.invoke('inbox','--chat','target')['rows'], [])
        rows = bridge.handle({'op':'inbox'})['rows']
        self.assertEqual(rows[0]['draft'], 'Reply')
        with patch.object(bridge.subprocess, 'run') as copy:
            bridge.handle({'op':'copy','id':rows[0]['id']})
            self.assertEqual(copy.call_args.kwargs['input'], 'Reply')
        self.assertEqual(self.invoke('watch','list','--platform','orca')[0]['interval'],7)

    def test_dispatch_failure_retry_and_schedule_gap(self):
        key = self.create()
        self.calls.side_effect = subprocess.CalledProcessError(1, 'orca')
        self.assertEqual(bridge.handle({'op':'check','id':key})['outcome'], 'failed')
        self.calls.side_effect = None
        self.calls.return_value = subprocess.CompletedProcess([],0,'{"result":{"automations":[]}}')
        self.assertEqual(bridge.handle({'op':'list'})['watches'][0]['schedule_state'], 'missing')
        self.assertEqual(bridge.handle({'op':'check','id':key})['outcome'], 'reviewing')

    def test_pause_blocks_manual_check_and_resume_reuses_schedule(self):
        key = self.create()
        bridge.handle({'op':'pause','id':key})
        with self.assertRaisesRegex(ValueError,'паузе'):
            bridge.handle({'op':'check','id':key})
        self.calls.return_value = subprocess.CompletedProcess([],0,'{"result":{"automations":[{"id":"auto","name":"existing","enabled":false}]}}')
        bridge.handle({'op':'resume','id':key})
        self.assertFalse(self.invoke('watch','list','--platform','orca')[0]['suspended'])
        self.assertTrue(any(c.args[0][:3]==['orca','automations','edit'] for c in self.calls.call_args_list))

    def test_create_from_form_registers_bundled_cli_and_lists_existing(self):
        jobs = []
        def scheduler(args, stdin=None):
            if args[:3] == ['orca','automations','create']:
                jobs.append({'id':'auto','name':args[args.index('--name')+1],'enabled':True})
                self.assertIn('tick ', args[args.index('--precheck')+1])
                self.assertNotIn('MM_COOKIE', ' '.join(args))
            return subprocess.CompletedProcess(args,0,json.dumps({'result':{'automations':jobs}}))
        self.calls.side_effect = scheduler
        row = bridge.handle({'op':'create','form':{'url':base.URL+ROOT,'owner':'bot','chat':'new-chat','timezone':'UTC','interval':'11','rule':'QA','draft':True}})
        self.assertEqual(row['schedule'],'auto')
        self.assertEqual(bridge.handle({'op':'list'})['watches'][0]['schedule_state'],'active')

    def test_delivery_failure_keeps_summary_and_consumes_receipt(self):
        key = self.create()
        self.invoke('tick', key)
        batch = self.invoke('review', key)
        message = Path(self.folder.name) / 'summary'; message.write_text('Important')
        self.calls.side_effect = subprocess.TimeoutExpired(['orca','orchestration','send'],60)
        self.invoke('resolve',key,batch['token'],'--message-file',str(message))
        self.assertEqual(bridge.handle({'op':'inbox'})['rows'][0]['body'],'Important')
        self.assertTrue(self.invoke('watch','list','--platform','orca')[0]['delivery_problem'])
        with self.assertRaises(ValueError):
            self.invoke('resolve',key,batch['token'],'--message-file',str(message))

    def test_copied_package_works_without_repository(self):
        import shutil
        import sys
        import tempfile
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / 'plugin'
            clean_repo = Path(folder) / 'checkout'
            clean_plugin = clean_repo / 'orca/plugins/mattermost'
            shutil.copytree(path.parents[1], clean_plugin, ignore=shutil.ignore_patterns('.orca','__pycache__','runtime'))
            shutil.copytree(path.parents[4]/'skills/mattermost/scripts', clean_repo/'skills/mattermost/scripts',
                            ignore=shutil.ignore_patterns('__pycache__'))
            subprocess.run([sys.executable,str(clean_plugin/'prepare.py')],check=True,capture_output=True)
            shutil.copytree(clean_plugin,target)
            import os
            env = {**os.environ, 'MM_STATE_DIR':str(Path(folder)/'state'), 'MM_CONFIG':str(Path(folder)/'config')}
            result = subprocess.run([sys.executable,str(target/'scripts/bridge.py')], input=json.dumps({'op':'list'}),
                                    text=True,capture_output=True,check=True,env=env)
            self.assertEqual(json.loads(result.stdout), {'ok':True,'result':{'watches':[],'problem':None}})
            for source in path.parents[4].joinpath('skills/mattermost/scripts').glob('*.py'):
                self.assertEqual((target/'runtime'/source.name).read_bytes(),source.read_bytes())

    def test_inbox_response_is_bounded_before_crossing_worker_bridge(self):
        import inbox
        key = self.create()
        with closing(watches.connect()) as db, db:
            state = json.loads(db.execute('SELECT data FROM watches WHERE id=?',(key,)).fetchone()[0])
            for i in range(100):
                inbox.record(db,state,'Large summary','я'*20000,'д'*20000,state['url'],'attention',self.now+i)
        response = bridge.handle({'op':'inbox'})
        self.assertLess(len(json.dumps(response,ensure_ascii=False).encode()),200000)
        seen = []
        while True:
            seen.extend(row['id'] for row in response['rows'])
            self.assertTrue(all(row['truncated'] for row in response['rows']))
            if not response['more']:
                break
            response = bridge.handle({'op':'inbox','before':response['before']})
        self.assertEqual(len(set(seen)),100)

    def test_scheduler_does_not_launch_duplicate_within_active_orca_lease(self):
        key = self.create()
        self.assertEqual(self.invoke('tick',key),0)
        batch = self.invoke('review',key)
        self.now += 301
        self.assertEqual(self.invoke('tick',key),1)
        self.assertEqual(bridge.handle({'op':'check','id':key})['outcome'],'busy')
        self.assertEqual(self.invoke('review',key)['token'],batch['token'])
        self.now += 600
        self.assertEqual(self.invoke('tick',key),0)

    def test_pause_recovers_schedule_after_registration_receipt_was_lost(self):
        key = self.create()
        with closing(watches.connect()) as db, db:
            state = json.loads(db.execute('SELECT data FROM watches WHERE id=?',(key,)).fetchone()[0])
            state.update(schedule=None,setup_pending=True)
            watches.save(db,key,state)
        self.calls.return_value = subprocess.CompletedProcess([],0,json.dumps({'result':{'automations':[
            {'id':'auto','name':'mm-watch-'+key,'enabled':True}]}}))
        bridge.handle({'op':'pause','id':key})
        row = self.invoke('watch','list','--platform','orca')[0]
        self.assertTrue(row['suspended'])
        self.assertEqual(row['schedule'],'auto')
        self.assertEqual(self.invoke('tick',key),1)
        self.assertTrue(any(c.args[0]==['orca','automations','edit','auto','--disabled'] for c in self.calls.call_args_list))

    def test_pause_during_manual_dispatch_revokes_prepared_receipt(self):
        key = self.create()
        receipt = []
        def run(args, stdin=None):
            if args[:3]==['orca','automations','run']:
                receipt.append(self.invoke('review',key)['token'])
                bridge.handle({'op':'pause','id':key})
            return subprocess.CompletedProcess(args,0,'{}')
        self.calls.side_effect = run
        self.assertEqual(bridge.handle({'op':'check','id':key})['outcome'],'busy')
        self.assertTrue(self.invoke('review',key)['idle'])
        with self.assertRaisesRegex(ValueError,'паузе'):
            self.invoke('resolve',key,receipt[0])

    def test_uncertain_manual_launch_does_not_dispatch_again_until_lease_expires(self):
        key = self.create()
        self.calls.side_effect = subprocess.TimeoutExpired(['orca','automations','run'],60)
        self.assertEqual(bridge.handle({'op':'check','id':key})['outcome'],'failed')
        self.calls.reset_mock()
        self.assertEqual(bridge.handle({'op':'check','id':key})['outcome'],'busy')
        self.now += 301
        self.assertEqual(self.invoke('tick',key),1)
        self.calls.assert_not_called()
        self.now += 600
        self.assertEqual(self.invoke('tick',key),0)

    def test_pause_guard_survives_scheduler_discovery_failure_without_schedule_id(self):
        key = self.create()
        with closing(watches.connect()) as db, db:
            state = json.loads(db.execute('SELECT data FROM watches WHERE id=?',(key,)).fetchone()[0])
            state['schedule'] = None
            watches.save(db,key,state)
        self.calls.side_effect = subprocess.TimeoutExpired(['orca','automations','list'],60)
        with self.assertRaises(subprocess.TimeoutExpired):
            bridge.handle({'op':'pause','id':key})
        self.assertTrue(self.invoke('watch','list','--platform','orca')[0]['suspended'])
        self.assertEqual(self.invoke('tick',key),1)

    def test_edit_during_manual_dispatch_rejects_old_receipt(self):
        key = self.create()
        receipt = []
        def run(args, stdin=None):
            if args[:3]==['orca','automations','run']:
                receipt.append(self.invoke('review',key)['token'])
                bridge.handle({'op':'edit','id':key,'form':{'interval':'7','rule':'new rule'}})
            return subprocess.CompletedProcess(args,0,'{}')
        self.calls.side_effect = run
        self.assertEqual(bridge.handle({'op':'check','id':key})['outcome'],'busy')
        with self.assertRaises(ValueError):
            self.invoke('resolve',key,receipt[0])
        self.assertEqual(self.invoke('watch','list','--platform','orca')[0]['rule'],'new rule')

    def test_expired_watch_can_be_removed_and_recreated_without_losing_inbox(self):
        key = self.create()
        self.invoke('tick',key)
        batch = self.invoke('review',key)
        message = Path(self.folder.name)/'summary'; message.write_text('Saved summary')
        self.invoke('resolve',key,batch['token'],'--message-file',str(message))
        self.invoke('edit',key,'--platform','orca','--interval','5','--rule','QA','--until',base.client.timestamp((self.now+1)*1000))
        self.now += 2
        self.assertTrue(self.invoke('watch','list','--platform','orca')[0]['paused'])
        bridge.handle({'op':'unwatch','id':key})
        self.assertEqual(bridge.handle({'op':'inbox'})['rows'][0]['body'],'Saved summary')
        replacement = self.create()
        self.assertNotEqual(key,replacement)

    def test_new_only_baseline_keeps_messages_arriving_before_first_tick(self):
        options = self.options[:-2]; options[3] = 'orca'
        key = self.invoke(*options,'--first-review','new')['id']
        self.assertEqual(self.invoke('tick',key),1)
        self.rows.append(base.post(base.REPLY,3,ROOT))
        self.now += 301
        self.assertEqual(self.invoke('tick',key),0)
        batch=self.invoke('review',key)
        self.assertFalse(batch['initial_review'])
        self.assertEqual(batch['changed'],[base.REPLY])

    def test_move_orca_chat_keeps_cursor_history_and_rejects_old_receipt(self):
        key=self.create(); self.invoke('tick',key); batch=self.invoke('review',key)
        with closing(watches.connect()) as db:
            old=json.loads(db.execute('SELECT data FROM watches WHERE id=?',(key,)).fetchone()[0])
        row=bridge.handle({'op':'edit','id':key,'form':{'chat':'new-chat','interval':'5','rule':'QA'}})
        self.assertEqual(row['id'],key);self.assertEqual(row['chat'],'new-chat')
        with self.assertRaises(ValueError):self.invoke('resolve',key,batch['token'])
        with closing(watches.connect()) as db:
            updated=json.loads(db.execute('SELECT data FROM watches WHERE id=?',(key,)).fetchone()[0])
        self.assertEqual(updated['seen'],old['seen']);self.assertEqual(updated['schedule'],old['schedule'])
        self.invoke('tick',key); batch=self.invoke('review',key)
        message=Path(self.folder.name)/'new';message.write_text('New destination')
        self.invoke('resolve',key,batch['token'],'--message-file',str(message))
        self.assertIn('new-chat',self.calls.call_args.args[0])

    def test_preview_reply_canonicalizes_without_creating_watch(self):
        result=bridge.handle({'op':'preview','url':base.URL+base.REPLY,'owner':'project','chat':'target'})
        self.assertEqual(result['url'],base.URL+ROOT)
        self.assertIsNone(result['existing'])
        self.assertEqual(len(self.invoke('watch','list')),1)
        self.calls.assert_not_called()

    def test_move_conflict_preserves_existing_destination(self):
        key=self.create()
        options=self.options[:-2];options[3]='orca';options[5]='new-chat'
        self.invoke(*options)
        with self.assertRaisesRegex(ValueError,'уже подключён'):
            bridge.handle({'op':'edit','id':key,'form':{'chat':'new-chat','interval':'5','rule':'QA'}})
        self.assertEqual(next(w for w in self.invoke('watch','list') if w['id']==key)['chat'],'target')

    def test_preview_existing_is_scoped_to_recipient_and_platform(self):
        key=self.create()
        row=bridge.handle({'op':'preview','url':base.URL+ROOT,'owner':'project','chat':'target'})
        self.assertEqual(row['existing'],key)
        self.assertIsNone(bridge.handle({'op':'preview','url':base.URL+ROOT,'owner':'project','chat':'other'})['existing'])

    def test_new_only_channel_reads_complete_baseline_and_open_mode_keeps_initial_review(self):
        channel_url='https://mm.example/team/channels/qa'
        self.client.channel.return_value=('team',{'id':base.CHANNEL,'name':'qa','display_name':'QA'})
        rows=[base.post(str(i).zfill(26),i+1,channel=base.CHANNEL) for i in range(80)]
        self.client.posts_by_channel_id.return_value=(rows,False)
        options=self.options[:-2];options[1]=channel_url;options[3]='orca'
        key=self.invoke(*options,'--first-review','new')['id']
        self.client.posts_by_channel_id.assert_called_with(base.CHANNEL,0,None)
        with closing(watches.connect()) as db:
            state=json.loads(db.execute('SELECT data FROM watches WHERE id=?',(key,)).fetchone()[0])
        self.assertEqual(len(state['seen']),80)
        self.assertFalse(watches.initial_review_pending(state))
        options[5]='other-chat'
        opened=self.invoke(*options,'--first-review','open')['id']
        with closing(watches.connect()) as db:
            state=json.loads(db.execute('SELECT data FROM watches WHERE id=?',(opened,)).fetchone()[0])
        self.assertTrue(watches.initial_review_pending(state))

    def test_retry_of_pending_creation_cannot_silently_change_initial_review_mode(self):
        options=self.options[:-2];options[3]='orca'
        key=self.invoke(*options,'--new','--first-review','new')['id']
        with self.assertRaisesRegex(ValueError,'другими условиями'):
            self.invoke(*options,'--new','--first-review','open')
        self.assertEqual(self.invoke(*options,'--new','--first-review','new')['id'],key)
