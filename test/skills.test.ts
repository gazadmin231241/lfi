import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  adaptLfiSkill,
  installSkills,
  SKILL_PATHS,
} from "../src/skills.js";

const upstreamSkill = (name: string): string => {
  const header = `---
name: ${name}
---

`;
  if (name === "to-spec") {
    return `${header}Apply the \`ready-for-agent\` triage label.\n`;
  }
  if (name === "to-tickets") {
    return `${header}- \`.scratch/<feature-slug>/issues/\`\nApply the \`ready-for-agent\` triage label.\n`;
  }
  return `${header}Original instructions.\n`;
};

const writeBundle = async (root: string): Promise<void> => {
  for (const path of SKILL_PATHS) {
    const name = path.split("/").at(-1)!;
    const directory = join(root, path);
    await mkdir(join(directory, "agents"), { recursive: true });
    await writeFile(join(directory, "SKILL.md"), upstreamSkill(name));
    await writeFile(join(directory, "agents", "openai.yaml"), "interface:\n");
  }
};

test("LFI adapts the installed spec and ticket skills conditionally", () => {
  const frontmatter = `---
name: example
---

`;
  const spec = adaptLfiSkill(
    "to-spec",
    `${frontmatter}Apply the \`ready-for-agent\` triage label.\n`,
  );
  assert.match(spec, /lfi:tracker-contract/u);
  assert.match(spec, /\.lfi\/specs/u);
  assert.match(spec, /lfi:spec/u);
  assert.match(spec, /\[SPEC\]/u);
  assert.match(spec, /take precedence/u);

  const tickets = adaptLfiSkill(
    "to-tickets",
    `${frontmatter}- \`.scratch/<feature-slug>/issues/\`\nApply the \`ready-for-agent\` triage label.\n`,
  );
  assert.match(tickets, /\.lfi\/tasks/u);
  assert.match(tickets, /lfi:task/u);
  assert.match(tickets, /\[READY\].*\[BLOCKED\]/su);
  assert.match(tickets, /must not ask for an execution model/u);
  assert.match(tickets, /Never[\s\S]*ready-for-agent/u);
  assert.equal(adaptLfiSkill("to-tickets", tickets), tickets);
});

test("LFI rejects an upstream skill whose adaptation anchors disappeared", () => {
  assert.throws(
    () => adaptLfiSkill("to-spec", "---\nname: to-spec\n---\nChanged upstream."),
    /cannot adapt.*to-spec/iu,
  );
});

test("skill install and update apply the LFI adaptation before replacement", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-skills-test-"));
  const sourceRoot = join(root, "source");
  const destinationRoot = join(root, "installed");
  await writeBundle(sourceRoot);

  const installed = await installSkills({
    sourceRoot,
    destinationRoot,
    yes: true,
  });
  assert.ok(installed.includes("to-spec"));
  assert.match(
    await readFile(join(destinationRoot, "to-spec", "SKILL.md"), "utf8"),
    /lfi:tracker-contract[\s\S]*lfi:spec/u,
  );
  assert.match(
    await readFile(join(destinationRoot, "to-tickets", "SKILL.md"), "utf8"),
    /\.lfi\/tasks[\s\S]*Never[\s\S]*ready-for-agent/u,
  );

  const beforeFailure = await readFile(
    join(destinationRoot, "to-spec", "SKILL.md"),
    "utf8",
  );
  await writeFile(
    join(sourceRoot, "skills", "engineering", "to-spec", "SKILL.md"),
    "---\nname: to-spec\n---\nChanged upstream.\n",
  );
  await assert.rejects(
    installSkills({
      sourceRoot,
      destinationRoot,
      update: true,
      yes: true,
    }),
    /cannot adapt.*to-spec/iu,
  );
  assert.equal(
    await readFile(join(destinationRoot, "to-spec", "SKILL.md"), "utf8"),
    beforeFailure,
  );
});
