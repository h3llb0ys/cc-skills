"""Actionable posts, kept separately from the immutable per-chat summary history."""
import json
from pathlib import Path

SIGNALS = ("answer", "attention", "resolved")
PAGE = 30


def initialize(db):
    if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='board_cards'").fetchone():
        return
    # Schema and initial projection become visible together, including on concurrent startup.
    db.execute("BEGIN IMMEDIATE")
    if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='board_cards'").fetchone():
        db.commit()
        return
    db.execute("""CREATE TABLE board_cards (
        id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL UNIQUE, post TEXT NOT NULL,
        status TEXT NOT NULL, headline TEXT NOT NULL, body TEXT NOT NULL,
        draft TEXT NOT NULL, author TEXT NOT NULL, updated INTEGER NOT NULL,
        opened INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1)""")
    db.execute("""CREATE TABLE board_sources (watch TEXT NOT NULL, card INTEGER NOT NULL,
                  PRIMARY KEY(watch,card))""")
    db.execute("CREATE INDEX board_sources_card ON board_sources(card)")
    db.execute("CREATE INDEX IF NOT EXISTS board_status ON board_cards(status, updated DESC, id DESC)")

    for (data,) in db.execute("SELECT data FROM watches"):
        state = json.loads(data)
        if state.get("platform") != "bb":
            continue
        source = state.get("title") or state["url"]
        prefix = state["url"].rsplit("/", 2)[0] + "/pl/"
        posts = list(state.get("awaiting", []))
        status = state.get("status", "normal")
        if not posts and state.get("kind") != "channel" and status in SIGNALS:
            posts.append(state["url"].rsplit("/", 1)[-1])
        for post in posts:
            row = db.execute("""SELECT headline,body,draft,created,opened FROM summaries
                WHERE chat=? AND source=? AND url=? ORDER BY id DESC LIMIT 1""",
                (state["chat"], source, prefix + post)).fetchone()
            head, body, draft, updated, opened = row or (
                "Открыть вопрос в Mattermost", "", "", state.get("last_checked_at", 0), 0)
            write(db, state, post, "answer" if state.get("awaiting") else status,
                  head, body, draft if state.get("draft") else "", "", updated)
            if opened:
                db.execute("UPDATE board_cards SET opened=1 WHERE url=?", (prefix + post,))
    db.commit()


def permalink(state, post):
    return state["url"].rsplit("/", 2)[0] + "/pl/" + post


def write(db, state, post, status, headline, body, draft, author, now):
    url = permalink(state, post)
    current = db.execute("SELECT id,status,draft FROM board_cards WHERE url=?", (url,)).fetchone()
    if current and current[1] == "answer":
        if status == "attention":
            # Informational chatter in an overlapping watch cannot close a personal question.
            db.execute("INSERT OR IGNORE INTO board_sources VALUES (?,?)", (state["id"], current[0]))
            return
        if status == "answer" and not state.get("draft"):
            draft = current[2]
    db.execute("""INSERT INTO board_cards(url,post,status,headline,body,draft,author,updated)
        VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(url) DO UPDATE SET
        status=excluded.status, headline=excluded.headline, body=excluded.body,
        draft=excluded.draft, author=excluded.author, updated=excluded.updated, opened=0, revision=revision+1
        WHERE (status,headline,body,draft,author) !=
              (excluded.status,excluded.headline,excluded.body,excluded.draft,excluded.author)""",
        (url, post, status, headline[:160], body[:1000], draft[:8000], author[:160], now))
    db.execute("INSERT OR IGNORE INTO board_sources SELECT ?,id FROM board_cards WHERE url=?", (state["id"], url))


def close(db, state, post, now):
    db.execute("""UPDATE board_cards SET status='resolved',draft='',updated=?,opened=0,revision=revision+1
                  WHERE url=? AND status!='resolved'""", (now, permalink(state, post)))


def details(path, allowed):
    if not path:
        return {}
    data = json.loads(Path(path).read_text())
    result = {}
    if not isinstance(data, list):
        raise ValueError("Expected an array in --cards-file")
    for item in data:
        if not isinstance(item, dict):
            raise ValueError("Invalid board card")
        key = item.get("post_id")
        if not isinstance(key, str) or key not in allowed or key in result:
            raise ValueError("Each card needs a unique reviewed or tracked post ID")
        if item.get("status") not in SIGNALS or any(not isinstance(item.get(k), str) or not item[k].strip()
                                                     for k in ("headline", "body")):
            raise ValueError("Each card needs a status, headline and body")
        if not isinstance(item.get("draft", ""), str):
            raise ValueError("Invalid card draft")
        result[key] = item
    return result


