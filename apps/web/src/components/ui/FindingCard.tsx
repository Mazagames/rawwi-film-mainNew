import { useEffect, useState } from 'react';
import { useLangStore } from '@/store/langStore';
import { Finding } from '@/store/dataStore';
import { useAuthStore } from '@/store/authStore';
import { useSettingsStore } from '@/store/settingsStore';
import { formatDate } from '@/utils/dateFormat';
import { useNavigate } from 'react-router-dom';
import { Badge } from './Badge';
import { Button } from './Button';
import { cn } from '@/utils/cn';
import { ShieldAlert, AlertTriangle, AlertCircle, Edit2, RotateCcw, MapPin, EyeOff, CheckCircle, ExternalLink, MoreVertical } from 'lucide-react';
import { getViolationTypeIdFromLegacyPolicyArticle, resolveViolationTypeId, violationTypeLabel } from '@/data/violationTypes';
import { displayPageForFinding } from '@/utils/viewerPageFromOffset';
import { formatResolvedSceneLabel, resolveSceneLabelFromOffset } from '@/utils/sceneLabelFromOffset';
import { getNoteCategoryLabel } from '@/utils/noteCategoryLabels';

export interface NoteCardData {
  id: string;
  category: string;
  title: string;
  description: string;
  snippet: string;
  eventId: number;
  reviewer?: string | null;
  confidence?: number | null;
  status?: string | null;
  includedInReport?: boolean;
  reviewerComment?: string | null;
  reviewedAt?: string | null;
  createdAt?: string | null;
}

interface FindingCardProps {
  finding?: Finding;
  note?: NoteCardData;
  mode?: 'finding' | 'note';
  onOverrideClick?: (finding: Finding) => void;
  onRestoreClick?: (finding: Finding) => void;
  onToggleNoteReportVisibility?: (note: NoteCardData) => void;
  onMarkNoteReviewed?: (note: NoteCardData) => void;
  onEditNote?: (note: NoteCardData) => void;
  noteAccent?: 'info' | 'error';
  /** When set with finding.startOffsetGlobal, page label matches workspace viewer. */
  scriptViewerPages?: Array<{ pageNumber: number; content: string }> | null;
}

const severityConfig: Record<string, { icon: any, color: string, bg: string, strip: string }> = {
  Critical: { icon: ShieldAlert, color: 'text-error-700', bg: 'bg-error-50', strip: 'bg-error-700' },
  High: { icon: ShieldAlert, color: 'text-error', bg: 'bg-error-50', strip: 'bg-error' },
  Medium: { icon: AlertTriangle, color: 'text-warning-700', bg: 'bg-warning-50', strip: 'bg-warning' },
  Low: { icon: AlertCircle, color: 'text-info', bg: 'bg-info-50', strip: 'bg-info' },
};

