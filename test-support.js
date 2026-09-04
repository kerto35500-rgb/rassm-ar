// اختبار الدعم: التذكرة محادثة، والصور تُفحَص، والخصوصيّة تُصان.
//
// أهمّ ما هنا ليس أن الإرسال يعمل، بل أن لاعبًا لا يقرأ تذكرة غيره ولا
// صورَه — وأن ملفًّا يدّعي أنه صورة يُردّ.

process.env.ADMIN_USER = "t-admin";
process.env.ADMIN_PASS = "كلمة أدمن طويلة للاختبار";
process.env.ADMIN_PATH = "/t-sup-" + Math.random().toString(36).slice(2, 8);
process.env.PORT = process.env.PORT || "3741";

const http = require("http");
require("./server");
const { decodeImage } = require("./support");

const AP = process.env.ADMIN_PATH, PORT = +process.env.PORT;
const A_NAME = "شاكي" + Date.now().toString(36);
const B_NAME = "فضولي" + Date.now().toString(36);
let P = 0, F = 0;
const ok = (c, m, x) => { c ? P++ : F++; console.log((c ? "  ✅ " : "  ❌ ") + m + (c ? "" : " → " + JSON.stringify(x))); };

/* صورة PNG صغيرة صحيحة (١×١ شفّافة) */
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
/* بايتات ليست صورة، لكن ترويستها تدّعي أنها PNG */
const FAKE = "data:image/png;base64," + Buffer.from("MZ\x90\x00 this is not a picture").toString("base64");

function req(method, p, body, cookie) {
  return new Promise(res => {
    const data = body == null ? null : (typeof body === "string" ? body : JSON.stringify(body));
    const h = { Cookie: cookie || "" };
    if (data) {
      h["Content-Type"] = typeof body === "string" ? "application/x-www-form-urlencoded" : "application/json";
      h["Content-Length"] = Buffer.byteLength(data);
    }
    const r = http.request({ host: "127.0.0.1", port: PORT, path: p, method, timeout: 9000, headers: h }, x => {
      const chunks = [];
      x.on("data", d => chunks.push(d));
      x.on("end", () => {
        const buf = Buffer.concat(chunks);
        let j = null; try { j = JSON.parse(buf.toString()); } catch (e) {}
        res({ code: x.statusCode, json: j, body: buf.toString(), buf,
              type: x.headers["content-type"] || "",
              cookies: x.headers["set-cookie"] || [] });
      });
    });
    r.on("error", e => res({ code: 0, err: e.message }));
    r.on("timeout", () => { r.destroy(); res({ code: 0 }); });
    if (data) r.write(data);
    r.end();
  });
}
const cookiesOf = r => r.cookies.map(c => c.split(";")[0]).join("; ");

