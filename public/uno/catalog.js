/* 🗂️ كتالوج «وحدة» — مصدرُ الحقيقة الوحيد لأسماء العناصر وأسعارها.
   يُقرأ من المتصفّح داخل اللعبة (وسمُ script) ومن الخادم عند بذر المتجر
   (require)، فلا يفترق سعرٌ في مكانٍ عن مثيله في آخر. */
const BOARDS=[
 ['classic','الكلاسيكية','الطاولة الحمراء الأصلية — بداية كل شيء.',0],
 ['nomercy','بلا رحمة','طاولة وضع بلا رحمة: نار وسواد ولا مكان للرحماء.',0],
 ['abstractgraphic','عالم الهافتون','لوحة من الأشكال الحرة تشكّل عالم اللعبة.',1500],
 ['triangles','المثلثات','هندسة زجاجية تتوهج فوق الظلام.',1500],
 ['luminescentstars','النجوم المضيئة','نجمة تسبح في سماء الليل.',1500],
 ['cube','المكعب','منصة نيون فوق مكعبات متدرجة.',1800],
 ['flowers','الزهور','حديقة هادئة وحلقة ماء وسط الأزهار.',1800],
 ['cosy','الكوخ الشتوي','تعال من البرد والعب جولة دافئة.',2200],
 ['zenroom','غرفة الزن','هدوء ياباني وحبر يسيل فوق الطاولة.',2200],
 ['lapool','مسبح لوس أنجلوس','شمس وماء وبطة عوّامة.',1800],
 ['oasis','الواحة','بحيرة صحراوية بين النخيل.',2000],
 ['drawroom','غرفة الرسم','مرسم فنان مليء بالألوان.',2000],
 ['painterworkshop','ورشة الرسام','قماش ولوحات وريشة على الطاولة.',2000],
 ['wizard','الساحر','خريطة سحرية وجرعات متوهجة.',2400],
 ['fairytalecastle','قلعة الحكايات','قلعة الأميرات في سماء زرقاء.',2400],
 ['candyworld','عالم الحلوى','مثلجات وسكاكر حول بحيرة زرقاء.',2000],
 ['origami','أوريغامي','جزر ورقية وبالونات معلقة.',2200],
 ['universe','الكون','كواكب ومحطة فضائية وسط النجوم.',2600],
 ['retroautumn','خريف السبعينات','ألوان الخريف بلمسة ريترو.',1800],
 ['steampunkcity','مدينة الستيم بانك','جزر عائمة وتروس نحاسية.',2200],
 ['underwaterbio','أعماق مضيئة','كائنات بحرية تتلألأ في الظلام.',2200],
 ['animecatcafe','مقهى القطط','مقهى أنمي لطيف مع قطط نائمة.',2000],
 ['ac15','أساسنز كريد','طاولة ذهبية بشعار الأخوية.',2600],
 ['ac15event','حدث الأساسنز','نسخة الحدث بألعاب نارية ذهبية.',2600],
];
const CARDSETS=[
 ['classic','الكلاسيكية','الكروت الأصلية.',0],['nomercy','بلا رحمة','كروت وضع بلا رحمة (تُستخدم في هذا الوضع فقط).',0],
 ['abstracta','تجريدي 1','أنماط تجريدية ملوّنة.',1200],['abstractb','تجريدي 2','خطوط وأشكال حديثة.',1200],['abstractc','تجريدي 3','دوائر ومنحنيات.',1200],
 ['gold','ذهبية','كروت ذهبية فاخرة.',2000],['silver','فضية','لمعان فضي أنيق.',1800],['gems','الجواهر','أحجار كريمة لامعة.',1800],['hologram','هولوغرام','كروت قوس قزح ثلاثية الأبعاد.',1800],
 ['pets','الحيوانات الأليفة','دمى محبوبة على كل كرت.',1600],['cosy','حيوانات القطب','دببة وبطاريق شتوية.',1600],['animecatcafe','مقهى القطط','قطط أنمي لطيفة.',1600],
 ['candy','الحلوى','سكاكر وكعك ملوّن.',1500],['balloon','البالونات','بالونات احتفالية.',1400],['clay','الصلصال','كروت من الطين المصبوغ.',1500],['fabric','القماش','خيوط ونسيج.',1500],['feather','الريش','ريش ناعم ملوّن.',1500],
 ['flowers','الزهور','أزهار الربيع.',1500],['origami','أوريغامي','طي الورق الياباني.',1600],['planets','الكواكب','رحلة في المجموعة الشمسية.',1700],['popart','بوب آرت','أسلوب الكوميكس الصاخب.',1600],
 ['seashells','الأصداف','كنوز الشاطئ.',1500],['lapool','المسبح','صيف وشمس.',1500],['lny','السنة القمرية','فوانيس وتنانين.',1800],['retroautumn','خريف ريترو','أوراق وشخصيات كرتونية.',1600],
 ['steampunkcity','ستيم بانك','جزر عائمة وتروس.',1700],['underwaterbio','الأعماق','مخلوقات بحرية مضيئة.',1700],['decupdate1','شتاء دافئ','مجموعة تحديث الشتاء 1.',1500],['decupdate2','عيد الشتاء','مجموعة تحديث الشتاء 2.',1500],
 ['ac15','أساسنز كريد','كروت الأخوية.',2000],['ac15event','حدث الأساسنز','نسخة الحدث.',2000],
];
const AVATAR_LIST=["AC15_1", "ACK_1_DLC", "ACK_2_DLC", "Adult_1", "Adult_2", "Adult_3", "Adult_4", "Adult_5", "Adult_6", "Adult_7", "Adult_8", "Adult_9", "Animal_1", "Animal_10", "Animal_2", "Animal_3", "Animal_4", "Animal_5", "Animal_6", "Animal_7", "Animal_8", "Animal_9", "AnimeCatCafe_1", "AnimeCatCafe_2", "AnimeCatCafe_3", "AnimeCatCafe_4", "Brawlhalla_1", "Brawlhalla_2", "Brawlhalla_3", "Brawlhalla_4", "CG_Mummy", "CG_Popcorn", "CG_TRex", "Cosy_1", "Cosy_2", "Cosy_3", "Cosy_4", "Creature_1", "Creature_2", "Creature_3", "Creature_4", "IFR_1_DLC", "IFR_2_DLC", "JD_1_DLC", "JD_2_DLC", "Kid_1", "Kid_2", "Kid_3", "LAPool_1", "LAPool_2", "LAPool_3", "LAPool_4", "LNY_1", "LNY_2", "LNY_3", "LNY_4", "NoMercy_1", "NoMercy_2", "Party_01_DLC", "Party_02_DLC", "Rabbids_1_DLC", "Rabbids_2_DLC", "Rayman_1_DLC", "Rayman_2_DLC", "RetroAutumn_1", "RetroAutumn_2", "RetroAutumn_3", "RetroAutumn_4", "Senior_1", "Senior_2", "ShovelKnight_1", "ShovelKnight_2", "ShovelKnight_3", "ShovelKnight_4", "SteampunkCity_1", "SteampunkCity_2", "SteampunkCity_3", "SteampunkCity_4", "Tetra_1_DLC", "Tetra_2_DLC", "TwitchDrop_1", "TwitchDrop_2", "UnderwaterBio_1", "UnderwaterBio_2", "UnderwaterBio_3", "UnderwaterBio_4"];
const FRAME_LIST=["AC15","AnimeCatCafe","Balloon","Bee","Biscuit","Brawlhalla","Brunch","CGChains","CGCircus","CGTheater","Cake","Carp","Castle","Cat","Classic","Cloud","Cosy1","Cosy2","Fabric","Flowers","IceCream","IceCubes","Island","LAPool","LNY1","LNY2","Light","Luxury","NoMercy","Princess","RetroAutumn","Roses","ShovelKnight","Space","SteampunkCity","Temple","TwitchDrop1","TwitchDrop2","UnderwaterBio","Wizard","WWAttackParticipated","WWAttackRanked","WWAttackWinner","WWBigHandsParticipated","WWBigHandsRanked","WWBigHandsWinner","WWFlippedParticipated","WWFlippedRanked","WWFlippedWinner","WWFogOfWarParticipated","WWFogOfWarRanked","WWFogOfWarWinner","WWTinyHandsParticipated","WWTinyHandsRanked","WWTinyHandsWinner","WWWhirlpoolParticipated","WWWhirlpoolRanked","WWWhirlpoolWinner"];
const AVN={CG_Mummy:'مومياء',CG_Popcorn:'فشار',CG_TRex:'ديناصور',Creature:'مخلوق',IFR:'إيموتال فينيكس',Party:'حفلة',Tetra:'تترا',TwitchDrop:'تويتش',AC15:'أساسنز',ACK:'الأخويّة',Adult:'شخصية',Animal:'حيوان',AnimeCatCafe:'مقهى القطط',Brawlhalla:'براولهالا',CG:'كوميك',Cosy:'شتاء',Dev:'المطورون',FC6:'فار كراي',Fenyx:'فينيكس',JD:'جست دانس',Kid:'طفل',LAPool:'المسبح',LNY:'السنة القمرية',NoMercy:'بلا رحمة',Rabbids:'رابيدز',Rayman:'رايمان',RetroAutumn:'خريف',Senior:'كبار',ShovelKnight:'شوفل نايت',SteampunkCity:'ستيم بانك',UnderwaterBio:'الأعماق'};
function avName(a){ if(AVN[a]) return AVN[a]; const m=a.match(/^([A-Za-z0-9]+?)_(\d+)/); return m?`${AVN[m[1]]||m[1]} ${m[2]}`:a; }
function avPrice(a){ return /Adult_[1-3]|Kid_1|Animal_[12]$/.test(a)?0:(/DLC|NoMercy|AC15|ACK|Dev/.test(a)?900:600); }
/* أسماء الإطارات عربيّةً. كانت تُشتقّ من المفتاح اللاتينيّ بفصل الحروف
   الكبيرة، فتخرج «Anime Cat Cafe» في متجرٍ عربيّ كلُّه. */