export function FindingCard({
  finding,
  note,
  mode,
  onOverrideClick,
  onRestoreClick,
  onToggleNoteReportVisibility,
  onMarkNoteReviewed,
  onEditNote,
  noteAccent = 'info',
  scriptViewerPages,
}: FindingCardProps) {
  const { lang, t } = useLangStore();
  const { user } = useAuthStore();
  const { settings } = useSettingsStore();
  const navigate = useNavigate();
  const isAdminOrRegulator = user?.role === 'Super Admin' || user?.role === 'Regulator' || user?.role === 'Admin';
  const isNoteCard = mode === 'note' || Boolean(note);
  const [noteMenuOpen, setNoteMenuOpen] = useState(false);

  if (isNoteCard && !note) return null;
  if (!isNoteCard && !finding) return null;

  useEffect(() => {
    if (!noteMenuOpen) return;
    const handlePointer = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.(`[data-note-menu="${note?.id ?? ''}"]`)) return;
      setNoteMenuOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setNoteMenuOpen(false);
    };
    window.addEventListener('mousedown', handlePointer);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('mousedown', handlePointer);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [noteMenuOpen, note?.id]);
  
  // Visibility Logic: Owner/Reviewer should not see 'hidden_from_owner'
  if (!isNoteCard && finding && !isAdminOrRegulator && finding.override?.eventType === 'hidden_from_owner') {
    return null;
  }

  const isOverriddenNotViolation = !isNoteCard && finding?.override?.eventType === 'not_violation';
  const isHiddenFromOwner = !isNoteCard && finding?.override?.eventType === 'hidden_from_owner';
  const enableHiddenOverrides = settings?.features?.enableHiddenOverrides !== false;
  const showHiddenFromOwner = isHiddenFromOwner && enableHiddenOverrides;

  // Strip Color Logic
  let stripColor = isNoteCard ? (noteAccent === 'error' ? 'bg-error' : 'bg-info') : severityConfig[finding!.severity].strip;
  if (isOverriddenNotViolation) stripColor = 'bg-success';
  if (showHiddenFromOwner) stripColor = 'bg-text-muted';

  const SevIcon = isNoteCard ? AlertCircle : severityConfig[finding!.severity].icon;

  const displayPage = !isNoteCard
    ? displayPageForFinding(
        finding!.startOffsetGlobal,
        scriptViewerPages ?? null,
        finding!.pageNumber != null && Number.isFinite(Number(finding!.pageNumber)) ? Number(finding!.pageNumber) : null
      )
    : null;
  const resolvedViolationType = !isNoteCard
    ? getViolationTypeIdFromLegacyPolicyArticle(
        Number.isFinite(Number(finding!.articleId)) ? Number(finding!.articleId) : null,
        finding!.subAtomId ?? null,
      )
      ?? resolveViolationTypeId(finding!.titleAr)
      ?? resolveViolationTypeId(finding!.descriptionAr)
      ?? resolveViolationTypeId(finding!.evidenceSnippet)
      ?? resolveViolationTypeId(finding!.excerpt)
    : null;
  const titleLabel = isNoteCard
    ? (note!.title || 'Note')
    : resolvedViolationType
      ? violationTypeLabel(resolvedViolationType, lang)
      : (lang === 'ar' ? finding!.titleAr || 'ملاحظة' : finding!.titleEn || 'Finding');
  const resolvedSceneLabel = !isNoteCard
    ? formatResolvedSceneLabel(
        resolveSceneLabelFromOffset(finding!.startOffsetGlobal, scriptViewerPages ?? null),
        lang
      )
    : null;

  const getLocationString = () => {
    if (isNoteCard) {
      return `${lang === 'ar' ? 'الحدث' : 'Event'} #${note!.eventId}`;
    }
    if (!finding) return t('unknownLocation');
    const page = displayPage ?? finding.location?.page;
    if (!finding.location && page == null) return t('unknownLocation');
    const parts = [];
    const scene = finding.location?.scene;
    if (page != null && Number.isFinite(Number(page))) parts.push(`${t('page')} ${page}`);
    if (resolvedSceneLabel) parts.push(resolvedSceneLabel);
    else if (scene != null && Number.isFinite(Number(scene))) parts.push(`${t('scene')} ${scene}`);
    if (finding.location?.lineChunk) parts.push(finding.location.lineChunk);
    return parts.length > 0 ? parts.join(' • ') : t('unknownLocation');
  };

  return (
    <div className={cn(
      "relative bg-surface rounded-xl shadow-sm border border-border overflow-hidden mb-4 print:break-inside-avoid print:shadow-none print:border-border/50",
      showHiddenFromOwner && "opacity-75 grayscale-[20%]"
    )}>
      {/* Left Strip */}
      <div className={cn("absolute top-0 bottom-0 w-1.5 start-0", stripColor)} />
      
      <div className="p-5 ps-6">
        {/* Header Row */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h4 className="font-bold text-lg text-text-main">
                {titleLabel}
              </h4>
            </div>
            
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {isNoteCard ? (
                <>
                  <Badge variant="outline" className={cn('text-[10px]', noteAccent === 'error' ? 'bg-error/10 text-error border-error/30' : 'bg-info/10 text-info border-info/30')}>
                    {getNoteCategoryLabel(note!.category, lang === 'ar' ? 'ar' : 'en') || note!.category}
                  </Badge>
                  <Badge variant="outline" className="text-[10px] text-text-muted border-border/60">
                    {note!.includedInReport === false ? (lang === 'ar' ? 'مستبعد' : 'Excluded') : (lang === 'ar' ? 'مضمن' : 'Included')}
                  </Badge>
                  {note!.reviewer && (
                    <Badge variant="outline" className="text-[10px] text-text-muted border-border/60">
                      {lang === 'ar' ? 'المراجع' : 'Reviewer'}: {note!.reviewer}
                    </Badge>
                  )}
                  {note!.confidence != null && (
                    <Badge variant="outline" className="text-[10px] text-text-muted border-border/60">
                      {lang === 'ar' ? 'ثقة' : 'Conf'} {Math.round((note!.confidence ?? 0) * 100)}%
                    </Badge>
                  )}
                  {note!.status && (
                    <Badge variant="outline" className="text-[10px] text-text-muted border-border/60">
                      {note!.status}
                    </Badge>
                  )}
                  {note!.reviewedAt && (
                    <Badge variant="outline" className="text-[10px] text-text-muted border-border/60">
                      {lang === 'ar' ? 'مراجعة' : 'Reviewed'}
                    </Badge>
                  )}
                </>
              ) : (
                <>
                  {/* Severity Badge */}
                  <div className={cn(
                    "flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-semibold border",
                    severityConfig[finding!.severity].bg,
                    severityConfig[finding!.severity].color,
                    "border-current/20",
                    isOverriddenNotViolation && "opacity-60"
                  )}>
                    <SevIcon className="w-3.5 h-3.5" />
                    <span className={cn(isOverriddenNotViolation && "line-through")}>
                      {finding!.severity}
                    </span>
                  </div>

                  {/* Source Badge */}
                  <Badge variant={finding!.source === 'ai' ? 'default' : finding!.source === 'lexicon_mandatory' ? 'error' : 'outline'} className="text-[10px]">
                    {finding!.source === 'ai' ? 'AI' : finding!.source === 'lexicon_mandatory' ? t('findingSourceGlossary') : t('manualFinding')}
                  </Badge>

                  {/* Override Badges */}
                  {isOverriddenNotViolation && (
                    <Badge variant="success" className="text-xs flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" />
                      {t('overriddenOk')}
                    </Badge>
                  )}
                  {showHiddenFromOwner && (
                    <Badge variant="outline" className="text-xs flex items-center gap-1 text-text-muted">
                      <EyeOff className="w-3 h-3" />
                      {t('hiddenOwner')}
                    </Badge>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Admin Controls (Hidden in Print) */}
          {!isNoteCard && isAdminOrRegulator && (
            <div className="flex gap-2 print:hidden">
              {!finding!.override ? (
                <Button variant="outline" size="sm" onClick={() => onOverrideClick?.(finding!)} className="h-8 text-xs">
                  <Edit2 className="w-3 h-3 me-1.5" />
                  {t('editStatus')}
                </Button>
              ) : (
                <>
                  <Button variant="ghost" size="sm" onClick={() => onRestoreClick?.(finding!)} className="h-8 text-xs text-error hover:bg-error-50 hover:text-error-700">
                    <RotateCcw className="w-3 h-3 me-1.5" />
                    {t('restoreOriginal')}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => onOverrideClick?.(finding!)} className="h-8 text-xs">
                    <Edit2 className="w-3 h-3 me-1.5" />
                    {t('updateOverride')}
                  </Button>
                </>
              )}
            </div>
          )}
          {isNoteCard && (
            <div className="relative flex gap-2 print:hidden">
              <button
                type="button"
                className="inline-flex h-6 w-6 items-center justify-center rounded border border-border bg-background text-text-muted hover:bg-surface"
                onClick={() => setNoteMenuOpen((prev) => !prev)}
                aria-label={lang === 'ar' ? 'خيارات الملاحظة' : 'Note actions'}
                data-note-menu={note!.id}
              >
                <MoreVertical className="h-3.5 w-3.5" />
              </button>
              {noteMenuOpen && (
                <div className="absolute end-0 top-7 z-20 min-w-[180px] rounded-md border border-border bg-background p-1 shadow-lg" data-note-menu={note!.id}>
                  <button
                    type="button"
                    className="w-full rounded px-2 py-1.5 text-start text-xs hover:bg-surface"
                    onClick={() => {
                      onToggleNoteReportVisibility?.(note!);
                      setNoteMenuOpen(false);
                    }}
                  >
                    {note!.includedInReport === false
                      ? (lang === 'ar' ? 'تضمين في التقرير' : 'Include in report')
                      : (lang === 'ar' ? 'استبعاد من التقرير' : 'Exclude from report')}
                  </button>
                  <button
                    type="button"
                    className="w-full rounded px-2 py-1.5 text-start text-xs hover:bg-surface"
                    onClick={() => {
                      onMarkNoteReviewed?.(note!);
                      setNoteMenuOpen(false);
                    }}
                  >
                    {lang === 'ar' ? 'اعتماد كمراجَع' : 'Mark as reviewed'}
                  </button>
                  <button
                    type="button"
                    className="w-full rounded px-2 py-1.5 text-start text-xs hover:bg-surface"
                    onClick={() => {
                      onEditNote?.(note!);
                      setNoteMenuOpen(false);
                    }}
                  >
                    {lang === 'ar' ? 'تعديل العنوان والوصف' : 'Edit title & description'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Override Reason Block */}
        {!isNoteCard && finding!.override && (
          <div className="mb-4 bg-background rounded-lg p-3 border border-border text-sm">
            <div className="flex justify-between items-start mb-1">
              <span className="font-semibold text-text-main">{t('overrideReason')}</span>
              <div className="text-xs text-text-muted flex gap-3">
                <span><span className="font-medium">{t('byUser')}</span> {finding!.override!.byUser}</span>
                <span>{formatDate(new Date(finding!.override!.createdAt), { lang, format: settings?.platform?.dateFormat })}</span>
              </div>
            </div>
            <p className="text-text-muted">{finding!.override!.reason}</p>
          </div>
        )}

        {/* Description */}
        <div className="mb-4">
          <span className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-1 block">
            {isNoteCard ? (lang === 'ar' ? 'الوصف' : 'Description') : t('findingDescription')}
          </span>
          <p className="text-sm text-text-main leading-relaxed">
            {isNoteCard
              ? note!.description
              : lang === 'ar'
                ? finding!.descriptionAr
                : (finding!.descriptionEn || finding!.descriptionAr)}
          </p>
          {isNoteCard && note!.reviewerComment && (
            <p className="mt-2 text-xs text-text-muted">
              <span className="font-semibold text-text-main">{lang === 'ar' ? 'ملاحظة المراجع:' : 'Reviewer comment:'}</span>{' '}
              {note!.reviewerComment}
            </p>
          )}
        </div>

        {/* Evidence & Location */}
        <div className="bg-background rounded-lg border border-border overflow-hidden">
          <div className="px-3 py-2 bg-surface/50 border-b border-border flex items-center justify-between text-xs text-text-muted">
            <div className="flex items-center gap-2">
              <MapPin className="w-3.5 h-3.5" />
              <span className="font-medium">{getLocationString()}</span>
            </div>
            {!isNoteCard && (
              <button
                onClick={() => {
                  const pg = displayPage ?? (finding!.pageNumber != null && finding!.pageNumber > 0 ? finding!.pageNumber : null);
                  const p = pg != null ? `?page=${pg}` : '';
                  navigate(`/workspace/${finding!.scriptId}${p}#highlight-${finding!.id}`);
                }}
                className="flex items-center gap-1 hover:text-primary transition-colors font-medium print:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 rounded-md px-1"
                aria-label={lang === 'ar' ? 'الذهاب للموقع' : 'Jump to location'}
              >
                <ExternalLink className="w-3.5 h-3.5" />
                {lang === 'ar' ? 'الذهاب للموقع' : 'Jump to location'}
              </button>
            )}
          </div>
          <div className="p-4">
            <blockquote className={cn('border-s-2 ps-4 text-sm font-medium text-text-main italic leading-relaxed', isNoteCard && noteAccent === 'error' ? 'border-error/50' : 'border-primary/50')} dir="rtl">
              "{isNoteCard ? note!.snippet : (finding!.evidenceSnippet || finding!.excerpt)}"
            </blockquote>
          </div>
        </div>
      </div>
    </div>
  );
}
