import assert from "node:assert/strict";
import { V4_SUBJECT_DEFINITIONS, buildV4SubjectPromptSection } from "./v4PromptPack.js";

const subject = V4_SUBJECT_DEFINITIONS.find((item) => item.name === "v4_01_religious_fundamentals");
assert.ok(subject, "Article 01 V4 violation subject must exist");

const prompt = buildV4SubjectPromptSection(subject);

for (const required of [
  "أنت مراجع مخالفات صارم",
  "إهانة أو سخرية أو ازدراء أو تحقير",
  "من أو ما الهدف الديني المحمي تحديداً؟",
  "لا تنسخ مرشحاً من مراجع الملاحظات",
  "بعض الروايات محل نقاش بين المؤرخين وأهل العلم",
  "إذا تعذر إثبات أي عنصر من هذه العناصر من المقتطف نفسه، فأعد findings فارغة",
]) {
  assert.ok(prompt.includes(required), `Article 01 violation prompt must include: ${required}`);
}

for (const excluded of [
  "اقتباس آية أو حديث أو قراءة القرآن",
  "مناقشة أو تفسير آية أو رواية أو ممارسة دينية",
  "حوار تاريخي أو أكاديمي أو تعليمي أو لاهوتي",
  "نقد فكرة أو تفسير دون إهانة أو تحقير",
]) {
  assert.ok(prompt.includes(excluded), `Article 01 violation prompt must reject: ${excluded}`);
}

assert.ok(prompt.includes("الدليل يجب أن يأتي من المقتطف الحالي فقط"));
console.log("✓ Article 01 violation prompt enforces strict target and evidence boundaries");
