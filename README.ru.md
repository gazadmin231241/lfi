# LFI — Let’s Fucking Implement

[English](README.md)

LFI превращает подготовленные GitHub Issues в проверенные commits с помощью
Codex и изолированных Git worktree. Он параллельно выполняет несколько задач,
разрешает интеграционные конфликты, проверяет общий результат, обновляет
default-ветку и закрывает выполненные Issues.

> LFI умеет напрямую обновлять default-ветку. Сначала используйте
> `lfi run --dry-run` и запускайте инструмент только там, где такой workflow
> действительно разрешён.

## Требования

- Node.js 22+
- Git
- GitHub CLI с выполненным `gh auth login`
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
`to-spec` и `to-tickets` откройте Codex в проекте и один раз запустите
`$setup-matt-pocock-skills`.

## Какие задачи выбираются

LFI берёт открытые Issues с `ready-for-agent`, исключая `blocked`, `needs-info`
и `ready-for-human`. Открытые ссылки в секции ниже считаются блокерами:

```md
## Blocked by

- #123
```

Labels и основную ветку можно изменить в `.lfi/config.env`.

## Команды

```text
lfi init
lfi doctor
lfi run
lfi run --dry-run
lfi status
lfi logs
lfi logs ISSUE_NUMBER
lfi logs prune
lfi logs prune --all
lfi skills install
lfi skills list
lfi skills doctor
lfi skills update
lfi config language en|ru
```

## Настройка

Обычный `lfi init` определяет почти всё автоматически и спрашивает только срок
хранения логов. Модель, reasoning, количество параллельных задач и этапов,
labels, команды подготовки и проверки остаются доступны в `.lfi/config.env`.

Для интерактивной настройки этих параметров используйте
`lfi init --advanced`.

Пользовательский prompt находится в `.lfi/task-prompt.md`. Codex автоматически
видит личные skills из `~/.agents/skills`.

## Безопасность

Каждая задача работает в сохраняемом worktree. Ветка допускается к объединению,
только если Codex вернул структурированный статус завершения, создал commits и
оставил чистый worktree. Общая integration-ветка обязана пройти validation до
push и закрытия Issues.

Если GitHub принял push, но временно не смог закрыть Issue, LFI сохраняет эту
операцию и повторяет её в начале следующего запуска. Во время работы `lfi
status` показывает текущий запуск, а после завершения — результат последнего.

Worker-у разрешены необходимые локальные изменения кода, миграций, зависимостей,
lockfile и конфигурации. Production deploy, SSH, production-данные,
разрушительный сброс БД, публикация секретов и force-push запрещены.

## Логи

Терминал показывает короткий поток с префиксами. Для успешных задач остаются
компактные логи; для упавших дополнительно сохраняется сжатый raw JSONL. Старые
папки удаляются по возрасту в начале и конце запуска. Значение по умолчанию —
три дня.

## Разработка

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm check
```

Лицензия: [MIT](LICENSE).
