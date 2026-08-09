/**
 * Best-effort English → Urdu presentation layer for letter generation only.
 * Employee records stay in English (fullName/currentDesignation/currentBranch);
 * these functions convert them for display on generated letters and never
 * throw — an unmapped/unrecognised value falls back to the original English
 * text, since every field that uses this stays editable in the letter wizard.
 */

/** Every designation title from org-structure.ts's DEPARTMENT_DESIGNATIONS. */
const DESIGNATION_UR: Record<string, string> = {
  'MEDICAL OFFICER': 'میڈیکل آفیسر',
  'WOMAN MEDICAL OFFICER': 'وومن میڈیکل آفیسر',
  LHV: 'ایل ایچ وی',
  DOCTOR: 'ڈاکٹر',
  'OPD STAFF': 'او پی ڈی سٹاف',
  'EMERGENCY STAFF': 'ایمرجنسی سٹاف',
  'RECOVERY STAFF': 'ریکوری سٹاف',
  'INJECTION AREA STAFF': 'انجکشن ایریا سٹاف',
  'NURSERY STAFF': 'نرسری سٹاف',
  'INDOOR STAFF': 'انڈور سٹاف',
  'OPERATION MANAGER': 'آپریشن مینیجر',
  'ADMIN MANAGER': 'ایڈمن مینیجر',
  'ADMIN OFFICER': 'ایڈمن آفیسر',
  'PHARMACY STAFF': 'فارمیسی سٹاف',
  'PHARMACY INCHARGE': 'فارمیسی انچارج',
  RECEPTIONIST: 'ریسیپشنسٹ',
  ORTHOPEDIC: 'آرتھوپیڈک',
  PAEDIATRICIAN: 'پیڈیاٹریشن',
  PHYSIOTHERAPIST: 'فزیوتھراپسٹ',
  GYNAECOLOGIST: 'گائناکالوجسٹ',
  DENTIST: 'ڈینٹسٹ',
  DERMATOLOGIST: 'ڈرمیٹولوجسٹ',
  ORTHOMOLOGIST: 'آرتھومولوجسٹ',
  'MEDICAL SPECIALIST': 'میڈیکل سپیشلسٹ',
  'MEDICINE MANAGER': 'میڈیسن مینیجر',
  'ASSISTANT DISPERSAL': 'اسسٹنٹ ڈسپرسل',
  'AUDIT OFFICER': 'آڈٹ آفیسر',
  'LAB MEDICINE': 'لیب میڈیسن',
  'ASSISTANT AUDIT OFFICER': 'اسسٹنٹ آڈٹ آفیسر',
  'LAB OPERATION MANAGER': 'لیب آپریشن مینیجر',
  'LHV ADMIN MANAGER': 'ایل ایچ وی ایڈمن مینیجر',
  'LAB STORE MANAGER': 'لیب سٹور مینیجر',
  'LAB ASSISTANT MANAGER': 'لیب اسسٹنٹ مینیجر',
  'LAB STAFF': 'لیب سٹاف',
  'LAB INCHARGE': 'لیب انچارج',
  'OPERATION THEATER ASSISTANT': 'آپریشن تھیٹر اسسٹنٹ',
  'OPERATION THEATER TECHNICIAN': 'آپریشن تھیٹر ٹیکنیشن',
  SURGEON: 'سرجن',
  ANESTHETIC: 'اینستھیٹک',
  'ORTHOPEDIC ASSISTANT': 'آرتھوپیڈک اسسٹنٹ',
  'DENTAL ASSISTANT': 'ڈینٹل اسسٹنٹ',
  SWEEPER: 'صفائی عملہ',
  'SECURITY GUARD': 'سیکیورٹی گارڈ',
  RADIOGRAPHY: 'ریڈیوگرافی',
  'CONSULTANT RADIOLOGIST': 'کنسلٹنٹ ریڈیولوجسٹ',
  'MEDICAL IMAGING TECHNOLOGY': 'میڈیکل امیجنگ ٹیکنالوجی',
  SONOLOGIST: 'سونولوجسٹ',
  COOK: 'باورچی',
  HELPER: 'ہیلپر',
  'KITCHEN INCHARGE': 'کچن انچارج',
  TANDOORI: 'تندوری',
  'SOFTWARE ENGINEER': 'سافٹ ویئر انجینئر',
  'INCHARGE OF IT': 'آئی ٹی انچارج',
  'INCHARGE MEDIA': 'میڈیا انچارج',
  EDITOR: 'ایڈیٹر',
  CAMERAMAN: 'کیمرہ مین',
  'SOCIAL MEDIA INCHARGE': 'سوشل میڈیا انچارج',
  'IT ASSISTANT': 'آئی ٹی اسسٹنٹ',
  'BEAUTICIAN TEACHER': 'بیوٹیشن ٹیچر',
  'STITCHING TEACHER': 'سلائی ٹیچر',
  'STITCHING HELPERS': 'سلائی ہیلپرز',
  'BEAUTICIAN HELPER': 'بیوٹیشن ہیلپر',
  'ISLAMIC SCHOOL': 'اسلامک سکول',
  PRINCIPAL: 'پرنسپل',
  VTI: 'وی ٹی آئی',
  'BIO MEDICAL ENGINEERS': 'بایو میڈیکل انجینئرز',
  'COORDINATOR INCHARGE': 'کوآرڈینیٹر انچارج',
  PLUMBER: 'پلمبر',
  CARPENTER: 'کارپینٹر',
  ELECTRICIAN: 'الیکٹریشن',
  SUPERVISOR: 'سپروائزر',
  'HR MANAGER': 'ایچ آر مینیجر',
  'HR ADMIN': 'ایچ آر ایڈمن',
  'HR OPERATION MANAGER': 'ایچ آر آپریشن مینیجر',
  'HR ASSISTANT': 'ایچ آر اسسٹنٹ',
  'HR STAFF': 'ایچ آر سٹاف',
  'PROGRESS OFFICER': 'پراگریس آفیسر',
  'GYNAE MANAGER': 'گائنی مینیجر',
  'MONITORING OFFICER': 'مانیٹرنگ آفیسر',
  'REPORTING OFFICER': 'رپورٹنگ آفیسر',
  'FINANCE REPRESENTATIVE': 'فنانس ریپریزنٹیٹو',
  'ACCOUNT ASSISTANT': 'اکاؤنٹ اسسٹنٹ',
  'ACCOUNT MANAGER': 'اکاؤنٹ مینیجر',
  'CENTRAL ACCOUNTANT': 'سنٹرل اکاؤنٹنٹ',
};

