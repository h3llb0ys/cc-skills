"""Private JSON/stdin bridge. No secrets in argv, stdout or diagnostic traces."""
import json
import os
import sqlite3
import subprocess
import sys
from contextlib import closing
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / 'runtime'
SOURCE = ROOT.parents[2] / 'skills/mattermost/scripts'
sys.path.insert(0, str(SOURCE if (SOURCE / 'mm.py').is_file() else RUNTIME))
import mm
import watches
from connection import connection
from client import Client, ApiError, AuthError
from urllib.parse import urlsplit


def invoke(*args):
    try:
        parsed = mm.parser().parse_args(args)
    except SystemExit:
        raise ValueError('Проверьте интервал, часовой пояс и дату окончания (ISO 8601 с timezone)') from None
    return watches.handle(parsed)


def handle(data):
    op = data['op']
    if op == 'recipients':
        if data.get('owner'):
            result = json.loads(watches.run(['orca','bot','chats','--bot',data['owner'],'--json']).stdout)['result']
            return [{'value':c['id'],'label':c.get('title') or 'Без названия'} for c in result['chats'] if not c.get('closed') and not c.get('self')]
        result = json.loads(watches.run(['orca','bot','list','--json']).stdout)['result']
        return [{'value':b['name'],'label':b['name']} for b in result['bots'] if not b.get('paused')]
    if op == 'preview':
        client = Client(timeout=10)
        try:
            if urlsplit(data['url']).path.rstrip('/').split('/')[-2:-1] == ['channels']:
                team, channel = client.channel(data['url'])
                source, title = channel['id'], channel['display_name']
                url = f"{client.base}/{team}/channels/{channel['name']}"
                kind = 'channel'
            else:
                team, source, posts = client.thread(data['url'])
                title = (next(p['message'] for p in posts if p['id']==source).splitlines() or ['Ветка Mattermost'])[0][:96]
                url = f"{client.base}/{team}/pl/{source}"
                kind = 'thread'
        except AuthError:
            raise ValueError('Сессия истекла — обновите подключение') from None
        except ApiError:
            raise ValueError('Источник недоступен: проверьте ссылку и права доступа') from None
        binding = watches.watch_id(client.base,source,'orca',data.get('owner',''),data.get('chat',''))
        try:
            with closing(watches.connect(readonly=True)) as db:
                row = watches.bound_watch(db,binding)
        except sqlite3.OperationalError:
            row = None
        return {'url':url,'title':title,'kind':kind,'existing':json.loads(row[0])['id'] if row else None}
    if op == 'summary':
        with closing(watches.connect()) as db:
            cursor = db.execute("SELECT * FROM summaries WHERE id=? AND platform='orca'",(data['id'],))
            row = cursor.fetchone()
            if not row:
                raise ValueError('Сводка не найдена')
            result = dict(zip((c[0] for c in cursor.description),row))
        result['body'] = result['body'][:16000]
        result['draft'] = result['draft'][:16000]
        return result
    if op == 'connection':
        action = data['action']
        if action not in ('status', 'test', 'save'):
            raise ValueError('Неизвестное действие соединения')
        return connection(action, data.get('data'))
    if op == 'list':
        rows = invoke('watch', 'list', '--platform', 'orca')
        problem = None
        try:
            jobs = watches.schedules({'platform': 'orca'}) if rows else []
        except Exception:
            jobs = None
            problem = 'Не удалось прочитать расписания Orca'
        for row in rows:
            job = next((j for j in jobs or [] if j['id'] == row.get('schedule')), None)
            row['schedule_state'] = 'unknown' if jobs is None else ('missing' if job is None else ('disabled' if job.get('enabled') is False else 'active'))
        return {'watches': rows, 'problem': problem}
    if op == 'inbox':
        before = data.get('before')
        if before is not None and (type(before) is not int or before < 1):
            raise ValueError('Некорректная страница входящих')
        with closing(watches.connect()) as db, db:
            cursor = db.execute("""SELECT s.* FROM summaries s WHERE s.platform='orca'
                AND (? IS NULL OR s.id < ?) ORDER BY s.id DESC LIMIT 11""", (before, before))
            rows = [dict(zip((c[0] for c in cursor.description), row)) for row in cursor]
        more = len(rows) > 10
        rows = rows[:10]
        for row in rows:
            row['truncated'] = len(row['body']) > 2000 or len(row['draft']) > 2000
            row['body'] = row['body'][:2000]
            row['draft'] = row['draft'][:2000]
        return {'rows': rows, 'more': more, 'before': rows[-1]['id'] if rows else None}
    if op == 'copy':
        with closing(watches.connect()) as db, db:
            row = db.execute("SELECT draft FROM summaries WHERE id=? AND platform='orca'", (data['id'],)).fetchone()
        if not row or not row[0]:
            raise ValueError('Черновик не найден')
        subprocess.run(['/usr/bin/pbcopy'], input=row[0], text=True, check=True, timeout=5)
        return {'copied': True}
    if op == 'create':
        form = data['form']
        args = ['watch', form['url'], '--new', '--platform', 'orca', '--owner', form['owner'], '--chat', form['chat'],
                '--timezone', form['timezone'], '--first-review', form.get('firstReview','open'), *fields(form)]
        row = invoke(*args)
        # Creation is deliberately saved before registration; UI can repair failures.
        return invoke('enable', row['id'], '--platform', 'orca')
    if op in ('edit', 'pause', 'resume', 'check', 'enable', 'unwatch'):
        args = [op, data['id'], '--platform', 'orca']
        if op == 'edit':
            args += fields(data['form'])
            if data['form'].get('chat'):
                args += ['--chat',data['form']['chat']]
        return invoke(*args)
    raise ValueError('Неизвестное действие')


def fields(form):
    args = ['--interval', str(form['interval']), '--rule', form['rule']]
    if form.get('draft'):
        args.append('--draft')
    if form.get('until'):
        args += ['--until', form['until']]
    return args


if __name__ == '__main__':
    os.umask(0o077)
    try:
        result = handle(json.load(sys.stdin))
        print(json.dumps({'ok': True, 'result': result}, ensure_ascii=False))
    except Exception as error:
        # Never print exception objects for external processes or connection input.
        message = str(error) if isinstance(error, ValueError) else 'Ошибка CLI, сети или расписания. Проверьте соединение и Orca.'
        print(json.dumps({'ok': False, 'error': message}, ensure_ascii=False))
