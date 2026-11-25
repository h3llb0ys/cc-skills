"""Small, read-only Mattermost REST v4 client."""

import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


class AuthError(ValueError):
    pass


class SiteMismatch(ValueError):
    pass


class ApiError(ValueError):
    def __init__(self, status, path):
        super().__init__(f"Mattermost returned HTTP {status} for {path}")
        self.status = status


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


def mmid(value):
    if not re.fullmatch(r"[a-z0-9]{26}", value):
        raise ValueError("Expected a Mattermost ID (26 lowercase letters/digits)")
    return value


def timestamp(milliseconds):
    return datetime.fromtimestamp(milliseconds / 1000, timezone.utc).isoformat()


def ordered(posts):
    return sorted(posts, key=lambda post: (post["create_at"], post["id"]))


def config_path():
    return Path(os.environ.get("MM_CONFIG", "~/.config/cc-skills/mattermost.env")).expanduser()


def read_config(lines):
    values = {}
    for line in lines:
        key, separator, value = line.partition("=")
        if separator and key.strip() in ("MM_URL", "MM_COOKIE"):
            value = value.strip()
            if value.startswith('"'):
                value = json.loads(value)
            elif len(value) >= 2 and value[0] == value[-1] == "'":
                value = value[1:-1]
            if not isinstance(value, str):
                raise ValueError("Invalid Mattermost configuration")
            values[key.strip()] = value
    return values


def site_url(value):
    base = value.strip().rstrip("/")
    site = urlsplit(base)
    if (site.scheme != "https" or not site.hostname or site.username is not None
            or "?" in base or "#" in base or chr(92) in base or any(c.isspace() or ord(c) < 32 for c in base)):
        raise ValueError("Укажите HTTPS-адрес сервера Mattermost")
    return base


