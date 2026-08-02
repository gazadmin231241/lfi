import { access, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { resolveAgentProfile, type AgentProvider } from "./agent-provider.js";
import { runCommand, runCommandLines, type CommandResult } from "./process.js";

export type IsolationProvider = "local" | "none";

export interface IsolatedCommand {
  command: string;
  args: readonly string[];
  input: string;
  idleTimeoutMs: number;
  onStdoutLine: (line: string) => void;
  onStderrLine: (line: string) => void;
  environment: NodeJS.ProcessEnv;
  writableDirectories?: readonly string[];
}

export interface IsolationSessionOptions {
  provider: IsolationProvider;
  agent: AgentProvider;
  worktree: string;
  gitDirectory: string;
  homeDirectory: string;
  environment: NodeJS.ProcessEnv;
  identity?: GitIdentity;
}

export interface IsolationDeclaration {
  worktree: string;
  gitDirectory: string;
  packageCacheDirectories: readonly string[];
  codeHostCredentialDirectories: readonly string[];
  codeHostCredentialFiles: readonly string[];
  agentProfilePaths: readonly string[];
  agentStateDirectory: string;
  skillsDirectory: string;
  gitConfigFiles: readonly string[];
  sanitizedGitConfig: string;
  environment: NodeJS.ProcessEnv;
}

export interface IsolationSession {
  prepare: <Command extends IsolatedCommand>(command: Command) => Command | IsolatedCommand;
  run: (command: IsolatedCommand) => Promise<CommandResult>;
  close: () => Promise<void>;
}

const runPrepared = async (command: IsolatedCommand, cwd: string): Promise<CommandResult> =>
  runCommandLines(command.command, command.args, {
    cwd,
    input: command.input,
    idleTimeoutMs: command.idleTimeoutMs,
    onStdoutLine: command.onStdoutLine,
    onStderrLine: command.onStderrLine,
    env: command.environment,
  });

const inheritedEnvironmentNames = new Set([
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LANGUAGE", "TERM",
  "COLORTERM", "TZ", "CODEX_HOME", "CODEX_API_KEY", "OPENAI_API_KEY",
  "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy",
  "https_proxy", "all_proxy", "no_proxy", "SSL_CERT_FILE", "SSL_CERT_DIR",
  "CURL_CA_BUNDLE", "REQUESTS_CA_BUNDLE", "NODE_EXTRA_CA_CERTS",
]);

export interface GitIdentity { name?: string; email?: string }

export const resolveGitIdentity = async (cwd: string): Promise<GitIdentity> =>
  Promise.all([
    runCommand("git", ["config", "--get", "user.name"], { cwd }),
    runCommand("git", ["config", "--get", "user.email"], { cwd }),
  ]).then(([name, email]) => ({
    ...(name.exitCode === 0 ? { name: name.stdout.trim() } : {}),
    ...(email.exitCode === 0 ? { email: email.stdout.trim() } : {}),
  }));

export const sanitizeAgentEnvironment = (
  source: NodeJS.ProcessEnv,
  identity: GitIdentity = {},
): NodeJS.ProcessEnv => {
  const environment: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(source)) {
    if (value !== undefined && (inheritedEnvironmentNames.has(name) || name.startsWith("LC_") || name.startsWith("CODEX_NETWORK_"))) {
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

const homePath = (home: string, suffix: string): string => `${home}/${suffix}`;
const packageCaches = (home: string): readonly string[] => [
  homePath(home, ".npm"), homePath(home, ".local/share/pnpm/store"),
  homePath(home, ".pnpm-store"), homePath(home, ".yarn/berry/cache"),
  homePath(home, ".bun/install/cache"), homePath(home, ".cache/node/corepack"),
  homePath(home, ".cache/pnpm"), homePath(home, ".cache/yarn"),
  homePath(home, ".cache/deno"),
];
const localCredentialDirectories = (home: string): readonly string[] => [
  homePath(home, ".ssh"), homePath(home, ".config/gh"),
  homePath(home, ".config/glab-cli"), homePath(home, ".config/hub"),
  homePath(home, ".config/git"), homePath(home, ".gnupg"),
];
const localCredentialFiles = (home: string): readonly string[] => [
  homePath(home, ".git-credentials"), homePath(home, ".netrc"),
  homePath(home, ".gitconfig"), homePath(home, ".npmrc"),
];
const existing = async (paths: readonly string[]): Promise<string[]> =>
  (await Promise.all(paths.map(async (path) => access(path).then(() => path, () => undefined))))
    .filter((path): path is string => path !== undefined);

export const resolveIsolationDeclaration = async (
  options: Omit<IsolationSessionOptions, "provider">,
  sanitizedGitConfig: string,
): Promise<IsolationDeclaration> => {
  const profile = resolveAgentProfile(
    options.agent,
    options.homeDirectory,
    options.environment,
  );
  const [codeHostCredentialDirectories, codeHostCredentialFiles, gitConfigFiles] = await Promise.all([
    existing(localCredentialDirectories(options.homeDirectory)),
    existing(localCredentialFiles(options.homeDirectory)),
    readdir(options.gitDirectory, { recursive: true }).then((paths) =>
      paths
        .filter((path) => ["config", "config.worktree"].includes(basename(path)))
        .map((path) => join(options.gitDirectory, path)),
    ),
  ]);
  return {
    worktree: options.worktree,
    gitDirectory: options.gitDirectory,
    packageCacheDirectories: packageCaches(options.homeDirectory),
    codeHostCredentialDirectories,
    codeHostCredentialFiles,
    agentProfilePaths: profile.paths,
    agentStateDirectory: profile.stateDirectory,
    skillsDirectory: profile.skillsDirectory,
    gitConfigFiles,
    sanitizedGitConfig,
    environment: sanitizeAgentEnvironment(options.environment, options.identity),
  };
};

export const openIsolationSession = async (
  options: IsolationSessionOptions,
): Promise<IsolationSession> => {
  if (options.provider === "none") {
    return {
      prepare: <Command extends IsolatedCommand>(command: Command) => command,
      run: async (command) => runPrepared(command, options.worktree),
      close: async () => undefined,
    };
  }
  const artifacts = await mkdtemp(join(options.gitDirectory, "lfi-isolation-"));
  const sanitizedGitConfig = join(artifacts, "safe-git-config");
  let declaration: IsolationDeclaration;
  try {
    await writeFile(sanitizedGitConfig, "");
    declaration = await resolveIsolationDeclaration(options, sanitizedGitConfig);
  } catch (error) {
    await rm(artifacts, { recursive: true, force: true });
    throw error;
  }
  let closed = false;
  const prepare = <Command extends IsolatedCommand>(command: Command): IsolatedCommand => {
      const args: string[] = [
        "--die-with-parent", "--new-session", "--unshare-user", "--unshare-pid",
        "--unshare-ipc", "--unshare-uts", "--ro-bind", "/", "/", "--proc",
        "/proc", "--dev", "/dev", "--tmpfs", "/tmp", "--bind",
        declaration.worktree, declaration.worktree, "--bind", declaration.gitDirectory,
        declaration.gitDirectory,
      ];
      for (const path of declaration.gitConfigFiles) args.push("--bind", declaration.sanitizedGitConfig, path);
      for (const path of declaration.packageCacheDirectories) args.push("--bind-try", path, path);
      for (const path of command.writableDirectories ?? []) args.push("--bind", path, path);
      for (const path of declaration.codeHostCredentialDirectories) args.push("--tmpfs", path);
      for (const path of declaration.codeHostCredentialFiles) args.push("--ro-bind", "/dev/null", path);
      // The agent CLI needs its state home writable (sqlite state, logs,
      // app-server socket) and fails on startup without it, so the state
      // directory stays writable and shared, exactly as outside the sandbox.
      args.push("--bind-try", declaration.agentStateDirectory, declaration.agentStateDirectory);
      args.push("--chdir", declaration.worktree, "--", command.command, ...command.args);
      return { ...command, command: "bwrap", args, environment: declaration.environment };
  };
  return {
    prepare,
    run: async (command) => runPrepared(prepare(command), declaration.worktree),
    close: async () => {
      if (closed) return;
      closed = true;
      await rm(artifacts, { recursive: true, force: true });
    },
  };
};

export const withIsolationSession = async <Session extends IsolationSession, Result>(
  open: () => Promise<Session>,
  use: (session: Session) => Promise<Result>,
): Promise<Result> => {
  const session = await open();
  try { return await use(session); } finally { await session.close(); }
};
