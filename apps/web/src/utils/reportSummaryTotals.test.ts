import { describe, it, expect } from 'vitest';
import { getCanonicalReportTotals } from './reportSummaryTotals';

describe('Report Summary Totals', () => {
  it('contract uses canonical summary totals correctly', () => {
    const totals = getCanonicalReportTotals({
      totals: {
        findings_count: 10,
        severity_counts: { low: 1, medium: 2, high: 3, critical: 4 },
        type_counts: { ai: 4, manual: 1, glossary: 2, special: 3 },
      },
      notes: {
        article_05: [{ id: 'n1' }],
        article_12: [{ id: 'n2' }],
      },
    } as any, { fallbackFindingsCount: 99, fallbackTypeCounts: { ai: 99, manual: 99, glossary: 99, special: 99 } });

    expect(totals.violations).toBe(10);
    expect(totals.notes).toBe(2);
    expect(totals.all).toBe(12);
    expect(totals.manual).toBe(1);
    expect(totals.glossary).toBe(2);
    expect(totals.special).toBe(3);
    expect(totals.ai).toBe(4);
  });

  it('uses fallback values when undefined', () => {
    const fallback = getCanonicalReportTotals(undefined, { fallbackFindingsCount: 77, fallbackTypeCounts: { ai: 5, manual: 6, glossary: 7, special: 8 } });
    
    expect(fallback.violations).toBe(77);
    expect(fallback.notes).toBe(0);
    expect(fallback.all).toBe(77);
    expect(fallback.manual).toBe(6);
    expect(fallback.glossary).toBe(7);
    expect(fallback.special).toBe(8);
    expect(fallback.ai).toBe(5);
  });

  it('can override canonical count', () => {
    const canonicalOverride = getCanonicalReportTotals({
      totals: {
        findings_count: 10,
        type_counts: { ai: 4, manual: 1, glossary: 2, special: 3 },
      },
      notes: {
        article_05: [{ id: 'n1' }, { id: 'n2' }, { id: 'n3' }],
      },
    } as any, { fallbackFindingsCount: 99, fallbackTypeCounts: { ai: 99, manual: 99, glossary: 99, special: 99 } }, { canonicalFindingCount: 1 });
    
    expect(canonicalOverride.violations).toBe(1);
    expect(canonicalOverride.notes).toBe(3);
    expect(canonicalOverride.all).toBe(4);
  });

  it('overrides using context metrics violation count', () => {
    const bannerOverride = getCanonicalReportTotals({
      totals: {
        findings_count: 7,
        type_counts: { ai: 4, manual: 0, glossary: 1, special: 0 },
      },
      context_metrics: {
        violation_count: 1,
      },
      canonical_findings: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }],
      notes: {
        article_05: Array.from({ length: 62 }, (_, index) => ({ id: `n${index}` })),
      },
    } as any, { fallbackFindingsCount: 99, fallbackTypeCounts: { ai: 99, manual: 99, glossary: 99, special: 99 } });
    
    expect(bannerOverride.violations).toBe(1);
    expect(bannerOverride.notes).toBe(62);
    expect(bannerOverride.manual).toBe(0);
    expect(bannerOverride.glossary).toBe(1);
    expect(bannerOverride.all).toBe(63);
  });

  it('uses canonical findings length if violation_count is 0', () => {
    const zeroedViolationContext = getCanonicalReportTotals({
      totals: {
        findings_count: 7,
        type_counts: { ai: 4, manual: 0, glossary: 1, special: 0 },
      },
      context_metrics: {
        violation_count: 0,
      },
      canonical_findings: Array.from({ length: 40 }, (_, index) => ({ id: `c${index}` })),
      notes: {
        article_05: Array.from({ length: 62 }, (_, index) => ({ id: `n${index}` })),
      },
    } as any, { fallbackFindingsCount: 99, fallbackTypeCounts: { ai: 99, manual: 99, glossary: 99, special: 99 } });
    
    expect(zeroedViolationContext.violations).toBe(40);
    expect(zeroedViolationContext.notes).toBe(62);
    expect(zeroedViolationContext.all).toBe(102);
  });
});