export function translateDesignation(title?: string | null): string {
  const key = (title ?? '').trim().toUpperCase();
  if (!key) return '';
  return DESIGNATION_UR[key] ?? title ?? '';
}

/** Every branch name from prisma/seed.ts's branch lists, matched exactly. */
const BRANCH_UR: Record<string, string> = {
  'YCDO Central Hospital': 'YCDO ہسپتال سنٹرل برانچ ملتان پاکستان',
  'YCDO Central Hospital Consultant Floor':
    'YCDO ہسپتال سنٹرل کنسلٹنٹ فلور برانچ ملتان پاکستان',
  'YCDO Hospital Hassan Abad': 'YCDO ہسپتال حسن آباد برانچ ملتان پاکستان',
  'Idrees Memorial YCDO Hospital':
    'ادریس میموریل YCDO ہسپتال برانچ ملتان پاکستان',
  'YCDO Hospital Hassan Parwana': 'YCDO ہسپتال حسن پروانہ برانچ ملتان پاکستان',
  'YCDO Hospital Suraj Kund': 'YCDO ہسپتال سورج کنڈ برانچ ملتان پاکستان',
  'YCDO Executive Hospital-I': 'YCDO ایگزیکٹو ہسپتال۔۱ برانچ ملتان پاکستان',
  'YCDO Executive-I Consultant Floor':
    'YCDO ایگزیکٹو۔۱ کنسلٹنٹ فلور برانچ ملتان پاکستان',
  'YCDO Executive Hospital-II Mother & Child Care':
    'YCDO ایگزیکٹو ہسپتال۔۲ مدر اینڈ چائلڈ کیئر برانچ ملتان پاکستان',
  'YCDO Hospital Jumma Wala': 'YCDO ہسپتال جمعہ والا برانچ ملتان پاکستان',
  'YCDO Hospital Bilawal Pur': 'YCDO ہسپتال بلاول پور برانچ ملتان پاکستان',
  'YCDO Hospital Pul Dhram Pura': 'YCDO ہسپتال پل دھرم پورہ برانچ ملتان پاکستان',
  'Allah Dad Memorial YCDO Hospital':
    'اللہ داد میموریل YCDO ہسپتال برانچ ملتان پاکستان',
  'YCDO Diagnostic Centre': 'YCDO ڈائیگناسٹک سنٹر برانچ ملتان پاکستان',
  'Police & YCDO Drug Rehabilitation Hospital':
    'پولیس اینڈ YCDO ڈرگ ریہیبیلیٹیشن ہسپتال برانچ ملتان پاکستان',
  'YCDO Hospital Budhla Santt': 'YCDO ہسپتال بدھلہ سانت برانچ ملتان پاکستان',
  'YCDO Hospital Sikandar Abad': 'YCDO ہسپتال سکندر آباد برانچ ملتان پاکستان',
  'YCDO Ghazi National Hospital E-III':
    'YCDO غازی نیشنل ہسپتال ای۔۳ برانچ ڈیرہ غازی خان پاکستان',
  'YCDO AR Executive-IV Hospital':
    'YCDO اے آر ایگزیکٹو۔۴ ہسپتال برانچ ڈیرہ غازی خان پاکستان',
  'YCDO Executive-V Drug Rehabilitation Hospital':
    'YCDO ایگزیکٹو۔۵ ڈرگ ریہیبیلیٹیشن ہسپتال برانچ ملتان پاکستان',
  'YCDO Islamabad Allergy Vaccination Centre':
    'YCDO اسلام آباد ایلرجی ویکسینیشن سنٹر برانچ ملتان پاکستان',
  'YCDO Head Office': 'YCDO ہیڈ آفس ملتان پاکستان',
  'YCDO Medical Complex': 'YCDO میڈیکل کمپلیکس برانچ ملتان پاکستان',
  'YCDO Executive Hospital-V': 'YCDO ایگزیکٹو ہسپتال۔۵ برانچ ملتان پاکستان',
  'YCDO Executive Hospital-VI': 'YCDO ایگزیکٹو ہسپتال۔۶ برانچ ملتان پاکستان',
  'YCDO Executive Hospital-VII': 'YCDO ایگزیکٹو ہسپتال۔۷ برانچ ملتان پاکستان',
  'YCDO Rashan Department': 'YCDO راشن ڈیپارٹمنٹ ملتان پاکستان',
  'YCDO Kitchen Masoom Shah': 'YCDO کچن معصوم شاہ ملتان پاکستان',
  'YCDO Kitchen Ghanta Ghar': 'YCDO کچن گھنٹہ گھر ملتان پاکستان',
  'YCDO Kitchen Qasim Pur': 'YCDO کچن قاسم پور ملتان پاکستان',
  'YCDO Kitchen Ghazi Abad': 'YCDO کچن غازی آباد ملتان پاکستان',
  'YCDO Ramzan Sehar o Aftaar': 'YCDO رمضان سحر و افطار ملتان پاکستان',
  'YCDO Water Filtration RO Plant Sabzwari':
    'YCDO واٹر فلٹریشن آر او پلانٹ سبزواری ملتان پاکستان',
  'YCDO Water Filtration RO Plant Basti Dogran':
    'YCDO واٹر فلٹریشن آر او پلانٹ بستی ڈوگراں ملتان پاکستان',
  'YCDO Water Filtration RO Plant Lodhran':
    'YCDO واٹر فلٹریشن آر او پلانٹ لودھراں پاکستان',
  'YCDO VTI For Women Qasim Pur':
    'YCDO وی ٹی آئی فار ویمن قاسم پور ملتان پاکستان',
  'YCDO VTI For Women Basti Malook':
    'YCDO وی ٹی آئی فار ویمن بستی ملوک ملتان پاکستان',
  'YCDO VTI Under Development': 'YCDO وی ٹی آئی (زیرِ تعمیر) ملتان پاکستان',
  'YCDO Paramedical & Allied Sciences College':
    'YCDO پیرامیڈیکل اینڈ الائیڈ سائنسز کالج ملتان پاکستان',
  'YCDO Jahez Program': 'YCDO جہیز پروگرام ملتان پاکستان',
  'YCDO Financial Assistance for Education':
    'YCDO فنانشل اسسٹنس فار ایجوکیشن ملتان پاکستان',
  'Software House HQ': 'YCDO سافٹ ویئر ہاؤس ہیڈ آفس ملتان پاکستان',
};

