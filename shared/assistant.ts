export const assistantModes = ['ask', 'explain', 'tests', 'fix', 'plan'] as const;
export type AssistantMode = (typeof assistantModes)[number];
export type AssistantSettings = {
  enabled: boolean;
  endpoint: string;
  model: string;
  timeoutSeconds: number;
  maxTokens: number;
};
export type AssistantView = { version: number; settings: AssistantSettings; busy: boolean };
export type AssistantPreview = {
  id: string;
  mode: AssistantMode;
  content: string;
  redactions: number;
  expiresAt: number;
  model: string;
  endpoint: string;
};
export type CommandPlan = {
  goal: string;
  assumptions: string[];
  steps: Array<{ purpose: string; command: string; risk: 'read' | 'change' | 'destructive'; verify: string }>;
};
export type AssistantResult = {
  mode: AssistantMode;
  model: string;
  content: string;
  plan?: CommandPlan;
  generatedAt: string;
  truncated: boolean;
};

/** Best-effort recognizers. Preview remains necessary for identifiers outside these formats. */
export function redactAssistantContext(input: string) {
  let count = 0;
  const replace = (pattern: RegExp, replacement: string | ((...parts: string[]) => string)) => {
    input = input.replace(pattern, (...parts) => {
      count++;
      return typeof replacement === 'string' ? replacement : replacement(...parts);
    });
  };
  replace(/-----BEGIN ([A-Z0-9 ]*PRIVATE KEY)-----[\s\S]*?(?:-----END \1-----|$)/g, '[REDACTED PRIVATE KEY]');
  replace(/PuTTY-User-Key-File-\d+:[\s\S]*/g, '[REDACTED PRIVATE KEY]');
  replace(
    /\b(?:gh[pousr]_[A-Za-z0-9]{20,255}|github_pat_[A-Za-z0-9_]{20,255}|xox[baprs]-[A-Za-z0-9-]{15,255}|sk-[A-Za-z0-9_-]{16,255}|(?:AKIA|ASIA)[A-Z0-9]{16})\b/g,
    '[REDACTED TOKEN]',
  );
  replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{16,}\b/g, '[REDACTED JWT]');
  replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, (_all, scheme) => scheme + '[REDACTED]@');
  replace(
    /([?&](?:token|key|password|secret|api[_-]?key|access[_-]?token)=)[^\s&#"']+/gi,
    (_all, prefix) => prefix + '[REDACTED]',
  );
  replace(
    /\b((?:authorization|proxy-authorization|cookie|set-cookie)["']?\s*:\s*)[^\r\n]+/gi,
    (_all, prefix) => prefix + '[REDACTED]',
  );
  replace(
    /\b((?:[A-Za-z0-9_-]*[_-])?(?:password|passwd|api[_-]?key|access[_-]?token|client[_-]?secret|secret[_-]?key|secret|token)["']?\s*[:=]\s*)[^\r\n]+/gi,
    (_all, prefix) => prefix + '[REDACTED]',
  );
  return { content: input, redactions: count };
}
