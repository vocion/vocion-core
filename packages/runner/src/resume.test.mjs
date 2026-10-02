import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resumeConflictNote } from './resume.mjs';

test('a resume that rebased cleanly tells the engineer nothing extra', () => {
  assert.equal(resumeConflictNote(null), null);
  assert.equal(resumeConflictNote({ ref: 'factory/t239-copy-link', sha: 'abc', rebased_onto: 'def' }), null);
});

test('a resume that conflicts names the files and asks for a merge of main first', () => {
  const note = resumeConflictNote({ ref: 'factory/t239-copy-link', main: 'def', conflicts: ['apps/web/src/router.tsx', 'apps/web/src/routes/LibraryPage.tsx'] });
  assert.match(note, /git merge origin\/main/);
  assert.match(note, /`apps\/web\/src\/router\.tsx`, `apps\/web\/src\/routes\/LibraryPage\.tsx`/);
  assert.match(note, /factory\/t239-copy-link/);
});