export function translateBranch(branchName?: string | null): string {
  const name = (branchName ?? '').trim();
  if (!name) return '';
  return BRANCH_UR[name] ?? name;
}

/**
 * Most frequent Pakistani first/last name components, phonetic spelling
 * (lowercase) → correct Urdu script. Checked word-by-word before falling
 * back to phoneticTransliterate() for anything not covered here.
 */
const COMMON_NAME_PARTS_UR: Record<string, string> = {
  muhammad: 'محمد',
  mohammad: 'محمد',
  mohammed: 'محمد',
  ahmed: 'احمد',
  ahmad: 'احمد',
  ali: 'علی',
  khan: 'خان',
  hassan: 'حسن',
  hasan: 'حسن',
  hussain: 'حسین',
  husain: 'حسین',
  fatima: 'فاطمہ',
  fatimah: 'فاطمہ',
  ayesha: 'عائشہ',
  aisha: 'عائشہ',
  malik: 'ملک',
  raza: 'رضا',
  bibi: 'بی بی',
  sheikh: 'شیخ',
  shaikh: 'شیخ',
  qureshi: 'قریشی',
  abdul: 'عبد',
  iqbal: 'اقبال',
  zahra: 'زہرہ',
  bilal: 'بلال',
  zainab: 'زینب',
  omar: 'عمر',
  umar: 'عمر',
  farooq: 'فاروق',
  sana: 'ثناء',
  tariq: 'طارق',
  mehmood: 'محمود',
  mahmood: 'محمود',
  nadia: 'نادیہ',
  rehman: 'رحمان',
  rahman: 'رحمان',
  sultan: 'سلطان',
  shah: 'شاہ',
  yasin: 'یٰسین',
  saeed: 'سعید',
  waheed: 'وحید',
  naveed: 'نوید',
  kashif: 'کاشف',
  imran: 'عمران',
  usman: 'عثمان',
  kamran: 'کامران',
  adnan: 'عدنان',
  faisal: 'فیصل',
  zubair: 'زبیر',
  arslan: 'ارسلان',
  amir: 'عامر',
  ameer: 'امیر',
  waqas: 'وقاص',
  junaid: 'جنید',
  danish: 'دانش',
  rizwan: 'رضوان',
  farhan: 'فرحان',
  asim: 'عاصم',
  nabeel: 'نبیل',
  saad: 'سعد',
  hamza: 'حمزہ',
  anas: 'انس',
  talha: 'طلحہ',
  zain: 'زین',
  shahzad: 'شہزاد',
  aslam: 'اسلم',
  akhtar: 'اختر',
  yaqoob: 'یعقوب',
  shabbir: 'شبیر',
  yousuf: 'یوسف',
  yusuf: 'یوسف',
  idrees: 'ادریس',
  idris: 'ادریس',
  bashir: 'بشیر',
  anwar: 'انور',
  karim: 'کریم',
  kareem: 'کریم',
  rashid: 'رشید',
  latif: 'لطیف',
  hafeez: 'حفیظ',
  aziz: 'عزیز',
  jamil: 'جمیل',
  nasir: 'ناصر',
  tahir: 'طاہر',
  shahid: 'شاہد',
  javed: 'جاوید',
  rafiq: 'رفیق',
  sadiq: 'صادق',
  siddiqui: 'صدیقی',
  ansari: 'انصاری',
  abbasi: 'عباسی',
  baig: 'بیگ',
  gilani: 'گیلانی',
  chishti: 'چشتی',
  rizvi: 'رضوی',
  naqvi: 'نقوی',
  jafri: 'جعفری',
  kazmi: 'کاظمی',
  hashmi: 'ہاشمی',
  warraich: 'وڑائچ',
  cheema: 'چیمہ',
  dogar: 'ڈوگر',
  sial: 'سیال',
  bhatti: 'بھٹی',
  chaudhry: 'چوہدری',
  chaudhary: 'چوہدری',
  chowdhry: 'چوہدری',
  butt: 'بٹ',
  awan: 'اعوان',
  gul: 'گل',
  nawaz: 'نواز',
  sadia: 'سعدیہ',
  saima: 'سائمہ',
  mehwish: 'مہوش',
  mehak: 'مہک',
  nida: 'ندا',
  rabia: 'رابعہ',
  amna: 'آمنہ',
  hina: 'حنا',
  sobia: 'ثوبیہ',
  kiran: 'کرن',
  iqra: 'اقرا',
  farah: 'فرح',
  rida: 'ردا',
  maria: 'ماریہ',
  alina: 'الینہ',
  anum: 'انم',
  nimra: 'نمرہ',
  uzma: 'عظمیٰ',
  naila: 'نائلہ',
  shaista: 'شائستہ',
  yusra: 'یسریٰ',
  zara: 'زارا',
  areeba: 'اریبہ',
  laiba: 'لائبہ',
  mahnoor: 'مہ نور',
  wardah: 'وردہ',
  eman: 'ایمان',
  iman: 'ایمان',
  amara: 'امارہ',
  noor: 'نور',
  bushra: 'بشریٰ',
  zunaira: 'زنیرہ',
  mehreen: 'مہرین',
  sumaira: 'سمیرا',
  shazia: 'شازیہ',
  rukhsana: 'رخسانہ',
  kausar: 'کوثر',
  kouser: 'کوثر',
  nusrat: 'نصرت',
  parveen: 'پروین',
  yasmin: 'یاسمین',
  roshan: 'روشن',
  rani: 'رانی',
  bano: 'بانو',
  begum: 'بیگم',
  sara: 'سارہ',
  sarah: 'سارہ',
  zafar: 'ظفر',
  ashraf: 'اشرف',
  ghulam: 'غلام',
  irfan: 'عرفان',
  asad: 'اسد',
  sajjad: 'سجاد',
  shoaib: 'شعیب',
  haris: 'حارث',
  fahad: 'فہد',
  moin: "معین",
  qasim: 'قاسم',
  huma: 'ہما',
  sidra: 'سدرہ',
  komal: 'کومل',
  saira: 'سائرہ',
  amber: 'عنبر',
  fizza: 'فضہ',
  aleena: 'الینہ',
  rimsha: 'رمشا',
  hafsa: 'حفصہ',
  aiman: 'ایمن',
  sumbal: 'سنبل',
};

