/* 🌐 «اونو» أونلاين — جانب المتصفّح.
 *
 * الفكرة التي وفّرت إعادة كتابة اللعبة: الخادم يُرسل حالةً، ونحن نُشكّلها
 * بالضبط كشكل `G` الذي تفهمه دوالُّ الرسم المحلّيّة — فترسم الطاولةَ نفسُها
 * التي كانت ترسم اللعب ضدّ الحاسوب، بلا أن تعرف أن هناك شبكة.
 *
 * وما نغيّره ثلاثة مداخل فقط: لمسُ كرت، ولمسُ الرزمة، ونداء «اونو».
 * في المحلّيّ تُنفّذ القاعدة، وهنا تُرسل نيّةً — والخادم يقبل أو يردّ.
 *
 * مقاعد: الخادم يرقّم من صفر بترتيب الجلوس، وأنا لستُ صفرًا بالضرورة.
 * فندوّر الترتيب حتى أصير أنا الأسفل دائمًا (كما اعتاد اللاعب)، ثم نوزّع
 * الباقين على المقاعد الثلاثة الظاهرة حسب عددهم.
 */
"use strict";

const ONL = {
  on: false, sock: null, code: null, me: null, seatN: 0, mySeat: 0,
  lobby: null, view: null, phys: [0, 1, 2, 3], started: false
};

/* توزيع المقاعد على الطاولة حسب العدد: أنا أسفل، والخصم الواحد أمامي. */
const PHYS = { 2: [0, 2], 3: [0, 1, 3], 4: [0, 1, 2, 3] };

/* ── الهويّة ── */
function olFreeAvatars() { return AVATARS.filter(a => a[3] === 0); }
function olFreeFrames()  { return FRAMES.filter(f => f[3] === 0); }

let olPick = { name: '', av: 'Adult_1', frame: 'Classic' };

function olRenderIdentity() {
  olPick.name = P.name || 'لاعب';
  olPick.av = P.avatar; olPick.frame = P.frame;
  const box = $('#ol-id');

  /* المسجَّل لا يُسأل عن شخصيّته: اختارها في «الملف» وهي محفوظةٌ في حسابه.
     سؤالُه مرّتين عن الشيء نفسه إزعاجٌ لا خيار — فنعرضها ونمضي.
     أمّا الضيف فلا ملفَّ له، فهنا مكان اختياره الوحيد. */
  if (UNOACC.on) {
    box.innerHTML =
      '<div class="olme">' +
        '<div class="avbox"><img class="a" src="' + avSrc(P.avatar) + '">' +
        (P.frame ? '<img class="f" src="' + frSrc(P.frame) + '">' : '') + '</div>' +
        '<div class="t"><b>' + olEsc(P.name) + '</b>' +
          '<small>حسابك المسجَّل — تلعب باسمه وشخصيّته</small></div>' +
      '</div>' +
      '<button class="play-btn sm" style="width:100%;margin-top:12px" onclick="openScreen(\'profile\')">غيّر شخصيّتك من الملف</button>';
    fitFrames(box);
    return;
  }

  const avs = olFreeAvatars(), frs = olFreeFrames();
  box.innerHTML =
    '<div class="opt"><div class="lbl">اسمك<small>يراه بقيّة اللاعبين</small></div>' +
      '<input id="ol-name" maxlength="16" value="' + olEsc(olPick.name) + '"></div>' +
    '<div class="olsec">اختر شخصيّتك <small>(سجّل حسابك لتفتح الباقي)</small></div>' +
    '<div class="olgrid" id="ol-avs">' + avs.map(a =>
      '<div class="olpick' + (a[0] === olPick.av ? ' on' : '') + '" data-av="' + a[0] + '" title="' + olEsc(a[1]) + '">' +
      '<img src="' + avSrc(a[0]) + '"></div>').join('') + '</div>' +
    (frs.length > 1 ? '<div class="olsec">الإطار</div>' +
      '<div class="olgrid" id="ol-frs">' + frs.map(f =>
        '<div class="olpick fr' + (f[0] === olPick.frame ? ' on' : '') + '" data-fr="' + f[0] + '" title="' + olEsc(f[1]) + '">' +
        '<img src="' + frSrc(f[0]) + '"></div>').join('') + '</div>' : '');

  $('#ol-avs').onclick = e => { const d = e.target.closest('[data-av]'); if (!d) return;
    olPick.av = d.dataset.av; P.avatar = d.dataset.av; saveP(); snd('click'); olRenderIdentity(); };
  const fr = $('#ol-frs');
  if (fr) fr.onclick = e => { const d = e.target.closest('[data-fr]'); if (!d) return;
    olPick.frame = d.dataset.fr; P.frame = d.dataset.fr; saveP(); snd('click'); olRenderIdentity(); };
  const ni = $('#ol-name');
  if (ni) ni.oninput = () => { olPick.name = ni.value.trim().slice(0, 16); P.name = olPick.name || 'لاعب'; saveP(); };
}
const olEsc = s => { const d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML; };
const olMsg = (t, bad) => { const e = $('#ol-msg'); if (!e) return; e.textContent = t || ''; e.className = 'olmsg' + (bad ? ' bad' : ''); };

