/* ═══════════════════════════════════════════════════════════════════
   moderation.js — نظام إشراف مشترك لكل ألعاب الموقع
   ═══════════════════════════════════════════════════════════════════
   يُستعمل من أي لعبة بسطر واحد داخل معالج الاتصال:

     const mod = require("./moderation");
     mod.attach(nsp, socket, {
       getRoom:    () => room,        // الغرفة الحالية لهذا الاتصال
       getPlayer:  () => player,      // اللاعب الحالي
       broadcast,                     // (room) => بث الحالة
       sys,                           // (room, text, cls) => رسالة نظام
       onRemoved:  (room) => {}       // اختياري: بعد إخراج لاعب (لإنهاء جولة مثلاً)
     });

   ما يوفّره:
   • kick        — المضيف يطرد لاعباً (يقدر يرجع بنفسه)
   • ban         — المضيف يحظر لاعباً من هذه الغرفة (ما يقدر يرجع لها)
   • votekick    — أي لاعب يبدأ تصويت طرد، والأغلبية تنفّذه
   • report      — بلاغ يُخزَّن للمراجعة في لوحة الأدمن

   الكتم (mute) محلي بالكامل في متصفح كل لاعب — لا يمر بالخادم إطلاقاً،
   لأن معناه «أنا لا أريد رؤية دردشة هذا الشخص» ولا يخص بقية اللاعبين.
   ══════════════════════════════════════════════════════════════════ */

"use strict";

const VOTE_MS = 45000;        // مهلة التصويت
const REPORTS_MAX = 500;      // آخر ٥٠٠ بلاغ تُحفظ في الذاكرة

const REASONS = {
  bad:  "رسائل أو رسومات غير لائقة",
  spam: "إزعاج ورسائل مكررة",
  cheat:"غش أو استخدام بوت"
};

/* بنك البلاغات — تقرأه لوحة الأدمن.
   كان في الذاكرة وحدها: يُجمَع البلاغ ثم يضيع مع أوّل إعادة تشغيل، ولا
   يقرؤه أحد. الآن يُسلَّم لِـsink يحفظه، ويُحمَّل عند الإقلاع. */
let reports = [];
let sink = null;
function setSink(fn) { sink = typeof fn === "function" ? fn : null; }
function loadReports(arr) {
  if (Array.isArray(arr)) reports = arr.slice(0, REPORTS_MAX);
  return reports.length;
}
function addReport(rec) {
  reports.unshift(rec);
  if (reports.length > REPORTS_MAX) reports.length = REPORTS_MAX;
  if (sink) { try { sink(reports); } catch (e) { /* الحفظ لا يُسقط الإشراف */ } }
}
function listReports() { return reports.slice(); }
function clearReports() { reports.length = 0; if (sink) { try { sink(reports); } catch (e) {} } }
function removeReport(id) {
  const n = reports.length;
  reports = reports.filter(r => String(r.id) !== String(id));
  if (reports.length !== n && sink) { try { sink(reports); } catch (e) {} }
  return n - reports.length;
}

/* المحظورون محفوظون داخل الغرفة نفسها: تنتهي الغرفة ⇒ ينتهي الحظر */
function banList(room) {
  if (!room._bans) room._bans = new Set();
  return room._bans;
}
/* بصمة اللاعب: التوكن يميّز الجلسة، والاسم يمنع العودة باسم جديد لنفس الجلسة */
function stamp(p) { return [p.token, String(p.name || "").trim().toLowerCase()]; }

function isBanned(room, { token, name } = {}) {
  const b = banList(room);
  if (token && b.has("t:" + token)) return true;
  const n = String(name || "").trim().toLowerCase();
  if (n && b.has("n:" + n)) return true;
  return false;
}