/**
 * Rule-based phonetic fallback: greedy longest-match over common Roman-Urdu
 * digraphs, then single letters. Inherently approximate — used only for
 * words not found in COMMON_NAME_PARTS_UR.
 */
const DIGRAPH_RULES: [string, string][] = [
  ['kh', 'خ'],
  ['gh', 'غ'],
  ['sh', 'ش'],
  ['ch', 'چ'],
  ['th', 'تھ'],
  ['dh', 'ڈھ'],
  ['bh', 'بھ'],
  ['ph', 'ف'],
  ['zh', 'ژ'],
  ['aa', 'ا'],
  ['ee', 'ی'],
  ['oo', 'و'],
  ['ou', 'او'],
  ['ai', 'ی'],
  ['ay', 'ے'],
];

const SINGLE_LETTER_RULES: Record<string, string> = {
  a: 'ا',
  b: 'ب',
  c: 'ک',
  d: 'د',
  e: 'ے',
  f: 'ف',
  g: 'گ',
  h: 'ہ',
  i: 'ی',
  j: 'ج',
  k: 'ک',
  l: 'ل',
  m: 'م',
  n: 'ن',
  o: 'او',
  p: 'پ',
  q: 'ق',
  r: 'ر',
  s: 'س',
  t: 'ت',
  u: 'و',
  v: 'و',
  w: 'و',
  x: 'کس',
  y: 'ی',
  z: 'ز',
};

function phoneticTransliterate(word: string): string {
  const lower = word.toLowerCase();
  let out = '';
  let i = 0;
  while (i < lower.length) {
    const ch = lower[i];
    if (!/[a-z]/.test(ch)) {
      out += ch;
      i += 1;
      continue;
    }
    const digraph = DIGRAPH_RULES.find(([pattern]) =>
      lower.startsWith(pattern, i),
    );
    if (digraph) {
      out += digraph[1];
      i += digraph[0].length;
      continue;
    }
    out += SINGLE_LETTER_RULES[ch] ?? '';
    i += 1;
  }
  return out;
}

export function transliterateName(fullName?: string | null): string {
  const name = (fullName ?? '').trim();
  if (!name) return '';
  return name
    .split(/\s+/)
    .map((word) => {
      const cleaned = word.replace(/[^a-zA-Z]/g, '');
      if (!cleaned) return word;
      const dictHit = COMMON_NAME_PARTS_UR[cleaned.toLowerCase()];
      return dictHit ?? phoneticTransliterate(cleaned);
    })
    .join(' ');
}
