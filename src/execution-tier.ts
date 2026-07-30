export const EXECUTION_TIERS = ["light", "standard", "deep"] as const;

export type ExecutionTier = (typeof EXECUTION_TIERS)[number];

export const EXECUTION_TIER_LABEL_PREFIX = "lfi:tier:";

export const isExecutionTier = (value: string): value is ExecutionTier =>
  value === "light" || value === "standard" || value === "deep";

export const executionTierLabel = (tier: ExecutionTier): string =>
  `${EXECUTION_TIER_LABEL_PREFIX}${tier}`;

export type ExecutionTierSelection =
  | { status: "missing" }
  | { status: "resolved"; tier: ExecutionTier }
  | { status: "conflict"; labels: string[] };

export const executionTierFromLabels = (
  labels: readonly string[],
): ExecutionTierSelection => {
  const tierLabels = labels.filter((label) =>
    label.startsWith(EXECUTION_TIER_LABEL_PREFIX),
  );
  const tiers = tierLabels.flatMap((label): ExecutionTier[] => {
    const value = label.slice(EXECUTION_TIER_LABEL_PREFIX.length);
    return isExecutionTier(value) ? [value] : [];
  });
  if (tierLabels.length === 0) return { status: "missing" };
  if (tierLabels.length !== 1 || tiers.length !== 1) {
    return { status: "conflict", labels: tierLabels };
  }
  return { status: "resolved", tier: tiers[0]! };
};
