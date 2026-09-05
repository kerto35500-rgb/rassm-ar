// اختبار الأصدقاء: طلبٌ يُقبَل أو يُرفَض، وحظرٌ يقطع كلّ شيء.
//
// نصفُه على المخزن مباشرةً (حالاتُ العلاقة)، ونصفُه على HTTP (الأذونات:
// من يطلب، وماذا يرى في البحث، وهل يستطيع ضيفٌ شيئًا).

const http = require("http");
const os = require("os"), path = require("path"), fs = require("fs");
const express = require("express");

let P = 0, F = 0;
const ok = (c, m, x) => { c ? P++ : F++; console.log((c ? "  ✅ " : "  ❌ ") + m + (c ? "" : " → " + JSON.stringify(x))); };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m, { got: a, want: b });

const { createStore } = require("./store");
const { setupFriends } = require("./friends");

(async () => {
  const JsonStore = Object.getPrototypeOf(await createStore()).constructor;
  const file = path.join(os.tmpdir(), "friends-" + Date.now() + ".json");
  const S = new JsonStore(file);
  await S.init();

  /* `createUser` تُرجع المعرّف لا الكائن — فنجلب الكائن بعده */
  const mk = async n => await S.getUserById(await S.createUser(n, "s", "h", {}));
  const A = await mk("أحمد"), Bb = await mk("بدر"), C = await mk("خالد"), D = await mk("داوود");

  console.log("\n═══ الأصدقاء ═══\n");

  console.log("① الحالة الابتدائيّة");
  {
    eq(await S.friendState(A.id, Bb.id), "none", "لا علاقة بين غريبين");
    eq((await S.friendsOf(A.id)).length, 0, "ولا أصدقاء");
    eq((await S.friendRequestsOf(A.id)).length, 0, "ولا طلبات");
  }

  console.log("② الطلب والقبول");
  {
    const r = await S.friendRequest(A.id, Bb.id);
    ok(r.ok && r.state === "sent", "أُرسل طلب", r);
    eq(await S.friendState(A.id, Bb.id), "sent", "فهو مُرسَلٌ عندي");
    eq(await S.friendState(Bb.id, A.id), "incoming", "ووارِدٌ عنده");
    eq((await S.friendsOf(A.id)).length, 0, "ولا صداقةَ بعد");
    eq((await S.friendRequestsOf(Bb.id)).length, 1, "وطلبٌ في قائمته");
    eq((await S.friendSentOf(A.id)).length, 1, "وفي قائمة المُرسَل عندي");

    const dup = await S.friendRequest(A.id, Bb.id);
    ok(!dup.ok, "ولا يُرسَل مرّتين", dup);

    const acc = await S.friendAccept(Bb.id, A.id);
    ok(acc.ok && acc.state === "friends", "قُبل الطلب", acc);
    eq(await S.friendState(A.id, Bb.id), "friends", "فصارا صديقين");
    eq(await S.friendState(Bb.id, A.id), "friends", "من الجهتين");
    eq((await S.friendsOf(A.id)).length, 1, "وفي قائمة كلٍّ منهما");
    eq((await S.friendsOf(Bb.id)).length, 1, "واحد");
    eq((await S.friendRequestsOf(Bb.id)).length, 0, "ولم يبقَ طلب");
    const f = (await S.friendsOf(A.id))[0];
    eq(f.name, "بدر", "والاسم يظهر");
    ok("avatar" in f && "frame" in f, "ومعه صورتُه وبرواز");
  }

  console.log("③ الطلب المقابل قبولٌ");
  {
    await S.friendRequest(C.id, D.id);
    const r = await S.friendRequest(D.id, C.id);
    ok(r.ok && r.state === "friends", "من طلب من طلبه صارا صديقين", r);
    eq(await S.friendState(C.id, D.id), "friends", "بلا انتظار");
    await S.friendRemove(C.id, D.id);
  }

  console.log("④ الرفض والإزالة");
  {
    await S.friendRequest(C.id, A.id);
    eq((await S.friendRequestsOf(A.id)).length, 1, "طلبٌ وارد");
    await S.friendReject(A.id, C.id);
    eq((await S.friendRequestsOf(A.id)).length, 0, "رُفض فاختفى");
    eq(await S.friendState(C.id, A.id), "none", "ولا أثرَ له");

    await S.friendRemove(A.id, Bb.id);
    eq(await S.friendState(A.id, Bb.id), "none", "والإزالة تقطع الصداقة");
    eq((await S.friendsOf(Bb.id)).length, 0, "من الجهتين", (await S.friendsOf(Bb.id)).length);
  }

  console.log("⑤ الحظر");
  {
    await S.friendRequest(A.id, Bb.id);
    await S.friendAccept(Bb.id, A.id);
    eq(await S.friendState(A.id, Bb.id), "friends", "صديقان أوّلًا");

    const b = await S.friendBlock(A.id, Bb.id);
    ok(b.ok, "حظرتُه", b);
    eq(await S.friendState(A.id, Bb.id), "blocked", "فهو محظورٌ عندي");
    eq(await S.friendState(Bb.id, A.id), "blocked-by", "ومحظورٌ هو");
    eq((await S.friendsOf(Bb.id)).length, 0, "وسقطت الصداقة عنده", (await S.friendsOf(Bb.id)).length);
    eq((await S.friendBlockedOf(A.id)).length, 1, "وهو في قائمة محظوريّ");

    const req = await S.friendRequest(Bb.id, A.id);
    ok(!req.ok, "ولا يطلبني المحظور", req);
    ok(!/محظور/.test(req.error || ""), "ولا يُقال له إنّه محظور", req.error);

    await S.friendUnblock(A.id, Bb.id);
    eq(await S.friendState(A.id, Bb.id), "none", "ورفعُ الحظر يُعيدهما غريبين");
    const req2 = await S.friendRequest(Bb.id, A.id);
    ok(req2.ok, "فيستطيع أن يطلب", req2);
  }

  console.log("⑥ الحدود");
  {
    const self = await S.friendRequest(A.id, A.id);
    ok(!self.ok, "لا يُصادق أحدٌ نفسه", self);
    const none = await S.friendRequest(0, Bb.id);
    ok(!none.ok, "ولا طلبَ بلا مُرسِل", none);
    const cap = await S.friendRequest(C.id, D.id, 0);
    ok(!cap.ok && /حدّ/.test(cap.error), "والحدُّ الأقصى يُحترَم", cap);
  }

  /* ─────────── HTTP ─────────── */
  console.log("⑦ المسارات والأذونات");
  {
    const app = express();
    let CUR = null;
    setupFriends(app, { get store() { return S; }, currentUser: async () => CUR });
    const srv = app.listen(0);
    const port = srv.address().port;
    const call = (method, p, body) => new Promise(res => {
      const data = body ? JSON.stringify(body) : null;
      /* المسار قد يحمل عربيّةً في `q` — يُرمَّز وإلا رفضته وحدة http */
      const r = http.request({ host: "127.0.0.1", port, path: encodeURI(p), method,
        headers: data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {} },
        s => { let b = ""; s.on("data", c => b += c); s.on("end", () => { try { res({ code: s.statusCode, j: JSON.parse(b) }); } catch (e) { res({ code: s.statusCode, j: null }); } }); });
      r.on("error", () => res({ code: 0, j: null }));
      if (data) r.write(data);
      r.end();
    });

    CUR = null;
    let r = await call("GET", "/api/friends");
    eq(r.code, 401, "الضيف لا يرى قائمة أصدقاء");
    r = await call("POST", "/api/friends/request", { id: Bb.id });
    eq(r.code, 401, "ولا يطلب صداقة");

    CUR = A;
    r = await call("GET", "/api/friends");
    ok(r.j && r.j.ok, "والمسجَّل يرى قائمته", r.j && r.j.ok);
    ok(Array.isArray(r.j.friends) && Array.isArray(r.j.incoming), "وفيها الأصدقاء والطلبات");

    r = await call("POST", "/api/friends/request", { id: A.id });
    ok(!r.j.ok && /نفسك/.test(r.j.error), "ولا يُصادق نفسه", r.j);

    r = await call("POST", "/api/friends/request", { id: 999999 });
    eq(r.code, 404, "ولا لاعبًا لا وجود له");

    r = await call("GET", "/api/friends/search?q=ب");
    eq(r.j.list.length, 0, "والبحث بحرفٍ واحدٍ لا يُرجع شيئًا");

    r = await call("GET", "/api/friends/search?q=بدر");
    ok(r.j.ok && r.j.list.length >= 1, "وبحرفين فأكثر يُرجع", r.j.list);
    ok(!r.j.list.some(x => x.id === A.id), "ولا يُرجعني لنفسي");
    ok(r.j.list.every(x => !("email" in x)), "ولا يكشف بريدًا", r.j.list[0]);
    ok(r.j.list.every(x => typeof x.state === "string"), "ويُبيّن حالة العلاقة");

    /* من حظرني لا أراه */
    await S.friendBlock(C.id, A.id);
    r = await call("GET", "/api/friends/search?q=خالد");
    ok(!r.j.list.some(x => x.id === C.id), "ومن حظرني لا يظهر لي في البحث", r.j.list);
    await S.friendUnblock(C.id, A.id);

    srv.close();
  }

  try { fs.unlinkSync(file); } catch (e) {}
  console.log(`\n═══ ${P} نجحت · ${F} فشلت ═══\n`);
  process.exit(F ? 1 : 0);
})();