class Client:
    def __init__(self, credentials=None, *, timeout=30):
        self.timeout = timeout
        if credentials is None:
            override = os.environ.get("MM_URL")
            cookie = os.environ.get("MM_COOKIE") if override else None
            if override and cookie:
                base = override
            else:
                path = config_path()
                config = read_config(path.read_text().splitlines()) if path.is_file() else {}
                saved_url = config.get("MM_URL", "").rstrip("/")
                base = site_url(override or saved_url)
                if base == saved_url:
                    cookie = config.get("MM_COOKIE")
        else:
            base, cookie = credentials
        self.base = site_url(base)
        if not cookie or not cookie.isascii() or not cookie.isprintable():
            raise AuthError("Mattermost session cookie is missing or invalid")
        self.headers = {"Cookie": cookie, "Accept": "application/json"}
        parsed = SimpleCookie(cookie)
        if "MMCSRF" in parsed:
            self.headers["X-CSRF-Token"] = parsed["MMCSRF"].value
        self.opener = build_opener(NoRedirect)
        self.use_system_curl = False

    def _curl(self, request, path, deadline, output):
        # Keep credentials on stdin. No curlrc, URL globbing or redirects.
        args = ["/usr/bin/curl", "-q", "--globoff", "--proto", "=https", "--silent",
                "--connect-timeout", str(min(4, self.timeout)), "--header", "@-",
                "--write-out", "\n%{http_code}"]
        if request.data is not None:
            args.extend(["--data-binary", request.data.decode()])
        if output is not None:
            output.seek(0)
            output.truncate()
            args.extend(["--output", output.name, "--speed-limit", "1", "--speed-time", str(self.timeout)])
        headers = "".join(f"{key}: {value}\n" for key, value in request.header_items()).encode()
        for _ in range(2):
            remaining = deadline - time.monotonic()
            if remaining <= 0.001:
                break
            limits = ["--max-time", f"{remaining:.3f}"] if output is None else []
            reply = subprocess.run([*args, *limits, "--url", request.full_url], input=headers, capture_output=True)
            if reply.returncode == 28:
                continue
            if reply.returncode:
                raise OSError(f"Не удалось подключиться к Mattermost (curl {reply.returncode})")
            data, _, code = reply.stdout.rpartition(b"\n")
            self._check_status(int(code), path)
            return json.loads(data) if output is None else None
        raise TimeoutError(f"Mattermost не ответил за {self.timeout} с. Проверьте соединение и попробуйте ещё раз.")

    @staticmethod
    def _check_status(status, path):
        if status in (301, 302, 303, 307, 308, 401):
            raise AuthError("Mattermost session expired; refresh the cookie")
        if not 200 <= status < 300:
            raise ApiError(status, path)

    def _read(self, path, params=None, body=None, output=None):
        url = self.base + "/api/v4/" + path
        if params:
            url += "?" + urlencode(params)
        request = Request(url, headers=self.headers)
        if body is not None:
            request.data = json.dumps(body).encode()
            request.add_header("Content-Type", "application/json")
        if any("\r" in value or "\n" in value for _, value in request.header_items()):
            raise AuthError("Invalid Mattermost request header")
        deadline = time.monotonic() + self.timeout
        if not self.use_system_curl:
            # Leave time for the system client if macOS routes Python differently.
            timeout = min(5, self.timeout / 2) if sys.platform == "darwin" else self.timeout
            try:
                with self.opener.open(request, timeout=timeout) as response:
                    if output is None:
                        return json.load(response)
                    shutil.copyfileobj(response, output)
                    return None
            except HTTPError as error:
                error.close()
                self._check_status(error.code, path)
                raise
            except (TimeoutError, socket.timeout, URLError) as error:
                if isinstance(error, URLError) and not isinstance(error.reason, (TimeoutError, socket.timeout)):
                    raise
                if sys.platform != "darwin":
                    raise TimeoutError(f"Mattermost не ответил за {self.timeout} с. Проверьте соединение и попробуйте ещё раз.") from None
                self.use_system_curl = True
        return self._curl(request, path, deadline, output)

    def api(self, path, **kwargs):
        return self._read(path, **kwargs)

    def link(self, url, route):
        if not url.startswith(self.base + "/"):
            raise SiteMismatch("Ссылка относится к другому серверу Mattermost. Проверьте адрес в настройках подключения.")
        path = urlsplit(url[len(self.base):]).path
        match = re.fullmatch(r"/([\w.-]+)/" + route + r"/([\w.-]+)/?", path)
        if not match or any(piece in (".", "..") for piece in match.groups()):
            raise ValueError(f"Expected /team/{route}/identifier")
        return match.groups()

    def channel(self, url):
        team, name = self.link(url, "channels")
        channel = self.api(f"teams/name/{quote(team)}/channels/name/{quote(name)}")
        return team, channel

    def thread(self, url):
        team, selected = self.link(url, "pl")
        post = self.api("posts/" + mmid(selected))
        root = mmid(post.get("root_id") or post["id"])
        params = {"perPage": 100, "direction": "down"}
        posts = {}
        while True:
            page = self.api(f"posts/{root}/thread", params=params)
            rows = ordered(page["posts"].values())
            replies = [p for p in rows if p.get("root_id") == root]
            posts.update((p["id"], p) for p in rows if p["id"] == root or p.get("root_id") == root)
            if page.get("has_next") is False or ("has_next" not in page and len(rows) < params["perPage"]):
                break
            if not replies or replies[-1]["id"] == params.get("fromPost"):
                if page.get("has_next"):
                    raise ValueError("Mattermost thread pagination did not advance")
                break
            params.update(fromPost=replies[-1]["id"], fromCreateAt=replies[-1]["create_at"])
        if root not in posts or selected not in posts:
            raise ValueError("Mattermost returned an incomplete thread")
        return team, root, ordered(posts.values())

    def channel_posts(self, url, since, limit):
        team, channel = self.channel(url)
        posts, truncated = self.posts_by_channel_id(channel["id"], since, limit)
        return team, posts, truncated

    def posts_by_channel_id(self, channel_id, since, limit):
        path = "channels/" + mmid(channel_id) + "/posts"
        params = {"per_page": min(limit + 1, 200) if limit else 200, "skipFetchThreads": "true"}
        found = {}
        last_ids = None
        while limit is None or len(found) <= limit:
            page = self.api(path, params=params)
            ids = page["order"]
            rows = [page["posts"][key] for key in ids]
            found.update((p["id"], p) for p in rows if p["create_at"] >= since)
            if len(ids) < params["per_page"] or rows[-1]["create_at"] < since:
                break
            if ids == last_ids:
                raise ValueError("Mattermost channel pagination did not advance")
            last_ids = ids
            # Mattermost's before cursor excludes every post at its timestamp.
            # Overlap the oldest millisecond so messages sharing it reach the next page.
            anchor = next((p for p in reversed(rows) if p["create_at"] > rows[-1]["create_at"]), None)
            if anchor:
                params.update(before=anchor["id"], page=0)
            else:
                params["page"] = params.get("page", 0) + 1
        posts = ordered(found.values())
        return posts[-limit:] if limit else posts, limit is not None and len(posts) > limit

    def around(self, url, before, after):
        team, key = self.link(url, "pl")
        post = self.api("posts/" + mmid(key))
        path = "channels/" + mmid(post["channel_id"]) + "/posts"
        found = {key: post}
        for direction, count in [("before", before), ("after", after)]:
            if count:
                page = self.api(path, params={direction: key, "per_page": count, "skipFetchThreads": "true"})
                found.update((i, page["posts"][i]) for i in page["order"])
        return team, ordered(found.values())

    def search(self, url, query, limit):
        team, channel = self.channel(url)
        if re.search(r"(?:^|\s)(?:in|channel):", query, flags=re.I):
            raise ValueError("Specify the channel only via its URL")
        body = {"terms": f'in:{channel["name"]} {query}', "is_or_search": False,
                "page": 0, "per_page": min(limit + 1, 100)}
        posts = {}
        while len(posts) <= limit:
            try:
                page = self.api("teams/" + mmid(channel["team_id"]) + "/posts/search", body=body)
            except AuthError:
                self.api("users/me")
                raise ValueError("Сессия активна, но Mattermost отклонил поиск. Проверьте, "
                                 "что в настройках сохранён полный Cookie, включая актуальный MMCSRF.") from None
            previous = len(posts)
            for key in page["order"]:
                post = page["posts"][key]
                if post["channel_id"] == channel["id"]:
                    posts[key] = post
            if len(page["order"]) < body["per_page"]:
                break
            if previous == len(posts):
                raise ValueError("Mattermost search pagination did not advance")
            body["page"] += 1
        return team, list(posts.values())[:limit], len(posts) > limit

    def render(self, team, posts):
        names = {}
        users = list(dict.fromkeys(p["user_id"] for p in posts if p.get("user_id")))
        if self.headers.get("X-CSRF-Token"):
            for start in range(0, len(users), 100):
                try:
                    profiles = self.api("users/ids", body=users[start:start + 100])
                except AuthError:
                    break
                except ApiError as error:
                    if error.status != 403:
                        raise
                    break
                names.update((u["id"], u["username"]) for u in profiles)
        for key in users:
            if key in names:
                continue
            try:
                names[key] = self.api("users/" + mmid(key))["username"]
            except ApiError as error:
                if error.status not in (403, 404):
                    raise
        return self.render_posts(team, posts, names, fetch_files=True)

    def render_posts(self, team, posts, names, *, fetch_files=False):
        files = {}
        rows = []
        for post in posts:
            metadata = post.get("metadata") or {}
            files.update((f["id"], f["name"]) for f in metadata.get("files") or [] if f.get("name"))
            attachments = []
            for key in post.get("file_ids") or []:
                if key not in files and fetch_files:
                    try:
                        files[key] = self.api("files/" + mmid(key) + "/info").get("name")
                    except ApiError as error:
                        if error.status not in (403, 404):
                            raise
                        files[key] = None
                attachments.append({"id": key, "name": files.get(key)})
            rows.append({"id": post["id"], "author": names.get(post["user_id"], post["user_id"]), "author_id": post["user_id"],
                         "root_id": post.get("root_id") or post["id"], "time": timestamp(post["create_at"]), "message": post["message"],
                         "url": f'{self.base}/{team}/pl/{post["id"]}', "replies": post.get("reply_count"),
                         "files": attachments})
        return rows

    def download(self, key, output):
        path = "files/" + mmid(key)
        if not output:
            return self.api(path + "/info")
        target = Path(output)
        with tempfile.NamedTemporaryFile(dir=target.parent) as scratch:
            self._read(path, output=scratch)
            scratch.flush()
            os.link(scratch.name, target)  # Refuse to overwrite an existing destination.
        return {"saved": str(target)}
