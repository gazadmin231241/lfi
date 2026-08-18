import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";

import { DEFAULT_CONFIG } from "../src/config.js";
import { DSH_VERSION } from "../src/dsh-profile.js";
import {
  buildWorkerImage,
  checkWorkerImageFreshness,
  deriveWorkerImageTag,
  generateWorkerImageLayer,
  scaffoldWorkerDockerfile,
  type WorkerIdentity,
} from "../src/worker-image.js";

const identity: WorkerIdentity = { uid: 501, gid: 20 };

test("worker Dockerfile scaffold declares ownership in both languages and is never rewritten", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-worker-scaffold-"));
  await scaffoldWorkerDockerfile(root);
  const scaffold = await readFile(join(root, "Dockerfile.lfi"), "utf8");
  assert.match(scaffold, /belongs to your project/u);
  assert.match(scaffold, /принадлежит проекту/u);
  assert.match(scaffold, /Добавьте среды языков/u);
  assert.match(scaffold, /end as root/u);
  assert.match(scaffold, /LFI добавляет CLI агентов/u);

  await writeFile(join(root, "Dockerfile.lfi"), "user-owned\n");
  await scaffoldWorkerDockerfile(root);
  assert.equal(await readFile(join(root, "Dockerfile.lfi"), "utf8"), "user-owned\n");
});

test("worker image tag is stable, project-derived, and Docker-safe", () => {
  const first = deriveWorkerImageTag("/Users/A Person/Hello_World");
  const second = deriveWorkerImageTag("/Users/A Person/Hello_World");

  assert.equal(first, second);
  assert.match(first, /^lfi-worker-hello_world-[a-f0-9]{12}$/u);
  assert.notEqual(first, deriveWorkerImageTag("/tmp/Hello_World"));
});

test("generated layer installs only configured agents and owns startup", () => {
  const codex = generateWorkerImageLayer(new Set(["codex"]));
  assert.match(codex, /useradd --non-unique/u);
  assert.match(codex, /groupadd --non-unique/u);
  assert.match(codex, /npm install --global @openai\/codex/u);
  assert.doesNotMatch(codex, /pi-coding-agent/u);
  assert.match(codex, /USER \$\{LFI_UID\}:\$\{LFI_GID\}/u);
  assert.match(codex, /ENTRYPOINT/u);
  assert.doesNotMatch(codex, /chown|chmod -R/u);

  const pi = generateWorkerImageLayer(new Set(["pi"]));
  assert.match(pi, /npm install --global @mariozechner\/pi-coding-agent/u);
  assert.doesNotMatch(pi, /@openai\/codex/u);

  const claude = generateWorkerImageLayer(new Set(["claude"]));
  assert.match(claude, /npm install --global @anthropic-ai\/claude-code/u);
  assert.doesNotMatch(claude, /@openai\/codex|pi-coding-agent/u);

  const dsh = generateWorkerImageLayer(new Set(["dsh"]));
  assert.match(dsh, new RegExp(`npm install --global @deepseek-ai/dsh@${DSH_VERSION}`, "u"));
  assert.doesNotMatch(dsh, /@openai\/codex|pi-coding-agent|@anthropic-ai\/claude-code/u);
});

test("build passes identity and generated layer to a fake runtime", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-worker-image-"));
  const bin = join(root, "bin");
  const calls = join(root, "calls");
  const input = join(root, "input");
  await mkdir(bin);
  await writeFile(join(root, "Dockerfile.lfi"), "FROM node:22\nUSER root\n");
  await writeFile(
    join(bin, "docker"),
    `#!/bin/sh\nprintf '%s\\n' "$*" > '${calls}'\ncat > '${input}'\n`,
  );
  await chmod(join(bin, "docker"), 0o755);

  await buildWorkerImage({
    projectRoot: root,
    config: DEFAULT_CONFIG,
    identity,
    version: "1.2.3",
    env: { PATH: `${bin}:${process.env.PATH ?? ""}` },
  });

  const args = await readFile(calls, "utf8");
  assert.match(args, /build --tag lfi-worker-/u);
  assert.match(args, /--build-arg LFI_UID=501/u);
  assert.match(args, /--build-arg LFI_GID=20/u);
  assert.match(args, /--file - /u);
  assert.match(await readFile(input, "utf8"), /^FROM node:22\nUSER root\n/u);
  assert.match(await readFile(input, "utf8"), /LABEL dev\.lfi\.version="1\.2\.3"/u);
});

test("freshness names each divergent image input", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-worker-freshness-"));
  const bin = join(root, "bin");
  const labels = join(root, "labels.json");
  await mkdir(bin);
  await writeFile(join(root, "Dockerfile.lfi"), "FROM node:22\nUSER root\n");
  await writeFile(
    join(bin, "docker"),
    `#!/bin/sh\ncat '${labels}'\n`,
  );
  await chmod(join(bin, "docker"), 0o755);
  const options = {
    projectRoot: root,
    identity,
    version: "1.2.3",
    env: { PATH: `${bin}:${process.env.PATH ?? ""}` },
  } as const;
  const dockerfileHash = "e9b65fc39eb18c666c91d8d129215a440ce215579862d7ad48675821174f97a9";
  const freshLabels = {
    "dev.lfi.dockerfile": dockerfileHash,
    "dev.lfi.version": "1.2.3",
    "dev.lfi.uid": "501",
    "dev.lfi.gid": "20",
  };
  await writeFile(labels, JSON.stringify(freshLabels));
  assert.deepEqual(await checkWorkerImageFreshness(options), { status: "fresh" });

  for (const [changed, reason] of [
    [{ "dev.lfi.dockerfile": "wrong" }, "dockerfile"],
    [{ "dev.lfi.version": "old" }, "version"],
    [{ "dev.lfi.uid": "1000" }, "identity"],
    [{ "dev.lfi.gid": "1000" }, "identity"],
  ] as const) {
    await writeFile(labels, JSON.stringify({ ...freshLabels, ...changed }));
    assert.deepEqual(await checkWorkerImageFreshness(options), {
      status: "stale",
      reasons: [reason],
    });
  }

  await writeFile(join(bin, "docker"), "#!/bin/sh\nexit 1\n");
  assert.deepEqual(
    await checkWorkerImageFreshness(options),
    { status: "missing" },
  );
  assert.equal(basename(root).startsWith("lfi-worker-freshness-"), true);
});