/* ── الاتّصال ── */
function olConnect() {
  if (ONL.sock) return ONL.sock;
  if (typeof io === 'undefined') { olMsg('تعذّر تحميل الاتّصال — حدّث الصفحة', true); return null; }
  const s = io('/uno', { transports: ['websocket', 'polling'] });
  ONL.sock = s;

  s.on('lobby', l => { ONL.lobby = l; olRenderRoom(); });
  s.on('err', e => { toastC(e.msg || 'تعذّر'); olMsg(e.msg || '', true); });
  s.on('kicked', () => { olQuit(); toastC('أخرجك المضيف من الغرفة'); });
  s.on('started', () => { ONL.started = true; olEnterBoard(); });
  s.on('state', v => olApply(v));
  s.on('matchEnd', e => olMatchEnd(e));
  s.on('disconnect', () => { if (ONL.on) toastC('انقطع الاتّصال…'); });
  return s;
}

function olCreate() {
  const s = olConnect(); if (!s) return;
  olMsg('جارٍ الإنشاء…');
  s.emit('create', olPick, r => {
    if (!r || !r.ok) return olMsg((r && r.error) || 'تعذّر الإنشاء', true);
    ONL.on = true; ONL.code = r.code; ONL.me = r.id; ONL.started = false;
    olMsg(''); openScreen('room');
  });
}
function olJoin(code) {
  const s = olConnect(); if (!s) return;
  const c = (code || $('#ol-code').value || '').trim().toUpperCase();
  if (c.length < 3) return olMsg('اكتب رمز الغرفة', true);
  olMsg('جارٍ الانضمام…');
  s.emit('join', { ...olPick, code: c }, r => {
    if (!r || !r.ok) return olMsg((r && r.error) || 'تعذّر الانضمام', true);
    ONL.on = true; ONL.code = r.code; ONL.me = r.id; ONL.started = false;
    olMsg(''); openScreen('room');
  });
}
function olQuit() {
  if (ONL.sock && ONL.on) ONL.sock.emit('leaveRoom');
  ONL.on = false; ONL.code = null; ONL.started = false; ONL.view = null;
  G = null;
  openScreen('main');
}

