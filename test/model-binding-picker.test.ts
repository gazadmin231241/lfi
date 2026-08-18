import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  applyBindingsToConfig,
  createInitialPickerState,
  formatBindingLine,
  getAvailableReasoning,
  getCuratedModels,
  handlePickerKey,
  renderPickerView,
  resolveBindingInheritance,
  type ModelBindings,
  type PickerKeyInput,
  type PickerState,
} from "../src/model-binding-picker.js";
import { DEFAULT_CONFIG, parseEnvConfig, type LfiConfig } from "../src/config.js";
import { initializeProject } from "../src/init.js";
import { runCommand } from "../src/process.js";

const nextState = (state: PickerState, key: PickerKeyInput): PickerState => {
  const result = handlePickerKey(state, key);
  assert.equal(result.type, "continue");
  return result.state;
};
import { supportsReasoningEffort } from "../src/agent-provider.js";

test("resolveBindingInheritance resolves explicit values without inheritance markers", () => {
  const bindings: ModelBindings = {
    DEFAULT: "codex:gpt-5.6-terra:medium",
    light: "codex:gpt-5.6-luna:medium",
    standard: "codex:gpt-5.6-terra:medium",
    deep: "codex:gpt-5.6-sol:high",
    merger: "codex:gpt-5.6-terra:medium",
    reviewer: "codex:gpt-5.6-terra:medium",
  };

  const defaultResolved = resolveBindingInheritance(bindings, "DEFAULT", "en");
  assert.equal(defaultResolved.inheritedFrom, null);
  assert.equal(defaultResolved.resolved, "codex:gpt-5.6-terra:medium");

  const lightResolved = resolveBindingInheritance(bindings, "light", "en");
  assert.equal(lightResolved.inheritedFrom, null);
  assert.equal(lightResolved.resolved, "codex:gpt-5.6-luna:medium");
});

test("resolveBindingInheritance resolves empty tier to DEFAULT in English and Russian", () => {
  const bindings: ModelBindings = {
    DEFAULT: "codex:gpt-5.6-terra:medium",
    light: "",
    standard: "codex:gpt-5.6-terra:medium",
    deep: "",
    merger: "",
    reviewer: "",
  };

  const lightEn = resolveBindingInheritance(bindings, "light", "en");
  assert.equal(lightEn.inheritedFrom, "DEFAULT");
  assert.equal(lightEn.resolved, "codex:gpt-5.6-terra:medium");

  const deepRu = resolveBindingInheritance(bindings, "deep", "ru");
  assert.equal(deepRu.inheritedFrom, "DEFAULT");
  assert.equal(deepRu.resolved, "codex:gpt-5.6-terra:medium");
});

test("resolveBindingInheritance resolves empty merger and reviewer to standard", () => {
  const bindings: ModelBindings = {
    DEFAULT: "codex:fallback:low",
    light: "",
    standard: "codex:gpt-5.6-terra:medium",
    deep: "",
    merger: "",
    reviewer: "",
  };

  const merger = resolveBindingInheritance(bindings, "merger", "en");
  assert.equal(merger.inheritedFrom, "standard");
  assert.equal(merger.resolved, "codex:gpt-5.6-terra:medium");

  const reviewer = resolveBindingInheritance(bindings, "reviewer", "ru");
  assert.equal(reviewer.inheritedFrom, "standard");
  assert.equal(reviewer.resolved, "codex:gpt-5.6-terra:medium");
});

test("resolveBindingInheritance resolves empty merger and reviewer through standard to DEFAULT when standard is also empty", () => {
  const bindings: ModelBindings = {
    DEFAULT: "codex:gpt-5.6-terra:medium",
    light: "",
    standard: "",
    deep: "",
    merger: "",
    reviewer: "",
  };

  const merger = resolveBindingInheritance(bindings, "merger", "en");
  assert.equal(merger.inheritedFrom, "standard");
  assert.equal(merger.resolved, "codex:gpt-5.6-terra:medium");
});

