# Прогресс в bb

Цикл отмечает ход командой `bb mr-cycle`: владелец видит этапы, процент и проверки в интерфейсе bb.
Команда — только витрина: её ошибку пропустить и идти дальше.

| Когда | Команда |
|---|---|
| старт цикла — нового MR или повторного прогона | `bb mr-cycle start --title "$(git branch --show-current)"` — заменяет прошлый цикл треда |
| начало этапа N (9 — итоговый отчёт) | `bb mr-cycle stage N running` |
| конец этапа | `bb mr-cycle stage N done --note "<итог в 2–5 словах>"`, например «4 исправлено», «+7 кейсов» |
| этап не нужен | `bb mr-cycle stage N skipped --note "<причина>"` |
| возврат к этапу 7 | `bb mr-cycle stage 7 running` — этапы после него сбросятся сами |
| проход этапа 7 закончен | `bb mr-cycle sub 7 <bottom\|top\|mutation> done` |
| после каждого прогона проверки | `bb mr-cycle check <build\|vet\|lint\|unit\|integration> <ok\|fail>` |
