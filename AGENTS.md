# LFI agent instructions

LFI is a zero-runtime-dependency TypeScript CLI that orchestrates Codex over
local Markdown tasks and Git worktrees.

- Keep user-facing behavior available in English and Russian.
- Keep process execution behind `src/process.ts`.
- Test domain behavior at exported seams with `node:test`.
- Preserve strict TypeScript settings and avoid unsafe casts.
- Never log credentials, process environments, or GitHub tokens.
- Run `pnpm check` before committing.
- Do not publish packages or mutate a user's remote repository from tests.

<!-- lfi:agent-tracker:begin -->
## Навыки агентов

### Трекер задач

Задачи и спецификации используют LFI Local Markdown. См. `docs/agents/issue-tracker.md`.
<!-- lfi:agent-tracker:end -->
