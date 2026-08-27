import React, { useState, useMemo } from 'react';
import { type ReportDisplaySectionCollections } from '@/utils/reportDisplaySections';
import { Shield, FileText, Settings, BookOpen, AlertTriangle, List } from 'lucide-react';
import { cn } from '@/utils/cn';
import { NOTE_CATEGORY_ORDER } from '@/utils/noteCategoryLabels';
import { getPolicyArticles } from '@/data/policyMap';

interface AnalysisReportViewProps {
  sections: ReportDisplaySectionCollections<any>;
  lang: 'ar' | 'en';
  getArticleId: (item: any) => number;
  getNoteCategory: (item: any) => string;
  getItemIdentity: (item: any) => string;
  renderViolation: (item: any) => React.ReactNode;
  renderNote: (item: any) => React.ReactNode;
  renderManual: (item: any) => React.ReactNode;
  renderGlossary: (item: any) => React.ReactNode;
}

export function AnalysisReportView({
  sections,
  lang,
  getArticleId,
  getNoteCategory,
  getItemIdentity,
  renderViolation,
  renderNote,
  renderManual,
  renderGlossary,
}: AnalysisReportViewProps) {
  const [activeTab, setActiveTab] = useState<'all' | 'violations' | 'notes' | 'manual' | 'glossary'>('all');
  const [activeViolationArticle, setActiveViolationArticle] = useState<number | 'all'>('all');
  const [activeNoteCategory, setActiveNoteCategory] = useState<string | 'all'>('all');

  const isAr = lang === 'ar';

  // 1. Calculate Deduplicated All Items
  const allItems = useMemo(() => {
    const unique = new Map<string, any>();
    sections.violations.forEach(v => unique.set(getItemIdentity(v), { type: 'violation', item: v }));
    sections.notes.forEach(n => unique.set(getItemIdentity(n), { type: 'note', item: n }));
    sections.manual.forEach(m => unique.set(getItemIdentity(m), { type: 'manual', item: m }));
    sections.glossary.forEach(g => unique.set(getItemIdentity(g), { type: 'glossary', item: g }));
    return Array.from(unique.values());
  }, [sections, getItemIdentity]);

  // 2. Pre-compute Violation Article Tabs
  const violationArticles = useMemo(() => {
    const articleCounts = new Map<number, number>();
    sections.violations.forEach(v => {
      const id = getArticleId(v);
      articleCounts.set(id, (articleCounts.get(id) ?? 0) + 1);
    });

    const articles = Array.from(articleCounts.keys())
      .map(id => {
        const policy = getPolicyArticles().find(p => p.id === id);
        return {
          id,
          count: articleCounts.get(id) ?? 0,
          title: policy ? policy.title_ar : `المادة ${String(id).padStart(2, '0')}`,
        };
      })
      .sort((a, b) => a.id - b.id);

    return articles;
  }, [sections.violations, getArticleId]);

  // 3. Pre-compute Note Category Tabs
  const noteCategories = useMemo(() => {
    const catCounts = new Map<string, number>();
    sections.notes.forEach(n => {
      const cat = getNoteCategory(n);
      catCounts.set(cat, (catCounts.get(cat) ?? 0) + 1);
    });

    return NOTE_CATEGORY_ORDER
      .filter(config => !config.key.startsWith('article_')) // Only true Note categories
      .map(config => ({
        key: config.key,
        title: isAr ? config.ar : config.en,
        count: catCounts.get(config.key) ?? 0,
      }))
      .filter(c => c.count > 0); // Only show categories that have notes
  }, [sections.notes, getNoteCategory, isAr]);

  const tabs = [
    { id: 'all', label: isAr ? 'الكل' : 'All', count: allItems.length, icon: List },
    { id: 'violations', label: isAr ? 'المخالفات' : 'Violations', count: sections.violations.length, icon: AlertTriangle },
    { id: 'notes', label: isAr ? 'الملاحظات' : 'Notes', count: sections.notes.length, icon: FileText },
    { id: 'manual', label: isAr ? 'يدوية' : 'Manual', count: sections.manual.length, icon: Settings },
    { id: 'glossary', label: isAr ? 'قاموس' : 'Glossary', count: sections.glossary.length, icon: BookOpen },
  ] as const;

  return (
    <div className="w-full flex flex-col space-y-6">
      {/* Top Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-800 overflow-x-auto no-scrollbar">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={cn(
              "flex flex-col items-center justify-center min-w-[120px] py-4 px-2 border-b-2 transition-colors duration-200 outline-none gap-2",
              activeTab === tab.id
                ? "border-primary-500 text-primary-600 dark:text-primary-400 bg-primary-50/50 dark:bg-primary-900/10"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50 dark:text-gray-400 dark:hover:text-gray-300 dark:hover:bg-gray-800/50"
            )}
          >
            <div className="flex items-center gap-2">
              <tab.icon className="w-5 h-5" />
              <span className="font-semibold text-sm whitespace-nowrap">{tab.label}</span>
            </div>
            <span className={cn(
              "text-xl font-bold font-mono tracking-tight",
              activeTab === tab.id ? "text-primary-700 dark:text-primary-300" : "text-gray-900 dark:text-gray-100"
            )}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Render Sections based on active tab */}
      
      {/* ALL TAB */}
      {activeTab === 'all' && (
        <div className="space-y-12">
          {sections.violations.length > 0 && (
            <div className="space-y-4">
              <h3 className="font-bold text-xl text-text-main border-b border-error/30 pb-2 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-error" />
                {isAr ? 'المخالفات' : 'Violations'}
                <span className="ms-2 text-sm bg-error/10 text-error border border-error/20 rounded-full px-2 py-0.5">{sections.violations.length}</span>
              </h3>
              <div className="space-y-4">
                {sections.violations.map(v => (
                  <React.Fragment key={getItemIdentity(v)}>{renderViolation(v)}</React.Fragment>
                ))}
              </div>
            </div>
          )}

          {sections.notes.length > 0 && (
            <div className="space-y-4">
              <h3 className="font-bold text-xl text-text-main border-b border-info/30 pb-2 flex items-center gap-2">
                <FileText className="w-5 h-5 text-info" />
                {isAr ? 'الملاحظات' : 'Notes'}
                <span className="ms-2 text-sm bg-info/10 text-info border border-info/20 rounded-full px-2 py-0.5">{sections.notes.length}</span>
              </h3>
              <div className="space-y-4">
                {sections.notes.map(n => (
                  <React.Fragment key={getItemIdentity(n)}>{renderNote(n)}</React.Fragment>
                ))}
              </div>
            </div>
          )}

          {sections.manual.length > 0 && (
            <div className="space-y-4">
              <h3 className="font-bold text-xl text-text-main border-b border-primary/30 pb-2 flex items-center gap-2">
                <Settings className="w-5 h-5 text-primary" />
                {isAr ? 'يدوية' : 'Manual'}
                <span className="ms-2 text-sm bg-primary/10 text-primary border border-primary/20 rounded-full px-2 py-0.5">{sections.manual.length}</span>
              </h3>
              <div className="space-y-4">
                {sections.manual.map(m => (
                  <React.Fragment key={getItemIdentity(m)}>{renderManual(m)}</React.Fragment>
                ))}
              </div>
            </div>
          )}

          {sections.glossary.length > 0 && (
            <div className="space-y-4">
              <h3 className="font-bold text-xl text-text-main border-b border-gray-400 pb-2 flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-gray-500" />
                {isAr ? 'قاموس' : 'Glossary'}
                <span className="ms-2 text-sm bg-gray-100 text-gray-700 border border-gray-200 rounded-full px-2 py-0.5">{sections.glossary.length}</span>
              </h3>
              <div className="space-y-4">
                {sections.glossary.map(g => (
                  <React.Fragment key={getItemIdentity(g)}>{renderGlossary(g)}</React.Fragment>
                ))}
              </div>
            </div>
          )}

          {allItems.length === 0 && (
            <div className="text-center py-12 text-gray-500">
              {isAr ? 'لا توجد نتائج' : 'No results found'}
            </div>
          )}
        </div>
      )}

      {/* VIOLATIONS TAB */}
      {activeTab === 'violations' && (
        <div className="space-y-6">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setActiveViolationArticle('all')}
              className={cn(
                "px-4 py-2 rounded-full text-sm font-medium transition-colors border",
                activeViolationArticle === 'all'
                  ? "bg-error text-white border-error"
                  : "bg-surface text-text-main border-gray-200 hover:bg-gray-50"
              )}
            >
              {isAr ? 'الكل' : 'All'} <span className="opacity-70 ms-1">({sections.violations.length})</span>
            </button>
            {violationArticles.map(article => (
              <button
                key={article.id}
                onClick={() => setActiveViolationArticle(article.id)}
                className={cn(
                  "px-4 py-2 rounded-full text-sm font-medium transition-colors border",
                  activeViolationArticle === article.id
                    ? "bg-error text-white border-error"
                    : "bg-surface text-text-main border-gray-200 hover:bg-gray-50"
                )}
              >
                {article.title} <span className="opacity-70 ms-1">({article.count})</span>
              </button>
            ))}
          </div>

          <div className="space-y-4">
            {sections.violations
              .filter(v => activeViolationArticle === 'all' || getArticleId(v) === activeViolationArticle)
              .map(v => (
                <React.Fragment key={getItemIdentity(v)}>{renderViolation(v)}</React.Fragment>
              ))}
            
            {sections.violations.filter(v => activeViolationArticle === 'all' || getArticleId(v) === activeViolationArticle).length === 0 && (
              <div className="text-center py-12 text-gray-500">
                {isAr ? 'لا توجد مخالفات في هذه الفئة' : 'No violations in this category'}
              </div>
            )}
          </div>
        </div>
      )}

      {/* NOTES TAB */}
      {activeTab === 'notes' && (
        <div className="space-y-6">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setActiveNoteCategory('all')}
              className={cn(
                "px-4 py-2 rounded-full text-sm font-medium transition-colors border",
                activeNoteCategory === 'all'
                  ? "bg-info text-white border-info"
                  : "bg-surface text-text-main border-gray-200 hover:bg-gray-50"
              )}
            >
              {isAr ? 'الكل' : 'All'} <span className="opacity-70 ms-1">({sections.notes.length})</span>
            </button>
            {noteCategories.map(cat => (
              <button
                key={cat.key}
                onClick={() => setActiveNoteCategory(cat.key)}
                className={cn(
                  "px-4 py-2 rounded-full text-sm font-medium transition-colors border",
                  activeNoteCategory === cat.key
                    ? "bg-info text-white border-info"
                    : "bg-surface text-text-main border-gray-200 hover:bg-gray-50"
                )}
              >
                {cat.title} <span className="opacity-70 ms-1">({cat.count})</span>
              </button>
            ))}
          </div>

          <div className="space-y-4">
            {sections.notes
              .filter(n => activeNoteCategory === 'all' || getNoteCategory(n) === activeNoteCategory)
              .map(n => (
                <React.Fragment key={getItemIdentity(n)}>{renderNote(n)}</React.Fragment>
              ))}

            {sections.notes.filter(n => activeNoteCategory === 'all' || getNoteCategory(n) === activeNoteCategory).length === 0 && (
              <div className="text-center py-12 text-gray-500">
                {isAr ? 'لا توجد ملاحظات' : 'No notes'}
              </div>
            )}
          </div>
        </div>
      )}

      {/* MANUAL TAB */}
      {activeTab === 'manual' && (
        <div className="space-y-4">
          {sections.manual.map(m => (
             <React.Fragment key={getItemIdentity(m)}>{renderManual(m)}</React.Fragment>
          ))}
          {sections.manual.length === 0 && (
            <div className="text-center py-12 text-gray-500">
              {isAr ? 'لا توجد عناصر يدوية' : 'No manual items'}
            </div>
          )}
        </div>
      )}

      {/* GLOSSARY TAB */}
      {activeTab === 'glossary' && (
        <div className="space-y-4">
          {sections.glossary.map(g => (
             <React.Fragment key={getItemIdentity(g)}>{renderGlossary(g)}</React.Fragment>
          ))}
          {sections.glossary.length === 0 && (
            <div className="text-center py-12 text-gray-500">
              {isAr ? 'لا توجد عناصر في القاموس' : 'No glossary items'}
            </div>
          )}
        </div>
      )}

    </div>
  );
}