/* ── اللوبي ── */
const OL_MODE = { nomercy: 'بلا رحمة', classic: 'الكلاسيكي' };
function olRenderRoom() {
  const l = ONL.lobby; if (!l || curScreen !== 'room') return;
  const host = l.host === ONL.me;
  $('#rm-code').textContent = l.code;
  const link = location.origin + '/uno/?r=' + l.code;
  $('#rm-link').value = link;

  $('#rm-players').innerHTML = l.players.map(p =>
    '<div class="olp' + (p.gone ? ' gone' : '') + '">' +
      '<div class="avbox"><img class="a" src="' + avSrc(p.av) + '">' +
      (p.frame ? '<img class="f" src="' + frSrc(p.frame) + '">' : '') + '</div>' +
      '<div class="n">' + olEsc(p.name) + (p.host ? ' <span class="tag">مضيف</span>' : '') +
        (p.gone ? ' <span class="tag bad">انقطع</span>' : '') + '</div>' +
      (host && !p.host ? '<button class="kick" data-kick="' + p.id + '">✕</button>' : '') +
    '</div>').join('') +
    Array.from({ length: Math.max(0, l.max - l.players.length) },
      () => '<div class="olp empty">مقعدٌ فارغ' + (l.settings && l.botsOn ? ' — سيملؤه بوت' : '') + '</div>').join('');
  fitFrames($('#rm-players'));
  $('#rm-players').onclick = e => { const b = e.target.closest('[data-kick]'); if (b) ONL.sock.emit('kick', { id: b.dataset.kick }); };

  const S2 = l.settings;
  $('#rm-set').innerHTML = host ? olSettingsHtml(S2, l.botsOn) : olSettingsRead(S2, l.botsOn);
  if (host) olBindSettings();

  const btn = $('#rm-start');
  btn.style.display = host ? '' : 'none';
  $('#rm-wait').style.display = host ? 'none' : '';
  const enough = l.players.filter(p => !p.gone).length >= 2 || l.botsOn;
  btn.disabled = !enough;
  btn.textContent = enough ? 'ابدأ المباراة' : 'بانتظار لاعبٍ آخر…';
}
function olSettingsHtml(S2, bots) {
  const seg = (k, opts, cur) => '<div class="seg" data-oset="' + k + '">' +
    opts.map(o => '<button data-v="' + o[0] + '"' + (String(cur) === String(o[0]) ? ' class="on"' : '') + '>' + o[1] + '</button>').join('') + '</div>';
  const sw = (k, on) => '<div class="switch' + (on ? ' on' : '') + '" data-oset="' + k + '"></div>';
  const nm = S2.mode === 'nomercy';
  return '' +
    '<div class="opt"><div class="lbl">النمط</div>' + seg('mode', [['nomercy', 'بلا رحمة'], ['classic', 'الكلاسيكي']], S2.mode) + '</div>' +
    (nm ? '' : '<div class="opt"><div class="lbl">حد النقاط</div>' + seg('limit', [['200', '200'], ['300', '300'], ['500', '500']], S2.limit) + '</div>') +
    '<div class="opt"><div class="lbl">مؤقت الدور<small>من تأخّر يُسحب له كرتٌ ويمرّ دوره</small></div>' + seg('timer', [['0', 'بدون'], ['15', '15'], ['30', '30']], S2.timer) + '</div>' +
    '<div class="opt"><div class="lbl">ملء المقاعد ببوتات<small>تبدأ فورًا — لكن لا ذهب في مباراةٍ فيها بوت</small></div>' + sw('bots', bots) + '</div>' +
    '<div class="olsec">قواعد البيت</div>' +
    '<div class="opt"><div class="lbl">التكديس</div>' + sw('stacking', S2.stacking) + '</div>' +
    '<div class="opt"><div class="lbl">7-0</div>' + sw('seven0', S2.seven0) + '</div>' +
    '<div class="opt"><div class="lbl">القفز</div>' + sw('jumpin', S2.jumpin) + '</div>' +
    '<div class="opt"><div class="lbl">اللعب الإجباري</div>' + sw('forceplay', S2.forceplay) + '</div>' +
    (nm ? '<div class="opt"><div class="lbl">قاعدة الرحمة<small>من يصل 25 كرتًا يخرج</small></div>' + sw('mercy', S2.mercy) + '</div>'
        : '<div class="opt"><div class="lbl">تحدّي +4</div>' + sw('challenge', S2.challenge) + '</div>');
}
function olSettingsRead(S2, bots) {
  const yes = v => v ? 'نعم' : 'لا';
  const rows = [['النمط', OL_MODE[S2.mode]], ...(S2.mode === 'classic' ? [['حد النقاط', S2.limit]] : []),
    ['مؤقت الدور', S2.timer ? S2.timer + 'ث' : 'بدون'], ['بوتات', yes(bots)],
    ['التكديس', yes(S2.stacking)], ['7-0', yes(S2.seven0)], ['القفز', yes(S2.jumpin)],
    ['اللعب الإجباري', yes(S2.forceplay)],
    S2.mode === 'nomercy' ? ['قاعدة الرحمة', yes(S2.mercy)] : ['تحدّي +4', yes(S2.challenge)]];
  return '<div class="olread">' + rows.map(r => '<div><b>' + r[0] + '</b><span>' + r[1] + '</span></div>').join('') +
         '</div><div class="olnote">المضيف يضبط الإعدادات.</div>';
}
function olBindSettings() {
  $('#rm-set').querySelectorAll('.seg[data-oset]').forEach(seg => {
    seg.querySelectorAll('button').forEach(b => b.onclick = () => {
      snd('click'); ONL.sock.emit('settings', { [seg.dataset.oset]: isNaN(+b.dataset.v) ? b.dataset.v : +b.dataset.v });
    });
  });
  $('#rm-set').querySelectorAll('.switch[data-oset]').forEach(sw => sw.onclick = () => {
    snd('click');
    const k = sw.dataset.oset;
    const cur = k === 'bots' ? ONL.lobby.botsOn : ONL.lobby.settings[k];
    ONL.sock.emit('settings', { [k]: !cur });
  });
}
function olCopyLink() {
  const i = $('#rm-link');
  i.select(); i.setSelectionRange(0, 999);
  try { navigator.clipboard.writeText(i.value); } catch (e) { try { document.execCommand('copy'); } catch (e2) {} }
  toastC('نُسخ الرابط ✔');
}

