/* 🔗 ربط «وحدة» بحساب الموقع.
 *
 * الضيف يبقى كما كان تمامًا: ملفُّه في المتصفّح، وعملاته عملاتُ اللعبة.
 * أمّا المسجَّل فملكيّاته ومحفظته على الخادم — يشتري إطارًا من متجر الموقع
 * فيجده هنا، ويشتريه من هنا فيراه هناك، ويفتح اللعبة من جوّاله فيجد كل شيء.
 *
 * لماذا لا نزامن الضيف؟ لأن حسابه لا وجود له، وأيّ محاولةٍ لدمج ملفٍّ محلّيٍّ
 * مع حسابٍ عند التسجيل تفتح بابًا لنسخ الملكيّات بين الحسابات. من سجّل بدأ
 * من محفظة الموقع — وله هديّة الترحيب.
 */
const UNOACC = {
  on: false,            /* هل نحن مربوطون بحسابٍ الآن؟ */
  name: null,
  wallet: { gold: 0, gems: 0 },
  owned: new Set(),     /* معرّفاتٌ كاملة: uno:frames:Wizard */

  id(tab, key) { return `uno:${tab}:${key}`; },

  /** يُنادى مرّةً عند الإقلاع. يصمت ويُبقي الوضع المحلّيّ إن لم ينجح. */
  async load(P, saveP) {
    try {
      const r = await fetch('/api/shop/mine?game=uno', { credentials: 'same-origin' });
      const j = await r.json();
      if (!j.ok || j.guest) return false;
      this.on = true;
      this.wallet = j.wallet || { gold: 0, gems: 0 };
      this.owned = new Set(j.owned || []);

      /* الملكيّات: الخادم مصدرُ الحقيقة، والمجّانيّات تبقى للجميع */
      const FREE = { boards: ['classic', 'nomercy'], cards: ['classic', 'nomercy'],
                     avatars: AVATARS.filter(a => a[3] === 0).map(a => a[0]), frames: ['Classic'] };
      ['boards', 'cards', 'avatars', 'frames'].forEach(t => {
        const pre = `uno:${t}:`;
        P.owned[t] = [...new Set([...FREE[t], ...j.owned.filter(x => x.startsWith(pre)).map(x => x.slice(pre.length))])];
      });
      P.coins = this.wallet.gold;

      /* المُجهَّز على الخادم يفوز على المحفوظ محلّيًّا — فالجوّال والحاسوب سواء */
      const lo = j.loadout || {};
      if (lo.boards)  P.sel.boards = lo.boards;
      if (lo.cards)   P.sel.cards  = lo.cards;
      if (lo.avatars) P.avatar     = lo.avatars;
      if (lo.frames)  P.frame      = lo.frames;
      saveP();
      return true;
    } catch (e) { return false; }
  },

  /** شراءٌ من داخل اللعبة — بالسعر الذي عند الخادم لا الذي في الصفحة. */
  async buy(tab, key) {
    const r = await fetch('/api/shop/buy', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: this.id(tab, key) })
    });
    const j = await r.json();
    if (j.ok) { this.owned.add(this.id(tab, key)); if (j.wallet) this.wallet = j.wallet; }
    return j;
  },

  /** التجهيز يُرسَل ولا يُنتظَر: الواجهة تتحرّك فورًا، والخادم يلحق. */
  equip(tab, key) {
    if (!this.on) return;
    fetch('/api/shop/equip', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: this.id(tab, key) })
    }).catch(() => {});
  },

  /** جائزة مباراةٍ ضدّ الحاسوب. الخادم يقرّر المقدار ويردّ الرصيد الجديد. */
  async reward(rank) {
    if (!this.on) return null;
    try {
      const r = await fetch('/api/uno/solo', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rank })
      });
      const j = await r.json();
      if (j.ok && j.wallet) this.wallet = j.wallet;
      return j;
    } catch (e) { return null; }
  }
};