test("formatBindingLine formats resolved and inherited strings matching specification", () => {
  const bindings: ModelBindings = {
    DEFAULT: "codex:gpt-5.6-terra:medium",
    light: "",
    standard: "codex:gpt-5.6-terra:medium",
    deep: "codex:gpt-5.6-sol:high",
    merger: "",
    reviewer: "",
  };

  assert.equal(
    formatBindingLine("DEFAULT", bindings, "ru", false),
    "  DEFAULT   codex:gpt-5.6-terra:medium",
  );
  assert.equal(
    formatBindingLine("light", bindings, "ru", false),
    "  light     (наследует DEFAULT) codex:gpt-5.6-terra:medium",
  );
  assert.equal(
    formatBindingLine("light", bindings, "en", false),
    "  light     (inherits DEFAULT) codex:gpt-5.6-terra:medium",
  );
  assert.equal(
    formatBindingLine("merger", bindings, "ru", true),
    "> merger    (наследует standard) codex:gpt-5.6-terra:medium",
  );
});

test("curated models are provided for codex and claude, while pi and dsh are empty in this slice", () => {
  assert.deepEqual(getCuratedModels("codex"), [
    "gpt-5.6-luna",
    "gpt-5.6-terra",
    "gpt-5.6-sol",
  ]);
  assert.deepEqual(getCuratedModels("claude"), [
    "claude-3-7-sonnet",
    "claude-3-5-sonnet",
    "claude-3-5-haiku",
    "claude-3-opus",
  ]);
  assert.deepEqual(getCuratedModels("pi"), []);
  assert.deepEqual(getCuratedModels("dsh"), []);
});

