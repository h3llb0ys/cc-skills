#!/usr/bin/env bash
# Test-pyramid inventory of the MR diff for the pyramid stage: functions the MR declared or changed that
# no test calls directly, and their statements no test runs. Go code only; mocks and generated code are
# skipped. Extra arguments go to `go test` (build tags as in the project's unit-test target).
#   pyramid.sh [base] [go test flags...]   base defaults to the merge-base with origin/main (or main)
set -u

top=$(git rev-parse --show-toplevel)
cd "$top"
base=$(git merge-base HEAD origin/main 2>/dev/null || git merge-base HEAD main 2>/dev/null || echo HEAD)
case "${1:-}" in -* | '') ;; *) base=$1 && shift ;; esac
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

id='[A-Za-z_][A-Za-z0-9_]*'
skip='(_test\.go$|/mocks?/|/gen/|\.pb\.go$)'
{ git diff --name-only "$base" -- '*.go'; git ls-files -o --exclude-standard -- '*.go'; } | sort -u \
	| grep -Ev "$skip" | while read -r f; do if [ -f "$f" ]; then echo "$f"; fi; done >"$tmp/files" || true
[ -s "$tmp/files" ] || { echo "no Go production changes against $base"; exit 0; }

is_new() { ! git cat-file -e "$base:$1" 2>/dev/null; }

# Functions declared on added lines (the whole file when new) plus functions whose body changed.
touched() {
	if is_new "$1"; then cat "$1"; else git diff "$base" -- "$1" | grep '^+' | grep -v '^+++' | sed 's/^+//'; fi \
		| grep -oE "^func( \([^)]*\))? $id" | sed -E 's/.* //'
	is_new "$1" || git diff "$base" -- "$1" | grep -oE "^@@ .* @@ func( \([^)]*\))? $id" | sed -E 's/.* //'
}

# Test files that may call a function: its package, plus every test of the repo for an exported name.
test_files() {
	ls "$(dirname "$1")"/*_test.go 2>/dev/null | grep -Ev '/mocks?_test\.go$'
	case "$2" in [A-Z]*) git ls-files -co --exclude-standard -- '*_test.go' | grep -Ev '/mocks?_test\.go$' ;; esac
}

while read -r f; do
	touched "$f" | grep -Ev '^(init|main)$' | sort -u | while read -r n; do
		grep -qE "^func( \([^)]*\))? $n[[(]" "$f" || continue
		echo "$f $n"
	done
done <"$tmp/files" >"$tmp/funcs"

echo "== Declared or changed by the MR without a direct test call: a test through the caller does not count"
while read -r f n; do
	tests=$(test_files "$f" "$n" | sort -u)
	if [ -z "$tests" ]; then
		echo "$f: $n (package has no tests)"
	elif grep -qE "(^|[^A-Za-z0-9_])$n(\[[^]]*\])?\(" $tests; then
		continue
	elif grep -qw "$n" $tests; then
		echo "$f: $n (tests only pass it as a value)"
	else
		echo "$f: $n"
	fi
done <"$tmp/funcs"

echo
echo "== Statements of those functions no test runs: a test, or why the branch is unreachable"
module=$(sed -n 's/^module //p' go.mod 2>/dev/null)
pkgs=$(xargs -n1 dirname <"$tmp/files" | sort -u | sed 's|^|./|')
if ! go test -count=1 -coverprofile="$tmp/cover.out" "$@" $pkgs >"$tmp/test.log" 2>&1; then
	echo "go test failed, coverage skipped:"
	grep -E '^(--- FAIL|FAIL|ok|panic:)' "$tmp/test.log" | head -20
	exit 0
fi
while read -r f n; do
	start=$(grep -nE "^func( \([^)]*\))? $n[[(]" "$f" | head -1 | cut -d: -f1)
	end=$(awk -v s="$start" 'NR > s && /^}/ { print NR; exit }' "$f")
	grep -F "$module/$f:" "$tmp/cover.out" | awk -v s="$start" -v e="$end" -v f="$f" -v n="$n" '
		$NF == 0 { sub(/^.*:/, "", $1); split($1, a, /[.,]/); if (a[1] >= s && a[1] <= e) print f ":" a[1] "-" a[3] " in " n }'
done <"$tmp/funcs"
