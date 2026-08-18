import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { dshProfileName, resolveAgentProfile } from "./agent-provider.js";
import { localize, type Language } from "./i18n.js";
import { requireCommand, runCommand } from "./process.js";

/**
 * The DeepSeek Harness release LFI is built against. The project is a developer
 * preview that promises compatibility-breaking changes, and LFI's bundle
 * addresses composition rows by id, so the version is pinned exactly rather
 * than by range.
 */
export const DSH_VERSION = "0.1.0-rc.7";

/** The upstream bundle the profile boots under LFI's own. */
export const DSH_HEADLESS_PACKAGE = "@deepseek-ai/dsh-headless";

/** LFI's bundle, shipped inside this package rather than published to npm. */
export const DSH_STREAM_PACKAGE = "dsh-lfi-stream";

/**
 * The bundle sources on disk. `src/` and `dist/` sit one level below the
 * package root, so the same expression resolves from a checkout and from an
 * installed copy.
 */
export const dshPluginDirectory = (): string =>
  fileURLToPath(new URL("../dsh-plugin/", import.meta.url));

export const dshProfileDirectory = (
  environment: NodeJS.ProcessEnv = process.env,
  homeDirectory: string = homedir(),
): string =>
  join(
    resolveAgentProfile("dsh", homeDirectory, environment).stateDirectory,
    "profiles",
    dshProfileName,
  );

interface ProfileManifest {
  dsh?: { profile?: { bundles?: string[] } };
}

/**
 * Whether the profile exists and mounts both bundles. A profile that lost one
 * of them boots without the event stream, which would leave a run silent rather
 * than failing, so the check names the layers instead of the directory.
 */
export const dshProfileStatus = async (
  environment: NodeJS.ProcessEnv = process.env,
  homeDirectory: string = homedir(),
): Promise<{ installed: boolean; bundles: readonly string[] }> => {
  const manifestPath = join(
    dshProfileDirectory(environment, homeDirectory),
    "package.json",
  );
  const manifest = await readFile(manifestPath, "utf8").then(
    (content) => JSON.parse(content) as ProfileManifest,
    () => undefined,
  );
  const bundles = manifest?.dsh?.profile?.bundles ?? [];
  return {
    installed:
      bundles.includes(DSH_HEADLESS_PACKAGE) && bundles.includes(DSH_STREAM_PACKAGE),
    bundles,
  };
};

export const dshVersion = async (
  environment: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> => {
  const result = await runCommand("dsh", ["--version"], { env: environment })
    .catch(() => undefined);
  if (!result || result.exitCode !== 0) return undefined;
  return result.stdout.trim() || undefined;
};

/**
 * Create or repair the profile LFI boots. `dsh plugin` initializes a missing
 * profile from the base template, forwards the rest to pnpm inside the profile
 * directory, and reconciles the bundle layer list against what it installed —
 * so one idempotent add covers both the first run and a later repair.
 */
export const installDshProfile = async (options: {
  language: Language;
  environment?: NodeJS.ProcessEnv;
  pluginDirectory?: string;
} = { language: "en" }): Promise<readonly string[]> => {
  const environment = options.environment ?? process.env;
  const pluginDirectory = options.pluginDirectory ?? dshPluginDirectory();
  await requireCommand(
    "dsh",
    [
      "plugin",
      "--profile",
      dshProfileName,
      "add",
      `${DSH_HEADLESS_PACKAGE}@${DSH_VERSION}`,
      `file:${pluginDirectory}`,
    ],
    { env: environment },
  );
  const status = await dshProfileStatus(environment);
  if (!status.installed) {
    throw new Error(
      localize(
        options.language,
        `The ${dshProfileName} profile mounts ${status.bundles.join(", ") || "no bundles"}; it needs both ${DSH_HEADLESS_PACKAGE} and ${DSH_STREAM_PACKAGE}.`,
        `Профиль ${dshProfileName} подключает ${status.bundles.join(", ") || "ни одного слоя"}; нужны оба: ${DSH_HEADLESS_PACKAGE} и ${DSH_STREAM_PACKAGE}.`,
      ),
    );
  }
  return status.bundles;
};
