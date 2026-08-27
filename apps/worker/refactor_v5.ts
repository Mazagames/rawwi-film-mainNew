import * as fs from 'fs';
import * as path from 'path';

const dir = 'reviewers/v5';
const files = fs.readdirSync(dir).filter(f => f.startsWith('article_') && f.endsWith('.md'));

let changedCount = 0;

for (const file of files) {
  const filePath = path.join(dir, file);
  let content = fs.readFileSync(filePath, 'utf8');
  let originalContent = content;

  // 1. Rewrite Type B (Reviewer Identity / Runtime Contract / Decision Principle)
  if (content.includes('# Reviewer Identity')) {
    // Identity
    content = content.replace(/أنت المراجع الرسمي للمادة \(\d+\) الخاصة بـ?[^\n]+/, (match) => {
      return match.replace("أنت المراجع الرسمي", "أنت كشاف أحداث (Event Detector) مختص بالبحث عن أي أحداث قد تندرج تحت") + "\n\nهذه ليست مراجعة نهائية، ولا تتطلب منك إثبات المخالفة. مهمتك هي الاستخراج الشامل (High Recall) وتوفير المرشحين للمراجع النهائي.";
    });
    content = content.replace(/ولا تقوم بمراجعة أي مادة أخرى من مواد GCAM\.\s+إذا كان الحدث يخص مادة أخرى، فتجاهله\./g, "");

    // Runtime Contract
    content = content.replace(/لكل حدث:\s+- صفر مخالفة\.\s+- أو مخالفة واحدة فقط\./g, "قيّم كل حدث (StructuredEvent) بشكل مستقل.\n\nاستخرج جميع الأحداث المرتبطة دون استثناء.\n\nحافظ على توثيق كل حدث (event_id) بشكل منفصل لتسهيل التتبع.");
    content = content.replace(/إذا لم يكن الحدث يندرج تحت المادة \(\d+\)، فتجاهله\./g, "لا تستبعد أي حدث لمجرد أنك تعتقد أنه يتبع مادة أخرى. استخرج الحدث دائمًا إذا كان يحتوي على أي إشارة للمادة.");
    content = content.replace(/الدليل الوحيد المقبول هو \*\*quote\*\*\./g, "استخرج الاقتباس (quote) كما هو كدليل للحدث.");

    // Decision Principle
    content = content.replace(/بحيث تكون المادة \(\d+\) هي المالك الأساسي لهذا الحدث\؟/g, "؟");
    content = content.replace(/إذا كانت الإجابة لا، أو كان الحدث يخص مادة أخرى بصورة أوضح، أو كانت الإجابة غير مؤكدة، فتجاهله\./g, "إذا كانت الإجابة لا، تجاهله.");
    content = content.replace(/لا تسجل مخالفة إلا إذا كان الحدث نفسه يتضمن[\s\S]*?(?=\n#|$)/g, (match) => {
      return match.replace(/لا تسجل مخالفة/g, "لا تستبعد الحدث").replace(/إلا إذا كان الحدث نفسه/g, "واستخرجه كمرشح إذا كان");
    });
    content = content.replace(/لا تسجل مخالفة/g, "لا تستبعد الحدث");
  } 
  // 2. Rewrite Type A (Scope / Violation Criteria / Exceptions / Evidence Requirements / Output Constraints)
  else if (content.includes('# Scope')) {
    // Scope
    content = content.replace(/أنت المراجع الرسمي للمادة \(\d+\) الخاصة بـ?[^\n]+/, (match) => {
      return match.replace("أنت المراجع الرسمي", "أنت كشاف أحداث (Event Detector) مختص بالبحث عن أي أحداث قد تندرج تحت") + "\n\nهذه ليست مراجعة نهائية، ولا تتطلب منك إثبات المخالفة. مهمتك هي الاستخراج الشامل (High Recall) وتوفير المرشحين للمراجع النهائي.";
    });

    // Violation Criteria -> Detection Criteria
    content = content.replace(/# Violation Criteria/g, "# Detection Criteria");
    content = content.replace(/يعتبر الحدث مخالفاً.*?إذا ثبت من الاقتباس.*?(:)/, "استخرج أي حدث يتضمن شبهة، تلويحاً، أو إشارة مباشرة أو غير مباشرة لما يلي$1");
    content = content.replace(/سجل مخالفة للمادة.*?(إذا ثبت من الاقتباس).*?(:)/, "استخرج الحدث كمرشح $1$2");

    // Remove Exceptions
    content = content.replace(/# Exceptions \(Boundaries & Exclusions\)[\s\S]*?(?=# Evidence Requirements)/g, "");

    // Evidence Requirements
    content = content.replace(/الدليل الوحيد المقبول هو حقل `quote`.*?دون حذف ما يغير معناها\./g, "استخرج الاقتباس (quote) كما هو كدليل للحدث.");
    
    // Output Constraints
    content = content.replace(/# Output Constraints[\s\S]*?(?=\n#|$)/, 
      "# Output Constraints\n" +
      "- قيّم كل حدث (StructuredEvent) بشكل مستقل.\n" +
      "- استخرج جميع الأحداث المرتبطة دون استثناء.\n" +
      "- لا تستبعد أي حدث لمجرد أنك تعتقد أنه يتبع مادة أخرى. استخرج الحدث دائمًا إذا كان يحتوي على أي إشارة للمادة.\n" +
      "- حافظ على توثيق كل حدث (event_id) بشكل منفصل لتسهيل التتبع."
    );
  }

  // General fixes
  content = content.replace(/صفر مخالفة/g, "تجاهل الحدث");
  content = content.replace(/مخالفة/g, "مرشح (Candidate)");

  if (content !== originalContent) {
    fs.writeFileSync(filePath, content, 'utf8');
    changedCount++;
  }
}

console.log(`Changed ${changedCount} files.`);
