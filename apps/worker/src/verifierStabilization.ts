export type VerifierSceneIndexEntry = {
  sceneIndex: number;
  startOffset: number;
  endOffset: number;
};

export type VerifierFinding = {
  article_id: number;
  detection_pass?: string | null;
  canonical_atom?: string | null;
  rationale_ar?: string | null;
  source?: string | null;
  start_offset_global?: number | null;
  evidence_snippet?: string | null;
};

function compactNormalizedEvidence(value: string | null | undefined): string {
  return (value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
}

function tokenizeArabicRationale(value: string | null | undefined): string[] {
  const text = compactNormalizedEvidence(value);
  if (!text) return [];
  const stopwords = new Set([
    "هذا",
    "هذه",
    "ذلك",
    "تلك",
    "هنا",
    "هناك",
    "على",
    "عن",
    "إلى",
    "الى",
    "من",
    "في",
    "و",
    "أو",
    "ثم",
    "كما",
    "لأن",
    "لان",
    "قد",
    "تم",
    "يتم",
    "كان",
    "تكون",
    "يكون",
    "ليس",
    "ما",
    "لا",
    "لم",
    "لن",
    "إن",
    "ان",
    "أن",
    "اي",
    "أي",
    "مع",
    "كل",
    "أيضاً",
    "ايضا",
  ]);
  const tokens = text
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter(Boolean)
    .flatMap((token) => {
      const variants = new Set<string>();
      const normalized = token.normalize("NFC");
      if (normalized.length >= 3 && !stopwords.has(normalized)) variants.add(normalized);
      if (normalized.startsWith("ال") && normalized.length > 4) {
        const stripped = normalized.slice(2);
        if (stripped.length >= 3 && !stopwords.has(stripped)) variants.add(stripped);
      }
      return [...variants];
    });
  return [...new Set(tokens)];
}

export function hasRationaleLocalSupport(rationale: string, localWindow: string): boolean {
  const rationaleTokens = tokenizeArabicRationale(rationale);
  if (rationaleTokens.length === 0) return true;
  const normalizedLocal = compactNormalizedEvidence(localWindow);
  if (!normalizedLocal) return false;
  return rationaleTokens.some((token) => normalizedLocal.includes(token));
}

export function hasDriftProneArticleAnchor(articleId: number, localWindow: string): boolean {
  switch (articleId) {
    case 12:
      return /(?:طفل|الطفل|الطفلة|الطفل\s+يتعرض|أطفال|قاصر|القاصر|يعنف|عنف\s+ضد\s+طفل|ضرب\s+طفل|الاعتداء\s+على\s+طفل)/u.test(localWindow);
    case 15:
      return /(?:فوضى|الفوضى|شغب|الشغب|اضطراب|اضطرابات|تحريض|يحرض|إخلال\s+بالنظام|النظام\s+العام|صراخ|تجمهر|اشتباك)/u.test(localWindow);
    case 19:
      return /(?:اقتصاد|الاقتصاد|اقتصادي|الاقتصادي|أسعار|السوق|مالية|المالية|عملة|البنك|التضخم|الديون|تجارة)/u.test(localWindow);
    case 21:
      return /(?:وثيقة|الوثيقة|مستند|ملف|الملف|تسريب|مسرب|مسربة|سري|سرية|معلومات\s+سرية|وثائق)/u.test(localWindow);
    case 23:
      return /(?:عري|عريان|مكشوف|ملابس|الملابس|لباس|لبس|زي|حجاب|قميص|سروال|فستان|جسد|المظهر|الهيئة)/u.test(localWindow);
    default:
      return true;
  }
}

export function hasWomenSpecificEvidence(value: string | null | undefined): boolean {
  const text = compactNormalizedEvidence(value);
  if (!text) return false;
  return (
    /(امرأ|المرأة|نساء|زوجة|زوجتك|بنت|البنت|بنات|أنثى|مطبخ|السرير|البيت)/u.test(text) ||
    /(ما\s+لك\s+كلمة|مالك\s+كلمة|ما\s+لها\s+كلمة|مكانك\s+المطبخ|مكان\s+البنت|مكانها\s+البيت|للمطبخ\s+والسرير|للمطبخ|السرير\s+وبس)/u.test(text)
  );
}

export function hasPoliticalAnchorForClassification(text: string): boolean {
  return /(نظام\s+الحكم|القيادة\s+السياسية|الحكومة|الدولة|الملك|ولي\s+العهد|انقلاب|انتفاض|إسقاط|تمرد|قلب\s+نظام|مؤسسات\s+الحكم|الأمن\s+الوطني)/u.test(text);
}

export function hasSexualAnchorContext(text: string): boolean {
  return /(جنسي|جنسية|علاقة\s+جنسية|ممارسة\s+جنسية|تحرش|اغتصاب|إيحاء\s+جنسي|عري|مشهد\s+حميمي|فعل\s+فاضح|ألفاظ\s+جنسية)/u.test(
    text,
  );
}

export function hasViolenceKeywordEvidence(value: string | null | undefined): boolean {
  const text = compactNormalizedEvidence(value);
  if (!text) return false;
  return /(ضرب|أضرب|بضرب|يضر|قتل|أقتل|بقتل|ذبح|طعن|ركل|صفع|دفع|عنف|يعنف|يعنفني|يضربني|بقتلك|جزمة|عصا|مسدس|سكين|دم)/u.test(text);
}

function getSceneContextAtOffset(sceneIndex: VerifierSceneIndexEntry[], fullText: string | null, offset: number | null | undefined): string {
  if (!fullText || !sceneIndex.length || typeof offset !== "number" || offset < 0) return "";
  const scene = sceneIndex.find((entry) => offset >= entry.startOffset && offset < entry.endOffset);
  if (!scene) return "";
  return fullText.slice(scene.startOffset, scene.endOffset);
}

function tokenizeEvidence(value: string | null | undefined): string[] {
  return compactNormalizedEvidence(value).split(/\s+/).filter(Boolean);
}

export function getPassSpecificEvidenceIssue(
  finding: VerifierFinding,
  excerpt: string,
  fullText?: string | null,
  sceneIndex: VerifierSceneIndexEntry[] = [],
): string | null {
  const pass = String(finding.detection_pass ?? "").trim().toLowerCase();
  const atom = String(finding.canonical_atom ?? "").trim().toUpperCase();
  const articleId = finding.article_id ?? 0;
  const source = String(finding.source ?? "ai").trim().toLowerCase();
  const rationale = String(finding.rationale_ar ?? "");
  if (source === "lexicon_mandatory" || source === "manual") return null;

  const sceneContext = getSceneContextAtOffset(sceneIndex, fullText ?? null, finding.start_offset_global ?? null);
  const localContext = `${sceneContext}\n${excerpt}`;

  if (rationale && !hasRationaleLocalSupport(rationale, localContext)) {
    return "unsupported_rationale";
  }

  if ([12, 15, 19, 21, 23].includes(articleId) && !hasDriftProneArticleAnchor(articleId, localContext)) {
    return "ownership_drift";
  }

  if ((pass === "women" || articleId === 7 || atom === "WOMEN") && !hasWomenSpecificEvidence(localContext)) {
    return "women_not_self_proving";
  }

  if (
    (pass === "v3_03_national_security" || pass === "national_security" || articleId === 3 || atom === "NATIONAL_SECURITY") &&
    !hasPoliticalAnchorForClassification(localContext)
  ) {
    return "security_not_self_proving";
  }

  if (
    (pass === "v3_02_political_leadership" || pass === "political_leadership" || articleId === 2 || atom === "POLITICAL_LEADERSHIP") &&
    !hasPoliticalAnchorForClassification(localContext)
  ) {
    return "political_not_self_proving";
  }

  if (
    (pass === "v3_10_explicit_sex" || articleId === 10 || atom === "EXPLICIT_SEX") &&
    !hasSexualAnchorContext(localContext)
  ) {
    return "sexual_not_self_proving";
  }

  const tokenCount = tokenizeEvidence(excerpt).length;
  if ((pass === "violence" || articleId === 9 || atom === "VIOLENCE") && tokenCount === 1 && !hasViolenceKeywordEvidence(excerpt)) {
    return "violence_single_word_non_violent";
  }

  return null;
}
