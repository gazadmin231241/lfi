import { access, readdir } from "node:fs/promises";
import { basename, join } from "node:path";

export type IsolationProvider = "local" | "none";

export interface IsolatedCommand {
  command: string;
  args: readonly string[];
  input: string;
  idleTimeoutMs: number;
  onStdoutLine: (line: string) => void;
  onStderrLine: (line: string) => void;
  environment: NodeJS.ProcessEnv;
}

export interface IsolationConfiguration {
  provider: IsolationProvider;
  worktree: string;
  gitDirectory: string;
  homeDirectory: string;
  codeHostCredentialDirectories: readonly string[];
  codeHostCredentialFiles: readonly string[];
  gitConfigFiles: readonly string[];
  sanitizedGitConfig: string;
}

const inheritedEnvironmentNames = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LANGUAGE",
  "TERM",
  "COLORTERM",
  "TZ",
  "CODEX_HOME",
  "CODEX_API_KEY",
  "OPENAI_API_KEY",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "CURL_CA_BUNDLE",
  "REQUESTS_CA_BUNDLE",
  "NODE_EXTRA_CA_CERTS",
]);

export interface GitIdentity {
  name?: string;
  email?: string;
}

export const sanitizeAgentEnvironment = (
  source: NodeJS.ProcessEnv,
  identity: GitIdentity = {},
): NodeJS.ProcessEnv => {
  const environment: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(source)) {
    if (
      value !== undefined &&
      (inheritedEnvironmentNames.has(name) ||
        name.startsWith("LC_") ||
        name.startsWith("CODEX_NETWORK_"))
    ) {
      environment[name] = value;
    }
  }
  environment.TMPDIR = "/tmp";
  environment.GIT_CONFIG_GLOBAL = "/dev/null";
  environment.GIT_CONFIG_NOSYSTEM = "1";
  environment.GIT_CONFIG_COUNT = "0";
  if (identity.name !== undefined) {
    environment.GIT_AUTHOR_NAME = identity.name;
    environment.GIT_COMMITTER_NAME = identity.name;
  }
  if (identity.email !== undefined) {
    environment.GIT_AUTHOR_EMAIL = identity.email;
    environment.GIT_COMMITTER_EMAIL = identity.email;
  }
  return environment;
};

const homePath = (homeDirectory: string, suffix: string): string =>
  `${homeDirectory}/${suffix}`;

const packageCacheDirectories = (homeDirectory: string): readonly string[] => [
  homePath(homeDirectory, ".npm"),
  homePath(homeDirectory, ".local/share/pnpm/store"),
  homePath(homeDirectory, ".pnpm-store"),
  homePath(homeDirectory, ".yarn/berry/cache"),
  homePath(homeDirectory, ".bun/install/cache"),
  homePath(homeDirectory, ".cache/node/corepack"),
  homePath(homeDirectory, ".cache/pnpm"),
  homePath(homeDirectory, ".cache/yarn"),
  homePath(homeDirectory, ".cache/deno"),
];

const candidateCodeHostCredentialDirectories = (
  homeDirectory: string,
): readonly string[] => [
  homePath(homeDirectory, ".ssh"),
  homePath(homeDirectory, ".config/gh"),
  homePath(homeDirectory, ".config/glab-cli"),
  homePath(homeDirectory, ".config/hub"),
  homePath(homeDirectory, ".config/git"),
  homePath(homeDirectory, ".gnupg"),
];

const candidateCodeHostCredentialFiles = (
  homeDirectory: string,
): readonly string[] => [
  homePath(homeDirectory, ".git-credentials"),
  homePath(homeDirectory, ".netrc"),
  homePath(homeDirectory, ".gitconfig"),
  homePath(homeDirectory, ".npmrc"),
];

const existingPaths = async (paths: readonly string[]): Promise<string[]> =>
  (await Promise.all(
    paths.map(async (path) =>
      access(path).then(
        () => path,
        () => undefined,
      )),
  )).filter((path): path is string => path !== undefined);

export const resolveIsolationConfiguration = async (options: {
  provider: IsolationProvider;
  worktree: string;
  gitDirectory: string;
  homeDirectory: string;
  sanitizedGitConfig: string;
}): Promise<IsolationConfiguration> => ({
  ...options,
  codeHostCredentialDirectories:
    options.provider === "none"
      ? []
      : await existingPaths(
          candidateCodeHostCredentialDirectories(options.homeDirectory),
        ),
  codeHostCredentialFiles:
    options.provider === "none"
      ? []
      : await existingPaths(candidateCodeHostCredentialFiles(options.homeDirectory)),
  gitConfigFiles:
    options.provider === "none"
      ? []
      : await readdir(options.gitDirectory, { recursive: true }).then((paths) =>
          paths
            .filter((path) => {
              const name = basename(path);
              return name === "config" || name === "config.worktree";
            })
            .map((path) => join(options.gitDirectory, path)),
        ),
});

export const wrapWithIsolation = <Command extends IsolatedCommand>(
  command: Command,
  configuration: IsolationConfiguration,
): Command | IsolatedCommand => {
  if (configuration.provider === "none") return command;

  const args: string[] = [
    "--die-with-parent",
    "--new-session",
    "--unshare-user",
    "--unshare-pid",
    "--unshare-ipc",
    "--unshare-uts",
    "--ro-bind",
    "/",
    "/",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--tmpfs",
    "/tmp",
    "--bind",
    configuration.worktree,
    configuration.worktree,
    "--bind",
    configuration.gitDirectory,
    configuration.gitDirectory,
  ];
  for (const path of configuration.gitConfigFiles) {
    args.push("--bind", configuration.sanitizedGitConfig, path);
  }
  for (const path of packageCacheDirectories(configuration.homeDirectory)) {
    args.push("--bind-try", path, path);
  }
  for (const path of configuration.codeHostCredentialDirectories) {
    args.push("--tmpfs", path);
  }
  for (const path of configuration.codeHostCredentialFiles) {
    args.push("--ro-bind", "/dev/null", path);
  }
  args.push(
    "--chdir",
    configuration.worktree,
    "--",
    command.command,
    ...command.args,
  );
  return {
    command: "bwrap",
    args,
    input: command.input,
    idleTimeoutMs: command.idleTimeoutMs,
    onStdoutLine: command.onStdoutLine,
    onStderrLine: command.onStderrLine,
    environment: command.environment,
  };
};