/* ── الطاولة ── */
function olEnterBoard() {
  $$('.fe').forEach(e => e.classList.remove('show'));
  $('#mend').classList.remove('show');
  $('#game').classList.add('show');
  curScreen = 'game';
}

/** يُحوّل منظور الخادم إلى `G` التي تفهمها دوالُّ الرسم. */
function olApply(v) {
  ONL.view = v;
  ONL.mySeat = v.me.seat; ONL.seatN = v.players.length;
  ONL.phys = PHYS[v.players.length] || [0, 1, 2, 3];
  if (!ONL.started) { ONL.started = true; olEnterBoard(); }

  /* إعدادات اللعبة تأتي من الخادم: canPlay المحلّيّة تقرأها لتلوين ما يجوز */
  Object.assign(S, v.S);

  const phys = i => ONL.phys[(i - ONL.mySeat + ONL.seatN) % ONL.seatN];
  const slots = new Array(4).fill(null);
  v.players.forEach(p => {
    const pi = phys(p.seat);
    slots[pi] = {
      name: p.name, av: p.av, frame: p.frame, human: p.seat === ONL.mySeat,
      score: p.score, uno: p.uno, out: p.out || p.left, _seat: p.seat, _id: p.id,
      _catchable: p.catchable,
      /* أيدي الآخرين أعدادٌ: نملؤها بأوراقٍ صمّاء لأن الرسم يقرأ الطول فقط */
      hand: p.seat === ONL.mySeat ? v.me.hand : new Array(p.n).fill(0).map((_, i) => ({ c: 'x', v: 'x', id: -1 - i }))
    };
  });
  for (let i = 0; i < 4; i++) if (!slots[i]) slots[i] = { name: '', av: 'Adult_1', frame: '', human: false, score: 0, uno: false, out: true, hand: [], _empty: true };

  const myTurn = v.phase === 'turn' && v.turn === ONL.mySeat;
  G = {
    players: slots, deck: new Array(v.deckN).fill(0), discard: v.top ? [v.top] : [],
    color: v.color, dir: v.dir, turn: v.turn == null ? 0 : phys(v.turn),
    pending: v.pending, pendingType: v.pendingType, round: v.round,
    over: !!v.over, busy: false, anim: false, online: true
  };
  /* renderHand تسأل عن humanResolve لتعرف «هل هو دوري الآن؟» */
  humanResolve = myTurn ? function () {} : null;

  /* المقاعد غير المستعملة تُخفى، وإلا ظهرت لوحاتٌ فارغة حول الطاولة */
  ['seat-me', 'seat-right', 'seat-top', 'seat-left'].forEach((id, i) => {
    const el = $('#' + id); if (!el) return;
    el.style.display = slots[i]._empty ? 'none' : '';
    if (slots[i]._empty) { const oh = $('#' + ohandId(i)); if (oh) oh.innerHTML = ''; }
    else {
      el.querySelector('.plate span').textContent = slots[i].name;
      el.querySelector('.av img.a').src = avSrc(slots[i].av);
      const f = el.querySelector('.avw>img.fr');
      f.src = frSrc(slots[i].frame); f.style.display = slots[i].frame ? '' : 'none';
      fitFrame(el.querySelector('.avw'));
    }
  });
  applyBoard();
  renderAll();
  /* شريط النقاط يُبنى من كل المقاعد الأربعة، فالفارغة تظهر «: 0».
     نكتبه من لاعبي الخادم وحدهم. */
  $('#score').innerHTML = v.players.map(p =>
    '<span>' + olEsc(p.name) + ': <b>' + p.score + '</b></span>').join('') +
    '<span>جولة ' + v.round + '</span>';
  olEvents(v.events || []);
  olTimer(v.deadline);
  olExtras(v);
}

