import fs from 'fs';
const text = fs.readFileSync('job2_fulltext.txt', 'utf-8');

// Map all scenes
const sceneRe = /المشهد (\d+)/g;
let m;
const scenes: Array<{num: number; offset: number}> = [];
while ((m = sceneRe.exec(text)) !== null) {
  scenes.push({ num: parseInt(m[1]), offset: m.index });
}
console.log('=== ALL SCENES IN TEXT ===');
for (const s of scenes) console.log(`  Scene ${s.num} at offset ${s.offset}`);

function getSceneForOffset(offset: number): number | null {
  let scene: number | null = null;
  for (const s of scenes) {
    if (s.offset <= offset) scene = s.num;
  }
  return scene;
}

// Art 16 and 17 findings
const findings = [
  { art: 16, label: 'Art16-ev1', start: 1816, end: 1826, snippet: 'الكذب يمشي' },
  { art: 16, label: 'Art16-ev2', start: 1881, end: 1959 },
  { art: 16, label: 'Art16-ev3', start: 1961, end: 2049 },
  { art: 17, label: 'Art17-ev1', start: 1920, end: 1931, snippet: 'اليوم التالي' },
  { art: 17, label: 'Art17-ev2', start: 1961, end: 2049 },
];

for (const f of findings) {
  const evidenceFromText = text.slice(f.start, f.end);
  const contextFrom = Math.max(0, f.start - 150);
  const ctx = text.slice(contextFrom, f.end + 150);
  const scene = getSceneForOffset(f.start);
  console.log(`\n=== ${f.label} (Art.${f.art}) ===`);
  console.log(`  Falls in: Scene ${scene}`);
  console.log(`  Actual text at offsets [${f.start}-${f.end}]: "${evidenceFromText}"`);
  console.log(`  Context:\n${ctx}\n---`);
}

// Also show what scene 17's content is vs where art17 evidence falls
console.log('\n=== SCENE 17 REGION ===');
const sc17 = scenes.find(s => s.num === 17);
const sc21 = scenes.find(s => s.num === 21);
if (sc17 && sc21) {
  console.log(`Scene 17 runs from offset ${sc17.offset} to ${sc21.offset}`);
  console.log(text.slice(sc17.offset, sc21.offset));
}
