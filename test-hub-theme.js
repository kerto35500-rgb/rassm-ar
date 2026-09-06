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

console.log("\n── نزولُ الورقة على الطاولة بلا قفزة ──");
{
  /* العطب: الورقةُ الطائرة تُقاس بـ`getBoundingClientRect` للخانة، وهو
     الصندوقُ المحاذي للمحاور — أكبرُ من الورقة بدورانها وأقصرُ منها بميل
     الطاولة (١٢٦×١٩٥ صارت ١٧٠×١٤٦ في الخانة اليسرى). فتصل الورقةُ بمقاسٍ
     وزاويةٍ غيرِ اللذين ستُرسَم بهما، ثمّ تُستبدَل في إطارٍ واحد ⇒ قلتشة. */
  const AR = fs.readFileSync(pub("baloot/arena.js"), "utf8");
  const BL = fs.readFileSync(pub("baloot/index.html"), "utf8");
  ok(/function cardBox\(el\)/.test(AR), "ثمّة قياسٌ بمقاس الورقة لا بصندوقها");
  ok(/el\.offsetWidth/.test(AR), "يعتمد مقاسَ التخطيط");
  ok(/function elRot\(el\)/.test(AR), "وقراءةٌ لزاوية الخانة من تحويلها");
  ok(/--tilt/.test(BL) && /getPropertyValue\("--tilt"\)/.test(AR),
     "وميلُ الطاولة متغيّرٌ واحدٌ يقرؤه CSS والسكربت معًا");
  ok(/rotateX\(var\(--tilt\)\)/.test(BL), "والطاولةُ تميل به");

  const fp = (AR.match(/async function flyPlay[\s\S]*?\n}/) || [""])[0];
  ok(/cardBox\(slot\)/.test(fp), "ولعبُ الورقة يهبط على مقاس الورقة", fp.slice(0, 60));
  ok(/rotTo: elRot\(slot\)/.test(fp), "بزاوية خانتها");
  ok(/tiltTo: tableTilt\(\)/.test(fp), "وميلِ الطاولة");
  ok(!/rot:\s*true/.test(fp), "ولا زاويةَ عشوائيّةٌ تُخالف الخانة");
  ok(/handoff\(/.test(fp), "ثمّ تُسلَّم بذوبانٍ لا باستبدالٍ مفاجئ");
  ok(/hold: true/.test(fp), "فتبقى الطائرةُ لحظةً بعد الوصول");

  /* والذوبانُ على الطائرة وحدَها. لو أذبنا المستقرّةَ معها لخفتت الورقةُ
     إلى ٧٥٪ في منتصف الطريق — شفّافان فوق بعضهما لا يجمعان واحدًا — ويُرى
     ذلك وميضًا. وقعنا فيه مرّةً، فليصرخ الاختبارُ إن عاد. */
  const ho = (AR.match(/function handoff\([\s\S]*?\n}/) || [""])[0];
  ok(/fly\.animate/.test(ho), "الطائرةُ تذوب", ho.slice(0, 60));
  ok(!/laid\.animate/.test(ho), "والمستقرّةُ لا تُمَسّ — لا وميضَ في المنتصف");
  ok(/fill:\s*"forwards"/.test(ho), "ولا ترتدّ عاتمةً قبل أن تُحذَف");
  ok(/onfinish/.test(ho) && /setTimeout/.test(ho), "وتُحذَف بانتهاء الحركة، ولها صمّامٌ زمنيّ");
}

console.log("\n── قوائمُ بالوت تتناسق مع بطاقتها في الرئيسيّة ──");
{
  const BL = fs.readFileSync(pub("baloot/index.html"), "utf8");
  ok(/--menu1:\s*#[0-9A-Fa-f]{6}/.test(BL), "ثمّة متغيّراتُ لونٍ للقوائم مستقلّةٌ عن الجوخ");
  const app = (BL.match(/#app\{[^}]*\}/) || [""])[0];
  ok(/var\(--menu1\)/.test(app), "وخلفيّةُ الواجهة منها", app.slice(-90));
  ok(!/var\(--felt/.test(app), "لا من ألوان الجوخ الأخضر");
  ok(/--felt1:\s*#9adcbe/.test(BL), "والجوخُ باقٍ لأنّه الساحةُ الافتراضيّة لا الواجهة");

  /* التناسق: لونُ القوائم يجب أن يكون **أزرق** كبطاقة بالوت في الرئيسيّة
     (الأزرقُ أعلى قناةً من الأحمر والأخضر)، لا أخضرَ كما كان. */
  const hex = h => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16));
  const menu2 = (BL.match(/--menu2:\s*(#[0-9A-Fa-f]{6})/) || [])[1];
  ok(menu2, "للقوائم لونٌ أوسط", menu2);
  const [r, g, b] = hex(menu2);
  ok(b > g && b > r, "وهو أزرقُ الغلبة لا أخضر", { r, g, b });

  const card = (KW.match(/\.g\.c-indigo\s*\{[^}]*\}/) || [""])[0];
  const cardBlue = (card.match(/#([0-9A-Fa-f]{6})/g) || [])[1];
  ok(cardBlue, "ولبطاقة بالوت لونُها", cardBlue);
  const [r2, g2, b2] = hex(cardBlue);
  /* لا نشترط التطابق — نشترط القرابة: فرقٌ صغيرٌ في كلّ قناة */
  const near = Math.abs(r - r2) < 60 && Math.abs(g - g2) < 60 && Math.abs(b - b2) < 60;
  ok(near, "واللونان من عائلةٍ واحدة — لا قفزةَ بين الصفحتين", { menu2, cardBlue });
}

console.log(`\n═══ ${P} نجحت · ${F} فشلت ═══\n`);
process.exit(F ? 1 : 0);
