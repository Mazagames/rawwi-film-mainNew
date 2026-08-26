import type { NoteCategoryKey } from '@/api/models';

export const NOTE_CATEGORY_LABELS: Array<{ key: NoteCategoryKey; labelAr: string; labelEn: string }> = [
  { key: 'article_01', labelAr: 'الإساءة إلى الذات الإلهية والدين', labelEn: 'Article 01' },
  { key: 'article_02', labelAr: 'القيادة السياسية ورموز الدولة', labelEn: 'Article 02' },
  { key: 'article_03', labelAr: 'الإرهاب والتطرف', labelEn: 'Article 03' },
  { key: 'article_04', labelAr: 'المخدرات والكحول', labelEn: 'Article 04' },
  { key: 'article_05', labelAr: 'العنف والقتل والتعذيب', labelEn: 'Article 05' },
  { key: 'article_12', labelAr: 'حماية الأطفال والقُصّر', labelEn: 'Article 12' },
  { key: 'article_14', labelAr: 'الألفاظ النابية والإهانات', labelEn: 'Article 14' },
  { key: 'article_06', labelAr: 'الانتحار وإيذاء النفس', labelEn: 'Article 06' },
  { key: 'article_07', labelAr: 'المحتوى الجنسي والعري', labelEn: 'Article 07' },
  { key: 'article_08', labelAr: 'السحر والشعوذة', labelEn: 'Article 08' },
  { key: 'article_09', labelAr: 'الجرائم وتقنياتها', labelEn: 'Article 09' },
  { key: 'article_10', labelAr: 'خطاب الكراهية والتمييز', labelEn: 'Article 10' },
  { key: 'article_11', labelAr: 'المصداقية الإعلامية', labelEn: 'Article 11' },
  { key: 'article_13', labelAr: 'المعلومات الطبية والصحية', labelEn: 'Article 13' },
  { key: 'security_scenes', labelAr: 'مشاهد أمنية', labelEn: 'Security Scenes' },
  { key: 'saudi_names', labelAr: 'أسماء سعودية', labelEn: 'Saudi Names' },
  { key: 'commercial_entities', labelAr: 'كيانات تجارية', labelEn: 'Commercial Entities' },
  { key: 'medical_notes', labelAr: 'ملاحظات طبية', labelEn: 'Medical Notes' },
  { key: 'media_credibility', labelAr: 'مصداقية الوسائط', labelEn: 'Media Credibility' },
  { key: 'classified_documents', labelAr: 'وثائق مصنفة', labelEn: 'Classified Documents' },
  { key: 'religious_content', labelAr: 'محتوى ديني / مذهبي حساس', labelEn: 'Religious Content' },
  { key: 'article_15', labelAr: 'النظام العام', labelEn: 'Article 15' },
  { key: 'article_16', labelAr: 'الشائعات والمعلومات المضللة', labelEn: 'Article 16' },
  { key: 'article_17', labelAr: 'الكرامة والسمعة والخصوصية', labelEn: 'Article 17' },
  { key: 'article_18', labelAr: 'العلاقات الدولية', labelEn: 'Article 18' },
  { key: 'article_19', labelAr: 'الاقتصاد والاستقرار المالي', labelEn: 'Article 19' },
  { key: 'article_20', labelAr: 'الإفلاس والقضايا التجارية', labelEn: 'Article 20' },
  { key: 'article_21', labelAr: 'الوثائق السرية', labelEn: 'Article 21' },
  { key: 'article_22', labelAr: 'الاتفاقيات والمعاهدات', labelEn: 'Article 22' },
  { key: 'article_23', labelAr: 'المظهر العام', labelEn: 'Article 23' },
  { key: 'article_24', labelAr: 'الزي والاحتشام', labelEn: 'Article 24' },
];

export function getNoteCategoryLabel(category: string | undefined | null, lang: 'ar' | 'en' = 'ar'): string {
  const match = NOTE_CATEGORY_LABELS.find((item) => item.key === category);
  return match ? (lang === 'ar' ? match.labelAr : match.labelEn) : (category ?? '');
}

export const NOTE_CATEGORY_ORDER = NOTE_CATEGORY_LABELS;
export const NOTE_CATEGORY_KEYS = NOTE_CATEGORY_ORDER.map((item) => item.key);
