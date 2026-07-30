import { dirname, relative, sep } from "node:path";

import type {
  LocalTracker,
  TrackerDocument,
} from "./local-tracker.js";

const START = "<!-- lfi:local-relationships:start -->";
const END = "<!-- lfi:local-relationships:end -->";
const managedRelationships = new RegExp(
  `\\n*${START}[\\s\\S]*?${END}\\n*`,
  "u",
);

export const withoutLocalRelationships = (body: string): string =>
  body.replace(managedRelationships, "\n").trimEnd();

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
    START,
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
    END,
  ].join("\n");
  return `${body}${body ? "\n\n" : ""}${relationships}\n`;
};
