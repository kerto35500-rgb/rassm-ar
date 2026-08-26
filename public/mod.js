/* ═══════════════════════════════════════════════════════════════════
   mod.js — نافذة إشراف موحّدة لكل ألعاب الموقع (ستايل مارشميلو)
   ═══════════════════════════════════════════════════════════════════
   الاستخدام داخل أي لعبة (بعد إنشاء socket):

     RassmMod.attach({
       socket,
       getMe:      () => ME,              // معرّف اللاعب الحالي
       getOwnerId: () => ST.ownerId,      // معرّف المضيف
       getPlayers: () => ST.players,      // [{id, name}]
       onChange:   () => renderChat()     // يُستدعى بعد كتم/إلغاء كتم
     });

   ثم افتح النافذة عند الضغط على أي اسم لاعب:
     RassmMod.open(playerId);

   ولإخفاء رسائل المكتومين في الدردشة:
     if (RassmMod.isMuted(name)) return;   // الكتم بالاسم (محلي في المتصفح)
   ══════════════════════════════════════════════════════════════════ */

(function () {
  "use strict";

  var CFG = null;
  var MUTE_KEY = "rassmMuted";
  var vote = null;   // حالة تصويت الطرد الجارية

  /* ───── الكتم: محلي بالكامل، لا يمر بالخادم ───── */
  function muted() {
    try { return new Set(JSON.parse(localStorage.getItem(MUTE_KEY) || "[]")); }
    catch (e) { return new Set(); }
  }
  function saveMuted(s) {
    try { localStorage.setItem(MUTE_KEY, JSON.stringify([...s])); } catch (e) {}
  }
  function key(name) { return String(name || "").trim().toLowerCase(); }
  function isMuted(name) { return muted().has(key(name)); }
  function toggleMute(name) {
    var s = muted(), k = key(name);
    if (s.has(k)) s.delete(k); else s.add(k);
    saveMuted(s);
    if (CFG && typeof CFG.onChange === "function") CFG.onChange();
    return s.has(k);
  }

  /* ───── الأنماط ───── */
  function css() {
    if (document.getElementById("rmStyle")) return;
    var s = document.createElement("style");
    s.id = "rmStyle";
    s.textContent = [
      "#rmBack{position:fixed;inset:0;z-index:9000;background:rgba(60,40,30,.45);",
      "  display:none;align-items:center;justify-content:center;padding:18px;",
      "  backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px)}",
      "#rmBack.on{display:flex}",
      "#rmBox{width:100%;max-width:340px;background:var(--rm-white,#fff);",
      "  border:2.5px solid var(--rm-line,#C99A72);border-radius:26px;padding:18px 18px 16px;",
      "  box-shadow:0 6px 0 var(--rm-line,#C99A72),0 18px 40px rgba(80,50,30,.28);",
      "  font-family:inherit;text-align:center;animation:rmPop .22s cubic-bezier(.34,1.56,.44,1)}",
      "@keyframes rmPop{from{transform:scale(.86);opacity:0}to{transform:scale(1);opacity:1}}",
      "#rmHead{display:flex;align-items:center;gap:10px;margin-bottom:14px}",
      "#rmAv{width:44px;height:44px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;",
      "  justify-content:center;font-size:18px;font-weight:900;background:var(--rm-band,#FFF0DC);",
      "  border:2.5px solid var(--rm-line,#C99A72);color:var(--rm-ink,#4A2E2B)}",
      "#rmName{flex:1;min-width:0;text-align:start;font-size:17px;font-weight:900;",
      "  color:var(--rm-ink,#4A2E2B);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      "#rmX{width:34px;height:34px;flex-shrink:0;border:2.5px solid var(--rm-line,#C99A72);",
      "  border-radius:50%;background:#fff;color:var(--rm-ink,#4A2E2B);font-size:15px;font-weight:900;cursor:pointer}",
      "#rmX:hover{background:var(--rm-band,#FFF0DC)}",
      ".rmB{width:100%;padding:12px;margin-top:8px;border-radius:999px;font-size:15px;font-weight:800;",
      "  cursor:pointer;border:2.5px solid var(--rm-line,#C99A72);background:#fff;color:var(--rm-ink,#4A2E2B);",
      "  box-shadow:0 3px 0 var(--rm-line,#C99A72);transition:transform .15s,filter .15s}",
      ".rmB:hover{transform:translateY(-2px)}",
      ".rmB:active{transform:translateY(2px);box-shadow:0 1px 0 var(--rm-line,#C99A72)}",
      ".rmB.warn{background:#FFE9C9}",
      ".rmB.danger{background:#FFDCDC;border-color:#D6455A;box-shadow:0 3px 0 #D6455A;color:#8E2230}",
      ".rmB.on{background:#E3F8EC;border-color:#2FA36B;box-shadow:0 3px 0 #2FA36B;color:#1C6B45}",
      "#rmNote{font-size:12.5px;color:#9A7A66;margin-top:12px;line-height:1.6}",
      ".rmR{display:flex;align-items:center;gap:10px;padding:11px 13px;margin-top:8px;cursor:pointer;",
      "  border:2.5px solid var(--rm-line,#C99A72);border-radius:16px;background:#fff;text-align:start}",
      ".rmR .bx{width:22px;height:22px;flex-shrink:0;border:2.5px solid var(--rm-line,#C99A72);",
      "  border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:13px;color:#fff}",
      ".rmR.on .bx{background:#2FA36B;border-color:#2FA36B}",
      ".rmR .tx{font-size:14.5px;font-weight:800;color:var(--rm-ink,#4A2E2B)}",
      "#rmToast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%) translateY(90px);",
      "  z-index:9100;background:#4A2E2B;color:#fff;padding:12px 22px;border-radius:999px;",
      "  font-size:14px;font-weight:800;opacity:0;transition:.25s;pointer-events:none}",
      "#rmToast.on{transform:translateX(-50%) translateY(0);opacity:1}",
      "#rmVote{position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:8900;",
      "  background:var(--rm-white,#fff);border:2.5px solid var(--rm-line,#C99A72);border-radius:20px;",
      "  padding:11px 16px;font-size:14px;font-weight:800;color:var(--rm-ink,#4A2E2B);",
      "  box-shadow:0 4px 0 var(--rm-line,#C99A72),0 12px 26px rgba(80,50,30,.22);display:none;",
      "  text-align:center;max-width:calc(100vw - 24px);animation:rmPop .2s cubic-bezier(.34,1.56,.44,1)}",
      "#rmVote.on{display:block}",
      "#rmVote .rmvT{font-size:15px;margin-bottom:3px}",
      "#rmVote .rmvC{font-size:12.5px;color:#9A7A66;margin-bottom:8px}",
      "#rmVote .rmvB{display:flex;gap:6px;justify-content:center;flex-wrap:wrap}",
      "#rmVote .rmvB button{padding:8px 14px;border-radius:999px;font-size:13.5px;font-weight:800;",
      "  cursor:pointer;border:2.5px solid var(--rm-line,#C99A72);background:#fff;",
      "  color:var(--rm-ink,#4A2E2B);box-shadow:0 3px 0 var(--rm-line,#C99A72)}",
      "#rmVote .rmvB button:active{transform:translateY(2px);box-shadow:0 1px 0 var(--rm-line,#C99A72)}",
      "#rmVote .rmvB button:disabled{opacity:.55;cursor:default}",
      "#rmVote .rmvY{background:#E3F8EC !important;border-color:#2FA36B !important;box-shadow:0 3px 0 #2FA36B !important;color:#1C6B45 !important}",
      "#rmVote .rmvN{background:#FDEBEC !important;border-color:#D6455A !important;box-shadow:0 3px 0 #D6455A !important;color:#8E2230 !important}",
      "#rmVote .rmvNote{font-size:13px;color:#9A7A66}",
      /* ألوان كل لعبة تُلتقط من الثيم */
      "body.kw-bomb{--rm-line:#A05F50;--rm-ink:#4A2E2B;--rm-band:#FFF0DC;--rm-white:#FFFDF8}",
      "body.kw-salfa{--rm-line:#55814B;--rm-ink:#274A2E;--rm-band:#EAF7EC;--rm-white:#FBFEFB}",
      "body.kw-quiz{--rm-line:#8F72C8;--rm-ink:#3B2A5E;--rm-band:#EFE6FF;--rm-white:#FDFAFF}"
    ].join("\n");
    document.head.appendChild(s);
  }

  /* ───── عناصر مشتركة ───── */
  function el(id, tag, parent) {
    var e = document.getElementById(id);
    if (e) return e;
    e = document.createElement(tag || "div");
    e.id = id;
    (parent || document.body).appendChild(e);
    return e;
  }
  function toast(text) {
    var t = el("rmToast");
    t.textContent = text;
    t.classList.add("on");
    clearTimeout(t._t);
    t._t = setTimeout(function () { t.classList.remove("on"); }, 2600);
  }
  function close() { var b = document.getElementById("rmBack"); if (b) b.classList.remove("on"); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c];
    });
  }

  /* ───── النافذة الرئيسية ───── */
  function open(playerId) {
    if (!CFG) return;
    var me = CFG.getMe(), owner = CFG.getOwnerId();
    var list = CFG.getPlayers() || [];
    var p = list.filter(function (x) { return x.id === playerId; })[0];
    if (!p || p.id === me) return;                    // لا نافذة على نفسك
    var iAmOwner = owner === me;

    css();
    var back = el("rmBack");
    back.innerHTML = "";
    var box = document.createElement("div"); box.id = "rmBox";

    var head = document.createElement("div"); head.id = "rmHead";
    head.innerHTML =
      '<div id="rmAv">' + esc(String(p.name || "?").slice(0, 2)) + "</div>" +
      '<div id="rmName">' + esc(p.name) + "</div>" +
      '<button id="rmX" aria-label="إغلاق">✕</button>';
    box.appendChild(head);

    function btn(label, cls, fn) {
      var b = document.createElement("button");
      b.className = "rmB" + (cls ? " " + cls : "");
      b.textContent = label;
      b.onclick = fn;
      box.appendChild(b);
      return b;
    }

    if (iAmOwner) {
      btn("🚪 طرد من الغرفة", "warn", function () {
        CFG.socket.emit("mod:kick", { targetId: p.id }, function (r) {
          close(); toast(r && r.ok ? "تم طرد " + p.name : (r && r.error) || "تعذّر الطرد");
        });
      });
      btn("⛔ حظر من الغرفة", "danger", function () {
        CFG.socket.emit("mod:ban", { targetId: p.id }, function (r) {
          close(); toast(r && r.ok ? "تم حظر " + p.name : (r && r.error) || "تعذّر الحظر");
        });
      });
    }

    btn("🗳️ تصويت طرد", "", function () {
      CFG.socket.emit("mod:votekick", { targetId: p.id }, function (r) {
        close();
        if (r && r.ok) toast("صوّتك سُجّل (" + r.have + "/" + r.need + ")");
        else toast((r && r.error) || "تعذّر التصويت");
      });
    });

    var m = isMuted(p.name);
    btn(m ? "🔊 إلغاء كتم الدردشة" : "🔇 كتم الدردشة", m ? "on" : "", function () {
      var now = toggleMute(p.name);
      close();
      toast(now ? "كتمت دردشة " + p.name : "ألغيت كتم " + p.name);
    });

    btn("🚩 إبلاغ", "", function () { reportBox(p); });

    if (iAmOwner) {
      var off = !!(CFG.getVoteOff && CFG.getVoteOff());
      btn(off ? "✅ تفعيل تصويت الطرد للجميع" : "🚫 إيقاف تصويت الطرد للجميع", off ? "on" : "", function () {
        CFG.socket.emit("mod:voteToggle", { off: !off }, function (r) {
          close(); toast(r && r.ok ? (r.off ? "أوقفت تصويت الطرد" : "فعّلت تصويت الطرد") : "تعذّر التغيير");
        });
      });
    }

    var note = document.createElement("div"); note.id = "rmNote";
    note.textContent = iAmOwner
      ? "الحظر يمنعه من العودة لهذه الغرفة فقط. الكتم يخصّك وحدك — لا يراه أحد غيرك."
      : "الكتم يخصّك وحدك: تختفي رسائله عن شاشتك فقط ولا يعلم بذلك.";
    box.appendChild(note);

    back.appendChild(box);
    back.classList.add("on");
    document.getElementById("rmX").onclick = close;
    back.onclick = function (e) { if (e.target === back) close(); };
  }

  /* ───── نافذة الإبلاغ ───── */
  function reportBox(p) {
    var back = el("rmBack");
    back.innerHTML = "";
    var box = document.createElement("div"); box.id = "rmBox";
    box.innerHTML =
      '<div id="rmHead"><div id="rmAv">' + esc(String(p.name || "?").slice(0, 2)) + "</div>" +
      '<div id="rmName">' + esc(p.name) + "</div>" +
      '<button id="rmX" aria-label="إغلاق">✕</button></div>' +
      '<div style="font-size:14.5px;font-weight:800;color:var(--rm-ink,#4A2E2B);margin-bottom:6px">' +
      "اختر سبب البلاغ</div>";

    var picked = new Set();
    [["bad","رسائل أو رسومات غير لائقة"],["spam","إزعاج ورسائل مكررة"],["cheat","غش أو استخدام بوت"]]
      .forEach(function (r) {
        var row = document.createElement("div");
        row.className = "rmR";
        row.innerHTML = '<div class="bx">✓</div><div class="tx">' + r[1] + "</div>";
        row.onclick = function () {
          if (picked.has(r[0])) picked.delete(r[0]); else picked.add(r[0]);
          row.classList.toggle("on", picked.has(r[0]));
        };
        box.appendChild(row);
      });

    var send = document.createElement("button");
    send.className = "rmB danger";
    send.textContent = "🚩 إرسال البلاغ";
    send.onclick = function () {
      if (!picked.size) return toast("اختر سبباً واحداً على الأقل");
      CFG.socket.emit("mod:report", { targetId: p.id, reasons: [...picked] }, function (r) {
        close(); toast(r && r.ok ? "وصل بلاغك — شكراً لك" : (r && r.error) || "تعذّر الإرسال");
      });
    };
    box.appendChild(send);

    var note = document.createElement("div"); note.id = "rmNote";
    note.textContent = "البلاغات تصل لإدارة الموقع للمراجعة.";
    box.appendChild(note);

    back.appendChild(box);
    back.classList.add("on");
    document.getElementById("rmX").onclick = close;
  }

  /* ───── لوحة تصويت الطرد الجاري ───── */
  function showVote(v) {
    css();
    var bar = el("rmVote");
    if (!v) { bar.classList.remove("on"); bar.innerHTML = ""; vote = null; return; }
    vote = v;
    var me = CFG ? CFG.getMe() : null;
    var iAmTarget = me && me === v.targetId;
    var iAmOwner  = CFG && CFG.getOwnerId() === me;
    var left = Math.max(0, Math.round((v.endsAt - Date.now()) / 1000));

    bar.innerHTML =
      '<div class="rmvT">🗳️ تصويت لطرد <b>' + esc(v.name) + '</b></div>' +
      '<div class="rmvC"><span id="rmvHave">' + v.have + '</span>/' + v.need +
      ' أصوات · <span id="rmvT">' + left + '</span>ث</div>' +
      '<div class="rmvB">' +
        (iAmTarget ? '<span class="rmvNote">التصويت عليك…</span>' :
          '<button class="rmvY">✔ موافق</button><button class="rmvN">✕ رافض</button>') +
        (iAmOwner ? '<button class="rmvX">🛑 إلغاء التصويت</button>' : "") +
      '</div>';
    bar.classList.add("on");

    var y = bar.querySelector(".rmvY"), n = bar.querySelector(".rmvN"), x = bar.querySelector(".rmvX");
    if (y) y.onclick = function () {
      CFG.socket.emit("mod:vote", { yes: true }, function (r) {
        if (r && !r.ok) toast(r.error || "تعذّر التصويت");
        else { y.disabled = n.disabled = true; y.textContent = "✔ صوّتّ"; }
      });
    };
    if (n) n.onclick = function () {
      CFG.socket.emit("mod:vote", { yes: false }, function () {
        y.disabled = n.disabled = true; n.textContent = "✕ رفضت";
      });
    };
    if (x) x.onclick = function () { CFG.socket.emit("mod:voteCancel", {}, function () {}); };

    clearInterval(bar._t);
    bar._t = setInterval(function () {
      if (!vote) return clearInterval(bar._t);
      var s = Math.max(0, Math.round((vote.endsAt - Date.now()) / 1000));
      var e = document.getElementById("rmvT");
      if (e) e.textContent = s;
      if (s <= 0) clearInterval(bar._t);
    }, 500);
  }

  /* ───── الربط ───── */
  function attach(cfg) {
    CFG = cfg;
    css();
    if (cfg.socket) {
      cfg.socket.on("mod:vote", showVote);
      cfg.socket.on("kicked", function (d) {
        var why = d && d.reason === "ban" ? "تم حظرك من هذه الغرفة"
                : d && d.reason === "votekick" ? "صوّت اللاعبون على طردك"
                : "تم طردك من الغرفة";
        try { alert(why); } catch (e) {}
      });
    }
  }

  window.RassmMod = { attach: attach, open: open, isMuted: isMuted, toggleMute: toggleMute, toast: toast };
})();
