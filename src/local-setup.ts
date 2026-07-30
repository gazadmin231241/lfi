import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const LOCAL_IGNORE_BLOCK =
  ".lfi/*\n!.lfi/tasks/\n!.lfi/tasks/*.md\n!.lfi/specs/\n!.lfi/specs/*.md\n";

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

const configureAgentInstructions = async (cwd: string): Promise<void> => {
  const claude = join(cwd, "CLAUDE.md");
  const agents = join(cwd, "AGENTS.md");
  const path = (await exists(claude)) ? claude : agents;
  const source = await readFile(path, "utf8").catch(() => "");
  if (
    source.includes("docs/agents/issue-tracker.md") ||
    source.includes("### Issue tracker")
  ) {
    return;
  }
  const block = `## Agent skills

### Issue tracker

Tasks and specs use LFI Local Markdown. See \`docs/agents/issue-tracker.md\`.
`;
  await writeFile(
    path,
    `${source}${source && !source.endsWith("\n") ? "\n" : ""}${source ? "\n" : ""}${block}`,
  );
};

export const configureLocalTracker = async (cwd: string): Promise<void> => {
  const lfiRoot = join(cwd, ".lfi");
  await Promise.all([
    mkdir(join(lfiRoot, "tasks"), { recursive: true }),
    mkdir(join(lfiRoot, "specs"), { recursive: true }),
    mkdir(join(cwd, "docs", "agents"), { recursive: true }),
  ]);
  const gitignorePath = join(cwd, ".gitignore");
  const source = await readFile(gitignorePath, "utf8").catch(() => "");
  const lines = source
    .split(/\r?\n/u)
    .filter(
      (line) =>
        line !== ".lfi/" &&
        line !== ".lfi/*" &&
        line !== "!.lfi/tasks/" &&
        line !== "!.lfi/tasks/*.md" &&
        line !== "!.lfi/specs/" &&
        line !== "!.lfi/specs/*.md",
    );
  const prefix = lines.filter(Boolean).join("\n");
  await writeFile(
    gitignorePath,
    `${prefix ? `${prefix}\n` : ""}${LOCAL_IGNORE_BLOCK}`,
  );
  await writeFile(
    join(cwd, "docs", "agents", "issue-tracker.md"),
    `# Issue tracker: LFI Local Markdown

Specifications live as flat Markdown files in \`.lfi/specs/\`. Runnable tasks
live as one Markdown file per task in \`.lfi/tasks/\`. Use one shared,
monotonically increasing \`LFI-N\` identifier sequence across both directories.
Tasks created from an approved breakdown use \`status: ready\`.

When a skill publishes or reads tracker work, it must use these files rather
than GitHub or \`.scratch/\`. GitHub is only an explicit mirror managed by
\`lfi sync\`.
`,
  );
  await configureAgentInstructions(cwd);
};
