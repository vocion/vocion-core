import type { CapabilityStatus } from '../types';
import type { CodeProvider, CodeProviderName } from './types';
import process from 'node:process';
import { statusForProvider } from '../status';
import { builtinCodeProvider } from './builtin';
import { e2bCodeProvider } from './e2b';

export function resolveCodeProviderName(): CodeProviderName {
  const raw = (process.env.VOCION_CODE_PROVIDER ?? 'builtin').toLowerCase();
  return raw === 'e2b' ? 'e2b' : 'builtin';
}

export function getCodeProvider(name = resolveCodeProviderName()): CodeProvider {
  return name === 'e2b' ? e2bCodeProvider() : builtinCodeProvider();
}

export async function codeStatus(orgId?: string): Promise<CapabilityStatus> {
  const name = resolveCodeProviderName();
  return statusForProvider('run_code', getCodeProvider(name), orgId);
}