setTimeout(async () => {
  console.log("\n═══ الدعم والإبلاغ ═══\n");

  console.log("① فحص الصور قبل أيّ شبكة");
  ok(!!decodeImage(PNG), "صورةٌ صحيحة تُقبَل");
  ok(!decodeImage(FAKE), "وبايتاتٌ تدّعي أنها PNG تُردّ (نفحص التوقيع لا الترويسة)");
  ok(!decodeImage("data:text/html;base64,PHNjcmlwdD4="), "وmime غير مسموح يُردّ");
  ok(!decodeImage("data:image/png;base64,!!!!"), "وbase64 معطوب يُردّ");
  ok(!decodeImage("https://example.com/a.png"), "ورابطٌ خارجيّ يُردّ");
  ok(!decodeImage("data:image/png;base64," + "A".repeat(2e6)), "وصورةٌ ضخمة تُردّ");

  console.log("\n② الصفحة والفئات");
  let r = await req("GET", "/support");
  ok(r.code === 200 && /sp-wrap/.test(r.body), "‎/support‎ تُقدَّم", r.code);
  ok(!/class="card"|class="btn"/.test(r.body), "بلا أصنافٍ تصطدم بـkawaii.css");
  r = await req("GET", "/api/support/kinds");
  ok(r.json.ok && Object.keys(r.json.kinds).length >= 4, "الفئات تُعرَض", r.json);

  console.log("\n③ الضيف يُبلّغ");
  r = await req("POST", "/api/support/new",
    { kind: "report", subject: "لاعبٌ مزعج", body: "يكتب كلامًا سيّئًا في غرفة ٤٤", images: [PNG] }, "");
  ok(r.json.ok && r.json.guest === true && r.json.images === 1, "بلاغ الضيف وصل بصورته", r.json);
  const GID = r.json.id;
  r = await req("GET", "/api/support/mine", null, "");
  ok(r.json.guest && r.json.tickets.length === 0, "لكنه لا يرى خيطًا", r.json);
  r = await req("GET", "/api/support/t/" + GID, null, "");
  ok(r.code === 401, "ولا يفتح تذكرته بلا حساب", r.code);

  console.log("\n④ الحقول الناقصة");
  for (const [b, why] of [[{ subject: "أ", body: "تفاصيل كافية هنا" }, "عنوانٌ قصير"],
                          [{ subject: "عنوان جيّد", body: "قصير" }, "متنٌ قصير"],
                          [{ subject: "", body: "" }, "فارغٌ تمامًا"]]) {
    r = await req("POST", "/api/support/new", b, "");
    ok(r.code === 400, why + " يُرفَض", r.code);
  }

  console.log("\n⑤ المسجَّل: تذكرةٌ هي محادثة");
  r = await req("POST", "/api/account/register", { name: A_NAME, pass: "كلمة سرّ طويلة" }, "");
  const CA = cookiesOf(r);
  ok(r.code === 200, "سُجّل «أ»", r.json);
  r = await req("POST", "/api/support/new",
    { kind: "buy", subject: "ذهبي ما وصل", body: "لعبتُ مباراةً وربحت ولم يزد رصيدي", images: [PNG, PNG, FAKE] }, CA);
  ok(r.json.ok && !r.json.guest, "فُتحت تذكرته", r.json);
  ok(r.json.images === 2, "الصورتان الصحيحتان حُفظتا والفاسدة سقطت وحدها", r.json);
  const TID = r.json.id;
  r = await req("GET", "/api/support/mine", null, CA);
  ok(r.json.tickets.length === 1 && r.json.tickets[0].id === TID, "ويراها في قائمته", r.json.tickets);
  r = await req("GET", "/api/support/t/" + TID, null, CA);
  ok(r.json.ok && r.json.ticket.messages.length === 1, "والخيط يفتح", r.json.error);
  ok(r.json.ticket.status === "open", "حالتها «مفتوحة»", r.json.ticket.status);
  const IMG = r.json.ticket.messages[0].images[0];

  console.log("\n⑥ لا أحد يقرأ تذكرة غيره");
  r = await req("POST", "/api/account/register", { name: B_NAME, pass: "كلمة سرّ طويلة" }, "");
  const CB = cookiesOf(r);
  r = await req("GET", "/api/support/t/" + TID, null, CB);
  ok(r.code === 404, "«ب» لا يفتح تذكرة «أ» — ٤٠٤ لا ٤٠٣ (لا نؤكّد وجودها)", r.code);
  r = await req("POST", "/api/support/t/" + TID + "/reply", { body: "أنا أتطفّل" }, CB);
  ok(r.code === 404, "ولا يردّ فيها", r.code);
  r = await req("GET", "/api/support/img/" + IMG, null, CB);
  ok(r.code === 403, "ولا يرى صورتها", r.code);
  r = await req("GET", "/api/support/img/" + IMG, null, "");
  ok(r.code === 403, "ولا الضيف", r.code);
  r = await req("GET", "/api/support/img/" + IMG, null, CA);
  ok(r.code === 200 && /^image\//.test(r.type), "وصاحبها يراها", r.code + " " + r.type);
  ok(r.buf.length > 20 && r.buf[0] === 0x89, "وهي صورةٌ فعلًا لا نصّ", r.buf.length);
  r = await req("GET", "/api/support/img/" + encodeURIComponent("tkt_1_ملفّق_0"), null, CA);
  ok(r.code === 403 || r.code === 404, "ومفتاحٌ مُخمَّن لا يُقدَّم", r.code);

  console.log("\n⑦ الإدارة تردّ، والحالة تتبع آخر متكلّم");
  r = await req("POST", AP, "u=" + encodeURIComponent(process.env.ADMIN_USER) +
                            "&p=" + encodeURIComponent(process.env.ADMIN_PASS), "");
  const ADM = cookiesOf(r);
  r = await req("GET", AP + "/p/tickets?status=open", null, "");
  ok(r.code === 403, "قائمة التذاكر محميّة", r.code);
  r = await req("GET", AP + "/p/tickets?status=all", null, ADM);
  ok(r.json.ok && r.json.tickets.length >= 2, "والإدارة ترى تذاكر الجميع", r.json.tickets && r.json.tickets.length);
  ok(r.json.tickets.some(t => t.id === GID && !t.userId), "بما فيها تذكرة الضيف");

  r = await req("POST", AP + "/p/ticket/" + TID + "/reply", { body: "راجعنا حسابك وأضفنا لك الذهب." }, ADM);
  ok(r.json.ok, "رددنا", r.json);
  r = await req("GET", "/api/support/t/" + TID, null, CA);
  ok(r.json.ticket.status === "answered", "فصارت «أجبنا»", r.json.ticket.status);
  ok(r.json.ticket.messages.length === 2 && r.json.ticket.messages[1].fromAdmin, "والردّ يظهر له", r.json.ticket.messages.length);

  r = await req("POST", "/api/support/t/" + TID + "/reply", { body: "شكرًا، لكن المشكلة تكرّرت" }, CA);
  ok(r.json.ok, "ردّ صاحبها");
  r = await req("GET", "/api/support/t/" + TID, null, CA);
  ok(r.json.ticket.status === "open", "فعادت «مفتوحة»", r.json.ticket.status);

  r = await req("POST", AP + "/p/ticket/" + TID + "/status", { status: "closed" }, ADM);
  r = await req("POST", "/api/support/t/" + TID + "/reply", { body: "لا زالت قائمة!" }, CA);
  ok(r.json.ok, "ويردّ حتى بعد الإغلاق");
  r = await req("GET", "/api/support/t/" + TID, null, CA);
  ok(r.json.ticket.status === "open", "فإغلاقٌ يُسكِت صاحب المشكلة ليس إغلاقًا", r.json.ticket.status);
  r = await req("POST", AP + "/p/ticket/" + TID + "/status", { status: "خربشة" }, ADM);
  ok(r.code === 400, "وحالةٌ مجهولة تُرفَض", r.code);

  console.log("\n⑧ بلاغات الغرف");
  r = await req("GET", AP + "/p/reports", null, "");
  ok(r.code === 403, "محميّة كذلك", r.code);
  r = await req("GET", AP + "/p/reports", null, ADM);
  ok(r.json.ok && Array.isArray(r.json.reports), "وتُقرأ الآن — كانت تُجمَع ولا يراها أحد", r.json);

  console.log("\n⑨ حذف الحساب");
  const uid = (await req("GET", AP + "/p/users?q=" + encodeURIComponent(B_NAME), null, ADM))
                .json.users.find(u => u.name === B_NAME).id;
  r = await req("POST", AP + "/p/delete-user", { id: uid, confirm: "اسم خاطئ" }, ADM);
  ok(r.code === 400, "بلا كتابة الاسم لا حذف", r.code);
  r = await req("GET", AP + "/p/user/" + uid, null, ADM);
  ok(r.json.ok, "والحساب باقٍ بعد المحاولة");
  r = await req("POST", AP + "/p/delete-user", { id: uid, confirm: B_NAME }, ADM);
  ok(r.json.ok && r.json.summary.name === B_NAME, "وبالاسم يُحذف مع ملخّصه", r.json);
  r = await req("GET", AP + "/p/user/" + uid, null, ADM);
  ok(r.code === 404, "فلا يبقى له أثر", r.code);
  r = await req("POST", "/api/account/login", { name: B_NAME, pass: "كلمة سرّ طويلة" }, "");
  ok(r.code === 401, "ولا يدخل باسمه", r.code);
  r = await req("GET", AP + "/p/audit", null, ADM);
  const acts = r.json.log.map(x => x.action);
  ok(acts.includes("delete-user"), "والحذف مسجَّل", acts.slice(0, 6));
  ok(acts.includes("delete-blocked"), "وحتى المحاولة المرفوضة", acts.slice(0, 6));
  ok(acts.includes("ticket-reply"), "وردّ التذكرة", acts.slice(0, 6));

  console.log(`\n═══ ${P} نجحت · ${F} فشلت ═══\n`);
  process.exit(F ? 1 : 0);
}, 2600);