function attach(nsp, socket, ctx) {
  const { getRoom, getPlayer, broadcast, sys, onRemoved } = ctx;
  const isOwner = () => {
    const r = getRoom(), p = getPlayer();
    return !!(r && p && r.ownerId === p.id);
  };
  const target = (id) => {
    const r = getRoom();
    return r ? r.players.find(p => p.id === id) : null;
  };
  /* الإخراج: كل لعبة تقدر تعطي طريقتها الخاصة (لعبة الرسم مثلاً تحفظ النقاط) */
  const remove = (r, t, reason) => {
    if (typeof ctx.remove === "function") { ctx.remove(r, t, reason); return; }
    r.players = r.players.filter(p => p.id !== t.id);
    nsp.to(t.id).emit("kicked", { reason });
    if (typeof onRemoved === "function") onRemoved(r, t);
    else broadcast(r);
  };

  /* ── طرد (المضيف فقط) ── */
  socket.on("mod:kick", ({ targetId } = {}, cb) => {
    const r = getRoom(), me = getPlayer();
    if (!r || !me) return cb && cb({ ok:false, error:"لست في غرفة" });
    if (!isOwner()) return cb && cb({ ok:false, error:"للمضيف فقط" });
    const t = target(targetId);
    if (!t || t.id === me.id) return cb && cb({ ok:false, error:"اختيار غير صالح" });
    remove(r, t, "kick");
    sys(r, `🚪 ${me.name} طرد ${t.name}`, "warn");
    cb && cb({ ok:true });
  });

  /* ── حظر من الغرفة (المضيف فقط) ── */
  socket.on("mod:ban", ({ targetId } = {}, cb) => {
    const r = getRoom(), me = getPlayer();
    if (!r || !me) return cb && cb({ ok:false, error:"لست في غرفة" });
    if (!isOwner()) return cb && cb({ ok:false, error:"للمضيف فقط" });
    const t = target(targetId);
    if (!t || t.id === me.id) return cb && cb({ ok:false, error:"اختيار غير صالح" });
    const [tok, nm] = stamp(t);
    const b = banList(r);
    if (tok) b.add("t:" + tok);
    if (nm)  b.add("n:" + nm);
    remove(r, t, "ban");
    sys(r, `⛔ ${me.name} حظر ${t.name} من الغرفة`, "warn");
    cb && cb({ ok:true });
  });

  /* حالة التصويت المرسلة للجميع */
  const voteState = (r) => {
    if (!r._vk) return null;
    const live = r.players.filter(p => p.connected).length;
    return {
      targetId: r._vk.targetId, name: r._vk.name,
      have: r._vk.voters.size, need: Math.floor(live / 2) + 1,
      endsAt: r._vk.endsAt, starterId: r._vk.starterId
    };
  };
  const endVote = (r) => { if (r._vk) clearTimeout(r._vk.timer); r._vk = null; nsp.to(r.id).emit("mod:vote", null); };

  /* ── بدء تصويت طرد (أي لاعب) ── */
  socket.on("mod:votekick", ({ targetId } = {}, cb) => {
    const r = getRoom(), me = getPlayer();
    if (!r || !me) return cb && cb({ ok:false, error:"لست في غرفة" });
    if (r.settings && r.settings.noVotekick) return cb && cb({ ok:false, error:"المضيف أوقف تصويت الطرد" });
    const t = target(targetId);
    if (!t || t.id === me.id) return cb && cb({ ok:false, error:"اختيار غير صالح" });
    const live = r.players.filter(p => p.connected);
    if (live.length < 3) return cb && cb({ ok:false, error:"يحتاج ٣ لاعبين على الأقل" });
    if (r._vk) return cb && cb({ ok:false, error:"يوجد تصويت جارٍ" });

    r._vk = { targetId: t.id, name: t.name, starterId: me.id,
              voters: new Set([me.id]), endsAt: Date.now() + VOTE_MS, timer: null };
    r._vk.timer = setTimeout(() => {
      if (r._vk && r._vk.targetId === t.id) {
        sys(r, `🗳️ انتهى وقت التصويت على طرد ${t.name} — لم تكتمل الأغلبية`, "system");
        endVote(r);
      }
    }, VOTE_MS);
    sys(r, `🗳️ ${me.name} بدأ تصويتاً لطرد ${t.name} — صوّتوا خلال ${VOTE_MS / 1000} ثانية`, "warn");
    nsp.to(r.id).emit("mod:vote", voteState(r));
    cb && cb({ ok:true, ...voteState(r) });
  });

  /* ── تصويت بنعم/لا على التصويت الجاري ── */
  socket.on("mod:vote", ({ yes } = {}, cb) => {
    const r = getRoom(), me = getPlayer();
    if (!r || !me || !r._vk) return cb && cb({ ok:false, error:"لا يوجد تصويت" });
    if (me.id === r._vk.targetId) return cb && cb({ ok:false, error:"لا تصوّت على نفسك" });
    if (r._vk.voters.has(me.id)) return cb && cb({ ok:false, error:"صوّتت مسبقاً" });
    if (yes === false) {
      if (!r._vk.no) r._vk.no = new Set();
      r._vk.no.add(me.id);
      nsp.to(r.id).emit("mod:vote", voteState(r));
      return cb && cb({ ok:true, voted:"no" });
    }
    r._vk.voters.add(me.id);
    const st = voteState(r);
    nsp.to(r.id).emit("mod:vote", st);
    if (st.have >= st.need) {
      const t = target(r._vk.targetId);
      endVote(r);
      if (t) { remove(r, t, "votekick"); sys(r, `🗳️ الأغلبية صوّتت — تم طرد ${t.name}`, "warn"); }
    }
    cb && cb({ ok:true, ...st });
  });

  /* ── المضيف: إلغاء التصويت الجاري ── */
  socket.on("mod:voteCancel", (_ = {}, cb) => {
    const r = getRoom(), me = getPlayer();
    if (!r || !me) return cb && cb({ ok:false, error:"لست في غرفة" });
    if (!isOwner()) return cb && cb({ ok:false, error:"للمضيف فقط" });
    if (!r._vk) return cb && cb({ ok:false, error:"لا يوجد تصويت" });
    sys(r, `🛑 ${me.name} ألغى تصويت الطرد`, "system");
    endVote(r);
    cb && cb({ ok:true });
  });

  /* ── المضيف: تفعيل/إيقاف تصويت الطرد في الغرفة ── */
  socket.on("mod:voteToggle", ({ off } = {}, cb) => {
    const r = getRoom(), me = getPlayer();
    if (!r || !me) return cb && cb({ ok:false, error:"لست في غرفة" });
    if (!isOwner()) return cb && cb({ ok:false, error:"للمضيف فقط" });
    if (!r.settings) r.settings = {};
    r.settings.noVotekick = !!off;
    if (off && r._vk) endVote(r);
    sys(r, off ? "🚫 المضيف أوقف تصويت الطرد" : "✅ المضيف فعّل تصويت الطرد", "system");
    broadcast(r);
    cb && cb({ ok:true, off: !!off });
  });

  /* ── بلاغ (أي لاعب) ── */
  socket.on("mod:report", ({ targetId, reasons } = {}, cb) => {
    const r = getRoom(), me = getPlayer();
    if (!r || !me) return cb && cb({ ok:false, error:"لست في غرفة" });
    const t = target(targetId);
    if (!t || t.id === me.id) return cb && cb({ ok:false, error:"اختيار غير صالح" });
    const list = (Array.isArray(reasons) ? reasons : []).filter(k => REASONS[k]);
    if (!list.length) return cb && cb({ ok:false, error:"اختر سبباً واحداً على الأقل" });
    addReport({
      /* معرّفٌ يكفي لحذف بلاغٍ بعينه من اللوحة */
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      at: Date.now(),
      game: nsp.name.replace("/", "") || "—",
      room: r.id,
      byName: me.name, byUser: me.userName || null,
      onName: t.name,  onUser: t.userName || null,
      reasons: list.map(k => REASONS[k])
    });
    cb && cb({ ok:true });
  });
}

module.exports = { attach, isBanned, banList, listReports, clearReports,
                   setSink, loadReports, removeReport, REASONS };