const FRN={AC15:'أساسنز كريد',AnimeCatCafe:'مقهى القطط',Balloon:'البالونات',Bee:'النحلة',
 Biscuit:'البسكويت',Brawlhalla:'براولهالا',Brunch:'فطورٌ متأخّر',CGChains:'السلاسل',
 CGCircus:'السيرك',CGTheater:'المسرح',Cake:'الكعكة',Carp:'سمكة الكارب',Castle:'القلعة',
 Cat:'القطّة',Classic:'الكلاسيكيّ',Cloud:'السحابة',Cosy1:'دفءٌ ١',Cosy2:'دفءٌ ٢',
 Fabric:'القماش',Flowers:'الزهور',IceCream:'المثلّجات',IceCubes:'مكعّبات الثلج',
 Island:'الجزيرة',LAPool:'المسبح',LNY1:'السنة القمريّة ١',LNY2:'السنة القمريّة ٢',
 Light:'الضوء',Luxury:'الفخامة',NoMercy:'بلا رحمة',Princess:'الأميرة',
 RetroAutumn:'خريف ريترو',Roses:'الورود',ShovelKnight:'شوفل نايت',Space:'الفضاء',
 SteampunkCity:'ستيم بانك',Temple:'المعبد',TwitchDrop1:'تويتش ١',TwitchDrop2:'تويتش ٢',
 UnderwaterBio:'الأعماق',Wizard:'الساحر'};
