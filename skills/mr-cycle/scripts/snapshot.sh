#!/usr/bin/env bash
# Snapshot of the uncommitted work for mr-cycle reruns. Changed and new files (honoring .gitignore)
# are copied outside the repository, to $MR_CYCLE_HOME (default ~/.claude/mr-cycle); the repository
# itself is never touched.
#   save [notes-file]  store the snapshot; the notes file (rejected review findings) is kept with it
#   diff               changes since the snapshot, new and deleted files included
#   notes              print the stored notes
set -euo pipefail

top=$(git rev-parse --show-toplevel)
branch=$(git rev-parse --abbrev-ref HEAD)
repo_id="$(basename "$top")-$(printf '%s' "$top" | shasum | cut -c1-8)"
dir="${MR_CYCLE_HOME:-$HOME/.claude/mr-cycle}/$repo_id/$branch"
cd "$top"

changed_paths() {
	git ls-files -m -o --exclude-standard
	git ls-files -d
}

case "${1:-}" in
save)
	rm -rf "$dir"
	mkdir -p "$dir/files"
	git rev-parse HEAD >"$dir/head"
	changed_paths | sort -u | while IFS= read -r path; do
		if [ -f "$path" ]; then
			mkdir -p "$dir/files/$(dirname "$path")"
			cp "$path" "$dir/files/$path"
		else
			printf '%s\n' "$path" >>"$dir/deleted"
		fi
	done
	if [ -n "${2:-}" ]; then cp "$2" "$dir/notes"; fi
	echo "$dir"
	;;
diff)
	[ -f "$dir/head" ] || { echo "no snapshot at $dir" >&2; exit 1; }
	head=$(cat "$dir/head")
	{
		(cd "$dir/files" && find . -type f | sed 's|^\./||')
		[ -f "$dir/deleted" ] && cat "$dir/deleted"
		git diff --name-only "$head"
		git ls-files -o --exclude-standard
	} | sort -u | while IFS= read -r path; do
		old=$(mktemp)
		if [ -f "$dir/files/$path" ]; then
			cp "$dir/files/$path" "$old"
		elif ! grep -qxF "$path" "$dir/deleted" 2>/dev/null; then
			git show "$head:$path" >"$old" 2>/dev/null || true
		fi
		new="/dev/null"
		[ -f "$path" ] && new="$path"
		diff -u --label "a/$path" --label "b/$path" "$old" "$new" || true
		rm -f "$old"
	done
	;;
notes)
	cat "$dir/notes" 2>/dev/null || true
	;;
*)
	echo "usage: snapshot.sh save [notes-file] | diff | notes" >&2
	exit 2
	;;
esac
