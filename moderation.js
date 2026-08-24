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

/* بنك البلاغات — تقرأه لوحة الأدمن */
const reports = [];
function addReport(rec) {
  reports.unshift(rec);
  if (reports.length > REPORTS_MAX) reports.length = REPORTS_MAX;
}
function listReports() { return reports.slice(); }
function clearReports() { reports.length = 0; }

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

  /* ── تصويت طرد (أي لاعب) ── */
  socket.on("mod:votekick", ({ targetId } = {}, cb) => {
    const r = getRoom(), me = getPlayer();
    if (!r || !me) return cb && cb({ ok:false, error:"لست في غرفة" });
    const t = target(targetId);
    if (!t || t.id === me.id) return cb && cb({ ok:false, error:"اختيار غير صالح" });
    const live = r.players.filter(p => p.connected);
    if (live.length < 3) return cb && cb({ ok:false, error:"يحتاج ٣ لاعبين على الأقل" });

    if (r._vk && r._vk.targetId === t.id && Date.now() < r._vk.endsAt) {
      if (r._vk.voters.has(me.id)) return cb && cb({ ok:false, error:"صوّتت مسبقاً" });
      r._vk.voters.add(me.id);
    } else {
      clearTimeout(r._vk && r._vk.timer);
      r._vk = { targetId: t.id, name: t.name, voters: new Set([me.id]),
                endsAt: Date.now() + VOTE_MS, timer: null };
      r._vk.timer = setTimeout(() => {
        if (r._vk && r._vk.targetId === t.id) {
          sys(r, `🗳️ انتهى وقت التصويت على طرد ${t.name} — لم تكتمل الأغلبية`, "system");
          r._vk = null;
          nsp.to(r.id).emit("mod:vote", null);
        }
      }, VOTE_MS);
      sys(r, `🗳️ ${me.name} بدأ تصويتاً لطرد ${t.name}`, "warn");
    }

    const need = Math.floor(live.length / 2) + 1;
    const have = r._vk.voters.size;
    nsp.to(r.id).emit("mod:vote", { targetId: t.id, name: t.name, have, need, endsAt: r._vk.endsAt });

    if (have >= need) {
      clearTimeout(r._vk.timer);
      r._vk = null;
      nsp.to(r.id).emit("mod:vote", null);
      remove(r, t, "votekick");
      sys(r, `🗳️ الأغلبية صوّتت — تم طرد ${t.name}`, "warn");
    }
    cb && cb({ ok:true, have, need });
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

module.exports = { attach, isBanned, banList, listReports, clearReports, REASONS };
