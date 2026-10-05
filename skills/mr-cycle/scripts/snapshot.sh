#!/usr/bin/env bash
# Snapshot of the working tree for mr-cycle reruns: tracked and untracked files (honoring
# .gitignore) go into a local ref, refs/mr-cycle/<branch>. Index, branch and stash stay untouched.
#   save [notes-file]  store the snapshot; the notes file (rejected review findings) becomes its message
#   diff [git diff args]  changes since the snapshot, new files included
#   notes              print the stored notes
set -euo pipefail

ref="refs/mr-cycle/$(git rev-parse --abbrev-ref HEAD)"

current_tree() {
	local index
	index=$(mktemp)
	GIT_INDEX_FILE="$index" git read-tree HEAD
	GIT_INDEX_FILE="$index" git add -A
	GIT_INDEX_FILE="$index" git write-tree
	rm -f "$index"
}

case "${1:-}" in
save)
	if [ -n "${2:-}" ]; then
		commit=$(git commit-tree "$(current_tree)" -p HEAD -F "$2")
	else
		commit=$(git commit-tree "$(current_tree)" -p HEAD -m "mr-cycle snapshot")
	fi
	git update-ref "$ref" "$commit"
	echo "$ref"
	;;
diff)
	git rev-parse --verify --quiet "$ref" >/dev/null || { echo "no snapshot at $ref" >&2; exit 1; }
	git diff "$ref" "$(current_tree)" "${@:2}"
	;;
notes)
	git log -1 --format=%B "$ref"
	;;
*)
	echo "usage: snapshot.sh save [notes-file] | diff [git diff args] | notes" >&2
	exit 2
	;;
esac
