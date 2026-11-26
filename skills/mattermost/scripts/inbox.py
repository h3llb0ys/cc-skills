"""BB summary history. Callers own the SQLite transaction."""
import json


def initialize(db):
    db.execute("""CREATE TABLE IF NOT EXISTS summaries (
        id INTEGER PRIMARY KEY, chat TEXT NOT NULL, source TEXT NOT NULL,
        headline TEXT NOT NULL, body TEXT NOT NULL, draft TEXT NOT NULL, url TEXT NOT NULL,
        status TEXT NOT NULL, created INTEGER NOT NULL, opened INTEGER NOT NULL DEFAULT 0)""")
    db.execute("CREATE TABLE IF NOT EXISTS summary_sources (summary INTEGER PRIMARY KEY, watch TEXT NOT NULL)")
    db.execute("CREATE INDEX IF NOT EXISTS summary_sources_watch ON summary_sources(watch,summary)")
    db.execute("CREATE INDEX IF NOT EXISTS summaries_chat ON summaries(chat, id)")
    db.execute("CREATE INDEX IF NOT EXISTS summaries_unread ON summaries(chat, opened, id)")
    db.execute("CREATE TABLE IF NOT EXISTS summary_threads (chat TEXT PRIMARY KEY, child TEXT NOT NULL)")


def record(db, state, headline, message, draft, url, status, now):
    entry = db.execute("""INSERT INTO summaries(chat, source, headline, body, draft, url, status, created)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (state["chat"], state.get("title") or state["url"], headline, message, draft, url, status, now))
    db.execute("INSERT INTO summary_sources VALUES (?, ?)", (entry.lastrowid, state["id"]))


def listing(db, chat, before=None):
    fields = "id, source, headline, url, status, created, opened, (SELECT watch FROM summary_sources WHERE summary=id) AS watch_id"
    def fetch(where, params, limit):
        cursor = db.execute(f"SELECT {fields} FROM summaries WHERE chat=? {where} ORDER BY id DESC LIMIT ?",
                            (chat, *params, limit))
        return [dict(zip((col[0] for col in cursor.description), row)) for row in cursor]

    rows = fetch("AND id < ?" if before else "", (before,) if before else (), 21)
    latest = fetch("AND opened=0", (), 1)
    unread = db.execute("SELECT COUNT(*) FROM summaries WHERE chat=? AND opened=0", (chat,)).fetchone()[0]
    child = db.execute("SELECT child FROM summary_threads WHERE chat=?", (chat,)).fetchone()
    return dict(rows=rows[:20], more=len(rows) > 20, unread=unread,
                latest=latest[0] if latest else None, child=child[0] if child else None)


def open_summary(db, chat, key):
    cursor = db.execute("SELECT *, (SELECT watch FROM summary_sources WHERE summary=id) AS watch_id FROM summaries WHERE chat=? AND id=?", (chat, key))
    row = cursor.fetchone()
    if not row:
        raise ValueError("Сводка не найдена в этом треде")
    db.execute("UPDATE summaries SET opened=1 WHERE chat=? AND id=?", (chat, key))
    return dict(zip((col[0] for col in cursor.description), row), opened=1)


def deliver_to_child(db, state, body, run):
    chat = state["chat"]
    saved = db.execute("SELECT child FROM summary_threads WHERE chat=?", (chat,)).fetchone()
    if saved:
        # Recreate an archived/deleted child on the next notification.
        active = json.loads(run(["bb", "thread", "list", "--project", state["owner"], "--parent-thread", chat,
                                 "--thread", saved[0], "--json"]).stdout)
        if any(row["id"] == saved[0] for row in active):
            run(["bb", "thread", "tell", saved[0], "--mode", "queue", "--message-file", "-"], body)
            return saved[0]
    result = run(["bb", "thread", "spawn", "--project", state["owner"], "--environment", state["environment"],
                  "--parent-thread", chat, "--visibility", "visible", "--parent-notifications", "off",
                  "--title", "Сводки Mattermost", "--prompt-file", "-", "--json"], body)
    child = json.loads(result.stdout)["id"]
    db.execute("INSERT OR REPLACE INTO summary_threads VALUES (?, ?)", (chat, child))
    return child
