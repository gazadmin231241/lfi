export interface RetryOptions {
  attempts?: number;
  delay?: (milliseconds: number) => Promise<void>;
  random?: () => number;
}

export const isTransientGithubFailure = (error: unknown): boolean => {
  const message = (error instanceof Error ? error.message : String(error))
    .toLowerCase();
  return (
    /timed? ?out|i\/o timeout|connection reset|econnreset|econnrefused|temporary|tls handshake|unexpected eof/u.test(
      message,
    ) || /\b(?:502|503|504)\b/u.test(message)
  );
};

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export const withGithubRetry = async <T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> => {
  const attempts = options.attempts ?? 4;
  const delay = options.delay ?? wait;
  const random = options.random ?? Math.random;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientGithubFailure(error) || attempt === attempts) throw error;
      await delay(250 * 2 ** (attempt - 1) + Math.floor(random() * 200));
    }
  }
  throw lastError;
};
