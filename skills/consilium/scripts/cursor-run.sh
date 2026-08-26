#!/bin/zsh
# Запуск cursor-участника (grok): read-only, промпт из файла, stdout и stderr — раздельно.
# Usage: cursor-run.sh <model-slug> <workspace> <prompt-file> <out-file> <chat-id>
#   chat-id получи заранее: cursor-agent create-chat (пустой --resume уводит в TUI и вешает вызов).

emulate -L zsh
setopt err_return no_unset pipe_fail

if (( $# != 5 )); then
  print -u2 "usage: $0 <model-slug> <workspace> <prompt-file> <out-file> <chat-id>"
  exit 2
fi

local model=$1 workspace=$2 prompt=$3 out=$4 chat=$5

[[ -r $prompt ]]  || { print -u2 "prompt file not readable: $prompt"; exit 2 }
[[ -d $workspace ]] || { print -u2 "workspace not a directory: $workspace"; exit 2 }
[[ -n $chat ]]    || { print -u2 "chat-id пустой — cursor-agent уйдёт в интерактивный выбор"; exit 2 }
# Симметрично codex-run.sh: без этой проверки ретрай молча затирает единственный артефакт прогона.
[[ -e $out ]]     && { print -u2 "out file exists, choose a unique name: $out"; exit 2 }

# Промпт передаём подстановкой из файла: кавычки пользователя в аргументе — инъекция.
# stderr отдельным файлом, иначе текст ошибки уедет в синтез как «находки».
# err_return прервал бы скрипт до чтения кода — поэтому код снимаем через `|| rc=$?`.
local rc=0
cursor-agent -p --output-format=text --mode ask --sandbox enabled --trust \
  --model "$model" --workspace "$workspace" --resume "$chat" \
  -- "$(cat "$prompt")" > "$out" 2> "$out.err" || rc=$?

# Сбой — ненулевой exit ЛИБО пустой out при exit 0 (таблица вендоров, cycle-state.md).
# Текст из .err содержательным ответом не является.
if (( rc != 0 )); then
  print -u2 "cursor-agent exit $rc — см. $out.err"; exit $rc
fi
[[ -s $out ]] || { print -u2 "пустой $out при exit 0 — результата нет, см. $out.err"; exit 1 }
