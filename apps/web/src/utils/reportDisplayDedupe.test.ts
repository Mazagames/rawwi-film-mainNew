import assert from 'node:assert/strict';
import { dedupeReportDisplayItems, type ReportDisplayFamily } from './reportDisplayDedupe';

type Item = {
  family: ReportDisplayFamily;
  category: string;
  page: number | null;
  description: string;
};

const dedupe = (items: readonly Item[]) => dedupeReportDisplayItems(
  items,
  (item) => item.family,
  (item) => item.category,
  (item) => item.page,
  (item) => item.description,
);

const base = { category: 'article_14', page: 4, description: 'Description A' };
assert.equal(dedupe([{ family: 'violation', ...base }, { family: 'violation', ...base }]).length, 1);
assert.equal(dedupe([{ family: 'note', ...base }, { family: 'note', ...base }]).length, 1);
assert.equal(dedupe([{ family: 'manual', ...base }, { family: 'manual', ...base }]).length, 1);
assert.equal(dedupe([{ family: 'glossary', ...base }, { family: 'glossary', ...base }]).length, 1);

for (const pair of [
  [{ family: 'violation', ...base }, { family: 'note', ...base }],
  [{ family: 'violation', ...base }, { family: 'manual', ...base }],
  [{ family: 'violation', ...base }, { family: 'glossary', ...base }],
  [{ family: 'note', ...base }, { family: 'manual', ...base }],
  [{ family: 'note', ...base }, { family: 'glossary', ...base }],
  [{ family: 'manual', ...base }, { family: 'glossary', ...base }],
] as Item[][]) {
  assert.equal(dedupe(pair).length, 2);
}

assert.equal(dedupe([{ family: 'note', ...base }, { family: 'note', ...base, page: 5 }]).length, 2);
assert.equal(dedupe([{ family: 'note', ...base }, { family: 'note', ...base, category: 'article_15' }]).length, 2);
assert.equal(dedupe([{ family: 'note', ...base }, { family: 'note', ...base, description: 'Description B' }]).length, 2);
assert.equal(dedupe([{ family: 'note', ...base }, { family: 'note', ...base, description: '  Description\n A  ' }]).length, 1);
assert.equal(dedupe([{ family: 'note', ...base, description: '' }, { family: 'note', ...base, description: '   ' }]).length, 2);
assert.equal(dedupe([{ family: 'note', ...base, evidence: 'same' } as Item, { family: 'note', ...base, evidence: 'different' } as Item]).length, 1);

const first = { family: 'note' as const, ...base };
const second = { family: 'note' as const, ...base, description: 'Different' };
const input = [first, second];
const output = dedupe(input);
assert.equal(output[0], first);
assert.deepEqual(input, [first, second]);

console.log('✓ report display dedupe preserves family boundaries, order, and input immutability');