test("available reasoning offers all levels for codex and excludes ultra for claude, pi, and dsh", () => {
  assert.deepEqual(getAvailableReasoning("codex"), [
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
    "ultra",
  ]);
  for (const agent of ["claude", "pi", "dsh"] as const) {
    assert.deepEqual(getAvailableReasoning(agent), [
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    assert.equal(supportsReasoningEffort(agent, "ultra"), false);
    assert.equal(supportsReasoningEffort(agent, "medium"), true);
  }
});

test("state machine navigates main screen and enters agent selection", () => {
  const availability = { codex: true, claude: true, pi: false, dsh: false };
  let state = createInitialPickerState(
    {
      DEFAULT: "codex:gpt-5.6-terra:medium",
      light: "codex:gpt-5.6-luna:medium",
    },
    availability,
    "ru",
  );

  assert.equal(state.view, "main");
  assert.equal(state.cursor, 0);

  // Press down twice
  state = nextState(state, { name: "down" });
  assert.equal(state.cursor, 1);

  state = nextState(state, { name: "down" });
  assert.equal(state.cursor, 2);

  // Press enter on standard tier (cursor=2) -> should open agent view
  state = nextState(state, { name: "return" });
  assert.equal(state.view, "agent");
  assert.equal(state.editingBinding, "standard");
});

test("state machine allows selecting 'inherit' which clears the binding", () => {
  const availability = { codex: true, claude: true, pi: true, dsh: true };
  let state = createInitialPickerState(
    {
      light: "codex:gpt-5.6-luna:medium",
      standard: "codex:gpt-5.6-terra:medium",
    },
    availability,
    "ru",
  );

  // Move to 'light' (index 1) and press enter
  state = nextState(state, { name: "down" });
  state = nextState(state, { name: "return" });
  assert.equal(state.view, "agent");
  assert.equal(state.editingBinding, "light");

  // In agent view, cursor 0 is '— наследовать —'
  assert.equal(state.cursor, 0);
  state = nextState(state, { name: "return" });
  assert.equal(state.view, "main");
  assert.equal(state.bindings.light, "");
});

test("state machine navigates agent -> curated model -> reasoning -> main", () => {
  const availability = { codex: true, claude: true, pi: true, dsh: true };
  let state = createInitialPickerState({}, availability, "en");

  // Enter DEFAULT binding
  state = nextState(state, { name: "return" });
  assert.equal(state.view, "agent");

  // Select codex (cursor 1 in agent menu)
  state = nextState(state, { name: "down" });
  state = nextState(state, { name: "return" });
  assert.equal(state.view, "model");
  assert.equal(state.selectedAgent, "codex");

  // In codex model list: 0: gpt-5.6-luna, 1: gpt-5.6-terra, 2: gpt-5.6-sol, 3: custom
  state = nextState(state, { name: "down" }); // cursor 1: gpt-5.6-terra
  state = nextState(state, { name: "return" });
  assert.equal(state.view, "reasoning");
  assert.equal(state.selectedModel, "gpt-5.6-terra");

  // In reasoning list: 0: low, 1: medium, 2: high, ...
  state = nextState(state, { name: "down" }); // cursor 1: medium
  state = nextState(state, { name: "return" });
  assert.equal(state.view, "main");
  assert.equal(state.bindings.DEFAULT, "codex:gpt-5.6-terra:medium");
});

test("manual model input validates reasoning and shows error without exiting on invalid input", () => {
  const availability = { codex: true, claude: true, pi: true, dsh: true };
  let state = createInitialPickerState({}, availability, "en");

  // Open deep binding (cursor 3)
  state = nextState(state, { name: "down" });
  state = nextState(state, { name: "down" });
  state = nextState(state, { name: "down" });
  state = nextState(state, { name: "return" });
  assert.equal(state.editingBinding, "deep");

  // Select pi (cursor 3 in agent menu: 0: inherit, 1: codex, 2: claude, 3: pi, 4: dsh)
  state = nextState(state, { name: "down" });
  state = nextState(state, { name: "down" });
  state = nextState(state, { name: "down" });
  state = nextState(state, { name: "return" });
  assert.equal(state.view, "model");
  assert.equal(state.selectedAgent, "pi");

  // For pi, curated list is empty, item 0 is 'custom model…'
  state = nextState(state, { name: "return" });
  assert.equal(state.view, "manual_model");
  assert.equal(state.inputBuffer, "");

  // Type empty and submit
  state = nextState(state, { name: "return" });
  assert.equal(state.view, "manual_model");
  assert.ok(state.errorMessage);

  // Type 'openai/gpt-5:ultra' (ultra is not supported by pi)
  for (const ch of "openai/gpt-5:ultra") {
    state = nextState(state, { sequence: ch });
  }
  assert.equal(state.inputBuffer, "openai/gpt-5:ultra");
  state = nextState(state, { name: "return" });
  assert.equal(state.view, "manual_model");
  assert.match(state.errorMessage ?? "", /ultra/u);

  // Fix by backspacing 'ultra' and typing 'high'
  for (let i = 0; i < 5; i++) {
    state = nextState(state, { name: "backspace" });
  }
  for (const ch of "high") {
    state = nextState(state, { sequence: ch });
  }
  assert.equal(state.inputBuffer, "openai/gpt-5:high");

  state = nextState(state, { name: "return" });
  assert.equal(state.view, "main");
  assert.equal(state.bindings.deep, "pi:openai/gpt-5:high");
});

test("Esc in sub-picker returns to main without changing binding; Esc in main cancels", () => {
  const availability = { codex: true, claude: true, pi: true, dsh: true };
  let state = createInitialPickerState(
    { DEFAULT: "codex:original:low" },
    availability,
    "en",
  );

  // Enter agent picker on DEFAULT
  state = nextState(state, { name: "return" });
  assert.equal(state.view, "agent");

  // Press Esc -> should return to main, DEFAULT unchanged
  state = nextState(state, { name: "escape" });
  assert.equal(state.view, "main");
  assert.equal(state.bindings.DEFAULT, "codex:original:low");

  // Press Esc on main screen -> should cancel
  const result = handlePickerKey(state, { name: "escape" });
  assert.equal(result.type, "cancel");
});

test("selecting Done on main screen returns done with final bindings", () => {
  const availability = { codex: true, claude: true, pi: true, dsh: true };
  let state = createInitialPickerState(
    { DEFAULT: "codex:gpt-5.6-terra:medium" },
    availability,
    "en",
  );

  // Move to Done item (index 6)
  for (let i = 0; i < 6; i++) {
    state = nextState(state, { name: "down" });
  }
  assert.equal(state.cursor, 6);

  const result = handlePickerKey(state, { name: "return" });
  assert.equal(result.type, "done");
  if (result.type === "done") {
    assert.equal(result.bindings.DEFAULT, "codex:gpt-5.6-terra:medium");
  }
});

test("applyBindingsToConfig sets model keys and synchronizes reasoning effort keys", () => {
  const bindings: ModelBindings = {
    DEFAULT: "codex:gpt-5.6-terra:low",
    light: "codex:gpt-5.6-luna:low",
    standard: "codex:gpt-5.6-terra:medium",
    deep: "codex:gpt-5.6-sol:high",
    merger: "codex:gpt-5.6-terra:xhigh",
    reviewer: "",
  };

  const updated = applyBindingsToConfig(DEFAULT_CONFIG, bindings);
  assert.equal(updated.DEFAULT_MODEL, "codex:gpt-5.6-terra:low");
  assert.equal(updated.LIGHT_MODEL, "codex:gpt-5.6-luna:low");
  assert.equal(updated.STANDARD_MODEL, "codex:gpt-5.6-terra:medium");
  assert.equal(updated.DEEP_MODEL, "codex:gpt-5.6-sol:high");
  assert.equal(updated.MERGER_MODEL, "codex:gpt-5.6-terra:xhigh");
  assert.equal(updated.REVIEWER_MODEL, "");

  // standard has reasoning medium -> REASONING_EFFORT is medium
  assert.equal(updated.REASONING_EFFORT, "medium");
  // merger has explicit reasoning xhigh -> MERGER_REASONING_EFFORT is xhigh
  assert.equal(updated.MERGER_REASONING_EFFORT, "xhigh");
  // reviewer is empty -> inherits standard's reasoning (medium)
  assert.equal(updated.REVIEWER_REASONING_EFFORT, "medium");
});

test("applyBindingsToConfig synchronizes reasoning to DEFAULT when standard is empty", () => {
  const bindings: ModelBindings = {
    DEFAULT: "codex:gpt-5.6-terra:high",
    light: "",
    standard: "",
    deep: "",
    merger: "",
    reviewer: "",
  };

  const updated = applyBindingsToConfig(DEFAULT_CONFIG, bindings);
  assert.equal(updated.REASONING_EFFORT, "high");
  assert.equal(updated.MERGER_REASONING_EFFORT, "high");
  assert.equal(updated.REVIEWER_REASONING_EFFORT, "high");
});

test("renderPickerView renders main screen and sub-screens", () => {
  const availability = { codex: true, claude: true, pi: false, dsh: false };
  let state = createInitialPickerState(
    {
      DEFAULT: "codex:gpt-5.6-terra:medium",
      light: "",
      standard: "codex:gpt-5.6-terra:medium",
      deep: "codex:gpt-5.6-sol:high",
      merger: "",
      reviewer: "",
    },
    availability,
    "ru",
  );

  const mainRu = renderPickerView(state);
  assert.match(mainRu, /Привязки моделей LFI/u);
  assert.match(mainRu, /> DEFAULT\s+codex:gpt-5\.6-terra:medium/u);
  assert.match(mainRu, /light\s+\(наследует DEFAULT\) codex:gpt-5\.6-terra:medium/u);
  assert.match(mainRu, /— готово —/u);

  // Enter agent view
  state = nextState(state, { name: "return" });
  const agentRu = renderPickerView(state);
  assert.match(agentRu, /> — наследовать —/u);
  assert.match(agentRu, /codex \(доступен\)/u);
  assert.match(agentRu, /pi \(не найден\)/u);

  // Select codex -> model view
  state = nextState(state, { name: "down" });
  state = nextState(state, { name: "return" });
  const modelRu = renderPickerView(state);
  assert.match(modelRu, /gpt-5\.6-luna/u);
  assert.match(modelRu, /своя модель…/u);
});

test("all six bindings can be edited including merger and reviewer", () => {
  const availability = { codex: true, claude: true, pi: true, dsh: true };
  let state = createInitialPickerState({}, availability, "en");

  // Edit merger (cursor 4)
  for (let i = 0; i < 4; i++) {
    state = nextState(state, { name: "down" });
  }
  assert.equal(state.cursor, 4);
  state = nextState(state, { name: "return" });
  assert.equal(state.view, "agent");
  assert.equal(state.editingBinding, "merger");

  // Select claude (cursor 2) -> claude-3-7-sonnet (cursor 0) -> high (cursor 2)
  state = nextState(state, { name: "down" });
  state = nextState(state, { name: "down" });
  state = nextState(state, { name: "return" });
  assert.equal(state.view, "model");
  assert.equal(state.selectedAgent, "claude");

  state = nextState(state, { name: "return" });
  assert.equal(state.view, "reasoning");
  assert.equal(state.selectedModel, "claude-3-7-sonnet");

  state = nextState(state, { name: "down" }); // medium
  state = nextState(state, { name: "down" }); // high
  state = nextState(state, { name: "return" });
  assert.equal(state.view, "main");
  assert.equal(state.bindings.merger, "claude:claude-3-7-sonnet:high");

  // Edit reviewer (cursor 5)
  state = nextState(state, { name: "down" });
  assert.equal(state.cursor, 5);
  state = nextState(state, { name: "return" });
  assert.equal(state.view, "agent");
  assert.equal(state.editingBinding, "reviewer");

  // Select codex -> gpt-5.6-sol -> max
  state = nextState(state, { name: "down" });
  state = nextState(state, { name: "return" });
  assert.equal(state.view, "model");

  state = nextState(state, { name: "down" }); // terra
  state = nextState(state, { name: "down" }); // sol
  state = nextState(state, { name: "return" });
  assert.equal(state.view, "reasoning");

  state = nextState(state, { name: "down" }); // medium
  state = nextState(state, { name: "down" }); // high
  state = nextState(state, { name: "down" }); // xhigh
  state = nextState(state, { name: "down" }); // max
  state = nextState(state, { name: "return" });
  assert.equal(state.view, "main");
  assert.equal(state.bindings.reviewer, "codex:gpt-5.6-sol:max");
});

test("agents marked as not found on host can still be selected", () => {
  const availability = { codex: false, claude: false, pi: false, dsh: false };
  let state = createInitialPickerState({}, availability, "en");

  // Select DEFAULT -> codex (even though not found)
  state = nextState(state, { name: "return" });
  state = nextState(state, { name: "down" }); // cursor 1 (codex)
  state = nextState(state, { name: "return" });
  assert.equal(state.view, "model");
  assert.equal(state.selectedAgent, "codex");
});

test("initializeProject with yes=true bypasses screen and does not ask preset question", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-init-yes-"));
  const bin = join(root, "bin");
  await mkdir(bin);
  await writeFile(
    join(bin, "gh"),
    `#!/bin/sh
printf '%s\n' '{"nameWithOwner":"acme/widgets","defaultBranchRef":{"name":"main"}}'
`,
  );
  await chmod(join(bin, "gh"), 0o755);
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}:${previousPath}`;

  try {
    await runCommand("git", ["init", "-b", "main"], { cwd: root });
    await writeFile(join(root, "package.json"), JSON.stringify({ scripts: {} }));

    const result = await initializeProject({
      cwd: root,
      language: "en",
      yes: true,
    });
    assert.equal(result, "created");
  } finally {
    process.env.PATH = previousPath;
  }

  const config = parseEnvConfig(
    await readFile(join(root, ".lfi", "config.env"), "utf8"),
  );
  assert.equal(config.DEFAULT_MODEL, "");
  assert.equal(config.LIGHT_MODEL, "");
  assert.equal(config.STANDARD_MODEL, "");
  assert.equal(config.DEEP_MODEL, "");
  assert.equal(config.REASONING_EFFORT, "medium");
});
