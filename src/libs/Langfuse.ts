import { Langfuse } from 'langfuse';

const globalForLangfuse = globalThis as unknown as {
  langfuse: Langfuse | undefined;
};

export const langfuse = globalForLangfuse.langfuse ?? new Langfuse({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY || 'pk-lf-corecontext-ziggy',
  secretKey: process.env.LANGFUSE_SECRET_KEY || 'sk-lf-corecontext-ziggy',
  baseUrl: process.env.LANGFUSE_BASE_URL || 'http://localhost:3200',
});

if (process.env.NODE_ENV !== 'production') {
  globalForLangfuse.langfuse = langfuse;
}
