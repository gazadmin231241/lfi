import * as readline from "node:readline";

import {
  supportsReasoningEffort,
  type AgentProvider,
} from "./agent-provider.js";
import {
  isReasoningEffort,
  parseAgentModel,
  type LfiConfig,
  type ReasoningEffort,
} from "./config.js";
import { type Language, localize } from "./i18n.js";
import { runCommand } from "./process.js";

export type BindingKey =
  | "DEFAULT"
  | "light"
  | "standard"
  | "deep"
  | "merger"
  | "reviewer";

export const BINDING_KEYS: readonly BindingKey[] = [
  "DEFAULT",
  "light",
  "standard",
  "deep",
  "merger",
  "reviewer",
] as const;

export type ModelBindings = Record<BindingKey, string>;

export interface ResolvedBinding {
  inheritedFrom: BindingKey | null;
  resolved: string;
}

export const resolveBindingInheritance = (
  bindings: ModelBindings,
  key: BindingKey,
  _language: Language = "en",
): ResolvedBinding => {
  const explicit = bindings[key];
  if (explicit) {
    return { inheritedFrom: null, resolved: explicit };
  }

  if (key === "DEFAULT") {
    return { inheritedFrom: null, resolved: "codex::medium" };
  }

  if (key === "light" || key === "standard" || key === "deep") {
    const parent = resolveBindingInheritance(bindings, "DEFAULT", _language);
    return { inheritedFrom: "DEFAULT", resolved: parent.resolved };
  }

  // merger and reviewer inherit from standard
  const standardExplicit = bindings.standard;
  if (standardExplicit) {
    return { inheritedFrom: "standard", resolved: standardExplicit };
  }
  const parent = resolveBindingInheritance(bindings, "DEFAULT", _language);
  return { inheritedFrom: "standard", resolved: parent.resolved };
};

export const formatBindingLine = (
  key: BindingKey,
  bindings: ModelBindings,
  language: Language,
  isSelected: boolean,
): string => {
  const prefix = isSelected ? "> " : "  ";
  const paddedKey = key.padEnd(10, " ");
  const resolved = resolveBindingInheritance(bindings, key, language);
  if (resolved.inheritedFrom) {
    const inheritLabel = localize(
      language,
      `inherits ${resolved.inheritedFrom}`,
      `наследует ${resolved.inheritedFrom}`,
    );
    return `${prefix}${paddedKey}(${inheritLabel}) ${resolved.resolved}`;
  }
  return `${prefix}${paddedKey}${resolved.resolved}`;
};

export const DSH_ROUTES: readonly string[] = [
  "deepseek-official",
  "opencode-go",
] as const;

export const getCuratedRoutes = (agent: AgentProvider): readonly string[] =>
  agent === "dsh" ? DSH_ROUTES : [];

const curatedModelsByAgent: Record<AgentProvider, readonly string[]> = {
  codex: ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"],
  claude: [
    "claude-3-7-sonnet",
    "claude-3-5-sonnet",
    "claude-3-5-haiku",
    "claude-3-opus",
  ],
  pi: [],
  dsh: [],
};

const dshCuratedModelsByRoute: Record<string, readonly string[]> = {
  "deepseek-official": ["deepseek-v4-pro", "deepseek-v4-flash"],
  "opencode-go": ["deepseek-v4-pro", "deepseek-v4-flash"],
};

export const getCuratedModels = (
  agent: AgentProvider,
  route?: string,
): readonly string[] => {
  if (agent === "dsh") {
    if (route && dshCuratedModelsByRoute[route]) {
      return dshCuratedModelsByRoute[route];
    }
    return [];
  }
  return curatedModelsByAgent[agent] ?? [];
};

const allReasoningEfforts: readonly ReasoningEffort[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
];

export const getAvailableReasoning = (
  agent: AgentProvider,
): readonly ReasoningEffort[] =>
  allReasoningEfforts.filter((effort) => supportsReasoningEffort(agent, effort));

