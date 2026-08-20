export class AssistantOperationTimeoutError extends Error {
  constructor(operation) {
    super('Assistant operation timed out.');
    this.name = 'AssistantOperationTimeoutError';
    this.code = 'assistant_operation_timeout';
    this.operation = String(operation || 'assistant_operation').slice(0, 80);
  }
}

export async function withAssistantTimeout(
  promise,
  milliseconds,
  operation,
  {
    onTimeout,
    setTimeoutFn = globalThis.setTimeout,
    clearTimeoutFn = globalThis.clearTimeout
  } = {}
) {
  if(!Number.isFinite(milliseconds) || milliseconds <= 0) {
    throw new TypeError('Timeout must be a positive finite number.');
  }

  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeoutFn(() => {
      try {
        onTimeout?.();
      } catch {
        // Cancellation is best-effort; timeout behavior remains deterministic.
      }
      reject(new AssistantOperationTimeoutError(operation));
    }, milliseconds);
  });

  try {
    return await Promise.race([Promise.resolve(promise), timeoutPromise]);
  } finally {
    clearTimeoutFn(timeoutId);
  }
}
