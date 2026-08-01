export const EXECUTION_TIERS = ["light", "standard", "deep"] as const;

export type ExecutionTier = (typeof EXECUTION_TIERS)[number];

export const isExecutionTier = (value: string): value is ExecutionTier =>
  value === "light" || value === "standard" || value === "deep";
