import { describe, it, expect } from 'vitest';
import { buildReportDisplaySections, getReportDisplaySectionCounts } from './reportDisplaySections';

describe('Report Display Sections and Counts', () => {
  it('A. Violations collection contains ONLY reportFamily === "violation"', () => {
    // We simulate the data provided from deduplication
    const mockViolations = [{ id: 'v1', family: 'violation' }, { id: 'v2', family: 'violation' }];
    const displaySections = buildReportDisplaySections({
      violations: mockViolations,
      notes: [], manual: [], glossary: []
    });
    
    expect(displaySections.violations.every((v: any) => v.family === 'violation')).toBe(true);
  });

  it('B. Manual collection contains ONLY manual items', () => {
    const mockManual = [{ id: 'm1', family: 'manual' }];
    const displaySections = buildReportDisplaySections({
      violations: [], notes: [], manual: mockManual, glossary: []
    });
    
    expect(displaySections.manual.every((m: any) => m.family === 'manual')).toBe(true);
  });

  it('C. Glossary collection contains ONLY glossary items', () => {
    const mockGlossary = [{ id: 'g1', family: 'glossary' }];
    const displaySections = buildReportDisplaySections({
      violations: [], notes: [], manual: [], glossary: mockGlossary
    });
    
    expect(displaySections.glossary.every((g: any) => g.family === 'glossary')).toBe(true);
  });

  it('D. Notes collection contains both Article Notes and Informational Notes', () => {
    const notesOnly = buildReportDisplaySections({
      violations: [{ id: 'v1' }],
      notes: [{ id: 'article-note', type: 'article' }, { id: 'informational-note', type: 'informational' }],
      manual: [],
      glossary: [],
    });
    
    expect(notesOnly.notes.length).toBe(2);
    const hasArticle = notesOnly.notes.some((n: any) => n.type === 'article');
    const hasInfo = notesOnly.notes.some((n: any) => n.type === 'informational');
    expect(hasArticle).toBe(true);
    expect(hasInfo).toBe(true);
  });

  it('E-H. Same report data counts matching array lengths', () => {
    const displaySections = buildReportDisplaySections({
      violations: [{ id: 'v1' }],
      notes: Array.from({ length: 62 }, (_, index) => ({ id: `note-${index}` })),
      manual: [],
      glossary: [{ id: 'g1' }],
    });

    const counts = getReportDisplaySectionCounts(displaySections);
    
    // E. top banner violation count === violations.length
    expect(counts.violations).toBe(displaySections.violations.length);
    expect(counts.violations).toBe(1);

    // F. Notes count === notes.length
    expect(counts.notes).toBe(displaySections.notes.length);
    expect(counts.notes).toBe(62);

    // G. Manual count === manual.length
    expect(counts.manual).toBe(displaySections.manual.length);
    expect(counts.manual).toBe(0);

    // H. Glossary count === glossary.length
    expect(counts.glossary).toBe(displaySections.glossary.length);
    expect(counts.glossary).toBe(1);
  });

  it('I. ALL is the unique union', () => {
    const overlappingSections = buildReportDisplaySections({
      violations: [{ id: 'shared' }, { id: 'v2' }],
      notes: [{ id: 'shared' }, { id: 'note-1' }],
      manual: [{ id: 'manual-1' }],
      glossary: [{ id: 'shared' }],
    });
    const overlappingCounts = getReportDisplaySectionCounts(overlappingSections);
    
    // Total distinct items: 'shared', 'v2', 'note-1', 'manual-1' = 4
    expect(overlappingCounts.all).toBe(4);
    expect(overlappingCounts.violations).toBe(2);
    expect(overlappingCounts.notes).toBe(2);
    expect(overlappingCounts.manual).toBe(1);
    expect(overlappingCounts.glossary).toBe(1);
  });
});
