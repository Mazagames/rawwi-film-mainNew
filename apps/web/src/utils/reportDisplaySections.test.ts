import assert from 'node:assert/strict';
import { buildReportDisplaySections, getReportDisplaySectionCounts } from './reportDisplaySections';

const displaySections = buildReportDisplaySections({
  violations: [{ id: 'v1' }],
  notes: Array.from({ length: 62 }, (_, index) => ({ id: `note-${index}` })),
  manual: [],
  glossary: [{ id: 'g1' }],
});

const counts = getReportDisplaySectionCounts(displaySections);
assert.equal(counts.violations, 1);
assert.equal(counts.notes, 62);
assert.equal(counts.manual, 0);
assert.equal(counts.glossary, 1);
assert.equal(counts.all, 64);

const overlappingSections = buildReportDisplaySections({
  violations: [{ id: 'shared' }, { id: 'v2' }],
  notes: [{ id: 'shared' }, { id: 'note-1' }],
  manual: [{ id: 'manual-1' }],
  glossary: [{ id: 'shared' }],
});
const overlappingCounts = getReportDisplaySectionCounts(overlappingSections);
assert.equal(overlappingCounts.all, 4);
assert.equal(overlappingCounts.violations, 2);
assert.equal(overlappingCounts.notes, 2);
assert.equal(overlappingCounts.manual, 1);
assert.equal(overlappingCounts.glossary, 1);

const notesOnly = buildReportDisplaySections({
  violations: [{ id: 'v1' }],
  notes: [{ id: 'article-note' }, { id: 'informational-note' }],
  manual: [],
  glossary: [],
});
assert.equal(getReportDisplaySectionCounts(notesOnly).notes, 2);
assert.deepEqual(notesOnly.notes.map((note: { id: string }) => note.id), ['article-note', 'informational-note']);

console.log('✓ report display sections use a shared count model');
