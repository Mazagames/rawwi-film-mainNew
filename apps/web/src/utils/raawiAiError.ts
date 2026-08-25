export const RAAWI_AI_NOT_CONNECTED_MESSAGE = 'Raawi AI is not connected';
export const RAAWI_AI_NO_CREDITS_MESSAGE = 'GPU Overheat';
export const RAAWI_AI_BUSY_MESSAGE = 'Server is busy, please try again later.';
export const RAAWI_AI_UNAVAILABLE_MESSAGE = 'AI service temporarily unavailable.';
export const RAAWI_AI_CANCELLED_MESSAGE = 'Analysis stopped.';

const RAAWI_AI_CONNECTION_ERROR_PATTERN =
  /openai|open ai|ai provider|api key|unauthorized|authentication|insufficient[_\s-]?quota|quota|credit|billing|payment required|rate limit|429|tokens per min|requests per min|overloaded|server overloaded|service unavailable|temporarily unavailable|fetch failed|socket hang up|connection error|etimedout|timeout|timed out|raawi ai overloading/i;

export function isRaawiAiConnectionIssue(message: string | null | undefined): boolean {
  return RAAWI_AI_CONNECTION_ERROR_PATTERN.test(String(message ?? ''));
}

export function getPublicAnalysisErrorMessage(message: string | null | undefined): string | null {
  if (!message) return null;
  const normalized = message.toLowerCase();
  if (/cancelled|canceled|analysis stopped/.test(normalized)) return RAAWI_AI_CANCELLED_MESSAGE;
  if (/no[_\s-]?credits|insufficient[_\s-]?quota|quota exceeded|billing|payment required|credit/.test(normalized)) {
    return RAAWI_AI_NO_CREDITS_MESSAGE;
  }
  if (/timeout|timed out|overloaded|server busy|rate.?limit|too many requests|503|temporarily unavailable/.test(normalized)) {
    return RAAWI_AI_BUSY_MESSAGE;
  }
  if (/model.?not.?found|unsupported model|invalid model|api key|unauthorized|authentication|configuration|not configured|providerpolicyerror/.test(normalized)) {
    return RAAWI_AI_UNAVAILABLE_MESSAGE;
  }
  return isRaawiAiConnectionIssue(message) ? RAAWI_AI_UNAVAILABLE_MESSAGE : message;
}
