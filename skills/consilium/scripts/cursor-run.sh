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

export LEAN_CTX_DISABLED=1   # у cursor свой lean-ctx-хук в ~/.cursor/hooks.json

# Промпт передаём подстановкой из файла: кавычки пользователя в аргументе — инъекция.
# stderr отдельным файлом, иначе текст ошибки уедет в синтез как «находки».
cursor-agent -p --output-format=text --mode ask --sandbox enabled --trust \
  --model "$model" --workspace "$workspace" --resume "$chat" \
  -- "$(cat "$prompt")" > "$out" 2> "$out.err"

# Падение определяем по exit code, а не по пустоте файла (см. таблицу вендоров в council.md).