export type PickerView =
  | "main"
  | "agent"
  | "route"
  | "manual_route"
  | "model"
  | "manual_model"
  | "reasoning";

export interface PickerKeyInput {
  name?: string | undefined;
  sequence?: string | undefined;
  ctrl?: boolean | undefined;
}

export interface PickerState {
  view: PickerView;
  cursor: number;
  bindings: ModelBindings;
  availability: Record<AgentProvider, boolean>;
  language: Language;
  editingBinding?: BindingKey | undefined;
  selectedAgent?: AgentProvider | undefined;
  selectedRoute?: string | undefined;
  selectedModel?: string | undefined;
  inputBuffer?: string | undefined;
  errorMessage?: string | undefined;
}

export type PickerKeyResult =
  | { type: "continue"; state: PickerState }
  | { type: "done"; bindings: ModelBindings }
  | { type: "cancel" };

const AGENTS: readonly AgentProvider[] = ["codex", "claude", "pi", "dsh"] as const;

export const applyBindingsToConfig = (
  config: LfiConfig,
  bindings: ModelBindings,
): LfiConfig => {
  const parseReasoning = (
    value: string | undefined,
  ): ReasoningEffort | undefined => {
    if (!value) return undefined;
    try {
      return parseAgentModel(value).reasoning;
    } catch {
      return undefined;
    }
  };

  const defaultReasoning =
    parseReasoning(bindings.DEFAULT) ?? config.REASONING_EFFORT ?? "medium";
  const standardReasoning =
    parseReasoning(bindings.standard) ?? defaultReasoning;
  const mergerReasoning =
    parseReasoning(bindings.merger) ?? standardReasoning;
  const reviewerReasoning =
    parseReasoning(bindings.reviewer) ?? standardReasoning;

  return {
    ...config,
    DEFAULT_MODEL: bindings.DEFAULT,
    LIGHT_MODEL: bindings.light,
    STANDARD_MODEL: bindings.standard,
    DEEP_MODEL: bindings.deep,
    MERGER_MODEL: bindings.merger,
    REVIEWER_MODEL: bindings.reviewer,
    REASONING_EFFORT: standardReasoning,
    MERGER_REASONING_EFFORT: mergerReasoning,
    REVIEWER_REASONING_EFFORT: reviewerReasoning,
  };
};

export const createInitialPickerState = (
  initialBindings: Partial<ModelBindings>,
  availability: Record<AgentProvider, boolean>,
  language: Language = "en",
): PickerState => ({
  view: "main",
  cursor: 0,
  bindings: {
    DEFAULT: initialBindings.DEFAULT ?? "",
    light: initialBindings.light ?? "",
    standard: initialBindings.standard ?? "",
    deep: initialBindings.deep ?? "",
    merger: initialBindings.merger ?? "",
    reviewer: initialBindings.reviewer ?? "",
  },
  availability,
  language,
});

