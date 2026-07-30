# LFI — Let’s Fucking Implement

[English](README.md)

LFI превращает локальные Markdown-задачи или GitHub Issues с `lfi:task` в
проверенные commits с помощью Codex и изолированных Git worktree. Локальный
режим работает без remote, а GitHub можно обновить позже явной синхронизацией.

> GitHub-режим умеет напрямую обновлять default-ветку. Локальный режим никогда
> не выполняет fetch или push. Сначала используйте `lfi run --dry-run`.

## Требования

- Node.js 22+
- Git
- GitHub CLI только для GitHub-режима, миграции или синхронизации
- Codex CLI с выполненным `codex login`
- pnpm для сборки и локальной установки LFI

## Установка из исходников

```bash
git clone https://github.com/gazadmin231241/lfi.git
cd lfi
pnpm install
pnpm build
npm link
```

Используется `npm link`, поскольку он работает с активной установкой Node. Если
global bin pnpm уже настроен, можно использовать `pnpm link --global`.

В целевом проекте:

```bash
lfi skills install
lfi init
lfi doctor
lfi run --dry-run
lfi run
```

Команда `lfi skills install` устанавливает закреплённый минимальный набор из
[`mattpocock/skills`](https://github.com/mattpocock/skills). Перед использованием
`to-spec` и `to-tickets`: локальная инициализация автоматически записывает для
них tracker contract. LFI условно адаптирует установленные инструкции
`to-spec` и `to-tickets` для LFI-проектов: локально спеки и задачи попадают в
`.lfi`, в GitHub используют `lfi:spec`/`lfi:task`, а создание задач не выбирает
метку модели.

## Хранение задач

`lfi init` спрашивает, где хранить задачи. Для новых и неинтерактивных проектов
по умолчанию используется Local Markdown:

```text
.lfi/tasks/[READY] LFI-2 — implement-parser.md
.lfi/specs/[SPEC] LFI-1 — local-first-workflow.md
```

Эти файлы версионируются, а `.lfi/logs`, `.lfi/state` и `.lfi/worktrees`
игнорируются. Tasks и specs используют общую последовательность `LFI-N`.
Сохраняются статусы `ready`, `completed`, `cancelled`; состояния выполнения и
блокировки вычисляются. После интеграции LFI записывает `completed_at`, поэтому
десять последних выполненных задач сортируются по времени завершения, а не по
ID.

В конце каждой локальной задачи находятся кликабельные разделы `Specification`
и `Blocked by`. LFI обновляет точные относительные ссылки при переименовании
файлов из-за смены статуса.

В status задач используются явные префиксы `[READY]`, `[RUNNING]`, `[BLOCKED]`
и `[DONE]`. Эти префиксы используются только локально. Заголовки GitHub Issues
имеют стабильный формат `LFI-N — название`; состояние показывают нативный статус
Issue и зависимости.

GitHub-режим использует тот же фиксированный словарь типов, что и Local
Markdown: `type: spec` соответствует `lfi:spec`, а `type: task` —
`lfi:task`. Спецификации никогда не исполняются. Задачи учитывают текстовые и
нативные зависимости.

## Команды

```text
lfi init [--task-source local|github]
lfi doctor [--sync]
lfi run [LFI-ID...]
lfi run --dry-run
lfi status [--all|--ready|--blocked|--completed]
lfi sync [github] [--repo OWNER/REPO] [--dry-run] [--force]
lfi migrate local
lfi logs
lfi logs LFI-ID|ISSUE_NUMBER
lfi logs prune
lfi logs prune --all
lfi skills install
lfi skills list
lfi skills doctor
lfi skills update
lfi config language en|ru
```

## Настройка

Обычный `lfi init` спрашивает источник задач и срок хранения логов. Модель,
reasoning, количество параллельных задач и этапов, GitHub mirror, default
branch, команды подготовки и проверки доступны в `.lfi/config.env`.

Для интерактивной настройки этих параметров используйте
`lfi init --advanced`.

Пользовательский prompt находится в `.lfi/task-prompt.md`. Codex автоматически
видит личные skills из `~/.agents/skills`.

## Безопасность

Каждая задача работает в сохраняемом worktree. Ветка допускается к объединению,
только если Codex вернул структурированный статус завершения. Codex изменяет и
проверяет файлы внутри sandbox `workspace-write`; поскольку этот sandbox
намеренно оставляет Git metadata read-only, успешные изменения добавляет в
индекс и коммитит host-процесс LFI. Общая integration-ветка обязана пройти
validation. Если команда падает, LFI сначала повторяет её в отдельно
подготовленном worktree базовой ревизии. Ошибка на base выводится без запуска
Codex. Если base зелёный, merger получает точную отредактированную диагностику
и может менять только пути из объединённого diff. LFI делает одну попытку
исправления и после integration failure не отправляет уже принятую задачу на
повторную реализацию. В local-mode проверенная ветка сливается в текущую ветку
обычным Git merge без push. При любой ошибке интеграции LFI сохраняет
integration worktree и выводит его ветку и путь для восстановления.

`lfi sync` односторонне зеркалирует локальные specs и tasks в GitHub. Команда
публикует фиксированные LFI type-labels, parent/sub-issue и blocking
relationships, явные status-префиксы и open/closed state. Посторонние labels
сохраняются, конфликтующий LFI type-label удаляется. Частичный sync
возобновляется без дублей. Одновременно выполняется не больше трёх
GitHub-операций; сетевые ошибки и 502/503/504 повторяются.

`lfi migrate local` читает только Issues с `lfi:spec` и `lfi:task`, сохраняет
нативные parent/blocker relationships, записывает правильные типы локальных
документов и затем переключает источник на Local Markdown. Старые tracker
labels намеренно не распознаются.

В GitHub-режиме, если GitHub принял push, но временно не смог закрыть Issue, LFI сохраняет эту
операцию и повторяет её в начале следующего запуска. Во время работы `lfi
status` показывает текущий запуск, а после завершения — результат последнего.

Worker-у разрешены необходимые локальные изменения кода, миграций, зависимостей,
lockfile и конфигурации. Production deploy, SSH, production-данные,
разрушительный сброс БД, публикация секретов и force-push запрещены.

Ревью worker-а ограничено без удаления независимого quality gate. После узких
проверок реализации worker один раз вызывает `$code-review`; reviewer-ы
Standards и Spec работают параллельно как одно полное ревью. Замечания
исправляются одним пакетом. Существенные исправления точечно подтверждают только
затронутые направления ревью, а полный diff повторно не проверяется.
Неразрешённый известный blocker приводит к статусу `incomplete`. Полная проверка
репозитория запускается на финальном коде после исправлений, а общая
integration-validation остаётся отдельным обязательным gate.

## Логи

В терминале выделяются итерации, завершение worker-ов, интеграция, общая
проверка и итог. `.lfi/logs/run.log` в реальном времени дублирует принадлежащий
LFI поток stdout/stderr. Строка приглашения shell в лог не входит.

`.lfi/logs` имеет плоскую структуру: локальные задачи пишутся в `LFI-2.log`,
GitHub Issues — в `issue-123.log`, общая проверка — в `integration.log`.
Повторные попытки дописываются секциями со временем и номером итерации. В лог
задачи в реальном времени попадают читаемые сообщения агента, команды, token
usage, stderr, exit status и итоговый summary. При сбое используется тот же лог
задачи, отдельный raw-артефакт не создаётся.

`lfi logs` показывает недавние запуски локализованной таблицей. `lfi logs LFI-2`
или `lfi logs 123` печатает последнюю секцию задачи и путь к полной истории.
Секции и старые timestamp-каталоги удаляются по `LOG_RETENTION_DAYS` (по
умолчанию три дня); значение `0` хранит их бессрочно.

## Разработка

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm check
```

Лицензия: [MIT](LICENSE).
