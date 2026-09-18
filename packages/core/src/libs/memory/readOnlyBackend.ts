/**
 * Read-only wrapper for the `/memories/` backend route — the structural half
 * of the approval gate at the filesystem layer.
 *
 * deepagents' `permissions` rules would enforce the same thing, but they
 * THROW, and a thrown tool error aborts the whole turn — verified live: one
 * attempted `write_file` under /memories/ killed the run. This wrapper
 * returns the denial as the tool's own result (`WriteResult.error` /
 * `EditResult.error`), so the model reads why it was refused and carries on.
 *
 * Mirrored in `packages/agent-runtime/src/readOnlyBackend.ts` (the artifact
 * cannot import core modules). Keep the two in sync.
 */

const DENIED = 'read-only: approved memories can only change through the review queue (approval is the only write path). Propose a rule instead of writing this file.';

/**
 * Wrap a backend so every mutating operation is refused gracefully and every
 * read passes through untouched.
 * @param inner - The backend serving reads.
 */
export function readOnlyBackend<T extends object>(inner: T): T {
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === 'write') {
        return (filePath: string) => ({ error: `${DENIED} (write ${filePath})` });
      }
      if (prop === 'edit') {
        return (filePath: string) => ({ error: `${DENIED} (edit ${filePath})` });
      }
      if (prop === 'uploadFiles') {
        return (files: Array<{ path: string }>) => files.map(f => ({ path: f.path, error: 'permission_denied' as const }));
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