/* إطارات «الأسبوع الجامح» اسمُها نمطٌ ثابت: الوضع ثم المرتبة */
const WWM={Attack:'الهجوم',BigHands:'الأيدي الكبيرة',Flipped:'المقلوب',FogOfWar:'ضباب الحرب',
 TinyHands:'الأيدي الصغيرة',Whirlpool:'الدوّامة'};
const WWT={Participated:'مشاركة',Ranked:'مرتَّب',Winner:'فائز'};
function frName(f){
  if(FRN[f]) return FRN[f];
  const m=f.match(/^WW(.+?)(Participated|Ranked|Winner)$/);
  if(m) return `أسبوع جامح · ${WWM[m[1]]||m[1]} — ${WWT[m[2]]}`;
  return f.replace(/^WW/,'أسبوع جامح: ').replace(/([a-z])([A-Z])/g,'$1 $2');
}
function frPrice(f){ return f==='Classic'?0:(/^WW/.test(f)?400:700); }
const AVATARS=AVATAR_LIST.map(a=>[a,avName(a),'',avPrice(a)]);
const FRAMES=FRAME_LIST.map(f=>[f,frName(f),'',frPrice(f)]);

if (typeof module !== "undefined" && module.exports)
  module.exports = { BOARDS, CARDSETS, AVATAR_LIST, FRAME_LIST, AVATARS, FRAMES, avName, avPrice, frName, frPrice };