export const handlePickerKey = (
  state: PickerState,
  key: PickerKeyInput,
): PickerKeyResult => {
  if (key.ctrl && key.name === "c") {
    return { type: "cancel" };
  }

  switch (state.view) {
    case "main": {
      const maxIndex = 6; // 0..5 bindings, 6 is Done
      if (key.name === "up") {
        return {
          type: "continue",
          state: {
            ...state,
            cursor: state.cursor > 0 ? state.cursor - 1 : maxIndex,
          },
        };
      }
      if (key.name === "down") {
        return {
          type: "continue",
          state: {
            ...state,
            cursor: state.cursor < maxIndex ? state.cursor + 1 : 0,
          },
        };
      }
      if (key.name === "return" || key.name === "enter") {
        if (state.cursor === 6) {
          return { type: "done", bindings: { ...state.bindings } };
        }
        const editingBinding = BINDING_KEYS[state.cursor];
        return {
          type: "continue",
          state: {
            ...state,
            view: "agent",
            cursor: 0,
            editingBinding,
            selectedAgent: undefined,
            selectedRoute: undefined,
            selectedModel: undefined,
            inputBuffer: undefined,
            errorMessage: undefined,
          },
        };
      }
      if (key.name === "escape" || key.sequence === "q") {
        return { type: "cancel" };
      }
      return { type: "continue", state };
    }

    case "agent": {
      const agentCount = AGENTS.length; // 4 agents
      const maxIndex = agentCount; // 0: inherit, 1..4: agents
      const editingKey = state.editingBinding ?? "DEFAULT";
      if (key.name === "up") {
        return {
          type: "continue",
          state: {
            ...state,
            cursor: state.cursor > 0 ? state.cursor - 1 : maxIndex,
          },
        };
      }
      if (key.name === "down") {
        return {
          type: "continue",
          state: {
            ...state,
            cursor: state.cursor < maxIndex ? state.cursor + 1 : 0,
          },
        };
      }
      if (key.name === "return" || key.name === "enter") {
        if (state.cursor === 0) {
          // Inherit -> clear binding
          const bindingIndex = BINDING_KEYS.indexOf(editingKey);
          return {
            type: "continue",
            state: {
              ...state,
              view: "main",
              cursor: bindingIndex >= 0 ? bindingIndex : 0,
              bindings: {
                ...state.bindings,
                [editingKey]: "",
              },
              editingBinding: undefined,
            },
          };
        }
        const selectedAgent = AGENTS[state.cursor - 1];
        if (selectedAgent === "dsh") {
          return {
            type: "continue",
            state: {
              ...state,
              view: "route",
              cursor: 0,
              selectedAgent,
              selectedRoute: undefined,
            },
          };
        }
        return {
          type: "continue",
          state: {
            ...state,
            view: "model",
            cursor: 0,
            selectedAgent,
            selectedRoute: undefined,
          },
        };
      }
      if (key.name === "escape") {
        const bindingIndex = BINDING_KEYS.indexOf(editingKey);
        return {
          type: "continue",
          state: {
            ...state,
            view: "main",
            cursor: bindingIndex >= 0 ? bindingIndex : 0,
            editingBinding: undefined,
            selectedAgent: undefined,
            selectedRoute: undefined,
          },
        };
      }
      return { type: "continue", state };
    }

    case "route": {
      const editingKey = state.editingBinding ?? "DEFAULT";
      const maxIndex = DSH_ROUTES.length; // 0..DSH_ROUTES.length - 1: routes, DSH_ROUTES.length: custom
      if (key.name === "up") {
        return {
          type: "continue",
          state: {
            ...state,
            cursor: state.cursor > 0 ? state.cursor - 1 : maxIndex,
          },
        };
      }
      if (key.name === "down") {
        return {
          type: "continue",
          state: {
            ...state,
            cursor: state.cursor < maxIndex ? state.cursor + 1 : 0,
          },
        };
      }
      if (key.name === "return" || key.name === "enter") {
        if (state.cursor === DSH_ROUTES.length) {
          // Custom route
          return {
            type: "continue",
            state: {
              ...state,
              view: "manual_route",
              cursor: 0,
              inputBuffer: "",
              errorMessage: undefined,
            },
          };
        }
        const selectedRoute = DSH_ROUTES[state.cursor];
        return {
          type: "continue",
          state: {
            ...state,
            view: "model",
            cursor: 0,
            selectedRoute,
          },
        };
      }
      if (key.name === "escape") {
        const bindingIndex = BINDING_KEYS.indexOf(editingKey);
        return {
          type: "continue",
          state: {
            ...state,
            view: "main",
            cursor: bindingIndex >= 0 ? bindingIndex : 0,
            editingBinding: undefined,
            selectedAgent: undefined,
            selectedRoute: undefined,
          },
        };
      }
      return { type: "continue", state };
    }

    case "manual_route": {
      const editingKey = state.editingBinding ?? "DEFAULT";
      if (key.name === "escape") {
        const bindingIndex = BINDING_KEYS.indexOf(editingKey);
        return {
          type: "continue",
          state: {
            ...state,
            view: "main",
            cursor: bindingIndex >= 0 ? bindingIndex : 0,
            editingBinding: undefined,
            selectedAgent: undefined,
            selectedRoute: undefined,
            inputBuffer: undefined,
            errorMessage: undefined,
          },
        };
      }
      if (key.name === "backspace") {
        const current = state.inputBuffer ?? "";
        return {
          type: "continue",
          state: {
            ...state,
            inputBuffer: current.slice(0, -1),
            errorMessage: undefined,
          },
        };
      }
      if (key.name === "return" || key.name === "enter") {
        const input = (state.inputBuffer ?? "").trim();
        if (!input) {
          return {
            type: "continue",
            state: {
              ...state,
              errorMessage: localize(
                state.language,
                "Route cannot be empty.",
                "Маршрут не может быть пустым.",
              ),
            },
          };
        }
        return {
          type: "continue",
          state: {
            ...state,
            view: "model",
            cursor: 0,
            selectedRoute: input,
            inputBuffer: undefined,
            errorMessage: undefined,
          },
        };
      }
      if (key.sequence && key.sequence.length === 1 && !key.ctrl) {
        return {
          type: "continue",
          state: {
            ...state,
            inputBuffer: (state.inputBuffer ?? "") + key.sequence,
            errorMessage: undefined,
          },
        };
      }
      return { type: "continue", state };
    }

    case "model": {
      const agent = state.selectedAgent ?? "codex";
      const editingKey = state.editingBinding ?? "DEFAULT";
      const curated = getCuratedModels(agent, state.selectedRoute);
      const maxIndex = curated.length; // 0..curated.length - 1: curated, curated.length: custom
      if (key.name === "up") {
        return {
          type: "continue",
          state: {
            ...state,
            cursor: state.cursor > 0 ? state.cursor - 1 : maxIndex,
          },
        };
      }
      if (key.name === "down") {
        return {
          type: "continue",
          state: {
            ...state,
            cursor: state.cursor < maxIndex ? state.cursor + 1 : 0,
          },
        };
      }
      if (key.name === "return" || key.name === "enter") {
        if (state.cursor === curated.length) {
          // Custom model
          return {
            type: "continue",
            state: {
              ...state,
              view: "manual_model",
              cursor: 0,
              inputBuffer: "",
              errorMessage: undefined,
            },
          };
        }
        const modelName = curated[state.cursor] ?? "";
        const selectedModel =
          agent === "dsh" && state.selectedRoute
            ? `${state.selectedRoute}/${modelName}`
            : modelName;
        return {
          type: "continue",
          state: {
            ...state,
            view: "reasoning",
            cursor: 0,
            selectedModel,
          },
        };
      }
      if (key.name === "escape") {
        const bindingIndex = BINDING_KEYS.indexOf(editingKey);
        return {
          type: "continue",
          state: {
            ...state,
            view: "main",
            cursor: bindingIndex >= 0 ? bindingIndex : 0,
            editingBinding: undefined,
            selectedAgent: undefined,
            selectedRoute: undefined,
          },
        };
      }
      return { type: "continue", state };
    }

    case "manual_model": {
      const agent = state.selectedAgent ?? "codex";
      const editingKey = state.editingBinding ?? "DEFAULT";
      if (key.name === "escape") {
        const bindingIndex = BINDING_KEYS.indexOf(editingKey);
        return {
          type: "continue",
          state: {
            ...state,
            view: "main",
            cursor: bindingIndex >= 0 ? bindingIndex : 0,
            editingBinding: undefined,
            selectedAgent: undefined,
            selectedRoute: undefined,
            inputBuffer: undefined,
            errorMessage: undefined,
          },
        };
      }
      if (key.name === "backspace") {
        const current = state.inputBuffer ?? "";
        return {
          type: "continue",
          state: {
            ...state,
            inputBuffer: current.slice(0, -1),
            errorMessage: undefined,
          },
        };
      }
      if (key.name === "return" || key.name === "enter") {
        const input = (state.inputBuffer ?? "").trim();
        if (!input) {
          return {
            type: "continue",
            state: {
              ...state,
              errorMessage: localize(
                state.language,
                "Model cannot be empty.",
                "Модель не может быть пустой.",
              ),
            },
          };
        }
        try {
          let candidate: string;
          if (agent === "dsh") {
            if (input.startsWith("dsh:")) {
              candidate = input;
            } else if (input.includes("/")) {
              candidate = `dsh:${input}`;
            } else if (state.selectedRoute) {
              candidate = `dsh:${state.selectedRoute}/${input}`;
            } else {
              candidate = `dsh:${input}`;
            }
          } else if (
            input.includes(":") &&
            (input.startsWith("codex:") ||
              input.startsWith("claude:") ||
              input.startsWith("pi:") ||
              input.startsWith("dsh:"))
          ) {
            candidate = input;
          } else {
            candidate = `${agent}:${input}`;
          }
          const parsed = parseAgentModel(candidate);
          if (!supportsReasoningEffort(parsed.agent, parsed.reasoning)) {
            return {
              type: "continue",
              state: {
                ...state,
                errorMessage: localize(
                  state.language,
                  `Agent ${parsed.agent} cannot honour reasoning=${parsed.reasoning}.`,
                  `Агент ${parsed.agent} не поддерживает reasoning=${parsed.reasoning}.`,
                ),
              },
            };
          }
          const lastColon = input.lastIndexOf(":");
          const possibleReasoning =
            lastColon >= 0 ? input.slice(lastColon + 1) : "";
          if (isReasoningEffort(possibleReasoning)) {
            const bindingIndex = BINDING_KEYS.indexOf(editingKey);
            return {
              type: "continue",
              state: {
                ...state,
                view: "main",
                cursor: bindingIndex >= 0 ? bindingIndex : 0,
                bindings: {
                  ...state.bindings,
                  [editingKey]: `${parsed.agent}:${parsed.model}:${parsed.reasoning}`,
                },
                editingBinding: undefined,
                selectedAgent: undefined,
                selectedRoute: undefined,
                inputBuffer: undefined,
                errorMessage: undefined,
              },
            };
          }
          return {
            type: "continue",
            state: {
              ...state,
              view: "reasoning",
              cursor: 0,
              selectedAgent: parsed.agent,
              selectedModel: parsed.model,
              inputBuffer: undefined,
              errorMessage: undefined,
            },
          };
        } catch (err) {
          return {
            type: "continue",
            state: {
              ...state,
              errorMessage: err instanceof Error ? err.message : String(err),
            },
          };
        }
      }
      if (key.sequence && key.sequence.length === 1 && !key.ctrl) {
        return {
          type: "continue",
          state: {
            ...state,
            inputBuffer: (state.inputBuffer ?? "") + key.sequence,
            errorMessage: undefined,
          },
        };
      }
      return { type: "continue", state };
    }

    case "reasoning": {
      const agent = state.selectedAgent ?? "codex";
      const model = state.selectedModel ?? "";
      const editingKey = state.editingBinding ?? "DEFAULT";
      const available = getAvailableReasoning(agent);
      const maxIndex = available.length - 1;
      if (key.name === "up") {
        return {
          type: "continue",
          state: {
            ...state,
            cursor: state.cursor > 0 ? state.cursor - 1 : maxIndex,
          },
        };
      }
      if (key.name === "down") {
        return {
          type: "continue",
          state: {
            ...state,
            cursor: state.cursor < maxIndex ? state.cursor + 1 : 0,
          },
        };
      }
      if (key.name === "return" || key.name === "enter") {
        const reasoning = available[state.cursor] ?? "medium";
        const bindingIndex = BINDING_KEYS.indexOf(editingKey);
        return {
          type: "continue",
          state: {
            ...state,
            view: "main",
            cursor: bindingIndex >= 0 ? bindingIndex : 0,
            bindings: {
              ...state.bindings,
              [editingKey]: `${agent}:${model}:${reasoning}`,
            },
            editingBinding: undefined,
            selectedAgent: undefined,
            selectedRoute: undefined,
            selectedModel: undefined,
          },
        };
      }
      if (key.name === "escape") {
        const bindingIndex = BINDING_KEYS.indexOf(editingKey);
        return {
          type: "continue",
          state: {
            ...state,
            view: "main",
            cursor: bindingIndex >= 0 ? bindingIndex : 0,
            editingBinding: undefined,
            selectedAgent: undefined,
            selectedRoute: undefined,
            selectedModel: undefined,
          },
        };
      }
      return { type: "continue", state };
    }
  }
};

