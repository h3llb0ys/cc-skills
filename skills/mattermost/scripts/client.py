"""Small, read-only Mattermost REST v4 client."""

import json
import os
import re
import shutil
import tempfile
from datetime import datetime, timezone
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


class AuthError(ValueError):
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


class Client:
    def __init__(self):
        config = {}
        default = Path.home() / ".config/cc-skills/mattermost.env"
        path = Path(os.environ.get("MM_CONFIG", default))
        if path.is_file():
            for line in path.read_text().splitlines():
                key, separator, value = line.partition("=")
                if separator and key.strip() in ("MM_URL", "MM_COOKIE"):
                    value = value.strip()
                    if value.startswith('"'):
                        value = json.loads(value)
                    elif len(value) >= 2 and value[0] == value[-1] == "'":
                        value = value[1:-1]
                    config[key.strip()] = value
        self.base = (os.environ.get("MM_URL") or config.get("MM_URL", "")).rstrip("/")
        site = urlsplit(self.base)
        if site.scheme != "https" or not site.hostname or site.username is not None or site.query or site.fragment:
            raise ValueError("Configure a trusted HTTPS Mattermost site in MM_URL or MM_CONFIG")
        cookie = os.environ.get("MM_COOKIE")
        if not cookie and self.base == config.get("MM_URL", "").rstrip("/"):
            cookie = config.get("MM_COOKIE")
        if not cookie or not cookie.isascii() or not cookie.isprintable():
            raise AuthError("Mattermost session cookie is missing or invalid")
        self.headers = {"Cookie": cookie, "Accept": "application/json"}
        parsed = SimpleCookie(cookie)
        if "MMCSRF" in parsed:
            self.headers["X-CSRF-Token"] = parsed["MMCSRF"].value
        self.opener = build_opener(NoRedirect)

    def open(self, path, params=None, body=None):
        url = self.base + "/api/v4/" + path
        if params:
            url += "?" + urlencode(params)
        request = Request(url, headers=self.headers)
        if body is not None:
            request.data = json.dumps(body).encode()
            request.add_header("Content-Type", "application/json")
        try:
            return self.opener.open(request, timeout=30)
        except HTTPError as error:
            error.close()
            if error.code == 401 or error.code in (301, 302, 303, 307, 308):
                raise AuthError("Mattermost session expired; refresh the cookie") from None
            raise ApiError(error.code, path) from None

    def api(self, path, **kwargs):
        with self.open(path, **kwargs) as response:
            return json.load(response)

    def link(self, url, route):
        if not url.startswith(self.base + "/"):
            raise ValueError("Expected a permalink on the configured Mattermost site")
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
            page = self.api("teams/" + mmid(channel["team_id"]) + "/posts/search", body=body)
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
        for start in range(0, len(users), 100):
            for user in self.api("users/ids", body=users[start:start + 100]):
                names[user["id"]] = user["username"]
        rows = []
        files = {}
        for post in posts:
            metadata = post.get("metadata") or {}
            files.update((f["id"], f["name"]) for f in metadata.get("files") or [] if f.get("name"))
            attachments = []
            for key in post.get("file_ids") or []:
                if key not in files:
                    try:
                        files[key] = self.api("files/" + mmid(key) + "/info").get("name")
                    except ApiError as error:
                        if error.status not in (403, 404):
                            raise
                        files[key] = None
                attachments.append({"id": key, "name": files[key]})
            rows.append({"id": post["id"], "author": names.get(post["user_id"], post["user_id"]),
                         "root_id": post.get("root_id") or post["id"], "time": timestamp(post["create_at"]), "message": post["message"],
                         "url": f'{self.base}/{team}/pl/{post["id"]}', "replies": post.get("reply_count"),
                         "files": attachments})
        return rows

    def download(self, key, output):
        path = "files/" + mmid(key)
        if not output:
            return self.api(path + "/info")
        target = Path(output)
        with self.open(path) as response, tempfile.NamedTemporaryFile(dir=target.parent) as scratch:
            shutil.copyfileobj(response, scratch)
            scratch.flush()
            os.link(scratch.name, target)  # Refuse to overwrite an existing destination.
        return {"saved": str(target)}
