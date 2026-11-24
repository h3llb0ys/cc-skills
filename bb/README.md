# Плагины для BB

Нужен [BB](https://getbb.app) 0.49 или новее. Команды ниже запускаются в терминале
с доступным `bb`.

| Плагин и настройки | Каталог для `--subdirectory` | ID для обновления и перезагрузки |
| --- | --- | --- |
| [Diff Preview](diff-preview/README.md) | `bb/diff-preview` | `diff-preview` |
| [Jira Thread Links](jira-thread-links/README.md) | `bb/jira-thread-links` | `jira-thread-links` |
| [Mattermost](mattermost/README.md) | `bb/mattermost` | `mattermost` |
| [MR cycle](mr-cycle/README.md) | `bb/mr-cycle` | `mr-cycle` |
| [Provider Limits](provider-limits/README.md) | `bb/provider-limits` | `provider-limits` |
| [Section Style](section-style/README.md) | `bb/section-style` | `section-style` |
| [Workspace Tools](workspace-labels/README.md) | `bb/workspace-labels` | `workspace-labels` |

## Установка из GitHub

Подставьте каталог нужного плагина из таблицы. Например, для Jira Thread Links:

```sh
bb plugin install git:https://github.com/h3llb0ys/cc-skills.git@main --subdirectory bb/jira-thread-links
```

BB скачает репозиторий и соберёт плагин. Для обновления используйте его ID:

```sh
bb plugin update jira-thread-links
```

После установки откройте README выбранного плагина. Там описаны настройки
и дополнительные требования, например настроенный `jira-boards` для Jira Thread Links
или включённый встроенный Git для Diff Preview.

## Установка из локального клона

Этот вариант удобен для разработки. Нужны Node.js и npm. Клонируйте весь
репозиторий и перейдите в каталог плагина. Например:

```sh
git clone https://github.com/h3llb0ys/cc-skills.git
cd cc-skills/bb/jira-thread-links
npm ci --include=dev
bb plugin build .
bb plugin install .
```

Если клон уже есть, перейдите в `bb/jira-thread-links` внутри него и начните с `npm ci`.

BB использует этот каталог на месте. После обновления исходников повторите
установку npm-зависимостей, сборку и выполните `bb plugin reload jira-thread-links`,
подставив ID своего плагина. Если переместили клон, повторите `bb plugin install .`
из нового каталога плагина.

Для локальных тестов и проверки типов Jira Thread Links, Section Style и
Workspace Tools дополнительно выполните `npm ci --prefix ../shared-ui`
из каталога плагина. [`shared-ui`](shared-ui/README.md) содержит общую палитру
и включается в сборки этих плагинов.
