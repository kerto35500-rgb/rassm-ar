/* 🂡 أوراق بالوت — مرسومةٌ بالـCSS لا بالصور.
 *
 * ورقٌ فرنسيٌّ من ٣٢: من السبعة إلى الأكة في أربعة أنواع. ولماذا رسمًا لا
 * صورًا؟ لأنّ اثنتين وثلاثين صورةً في ستّة ثيماتٍ يعني مئتي ملفٍّ يُحمَّل
 * على شبكةِ جوّالٍ بطيئة، ولأنّ الورقة المرسومة تتكيّف مع أيّ مقاسٍ بلا
 * تشوّش. الستايل الناعم («مارشميلو») في الواجهة والأيقونات، أمّا الورقة
 * فكلاسيكيّةٌ نظيفة — من يلعب بالوت يريد أن يقرأ ورقته من نصف متر.
 */

const SUIT_SYM = { S: "♠", H: "♥", D: "♦", C: "♣" };
const SUIT_AR = { S: "بستوني", H: "كُبّة", D: "ديمن", C: "شيريا" };
const SUIT_RED = { S: false, H: true, D: true, C: false };
const RANK_AR = { "7": "٧", "8": "٨", "9": "٩", "10": "١٠", J: "ولد", Q: "بنت", K: "شايب", A: "أكة" };

const cRank = c => c.slice(0, -1);
const cSuit = c => c.slice(-1);
const cardName = c => RANK_AR[cRank(c)] + " " + SUIT_AR[cSuit(c)];

/* توزيع النقوش على الورقة الرقميّة — نِسَبٌ من عرضها وارتفاعها.
   الأعمدة ثلاثة (يسار، وسط، يمين) والصفوف سبعة، كما في الورق المطبوع. */
const PIPS = {
  "7":  [[0,0],[2,0],[0,2],[2,2],[1,1],[0,4],[2,4]],
  "8":  [[0,0],[2,0],[0,2],[2,2],[1,1],[1,3],[0,4],[2,4]],
  "9":  [[0,0],[2,0],[0,1.4],[2,1.4],[1,2],[0,2.6],[2,2.6],[0,4],[2,4]],
  "10": [[0,0],[2,0],[0,1.4],[2,1.4],[1,.7],[1,3.3],[0,2.6],[2,2.6],[0,4],[2,4]],
  "A":  [[1,2]]
};
const COURT = { J: "🂫", Q: "🂭", K: "🂮" };

/** يبني عنصر ورقةٍ مكشوفة. `small` للأيدي المقابلة والمعاينات. */
function cardFace(card, small) {
  const r = cRank(card), s = cSuit(card), sym = SUIT_SYM[s], red = SUIT_RED[s];
  const el = document.createElement("div");
  el.className = "bc" + (red ? " red" : "") + (small ? " sm" : "");
  el.dataset.card = card;

  const corner = pos => `<i class="cn ${pos}"><b>${r}</b><u>${sym}</u></i>`;
  let mid = "";
  if (PIPS[r]) {
    mid = PIPS[r].map(([col, row]) =>
      `<s class="pip" style="left:${14 + col * 36}%;top:${12 + row * 19}%${row > 2.5 ? ";transform:translate(-50%,-50%) rotate(180deg)" : ""}">${sym}</s>`
    ).join("");
    if (r === "A") mid = `<s class="pip big" style="left:50%;top:50%">${sym}</s>`;
  } else {
    /* الأوراق الملوّنة: حرفٌ كبيرٌ وإطارٌ داخليّ — لا رسمَ لملكٍ ولا وزير،
       فرسمٌ رديءٌ أسوأ من حرفٍ واضح. */
    mid = `<s class="court">${r}</s><s class="courtsym">${sym}</s>`;
  }
  el.innerHTML = corner("tl") + `<span class="mid">${mid}</span>` + corner("br");
  el.title = cardName(card);
  return el;
}

/** ظهرُ الورقة — نقشُ الثيم المختار. */
function cardBack(small) {
  const el = document.createElement("div");
  el.className = "bc back" + (small ? " sm" : "");
  el.innerHTML = '<span class="bk"></span>';
  return el;
}

/** عنصرٌ جاهزٌ للطيران: نسخةٌ من الوجه أو الظهر داخل غلاف. */
function cardNode(card, small) {
  return card && card !== "xx" ? cardFace(card, small) : cardBack(small);
}
const cardHTML = (card, small) => cardNode(card, small).outerHTML;

window.BCARD = { SUIT_SYM, SUIT_AR, SUIT_RED, RANK_AR, cRank, cSuit, cardName, cardFace, cardBack, cardNode, cardHTML };