/** أحداثٌ للعرض فقط — القاعدة نُفّذت على الخادم، هذه لافتاتها. */
function olEvents(evs) {
  const phys = i => ONL.phys[(i - ONL.mySeat + ONL.seatN) % ONL.seatN];
  for (const e of evs) {
    switch (e.t) {
      case 'round':     banner('جولة ' + e.round, '', 1000); break;
      case 'play':      snd(e.card && e.card.c === 'w' ? 'wild' : 'card');
                        if (e.seat !== ONL.mySeat) seatBubble(phys(e.seat), e.name || '', 'info', 900); break;
      case 'draw':      if (e.n > 1) seatBubble(phys(e.seat), 'سحب ' + e.n, 'bad', 1000); break;
      case 'reverse':   banner('عكس', '', 700); break;
      case 'skip':      seatBubble(phys(e.seat), 'محظور ⛔', 'bad', 1000); break;
      case 'skipall':   banner('حظر الجميع!', '', 900); break;
      case 'pending':   banner('+' + e.n, '', 800); break;
      case 'roulette':  seatBubble(phys(e.seat), 'روليت — سحب ' + e.n, 'bad', 1300); break;
      case 'swap':      banner('تبديل الأيدي', '', 900); break;
      case 'rotate':    banner('تدوير الأيدي', '', 900); break;
      case 'discardAll':banner('ارمِ الكل!', e.n + ' كرت', 1000); break;
      case 'eliminate': splat(); banner('بلا رحمة!', '', 1400); snd('boom'); break;
      case 'uno':       seatBubble(phys(e.seat), 'اونو!', '', 1000); snd('uno'); break;
      case 'caught':    banner('مُسك!', '', 1000); snd('bad'); break;
      case 'missCatch': banner('مسكٌ خاطئ', '', 900); snd('bad'); break;
      case 'left':      toastC(e.name + ' غادر'); break;
      case 'timeout':   seatBubble(phys(e.seat), 'انتهى وقته', 'bad', 1100); break;
      case 'reshuffle': toastC('أعيد خلط الكومة'); break;
      case 'roundEnd':  banner('انتهت الجولة', '', 1600); snd('win'); break;
    }
  }
}

/* مؤقّت الدور: شريطٌ حول صورتي — نرسمه من موعد الخادم لا من عدّادٍ محلّيّ،
   فلا يختلف ما أراه عمّا يراه الخادم. */
let olRaf = null;
function olTimer(deadline) {
  if (olRaf) { cancelAnimationFrame(olRaf); olRaf = null; }
  const el = $('#seat-me .timer');
  if (!deadline || !ONL.view || ONL.view.turn !== ONL.mySeat) { if (el) el.style.setProperty('--p', '0%'); return; }
  const total = (ONL.view.S.timer || 30) * 1000;
  const tick = () => {
    const left = deadline - Date.now();
    if (left <= 0) { el.style.setProperty('--p', '0%'); olRaf = null; return; }
    el.style.setProperty('--p', Math.max(0, Math.min(100, left / total * 100)) + '%');
    olRaf = requestAnimationFrame(tick);
  };
  tick();
}

/** أزرارٌ خاصّة بالأونلاين: «اونو»، ومسك من نسي، وتحدّي +٤، وجواب المسحوب. */
function olExtras(v) {
  const myTurn = v.phase === 'turn' && v.turn === ONL.mySeat;
  showUnoBtn(myTurn && v.me.hand.length === 2 && !v.me.uno);

  /* من نسي النداء يظهر عليه زرُّ مسك */
  const phys = i => ONL.phys[(i - ONL.mySeat + ONL.seatN) % ONL.seatN];
  $$('.seat .burst').forEach(b => b.classList.remove('show'));
  v.players.forEach(p => {
    if (p.seat === ONL.mySeat || !p.catchable) return;
    const el = $('#' + ['seat-me', 'seat-right', 'seat-top', 'seat-left'][phys(p.seat)]);
    if (!el) return;
    const b = el.querySelector('.burst');
    if (b) { b.classList.add('show'); b.onclick = () => { snd('click'); ONL.sock.emit('catch', { seat: p.seat }); }; }
  });

  /* سؤال الكرت المسحوب */
  if (v.phase === 'drawn' && v.pendingFor === ONL.mySeat) {
    const k = v.me.hand[v.me.hand.length - 1];
    if (!ONL._asking) {
      ONL._asking = true;
      askDrawnPlay(k).then(async yes => {
        ONL._asking = false;
        let color = null;
        if (yes && k.c === 'w') color = await askColor('اختر اللون');
        ONL.sock.emit('drawn', { yes: !!yes, color });
      });
    }
  }

  /* تحدّي +٤ */
  const ch = $('#ol-challenge');
  if (ch) ch.style.display = v.canChallenge ? '' : 'none';
}

