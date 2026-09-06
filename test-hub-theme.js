// اختبار: كلُّ لعبةٍ في الصفحة الرئيسيّة لها لونٌ في سمة المارشميلو.
//
// العطب الذي وُلد منه هذا الملفّ: أضفنا «بالوت» بصنف c-indigo وعرّفناه في
// hub.html وحدَه، وسمةُ المارشميلو (kawaii.css) هي التي تُلوّن البطاقات
// فعلًا — فسقطت البطاقة على الخلفيّة البيضاء الافتراضيّة، ونصُّها أبيضُ،
// فظهرت **فارغةً** في الموقع الحيّ.
//
// فالقاعدة: لكلّ صنف لونٍ يُستعمل في hub.html أربعُ قواعدَ في kawaii.css —
// خلفيّةُ البطاقة، ولونُ الزرّ، وظلُّه، وأيقونتُه. ولو أضفتَ لعبةً غدًا بلا
// إحداها صرخ هذا الاختبار قبل النشر.

const fs = require("fs"), path = require("path");

let P = 0, F = 0;
const ok = (c, m, x) => { c ? P++ : F++; console.log((c ? "  ✅ " : "  ❌ ") + m + (c ? "" : " → " + JSON.stringify(x))); };

const pub = p => path.join(__dirname, "public", p);
const HUB = fs.readFileSync(pub("hub.html"), "utf8");
const KW  = fs.readFileSync(pub("kawaii.css"), "utf8");

console.log("\n═══ ألوان الصفحة الرئيسيّة ═══\n");

/* الألوان المستعملة فعلًا في قائمة الألعاب، لا كلُّ ما عُرّف في CSS */
const used = [...HUB.matchAll(/color:"(c-[a-z]+)"/g)].map(m => m[1]);
ok(used.length >= 6, `${used.length} لعبةً في القائمة`, used);
ok(new Set(used).size === used.length, "ولا لونَ مكرَّرٌ بين لعبتين", used);

console.log("\n── سمة المارشميلو تعرف كلَّ لون ──");
for (const c of used) {
  const esc = c.replace(/-/g, "\\-");
  const has = re => new RegExp(re.replace(/CLS/g, esc)).test(KW);
  ok(has(`\\.g\\.CLS\\s*\\{[^}]*background`), `${c}: خلفيّةُ البطاقة`);
  ok(has(`\\.g\\.CLS\\s+\\.go\\s*\\{[^}]*background:`), `${c}: لونُ الزرّ`);
  ok(has(`\\.g\\.CLS\\s+\\.go\\s*\\{[^}]*box-shadow`), `${c}: ظلُّ الزرّ`);
  ok(has(`\\.g\\.CLS\\s+\\.ic\\s*\\{[^}]*background-image`), `${c}: أيقونتُه`);
}

console.log("\n── ملفّاتُ الأيقونات موجودةٌ فعلًا ──");
const icons = [...KW.matchAll(/\.g\.c-[a-z]+\s+\.ic\s*\{[^}]*background-image:url\("([^"]+)"\)/g)].map(m => m[1]);
ok(icons.length >= used.length, `${icons.length} أيقونةً مُشار إليها`, icons);
for (const src of icons) {
  const f = pub(src.replace(/^\//, ""));
  ok(fs.existsSync(f), "موجود: " + src);
}

console.log("\n── بالوت لها هويّتُها ──");
{
  const m = HUB.match(/key:"baloot"[^}]*}/);
  ok(m, "بالوت في القائمة");
  ok(m && /c-indigo/.test(m[0]), "بلونها النيليّ");
  const others = [...HUB.matchAll(/key:"(\w+)"[\s\S]{0,200}?icon:"(.+?)"/g)].map(x => [x[1], x[2]]);
  const bal = others.find(x => x[0] === "baloot");
  ok(bal, "ولها أيقونة", bal);
  ok(others.filter(x => x[1] === (bal || [])[1]).length === 1, "لا تتشاركها مع غيرها", others);
  /* البستوني في الأيقونة المرسومة، لا في محرفٍ يختلف رسمُه بين الأجهزة */
  const svg = fs.readFileSync(pub("kw-g-baloot.svg"), "utf8");
  ok(/viewBox="0 0 128 128"/.test(svg), "وأيقونتُها بمقاس بقيّة الأيقونات");
  ok(!/<image|xlink:href/.test(svg), "ومرسومةٌ لا مستوردة");
  ok((svg.match(/<rect/g) || []).length >= 2, "وفيها ورقتان على الأقلّ");
}

console.log(`\n═══ ${P} نجحت · ${F} فشلت ═══\n`);
process.exit(F ? 1 : 0);
