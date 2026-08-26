import assert from 'node:assert/strict';
import { getNoteCategoryLabel } from './noteCategoryLabels';

assert.equal(getNoteCategoryLabel('article_01', 'ar'), 'الإساءة إلى الذات الإلهية والدين');
assert.equal(getNoteCategoryLabel('article_01', 'en'), 'Article 01');
assert.equal(getNoteCategoryLabel('unknown_category', 'ar'), 'unknown_category');

console.log('✓ note category labels resolve to the canonical user-facing names');
