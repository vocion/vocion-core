export type CodeRunResult = {
  /** human-readable result/output */
  output: string;
};

export type CodeProvider = {
  readonly name: string;
  readonly requiredEnv: string[];
  isReady: () => boolean;
  /** What this provider accepts: a math expression (builtin) or full code (e2b). */
  readonly kind: 'calculator' | 'sandbox';
  run: (code: string, opts?: { language?: string }) => Promise<CodeRunResult>;
};

export type CodeProviderName = 'builtin' | 'e2b';
