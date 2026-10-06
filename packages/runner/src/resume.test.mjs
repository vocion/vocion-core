import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resumeNote } from './resume.mjs';

test('a resume that rebased cleanly tells the engineer nothing extra', () => {
  assert.equal(resumeNote(null), null);
  // A clean resume says the work is already on the branch, so finishing it may mean only checking it (walk 27, FE-478).
  assert.match(resumeNote({ ref: 'factory/t239-copy-link', sha: 'abc', rebased_onto: 'def' }), /already on your branch.*If it is already complete/s);
});

test('a resume that conflicts names the files and asks for a merge of main first', () => {
  const note = resumeNote({ ref: 'factory/t239-copy-link', main: 'def', conflicts: ['apps/web/src/router.tsx', 'apps/web/src/routes/LibraryPage.tsx'] });
  assert.match(note, /git merge origin\/main/);
  assert.match(note, /`apps\/web\/src\/router\.tsx`, `apps\/web\/src\/routes\/LibraryPage\.tsx`/);
  assert.match(note, /factory\/t239-copy-link/);
});
