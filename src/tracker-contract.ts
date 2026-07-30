export const LFI_SPEC_LABEL = "lfi:spec";
export const LFI_TASK_LABEL = "lfi:task";

export const GITHUB_TYPE_LABELS: ReadonlyArray<
  readonly [name: string, color: string, description: string]
> = [
  [LFI_SPEC_LABEL, "5319E7", "LFI specification; not executable"],
  [LFI_TASK_LABEL, "1D76DB", "LFI executable task"],
];

export const STATUS_PREFIX = {
  spec: "[SPEC]",
  ready: "[READY]",
  running: "[RUNNING]",
  blocked: "[BLOCKED]",
  done: "[DONE]",
} as const;
