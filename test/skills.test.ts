import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";

import { installSkills, SKILL_PATHS } from "../src/skills.js";

const skillName = (path: string): string => basename(path);

const upstreamSkill = (name: string): string => `---
name: ${name}
---

Upstream instructions for ${name}.
`;

const writeBundle = async (root: string): Promise<void> => {
  for (const path of SKILL_PATHS) {
    const name = skillName(path);
    const directory = join(root, path);
    await mkdir(join(directory, "agents"), { recursive: true });
    await writeFile(join(directory, "SKILL.md"), upstreamSkill(name));
    await writeFile(join(directory, "agents", "openai.yaml"), "interface:\n");
  }
};

const filesUnder = async (root: string, directory = root): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await filesUnder(root, path)));
    } else {
      files.push(path.slice(root.length + 1));
    }
  }
  return files;
};

test("skill installation copies every upstream skill byte-for-byte", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-skills-test-"));
  const sourceRoot = join(root, "source");
  const destinationRoot = join(root, "installed");
  await writeBundle(sourceRoot);

  const installed = await installSkills({ sourceRoot, destinationRoot });

  assert.deepEqual(installed, SKILL_PATHS.map(skillName));
  for (const path of SKILL_PATHS) {
    const name = skillName(path);
    const sourceDirectory = join(sourceRoot, path);
    const destinationDirectory = join(destinationRoot, name);
    const relativePaths = await filesUnder(sourceDirectory);
    assert.deepEqual(
      await filesUnder(destinationDirectory),
      relativePaths,
    );
    for (const relativePath of relativePaths) {
      assert.equal(
        Buffer.compare(
          await readFile(join(destinationDirectory, relativePath)),
          await readFile(join(sourceDirectory, relativePath)),
        ),
        0,
      );
      assert.doesNotMatch(
        await readFile(join(destinationDirectory, relativePath), "utf8"),
        /lfi:skill-override|LFI tracker override|Переопределение LFI/u,
      );
    }
  }
});

test("skill update accepts upstream rewording and installs it verbatim", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-skills-test-"));
  const sourceRoot = join(root, "source");
  const destinationRoot = join(root, "installed");
  await writeBundle(sourceRoot);
  await installSkills({ sourceRoot, destinationRoot });

  const changedSource = join(sourceRoot, "skills/engineering/to-spec/SKILL.md");
  const reworded = "Upstream has reworded this instruction.\n";
  await writeFile(changedSource, reworded);

  const changed = await installSkills({
    sourceRoot,
    destinationRoot,
    update: true,
    yes: true,
  });

  assert.ok(changed.includes("to-spec"));
  assert.equal(
    await readFile(join(destinationRoot, "to-spec", "SKILL.md"), "utf8"),
    reworded,
  );
});

test("skill installation replaces an earlier adapted skill", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-skills-test-"));
  const sourceRoot = join(root, "source");
  const destinationRoot = join(root, "installed");
  await writeBundle(sourceRoot);
  const destination = join(destinationRoot, "to-spec");
  await mkdir(join(destination, "agents"), { recursive: true });
  await writeFile(
    join(destination, "SKILL.md"),
    "<!-- lfi:skill-override -->\nold adapted skill\n",
  );
  await writeFile(join(destination, "agents", "openai.yaml"), "interface:\n");

  await installSkills({ sourceRoot, destinationRoot });

  assert.equal(
    await readFile(join(destination, "SKILL.md"), "utf8"),
    await readFile(join(sourceRoot, "skills/engineering/to-spec/SKILL.md"), "utf8"),
  );
});

test("skill installation fails when bundle metadata is missing", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-skills-test-"));
  const sourceRoot = join(root, "source");
  const destinationRoot = join(root, "installed");
  await writeBundle(sourceRoot);
  await rm(
    join(sourceRoot, "skills/engineering/to-spec/agents/openai.yaml"),
  );

  await assert.rejects(
    installSkills({ sourceRoot, destinationRoot }),
    /to-spec is missing agents\/openai\.yaml at pinned commit/u,
  );
});

test("skill installation rejects missing metadata even for installed skills", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-skills-test-"));
  const sourceRoot = join(root, "source");
  const destinationRoot = join(root, "installed");
  await writeBundle(sourceRoot);
  await installSkills({ sourceRoot, destinationRoot });
  await rm(join(sourceRoot, "skills/engineering/to-spec/agents/openai.yaml"));

  await assert.rejects(
    installSkills({ sourceRoot, destinationRoot }),
    /to-spec is missing agents\/openai\.yaml at pinned commit/u,
  );
});