async function olMatchEnd(e) {
  const names = e.scores || [];
  $('#mend').classList.add('show');
  $('#game').classList.remove('show');
  const pod = $('#podium'); pod.innerHTML = '';
  const order = names.map((x, i) => ({ x, i })).sort((a, b) => b.x.score - a.x.score);
  order.forEach((o, r) => {
    const d = document.createElement('div');
    d.className = 'pod' + (o.i === e.winner ? ' win' : '');
    d.style.animationDelay = (r * .15) + 's';
    d.innerHTML = '<div class="rk"><img src="ui/rank' + Math.min(4, r + 1) + '.webp"></div>' +
      '<div class="pn">' + olEsc(o.x.name) + '</div>' +
      '<div class="card"><div class="pts">' + o.x.score + '</div></div>' +
      (o.i === e.winner && e.gold ? '<div class="rw">+ <img src="ui/coin2.webp"> ' + e.gold + '</div>' : '');
    pod.appendChild(d);
  });
  if (e.gold) { P.coins = (UNOACC.wallet.gold = UNOACC.wallet.gold + 0) || P.coins; toastC('كسبتَ ' + e.gold + ' ذهبًا'); }
  else if (e.reason) toastC(e.reason);
  snd('win');
  $('#mend-again').onclick = () => { $('#mend').classList.remove('show'); openScreen('room'); };
  $('#mend-menu').onclick = () => olQuit();
  ONL.started = false;
}

/* ── اعتراض المداخل الثلاثة ── */
function olPlay(k) {
  if (!ONL.on || !ONL.view) return false;
  const v = ONL.view;
  const mine = v.me.hand.some(x => x.id === k.id);
  if (!mine) return true;
  const jump = S.jumpin && !v.pending && v.top && k.c !== 'w' && v.top.c === k.c && v.top.v === k.v;
  if (!(v.turn === ONL.mySeat && v.phase === 'turn') && !jump) { shakeCard(k); return true; }
  if (!jump && !canPlay(k)) { shakeCard(k); return true; }
  (async () => {
    let color = null, swap;
    if (k.c === 'w') {
      color = await askColor(k.v === 'roulette' ? 'روليت الألوان — اختر لونًا' : 'اختر اللون');
      if (!color) return;
    }
    if (S.seven0 && k.v === '7') {
      const others = v.players.filter(p => p.seat !== ONL.mySeat && !p.out && !p.left);
      if (others.length) {
        const idx = await askSwapOnline(others);
        if (idx == null) return;
        swap = idx;
      }
    }
    ONL.sock.emit('play', { cardId: k.id, color, swap });
  })();
  return true;
}
function askSwapOnline(others) {
  return new Promise(res => {
    const l = $('#swaplist'); l.innerHTML = '';
    others.forEach(p => {
      const b = document.createElement('button');
      b.innerHTML = '<img src="' + avSrc(p.av) + '">' + olEsc(p.name) + '<small>' + p.n + ' كروت</small>';
      b.onclick = () => { snd('click'); $('#ov-swap').classList.remove('show'); res(p.seat); };
      l.appendChild(b);
    });
    $('#ov-swap').classList.add('show');
  });
}

/* ── الإقلاع ── */
function olBoot() {
  /* رابط الدعوة: ‎/uno/?r=CODE‎ يفتح شاشة الأونلاين والرمز مكتوب */
  const m = location.search.match(/[?&]r=([A-Za-z0-9]{3,8})/);
  if (m) {
    setTimeout(() => {
      openScreen('online');
      const i = $('#ol-code'); if (i) i.value = m[1].toUpperCase();
      olMsg('اضبط اسمك وشخصيّتك ثم اضغط «انضمّ»');
    }, 60);
  }
}
