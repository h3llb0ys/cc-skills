#!/usr/bin/env python3
"""Read Mattermost or manage a watch. Output is JSON; silent ticks print nothing."""

import argparse
import json
import os
import re
import sqlite3
import subprocess
import sys
import time
from datetime import datetime
from urllib.error import URLError
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from client import Client, mmid
from connection import connection
import watches


def positive(value):
    count = int(value)
    if count < 1:
        raise argparse.ArgumentTypeError("expected a positive integer")
    return count


def instant(value):
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        raise argparse.ArgumentTypeError("include a timezone offset")
    return int(dt.timestamp())


def since(value):
    match = re.fullmatch(r"(\d+)([mhd])", value)
    if match:
        seconds = int(match[1]) * {"m": 60, "h": 3600, "d": 86400}[match[2]]
        return int(time.time() - seconds) * 1000
    return instant(value) * 1000


def zone(value):
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError) as error:
        raise argparse.ArgumentTypeError("expected an IANA timezone") from error
    return value


def parser():
    cli = argparse.ArgumentParser(description=__doc__)
    commands = cli.add_subparsers(dest="action", required=True)
    for name in ("thread", "channel", "search", "around"):
        p = commands.add_parser(name)
        p.add_argument("url")
        if name in ("channel", "search", "thread"):
            p.add_argument("--limit", type=positive, default=None if name == "thread" else 50)
        if name == "channel":
            p.add_argument("--since", type=since, default="1d")
        if name == "search":
            p.add_argument("query")
        if name == "around":
            for side in ("--before", "--after"):
                p.add_argument(side, type=int, choices=range(201), metavar="0..200", default=5)
    p = commands.add_parser("connection", help="manage plugin connection settings")
    p.add_argument("operation", choices=["status", "test", "save"])
    p = commands.add_parser("file")
    p.add_argument("id")
    p.add_argument("--output", help="save attachment to a new file")
    p = commands.add_parser("watch", help="configure a watch or list subscriptions")
    p.add_argument("url", help="post permalink or list")
    p.add_argument("--new", action="store_true", help="create from the UI without replacing an existing watch")
    p.add_argument("--platform", choices=["bb", "orca"])
    p.add_argument("--owner", help="BB project ID or Orca bot name")
    p.add_argument("--chat", help="destination BB thread ID or Orca bot chat ID")
    p.add_argument("--environment", help="BB environment ID or path")
    p.add_argument("--title", help="short subscription title")
    p.add_argument("--draft", action="store_true", help="include a draft response")
    p.add_argument("--rule", help="when to notify and whether to draft a reply")
    p.add_argument("--interval", type=positive, metavar="MINUTES")
    p.add_argument("--push", help="BB push condition")
    p.add_argument("--timezone", type=zone)
    p.add_argument("--until", type=instant, help="end time in ISO 8601 with offset")
    p.add_argument("--destination", choices=["chat", "shared"])
    p = commands.add_parser("board")
    for status in ("answer", "attention", "resolved"):
        p.add_argument("--" + status, type=positive, default=0)
    p = commands.add_parser("read-card")
    p.add_argument("card", type=positive)
    p.add_argument("revision", type=positive)
    for name in ("inbox", "open-summary"):
        p = commands.add_parser(name)
        p.add_argument("--chat", required=True)
        if name == "inbox":
            p.add_argument("--before", type=positive)
        else:
            p.add_argument("summary", type=positive)
    for name in ("unwatch", "enable", "pause", "resume", "finish-setup", "check", "tick", "review", "resolve", "edit"):
        p = commands.add_parser(name)
        p.add_argument("id", help="local watch ID")
        if name in ("finish-setup", "edit"):
            for flag in ("--chat", "--owner", "--environment"):
                p.add_argument(flag, required=name == "finish-setup")
        if name in ("unwatch", "pause", "resume"):
            p.add_argument("--platform", choices=["bb", "orca"])
        if name == "edit":
            p.add_argument("--destination", choices=["chat", "shared"])
            p.add_argument("--interval", type=positive, required=True)
            p.add_argument("--rule", required=True)
            p.add_argument("--push")
            p.add_argument("--draft", action="store_true")
            p.add_argument("--until", type=instant)
        if name == "resolve":
            p.add_argument("--status", choices=["answer", "attention", "resolved", "normal"])

            p.add_argument("--awaiting", action="append", type=mmid, default=[], help="channel post awaiting the owner")
            p.add_argument("--answered", action="append", type=mmid, default=[], help="close a previously tracked question")
            p.add_argument("token")
            p.add_argument("--message-file")
            p.add_argument("--cards-file")
            p.add_argument("--headline")
            p.add_argument("--post-id", type=mmid)
            p.add_argument("--draft-file")
            p.add_argument("--push", action="store_true")
            p.add_argument("--recheck-at", type=instant)
    return cli


def main():
    os.umask(0o077)
    args = parser().parse_args()
    if args.action == "connection":
        result = connection(args.operation, None if args.operation == "status" else json.load(sys.stdin))
    elif args.action in ("watch", "unwatch", "enable", "pause", "resume", "finish-setup", "check", "tick", "review", "resolve", "edit", "inbox", "open-summary", "board", "read-card"):
        result = watches.handle(args)
        if args.action == "tick":
            return result
    else:
        client = Client()
        truncated = False
        if args.action == "file":
            result = client.download(args.id, args.output)
        else:
            if args.action == "thread":
                team, _, posts = client.thread(args.url)
                if args.limit and len(posts) > args.limit:
                    truncated = True
                    posts = posts[-args.limit:]
            elif args.action == "channel":
                team, posts, truncated = client.channel_posts(args.url, args.since, args.limit)
            elif args.action == "search":
                team, posts, truncated = client.search(args.url, args.query, args.limit)
            else:
                team, posts = client.around(args.url, args.before, args.after)
            result = {"posts": client.render(team, posts), "truncated": truncated}
    if result is not None or args.action in ("pause", "resume"):
        print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, KeyError, OSError, URLError, sqlite3.Error, subprocess.SubprocessError) as error:
        # External CLI arguments can contain a draft or an agent prompt.
        detail = "Platform CLI failed; inspect the automation run" if isinstance(error, subprocess.SubprocessError) else str(error)
        print(f"mm: {detail}", file=sys.stderr)
        sys.exit(2)
