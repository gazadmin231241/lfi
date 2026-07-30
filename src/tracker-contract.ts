import {
  EXECUTION_TIERS,
  executionTierLabel,
} from "./execution-tier.js";

export const LFI_SPEC_LABEL = "lfi:spec";
export const LFI_TASK_LABEL = "lfi:task";

export const GITHUB_TYPE_LABELS: ReadonlyArray<
  readonly [name: string, color: string, description: string]
> = [
  [
    LFI_SPEC_LABEL,
    "5319E7",
    "LFI specification; not executable / спецификация LFI; не исполняется",
  ],
  [
    LFI_TASK_LABEL,
    "1D76DB",
    "LFI executable task / исполняемая задача LFI",
  ],
  ...EXECUTION_TIERS.map(
    (tier) =>
      [
        executionTierLabel(tier),
        tier === "light" ? "2DA44E" : tier === "standard" ? "BF8700" : "CF222E",
        `LFI ${tier} execution tier / уровень выполнения LFI: ${tier}`,
      ] as const,
  ),
];

export const STATUS_PREFIX = {
  spec: "[SPEC]",
  ready: "[READY]",
  running: "[RUNNING]",
  blocked: "[BLOCKED]",
  done: "[DONE]",
} as const;

export const withoutStatusPrefix = (title: string): string =>
  title.replace(/^\[(?:SPEC|READY|RUNNING|BLOCKED|DONE)\]\s+/u, "");
