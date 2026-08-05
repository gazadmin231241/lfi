import { redactSensitiveText } from "./logs.js";

export interface ValidationObservation {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ValidationDiagnostic extends ValidationObservation {
  command: string;
}

export type ValidationRunContext =
  | { step: "initial" }
  | { step: "retry"; retry: number; repairAttempt?: number }
  | { step: "post-repair"; repairAttempt: number };

/**
 * Runs one validation command through bounded retries, one diagnostic callback,
 * and bounded repair rounds. Callers supply the runtime adapter and decide how
 * a final red diagnostic is presented; only an observed exit code of zero
 * produces `undefined`.
 */
export const recoverValidation = async (options: {
  command: string;
  retryCount: number;
  repairAttempts: number;
  run: (context: ValidationRunContext) => Promise<ValidationObservation>;
  diagnose?: (diagnostic: ValidationDiagnostic) => Promise<void>;
  repair?: (
    diagnostic: ValidationDiagnostic,
    repairAttempt: number,
  ) => Promise<void>;
}): Promise<ValidationDiagnostic | undefined> => {
  const diagnosticFor = (
    observation: ValidationObservation,
  ): ValidationDiagnostic => ({
    command: redactSensitiveText(options.command),
    exitCode: observation.exitCode,
    stdout: redactSensitiveText(observation.stdout),
    stderr: redactSensitiveText(observation.stderr),
  });
  const runWithRetries = async (
    repairAttempt?: number,
  ): Promise<ValidationObservation> => {
    let observation = await options.run(
      repairAttempt === undefined
        ? { step: "initial" }
        : { step: "post-repair", repairAttempt },
    );
    for (
      let retry = 0;
      observation.exitCode !== 0 && retry < options.retryCount;
      retry += 1
    ) {
      observation = await options.run({
        step: "retry",
        retry: retry + 1,
        ...(repairAttempt === undefined ? {} : { repairAttempt }),
      });
    }
    return observation;
  };

  let observation = await runWithRetries();
  if (observation.exitCode === 0) return undefined;
  await options.diagnose?.(diagnosticFor(observation));
  for (
    let repairAttempt = 1;
    observation.exitCode !== 0 &&
    options.repair &&
    repairAttempt <= options.repairAttempts;
    repairAttempt += 1
  ) {
    await options.repair(diagnosticFor(observation), repairAttempt);
    observation = await runWithRetries(repairAttempt);
  }
  return observation.exitCode === 0
    ? undefined
    : diagnosticFor(observation);
};
