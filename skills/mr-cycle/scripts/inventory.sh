#!/usr/bin/env bash
# Inventory of the MR diff for the simplification, style, test and comment stages: every line is a
# candidate that needs a verdict. Go code only; mocks and generated code are skipped.
#   inventory.sh [base]   base defaults to the merge-base with origin/main (or main)
set -u

top=$(git rev-parse --show-toplevel)
cd "$top"
base=${1:-$(git merge-base HEAD origin/main 2>/dev/null || git merge-base HEAD main 2>/dev/null || echo HEAD)}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

sp='[[:space:]]'
id='[A-Za-z_][A-Za-z0-9_]*'
skip='(mocks?_test\.go|/mocks?/|/gen/|\.pb\.go$)'
{ git diff --name-only "$base" -- '*.go'; git ls-files -o --exclude-standard -- '*.go'; } | sort -u \
	| grep -Ev "$skip" | while read -r f; do if [ -f "$f" ]; then echo "$f"; fi; done >"$tmp/files" || true
[ -s "$tmp/files" ] || { echo "no Go changes against $base"; exit 0; }

is_new() { ! git cat-file -e "$base:$1" 2>/dev/null; }

# Added lines of a file: the diff against base, or the whole file when it is new.
added() {
	if is_new "$1"; then cat "$1"; else git diff "$base" -- "$1" | grep '^+' | grep -v '^+++' | sed 's/^+//' || true; fi
}

# Names declared or changed by the MR: declarations on added lines plus functions whose body changed.
touched() {
	added "$1" | grep -oE "^(func|type)( \([^)]*\))? $id" | sed -E 's/^(func|type)( \([^)]*\))? //'
	is_new "$1" || git diff "$base" -- "$1" | grep -oE "^@@ .* @@ func( \([^)]*\))? $id" | sed -E 's/.* //'
}

# Uses of a name in the given files, without its declaration, method receivers, comments and mocks.
uses() {
	local n=$1
	shift
	grep -hEv "^$sp*//" "$@" 2>/dev/null | sed -E 's/"([^"\\]|\\.)*"//g' \
		| grep -Ev "^(func|type)( \([^)]*\))? $n\b" | grep -Ev "^func \($id \*?$n\)" \
		| grep -Ev "^$sp+$n :?= func" | grep -ow "$n" | wc -l | tr -d ' '
}

# Go files of a directory without mocks and generated code; production code counts only production uses,
# since a test calling a helper is no reason to keep it.
pkg_files() {
	case "$2" in
	*_test.go) ls "$1"/*.go 2>/dev/null | grep -Ev "$skip" ;;
	*) ls "$1"/*.go 2>/dev/null | grep -Ev "$skip" | grep -v '_test\.go$' ;;
	esac
}

# Where to look for the neighbours' way: the module for internal/<module>, the whole repo otherwise.
scope() { case "$1" in internal/*) echo "$1" | cut -d/ -f1-2 ;; *) echo . ;; esac; }

echo "== Declared or changed by the MR and used once: inline unless it stops reading well"
while read -r f; do
	dir=$(dirname "$f")
	touched "$f" | grep -Ev '^(Test|Setup|TearDown)' | sort -u | while read -r n; do
		grep -qE "^(func|type)( \([^)]*\))? $n\b" "$f" || continue
		case "$n" in
		[A-Z]*) c=$(uses "$n" $(git ls-files -co --exclude-standard -- '*.go' | grep -Ev "$skip")) ;;
		*) c=$(uses "$n" $(pkg_files "$dir" "$f")) ;;
		esac
		if [ "$c" -le 1 ]; then echo "$f: $n"; fi
	done
	added "$f" | grep -oE "^$sp+$id :?= func\(" | sed -E "s/^$sp+//; s/ .*//" | sort -u | while read -r n; do
		if [ "$(uses "$n" "$f")" -le 1 ]; then echo "$f: $n (closure)"; fi
	done
done <"$tmp/files"

echo
echo "== Interface methods added or changed by the MR: does an existing method already cover it?"
while read -r f; do
	added "$f" | grep -E "^$sp+[A-Z][A-Za-z0-9_]*\(ctx context\.Context" | sed -E "s|^$sp+|$f: |" || true
done <"$tmp/files"

echo
echo "== New files: one use-case action per file; does this one deserve its own?"
while read -r f; do if is_new "$f"; then echo "$f"; fi; done <"$tmp/files"

echo
echo "== External package members the module did not use at base: use the neighbours' way"
own=$(sed -n 's/^module //p' go.mod 2>/dev/null)
while read -r f; do
	sed -n '/^import (/,/^)/p' "$f" | grep -oE "^$sp*($id$sp+)?\"[^\"]+\"" | grep -v "\"${own:-//}/" \
		| sed -E "s/^$sp*//; s/^\"([^\"]*\/)?([^\"/]+)\"$/\2/; s/^($id)$sp+\".*/\1/; s/^v[0-9]+$//" | grep -v '^$' || true
done <"$tmp/files" | sort -u >"$tmp/aliases"
while read -r f; do
	m=$(scope "$f")
	added "$f" | grep -oE '(^|[^A-Za-z0-9_.])[a-z][a-z0-9_]*\.[A-Z][A-Za-z0-9_]*' | sed -E 's/^[^a-z]//' | sort -u \
		| while read -r sym; do
			grep -qxF "${sym%%.*}" "$tmp/aliases" || continue
			git grep -qE "[^A-Za-z0-9_.]${sym//./\\.}([^A-Za-z0-9_]|$)" "$base" -- "$m/**/*.go" 2>/dev/null \
				|| echo "$f: $sym"
		done
done <"$tmp/files" | sort -u

echo
echo "== log.FromCtx where the package has its own logger helper: log the way neighbouring methods do"
while read -r f; do
	dir=$(dirname "$f")
	helper=$(grep -hoE "^func \($id \*?$id\) logger\(" $(pkg_files "$dir" x.go) 2>/dev/null | head -1)
	[ -n "$helper" ] || continue
	case "$f" in *_test.go) continue ;; esac
	added "$f" | grep -E 'log\.FromCtx\(' | sed -E "s|^$sp+||; s|^|$f: |" || true
done <"$tmp/files"

echo
echo "== Log capture in tests: check behaviour by results and calls, not logs"
while read -r f; do
	case "$f" in *_test.go) added "$f" | grep -E 'zaptest/observer|ObservedLogs|FilterMessage|ContextMap\(' \
		| sed "s|^|$f: |" || true ;; esac
done <"$tmp/files"

echo
echo "== Comments added by the MR: keep reasons and non-obvious semantics only"
while read -r f; do
	added "$f" | grep -E '//' | grep -vE '//go:|//nolint|://' | sed "s|^|$f: |" || true
done <"$tmp/files"
