import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

const exists = async (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

export const detectPackageManager = async (cwd: string): Promise<string> => {
  if (await exists(join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (await exists(join(cwd, "bun.lock"))) return "bun";
  if (await exists(join(cwd, "yarn.lock"))) return "yarn";
  return "npm";
};

export const detectCommands = async (
  cwd: string,
): Promise<{ setup: string; validate: string }> => {
  const manager = await detectPackageManager(cwd);
  let scripts: Record<string, string> = {};
  try {
    const pkg = JSON.parse(await readFile(join(cwd, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    scripts = pkg.scripts ?? {};
  } catch {
    return { setup: "", validate: "" };
  }
  const run = (script: string) =>
    manager === "npm" ? `npm run ${script}` : `${manager} ${script}`;
  const validateName = ["validate:all", "check", "test"].find(
    (name) => scripts[name],
  );
  const setup =
    manager === "pnpm"
      ? "pnpm install --frozen-lockfile"
      : manager === "yarn"
        ? "yarn install --immutable"
        : manager === "bun"
          ? "bun install --frozen-lockfile"
          : "npm ci";
  return { setup, validate: validateName ? run(validateName) : "" };
};