def reconcile(db, state, args, message, draft, headline, now, closed, previous):
    tracked = dict(db.execute("""SELECT b.post,b.author FROM board_cards b
                               JOIN board_sources s ON s.card=b.id WHERE s.watch=?""", (state["id"],)))
    items = details(args.cards_file, state["reviewed"].keys() | tracked.keys())
    personal = set(state.get("awaiting", []))
    primary = args.post_id
    thread = state.get("kind") != "channel"
    if not primary and thread:
        primary = state["url"].rsplit("/", 1)[-1]
    if primary and message and args.status in SIGNALS and not items and not (closed and args.status == "resolved"):
        if args.status != "answer" or primary in personal or (thread and not personal):
            items[primary] = dict(status=args.status, headline=headline, body=message, draft=draft)
    for key in personal:
        if key not in items and (key not in previous or key not in tracked):
            hint = state.get("board_context", {}).get(key, {})
            text = hint.get("message") or "Открыть вопрос в Mattermost"
            items[key] = dict(status="answer", headline=text.splitlines()[0], body=text)
    for key, item in items.items():
        status = item["status"]
        if status == "answer" and key not in personal and not (thread and key == primary and args.status == "answer"):
            raise ValueError("Use --awaiting for a personal question")
        if key in personal:
            status = "answer"
        hint = state.get("board_context", {}).get(key, {})
        write(db, state, key, status, item["headline"], item["body"],
              item.get("draft", "") if state.get("draft") and status == "answer" else "", hint.get("author") or tracked.get(key, ""), now)
    for key in closed:
        close(db, state, key, now)
    if primary in tracked and args.status == "resolved" and not (items or closed or personal):
        close(db, state, primary, now)
    if primary and args.status == "normal" and primary not in personal and primary not in items:
        discard(db, state["id"], primary)


def active_items(db, watch):
    return dict(db.execute("""SELECT post,headline FROM board_cards b JOIN board_sources s ON s.card=b.id
                              WHERE s.watch=? AND status!='resolved'""", (watch,)))


def discard(db, watch, post=None):
    if post is None:
        db.execute("DELETE FROM board_sources WHERE watch=?", (watch,))
    else:
        db.execute("""DELETE FROM board_sources WHERE watch=? AND card IN
                      (SELECT id FROM board_cards WHERE post=? AND status!='resolved')""", (watch, post))
    db.execute("DELETE FROM board_cards WHERE NOT EXISTS (SELECT 1 FROM board_sources s WHERE s.card=board_cards.id)")


def listing(db, status, offset, now):
    # Derive the destination and draft visibility from the same active sources.
    active = """WITH active_cards AS (
        SELECT s.card, MIN(s.watch) AS source, MAX(COALESCE(json_extract(d.data,'$.draft'),0)) AS show_draft
        FROM board_sources s JOIN watches d ON d.id=s.watch
        WHERE COALESCE(json_extract(d.data,'$.suspended'),0)=0 AND COALESCE(json_extract(d.data,'$.paused'),0)=0
          AND (json_extract(d.data,'$.until') IS NULL OR json_extract(d.data,'$.until')>?)
        GROUP BY s.card)"""
    sources = "FROM board_cards b JOIN active_cards a ON a.card=b.id JOIN watches w ON w.id=a.source WHERE b.status=?"
    count = db.execute(f"{active} SELECT COUNT(*) {sources}", (now, status)).fetchone()[0]
    rows = db.execute(f"""{active} SELECT b.id,b.revision,b.headline,b.body,
            CASE WHEN a.show_draft THEN b.draft ELSE '' END,
            b.author,b.updated,b.opened,b.url,
            json_extract(w.data,'$.channel'),json_extract(w.data,'$.title'),json_extract(w.data,'$.chat')
            {sources} ORDER BY b.updated DESC,b.id DESC LIMIT ? OFFSET ?""", (now, status, PAGE, offset))
    return dict(total=count, rows=[dict(id=key, revision=revision, headline=head, body=body, draft=draft, author=author,
                updated=updated, opened=bool(opened), url=url,
                source=("#" + channel if channel else title or "Mattermost"), chat=chat)
                for key, revision, head, body, draft, author, updated, opened, url, channel, title, chat in rows])
