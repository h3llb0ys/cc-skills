#!/bin/zsh
# Запуск codex-участника консилиума: read-only, промпт из файла, итог в -o.
# Usage: codex-run.sh <model-slug> <effort> <repo> <prompt-file> <out-file> [session-id]
#   session-id задан → resume этой сессии тем же промптом-файлом.
# Печатает строку `session id:` по завершении; во время прогона она уже лежит в <итог>.stdout.

emulate -L zsh
setopt err_return no_unset pipe_fail

if (( $# < 5 )); then
  print -u2 "usage: $0 <model-slug> <effort> <repo> <prompt-file> <out-file> [session-id]"
  exit 2
fi

local model=$1 effort=$2 repo=$3 prompt=$4 out=$5 session=${6:-}

[[ -r $prompt ]] || { print -u2 "prompt file not readable: $prompt"; exit 2 }
[[ -d $repo ]]   || { print -u2 "repo not a directory: $repo"; exit 2 }
[[ -e $out ]]    && { print -u2 "out file exists, choose a unique name: $out"; exit 2 }

# Вне git codex откажется стартовать («Not inside a trusted directory») — добавляем флаг.
# Отказ по той же причине внутри git флагом не лечится: доверие каталогу настраивается в codex.
local -a gitflag=()
git -C "$repo" rev-parse --git-dir >/dev/null 2>&1 || gitflag=(--skip-git-repo-check)

# err_return прервал бы скрипт до диагностики — код снимаем через `|| rc=$?`, как в cursor-run.sh.
local rc=0
if [[ -n $session ]]; then
  codex exec -C "$repo" -s read-only "${gitflag[@]}" -m "$model" -c model_reasoning_effort="$effort" \
    -o "$out" resume "$session" - < "$prompt" > "$out.stdout" 2>&1 || rc=$?
else
  codex exec -C "$repo" -s read-only "${gitflag[@]}" -m "$model" -c model_reasoning_effort="$effort" \
    -o "$out" - < "$prompt" > "$out.stdout" 2>&1 || rc=$?
fi

(( rc == 0 )) || print -u2 "codex вернул $rc — диагностика в $out.stdout"

# stdout целиком — в файл: обрезать его пайпом нельзя, вместе с баннером теряется session id.
grep -m1 'session id:' "$out.stdout" || print -u2 "session id не напечатан: участник статичен"
[[ -s $out ]] || { print -u2 "пустой $out — прогон считается сбойным, см. $out.stdout"; (( rc )) || rc=1 }
exit $rc