export const renderPickerView = (state: PickerState): string => {
  const lines: string[] = [];
  const lang = state.language;

  switch (state.view) {
    case "main": {
      lines.push(
        localize(
          lang,
          "LFI model bindings (Enter to edit, Esc to cancel):",
          "Привязки моделей LFI (Enter — редактировать, Esc — отмена):",
        ),
      );
      lines.push("");
      BINDING_KEYS.forEach((key, index) => {
        lines.push(
          formatBindingLine(key, state.bindings, lang, state.cursor === index),
        );
      });
      lines.push(
        state.cursor === 6
          ? `> ${localize(lang, "— done —", "— готово —")}`
          : `  ${localize(lang, "— done —", "— готово —")}`,
      );
      break;
    }

    case "agent": {
      lines.push(
        localize(
          lang,
          `Select agent for ${state.editingBinding} (Enter to select, Esc to go back):`,
          `Выберите агента для ${state.editingBinding} (Enter — выбрать, Esc — назад):`,
        ),
      );
      lines.push("");
      const inheritPrefix = state.cursor === 0 ? "> " : "  ";
      lines.push(
        `${inheritPrefix}${localize(lang, "— inherit —", "— наследовать —")}`,
      );
      AGENTS.forEach((agent, index) => {
        const isSelected = state.cursor === index + 1;
        const prefix = isSelected ? "> " : "  ";
        const available = state.availability[agent] ?? false;
        const status = available
          ? localize(lang, "available", "доступен")
          : localize(lang, "not found", "не найден");
        lines.push(`${prefix}${agent} (${status})`);
      });
      break;
    }

    case "route": {
      lines.push(
        localize(
          lang,
          `Select dsh route for ${state.editingBinding} (Enter to select, Esc to go back):`,
          `Выберите маршрут dsh для ${state.editingBinding} (Enter — выбрать, Esc — назад):`,
        ),
      );
      lines.push("");
      DSH_ROUTES.forEach((route, index) => {
        const isSelected = state.cursor === index;
        const prefix = isSelected ? "> " : "  ";
        lines.push(`${prefix}${route}`);
      });
      const customPrefix = state.cursor === DSH_ROUTES.length ? "> " : "  ";
      lines.push(
        `${customPrefix}${localize(lang, "custom…", "свой…")}`,
      );
      break;
    }

    case "manual_route": {
      lines.push(
        localize(
          lang,
          `Enter harness route for dsh (${state.editingBinding}):`,
          `Введите маршрут для dsh (${state.editingBinding}):`,
        ),
      );
      lines.push("");
      lines.push(`> ${state.inputBuffer ?? ""}`);
      if (state.errorMessage) {
        lines.push(`  ${state.errorMessage}`);
      }
      break;
    }

    case "model": {
      const agent = state.selectedAgent ?? "codex";
      lines.push(
        localize(
          lang,
          `Select ${agent} model for ${state.editingBinding} (Enter to select, Esc to go back):`,
          `Выберите модель ${agent} для ${state.editingBinding} (Enter — выбрать, Esc — назад):`,
        ),
      );
      lines.push("");
      const curated = getCuratedModels(agent, state.selectedRoute);
      curated.forEach((model, index) => {
        const isSelected = state.cursor === index;
        const prefix = isSelected ? "> " : "  ";
        lines.push(`${prefix}${model}`);
      });
      const customPrefix = state.cursor === curated.length ? "> " : "  ";
      lines.push(
        `${customPrefix}${localize(lang, "custom model…", "своя модель…")}`,
      );
      break;
    }

    case "manual_model": {
      const agent = state.selectedAgent ?? "codex";
      lines.push(
        localize(
          lang,
          `Enter model for ${agent} (${state.editingBinding}):`,
          `Введите модель для ${agent} (${state.editingBinding}):`,
        ),
      );
      lines.push("");
      lines.push(`> ${state.inputBuffer ?? ""}`);
      if (state.errorMessage) {
        lines.push(`  ${state.errorMessage}`);
      }
      break;
    }

    case "reasoning": {
      const agent = state.selectedAgent ?? "codex";
      const model = state.selectedModel ?? "";
      lines.push(
        localize(
          lang,
          `Select reasoning effort for ${agent}:${model} (Enter to select, Esc to go back):`,
          `Выберите уровень рассуждений для ${agent}:${model} (Enter — выбрать, Esc — назад):`,
        ),
      );
      lines.push("");
      const available = getAvailableReasoning(agent);
      available.forEach((effort, index) => {
        const isSelected = state.cursor === index;
        const prefix = isSelected ? "> " : "  ";
        lines.push(`${prefix}${effort}`);
      });
      break;
    }
  }

  return lines.join("\n");
};

