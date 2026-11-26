"""Private JSON/stdin bridge. No secrets in argv, stdout or diagnostic traces."""
import json
import os
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


def invoke(*args):
    try:
        parsed = mm.parser().parse_args(args)
    except SystemExit:
        raise ValueError('Проверьте интервал, часовой пояс и дату окончания (ISO 8601 с timezone)') from None
    return watches.handle(parsed)


def handle(data):
    op = data['op']
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
                '--timezone', form['timezone'], *fields(form)]
        row = invoke(*args)
        # Creation is deliberately saved before registration; UI can repair failures.
        return invoke('enable', row['id'], '--platform', 'orca')
    if op in ('edit', 'pause', 'resume', 'check', 'enable', 'unwatch'):
        args = [op, data['id'], '--platform', 'orca']
        if op == 'edit':
            args += fields(data['form'])
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
