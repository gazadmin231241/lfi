import { dirname, relative, sep } from "node:path";

import type {
  LocalTracker,
  TrackerDocument,
} from "./local-tracker.js";

const LEGACY_START = "<!-- lfi:local-relationships:start -->";
const LEGACY_END = "<!-- lfi:local-relationships:end -->";
const markedRelationships = new RegExp(
  `\\n*(?:${LEGACY_START}[\\s\\S]*?${LEGACY_END}|\\[lfi-local-relationships-start\\]: <>[\\s\\S]*?\\[lfi-local-relationships-end\\]: <>)\\n*`,
  "u",
);
const managedRelationships =
  /\n*## Specification\n[\s\S]*?\n## Blocked by\n[\s\S]*$/u;
const taskComplexity = /^> \*\*Task complexity:\*\* `(?:light|standard|deep)`\n*/u;

export const withoutLocalRelationships = (body: string): string =>
  body
    .replace(markedRelationships, "\n")
    .replace(managedRelationships, "\n")
    .replace(taskComplexity, "")
    .trimEnd();

const linkTo = (
  source: TrackerDocument,
  target: TrackerDocument,
): string => {
  const path = relative(dirname(source.path), target.path).split(sep).join("/");
  return `[${target.id} — ${target.title}](<${path}>)`;
};

export const withLocalRelationships = (
  document: TrackerDocument,
  tracker: LocalTracker,
): string => {
  const body = withoutLocalRelationships(document.body);
  if (document.type !== "task") return body ? `${body}\n` : "";
  const byId = new Map(tracker.documents.map((item) => [item.id, item]));
  const specification = document.spec
    ? byId.get(document.spec)
    : undefined;
  const blockers = document.blockedBy.flatMap((id) => {
    const blocker = byId.get(id);
    return blocker ? [`- ${linkTo(document, blocker)}`] : [];
  });
  const relationships = [
    "## Specification",
    "",
    specification
      ? linkTo(document, specification)
      : "None.",
    "",
    "## Blocked by",
    "",
    blockers.length > 0
      ? blockers.join("\n")
      : "None — can start immediately.",
  ].join("\n");
  const complexity = `> **Task complexity:** \`${document.executionTier ?? "standard"}\``;
  return `${complexity}${body ? `\n\n${body}` : ""}\n\n${relationships}\n`;
};