export const checkHostAgentAvailability = async (): Promise<
  Record<AgentProvider, boolean>
> => {
  const entries = await Promise.all(
    AGENTS.map(async (agent) => {
      const ok = await runCommand("which", [agent])
        .then((res) => res.exitCode === 0)
        .catch(() => false);
      return [agent, ok] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<AgentProvider, boolean>;
};

export interface RunPickerOptions {
  initialBindings: Partial<ModelBindings>;
  language: Language;
  availability?: Record<AgentProvider, boolean>;
  input?: NodeJS.ReadStream;
  output?: NodeJS.WriteStream;
}

export const runModelBindingPicker = async (
  options: RunPickerOptions,
): Promise<ModelBindings | null> => {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const availability =
    options.availability ?? (await checkHostAgentAvailability());
  let state = createInitialPickerState(
    options.initialBindings,
    availability,
    options.language,
  );

  return new Promise<ModelBindings | null>((resolve) => {
    let previousLineCount = 0;

    const render = (currentState: PickerState) => {
      const text = renderPickerView(currentState);
      const lines = text.split("\n");
      if (previousLineCount > 0) {
        output.write(`\x1b[${previousLineCount}A\x1b[0J`);
      }
      output.write(`${text}\n`);
      previousLineCount = lines.length;
    };

    const cleanup = () => {
      if (input.isTTY && typeof input.setRawMode === "function") {
        input.setRawMode(false);
      }
      input.removeListener("keypress", onKeypress);
      output.write("\x1b[?25h"); // show cursor
      if (previousLineCount > 0) {
        output.write(`\x1b[${previousLineCount}A\x1b[0J`);
      }
    };

    const onKeypress = (_ch: string | undefined, key: readline.Key) => {
      const result = handlePickerKey(state, {
        name: key.name,
        sequence: key.sequence,
        ctrl: key.ctrl,
      });
      if (result.type === "continue") {
        state = result.state;
        render(state);
      } else if (result.type === "done") {
        cleanup();
        resolve(result.bindings);
      } else if (result.type === "cancel") {
        cleanup();
        resolve(null);
      }
    };

    readline.emitKeypressEvents(input);
    if (input.isTTY && typeof input.setRawMode === "function") {
      input.setRawMode(true);
    }
    input.resume();
    output.write("\x1b[?25l"); // hide cursor
    input.on("keypress", onKeypress);
    render(state);
  });
};
