/**
 * Wage slip rendering — two formats, and only two.
 *
 *  1. Printable HTML. The browser turns it into a PDF (Ctrl/Cmd + P → Save as
 *     PDF). There is no PDF library here and no server-side binary: generating a
 *     PDF server-side would mean embedding six Indic scripts into fonts, which
 *     is a dependency and a licensing question for no gain the browser does not
 *     already give us.
 *  2. Plain text, in the worker's language, for WhatsApp/SMS where the worker
 *     has no browser at all.
 *
 * The slip's legal note stays in English in both formats: it is the sentence
 * that says what the document is and is not, and a mistranslated disclaimer is
 * worse than an English one the reader can have explained.
 */
import { SLIP_LANGUAGES } from "../models/WageSlip.js";

const EN = {
  slip_title: "FORM V — WAGE SLIP",
  slip_number: "Slip number",
  date_of_issue: "Date of issue",
  establishment: "Name of establishment",
  establishment_address: "Address of establishment",
  registration_number: "Registration number",
  wage_period: "Wage period",
  wage_period_days: "Days in wage period",
  employee_name: "Name of employee",
  employee_code: "Worker ID",
  relation_name: "Father's / mother's / spouse's name",
  designation: "Designation",
  uan: "UAN",
  bank_account: "Bank account",
  attendance: "Total attendance / units",
  basic_wages: "Basic wages",
  da: "Dearness allowance",
  allowances: "Other allowances",
  overtime_wages: "Overtime wages",
  gross_wages: "Gross wages",
  deductions: "Deductions",
  pf: "Provident fund (PF)",
  esi: "ESI",
  other_deductions: "Other deductions",
  total_deductions: "Total deductions",
  net_wages: "Net wages",
  employer_signature: "Signature of employer",
  not_recorded: "Not recorded",
  retain_until: "Keep this slip until",
  superseded: "SUPERSEDED — this slip has been replaced by a later one",
  print_hint: "Print this page (Ctrl/Cmd + P) and choose ‘Save as PDF’.",
  derived_note:
    "Derived from the Code on Wages 2019 and the Wages (Central) Rules 2026. State rules may differ.",
  money: "Rs",
  days: "days",
  units: "units",
  muster_title: "FORM IX — ATTENDANCE-CUM-MUSTER ROLL",
  month: "Month",
  sl_no: "Sl. No.",
  total_days: "Total days",
  total_ot_hours: "Total OT hours",
  shift: "Shift",
  place_of_work: "Place of work",
  tour_details: "Tour details",
  keeper_signature: "Signature of register keeper",
  present: "P",
  no_engagements: "No confirmed engagements for this month.",
};

const STRINGS = {
  en: EN,
  hi: {
    slip_title: "फॉर्म V — वेतन पर्ची",
    slip_number: "पर्ची संख्या",
    date_of_issue: "जारी करने की तिथि",
    establishment: "प्रतिष्ठान का नाम",
    establishment_address: "प्रतिष्ठान का पता",
    registration_number: "पंजीकरण संख्या",
    wage_period: "वेतन अवधि",
    wage_period_days: "वेतन अवधि के दिन",
    employee_name: "कर्मचारी का नाम",
    employee_code: "श्रमिक आईडी",
    relation_name: "पिता / माता / जीवनसाथी का नाम",
    designation: "पदनाम",
    uan: "यूएएन",
    bank_account: "बैंक खाता",
    attendance: "कुल उपस्थिति / इकाइयाँ",
    basic_wages: "मूल वेतन",
    da: "महंगाई भत्ता",
    allowances: "अन्य भत्ते",
    overtime_wages: "ओवरटाइम वेतन",
    gross_wages: "कुल वेतन",
    deductions: "कटौतियाँ",
    pf: "भविष्य निधि (पीएफ)",
    esi: "ईएसआई",
    other_deductions: "अन्य कटौतियाँ",
    total_deductions: "कुल कटौतियाँ",
    net_wages: "शुद्ध वेतन",
    employer_signature: "नियोक्ता का हस्ताक्षर",
    not_recorded: "दर्ज नहीं",
    retain_until: "यह पर्ची तब तक रखें",
    superseded: "यह पर्ची बदल दी गई है — नई पर्ची जारी हो चुकी है",
    print_hint: "इस पृष्ठ को प्रिंट करें (Ctrl/Cmd + P) और ‘Save as PDF’ चुनें।",
    derived_note: "कोड ऑन वेजेज 2019 और वेजेज (सेंट्रल) रूल्स 2026 से लिया गया। राज्य के नियम भिन्न हो सकते हैं।",
    money: "रु",
    days: "दिन",
    units: "इकाई",
    muster_title: "फॉर्म IX — उपस्थिति सह मस्टर रोल",
    month: "माह",
    sl_no: "क्र.सं.",
    total_days: "कुल दिन",
    total_ot_hours: "कुल ओवरटाइम घंटे",
    shift: "पाली",
    place_of_work: "कार्य स्थल",
    tour_details: "दौरा विवरण",
    keeper_signature: "रजिस्टर रखने वाले का हस्ताक्षर",
    present: "उ",
    no_engagements: "इस माह कोई पुष्ट कार्य दिवस नहीं।",
  },
  ml: {
    slip_title: "ഫോറം V — കൂലി രസീത്",
    slip_number: "രസീത് നമ്പർ",
    date_of_issue: "നൽകിയ തീയതി",
    establishment: "സ്ഥാപനത്തിന്റെ പേര്",
    establishment_address: "സ്ഥാപനത്തിന്റെ വിലാസം",
    registration_number: "രജിസ്ട്രേഷൻ നമ്പർ",
    wage_period: "കൂലി കാലയളവ്",
    wage_period_days: "കൂലി കാലയളവിലെ ദിവസങ്ങൾ",
    employee_name: "തൊഴിലാളിയുടെ പേര്",
    employee_code: "തൊഴിലാളി ഐഡി",
    relation_name: "പിതാവ് / മാതാവ് / ജീവിതപങ്കാളിയുടെ പേര്",
    designation: "തസ്തിക",
    uan: "യു.എ.എൻ",
    bank_account: "ബാങ്ക് അക്കൗണ്ട്",
    attendance: "ആകെ ഹാജർ / യൂണിറ്റുകൾ",
    basic_wages: "അടിസ്ഥാന കൂലി",
    da: "ഡി.എ.",
    allowances: "മറ്റ് അലവൻസുകൾ",
    overtime_wages: "ഓവർടൈം കൂലി",
    gross_wages: "മൊത്ത കൂലി",
    deductions: "കിഴിവുകൾ",
    pf: "പ്രൊവിഡന്റ് ഫണ്ട് (പി.എഫ്.)",
    esi: "ഇ.എസ്.ഐ.",
    other_deductions: "മറ്റ് കിഴിവുകൾ",
    total_deductions: "ആകെ കിഴിവ്",
    net_wages: "അറ്റ കൂലി",
    employer_signature: "തൊഴിലുടമയുടെ ഒപ്പ്",
    not_recorded: "രേഖപ്പെടുത്തിയിട്ടില്ല",
    retain_until: "ഈ രസീത് സൂക്ഷിക്കേണ്ട തീയതി",
    superseded: "ഈ രസീത് മാറ്റിസ്ഥാപിച്ചിരിക്കുന്നു — പുതിയ രസീത് നൽകിയിട്ടുണ്ട്",
    print_hint: "ഈ പേജ് പ്രിന്റ് ചെയ്ത് (Ctrl/Cmd + P) ‘Save as PDF’ തിരഞ്ഞെടുക്കുക.",
    derived_note: "2019-ലെ വേജസ് കോഡിൽ നിന്നും 2026-ലെ വേജസ് (സെൻട്രൽ) റൂളിൽ നിന്നും തയ്യാറാക്കിയത്. സംസ്ഥാന നിയമങ്ങൾ വ്യത്യസ്തമായിരിക്കാം.",
    money: "രൂ",
    days: "ദിവസം",
    units: "യൂണിറ്റ്",
    muster_title: "ഫോറം IX — ഹാജർ കം മസ്റ്റർ റോൾ",
    month: "മാസം",
    sl_no: "ക്ര.നം.",
    total_days: "ആകെ ദിവസങ്ങൾ",
    total_ot_hours: "ആകെ ഓവർടൈം മണിക്കൂർ",
    shift: "ഷിഫ്റ്റ്",
    place_of_work: "ജോലിസ്ഥലം",
    tour_details: "യാത്രാവിവരങ്ങൾ",
    keeper_signature: "രജിസ്റ്റർ സൂക്ഷിപ്പുകാരന്റെ ഒപ്പ്",
    present: "ഹാ",
    no_engagements: "ഈ മാസം സ്ഥിരീകരിച്ച ജോലിദിനങ്ങൾ ഇല്ല.",
  },
  ta: {
    slip_title: "படிவம் V — ஊதியச் சீட்டு",
    slip_number: "சீட்டு எண்",
    date_of_issue: "வழங்கிய தேதி",
    establishment: "நிறுவனத்தின் பெயர்",
    establishment_address: "நிறுவனத்தின் முகவரி",
    registration_number: "பதிவு எண்",
    wage_period: "ஊதியக் காலம்",
    wage_period_days: "ஊதியக் கால நாட்கள்",
    employee_name: "தொழிலாளர் பெயர்",
    employee_code: "தொழிலாளர் ஐடி",
    relation_name: "தந்தை / தாய் / துணைவர் பெயர்",
    designation: "பதவி",
    uan: "யுஏஎன்",
    bank_account: "வங்கிக் கணக்கு",
    attendance: "மொத்த வருகை / அலகுகள்",
    basic_wages: "அடிப்படை ஊதியம்",
    da: "அகவிலைப்படி",
    allowances: "மற்ற படிகள்",
    overtime_wages: "மேலதிக நேர ஊதியம்",
    gross_wages: "மொத்த ஊதியம்",
    deductions: "பிடித்தங்கள்",
    pf: "வருங்கால வைப்பு நிதி (பிஎஃப்)",
    esi: "இஎஸ்ஐ",
    other_deductions: "மற்ற பிடித்தங்கள்",
    total_deductions: "மொத்த பிடித்தம்",
    net_wages: "நிகர ஊதியம்",
    employer_signature: "முதலாளியின் கையொப்பம்",
    not_recorded: "பதிவு செய்யப்படவில்லை",
    retain_until: "இந்தச் சீட்டை வைத்திருக்க வேண்டிய தேதி",
    superseded: "இந்தச் சீட்டு மாற்றப்பட்டுவிட்டது — புதிய சீட்டு வழங்கப்பட்டுள்ளது",
    print_hint: "இந்தப் பக்கத்தை அச்சிட்டு (Ctrl/Cmd + P) ‘Save as PDF’ தேர்ந்தெடுக்கவும்.",
    derived_note: "2019 ஊதியச் சட்டத்திலும் 2026 ஊதிய (மத்திய) விதிகளிலும் இருந்து எடுக்கப்பட்டது. மாநில விதிகள் வேறுபடலாம்.",
    money: "ரூ",
    days: "நாட்கள்",
    units: "அலகுகள்",
    muster_title: "படிவம் IX — வருகை மற்றும் மஸ்டர் பட்டியல்",
    month: "மாதம்",
    sl_no: "வ.எண்",
    total_days: "மொத்த நாட்கள்",
    total_ot_hours: "மொத்த ஓவர்டைம் மணிநேரம்",
    shift: "பணி நேரம்",
    place_of_work: "பணியிடம்",
    tour_details: "பயண விவரங்கள்",
    keeper_signature: "பட்டியல் காப்பாளர் கையொப்பம்",
    present: "வ",
    no_engagements: "இந்த மாதத்தில் உறுதிப்படுத்தப்பட்ட பணி நாட்கள் இல்லை.",
  },
  te: {
    slip_title: "ఫారం V — వేతన రసీదు",
    slip_number: "రసీదు సంఖ్య",
    date_of_issue: "జారీ చేసిన తేదీ",
    establishment: "సంస్థ పేరు",
    establishment_address: "సంస్థ చిరునామా",
    registration_number: "నమోదు సంఖ్య",
    wage_period: "వేతన కాలం",
    wage_period_days: "వేతన కాల రోజులు",
    employee_name: "కార్మికుడి పేరు",
    employee_code: "కార్మికుడి ఐడీ",
    relation_name: "తండ్రి / తల్లి / జీవిత భాగస్వామి పేరు",
    designation: "హోదా",
    uan: "యూఏఎన్",
    bank_account: "బ్యాంక్ ఖాతా",
    attendance: "మొత్తం హాజరు / యూనిట్లు",
    basic_wages: "ప్రాథమిక వేతనం",
    da: "డీఏ",
    allowances: "ఇతర భత్యాలు",
    overtime_wages: "ఓవర్‌టైమ్ వేతనం",
    gross_wages: "మొత్తం వేతనం",
    deductions: "మినహాయింపులు",
    pf: "ప్రావిడెంట్ ఫండ్ (పీఎఫ్)",
    esi: "ఈఎస్‌ఐ",
    other_deductions: "ఇతర మినహాయింపులు",
    total_deductions: "మొత్తం మినహాయింపు",
    net_wages: "నికర వేతనం",
    employer_signature: "యజమాని సంతకం",
    not_recorded: "నమోదు కాలేదు",
    retain_until: "ఈ రసీదును ఉంచుకోవాల్సిన తేదీ",
    superseded: "ఈ రసీదు భర్తీ చేయబడింది — కొత్త రసీదు జారీ అయింది",
    print_hint: "ఈ పేజీని ప్రింట్ చేసి (Ctrl/Cmd + P) ‘Save as PDF’ ఎంచుకోండి.",
    derived_note: "2019 వేజెస్ కోడ్ మరియు 2026 వేజెస్ (సెంట్రల్) రూల్స్ నుండి తీసుకోబడింది. రాష్ట్ర నియమాలు భిన్నంగా ఉండవచ్చు.",
    money: "రూ",
    days: "రోజులు",
    units: "యూనిట్లు",
    muster_title: "ఫారం IX — హాజరు మరియు మస్టర్ రోల్",
    month: "నెల",
    sl_no: "క్ర.సం.",
    total_days: "మొత్తం రోజులు",
    total_ot_hours: "మొత్తం ఓవర్‌టైమ్ గంటలు",
    shift: "షిఫ్ట్",
    place_of_work: "పని ప్రదేశం",
    tour_details: "పర్యటన వివరాలు",
    keeper_signature: "రిజిస్టర్ నిర్వాహకుడి సంతకం",
    present: "హా",
    no_engagements: "ఈ నెలలో నిర్ధారిత పని దినాలు లేవు.",
  },
  bn: {
    slip_title: "ফরম V — মজুরি রসিদ",
    slip_number: "রসিদ নম্বর",
    date_of_issue: "জারির তারিখ",
    establishment: "প্রতিষ্ঠানের নাম",
    establishment_address: "প্রতিষ্ঠানের ঠিকানা",
    registration_number: "নিবন্ধন নম্বর",
    wage_period: "মজুরি সময়কাল",
    wage_period_days: "মজুরি সময়কালের দিন",
    employee_name: "শ্রমিকের নাম",
    employee_code: "শ্রমিক আইডি",
    relation_name: "পিতা / মাতা / স্বামী বা স্ত্রীর নাম",
    designation: "পদবি",
    uan: "ইউএএন",
    bank_account: "ব্যাংক অ্যাকাউন্ট",
    attendance: "মোট উপস্থিতি / একক",
    basic_wages: "মূল মজুরি",
    da: "ডিএ",
    allowances: "অন্যান্য ভাতা",
    overtime_wages: "ওভারটাইম মজুরি",
    gross_wages: "মোট মজুরি",
    deductions: "কর্তন",
    pf: "প্রভিডেন্ট ফান্ড (পিএফ)",
    esi: "ইএসআই",
    other_deductions: "অন্যান্য কর্তন",
    total_deductions: "মোট কর্তন",
    net_wages: "নিট মজুরি",
    employer_signature: "নিয়োগকর্তার স্বাক্ষর",
    not_recorded: "নথিভুক্ত নয়",
    retain_until: "এই রসিদটি রাখুন",
    superseded: "এই রসিদটি প্রতিস্থাপিত হয়েছে — নতুন রসিদ জারি হয়েছে",
    print_hint: "এই পৃষ্ঠাটি প্রিন্ট করুন (Ctrl/Cmd + P) এবং ‘Save as PDF’ বেছে নিন।",
    derived_note: "২০১৯ সালের মজুরি কোড এবং ২০২৬ সালের মজুরি (কেন্দ্রীয়) বিধি থেকে নেওয়া। রাজ্যের নিয়ম ভিন্ন হতে পারে।",
    money: "৳",
    days: "দিন",
    units: "একক",
    muster_title: "ফরম IX — উপস্থিতি ও মাস্টার রোল",
    month: "মাস",
    sl_no: "ক্রম নং",
    total_days: "মোট দিন",
    total_ot_hours: "মোট ওভারটাইম ঘণ্টা",
    shift: "শিফট",
    place_of_work: "কর্মস্থল",
    tour_details: "সফরের বিবরণ",
    keeper_signature: "রেজিস্টার রক্ষকের স্বাক্ষর",
    present: "উ",
    no_engagements: "এই মাসে কোনো নিশ্চিত কর্মদিবস নেই।",
  },
};

export function stringsFor(language) {
  return STRINGS[language] || STRINGS.en;
}

export function resolveLanguage(language) {
  return SLIP_LANGUAGES.includes(String(language || "")) ? String(language) : "en";
}

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const isoDay = (value) => (value ? new Date(value).toISOString().slice(0, 10) : null);

const money = (amount) =>
  Number(amount).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A null statutory field renders as the localised "not recorded", never as 0. */
function value(t, raw, { formatter } = {}) {
  if (raw === null || raw === undefined || raw === "") return t.not_recorded;
  return formatter ? formatter(raw) : String(raw);
}

/* ── Plain text ────────────────────────────────────────────────────── */

export function renderSlipText(slip, language) {
  const lang = resolveLanguage(language || slip.language);
  const t = stringsFor(lang);
  const line = "-----------------------------------------------";
  const out = [];

  const row = (label, v) => out.push(`${label}: ${v}`);

  out.push(t.slip_title);
  if (slip.status === "superseded") out.push(`** ${t.superseded} **`);
  out.push(line);
  row(t.slip_number, slip.slip_number);
  row(t.date_of_issue, isoDay(slip.issue_date));
  row(t.establishment, slip.establishment.name);
  row(t.establishment_address, value(t, slip.establishment.address));
  row(t.registration_number, value(t, slip.establishment.registration_number));
  out.push(line);
  row(t.wage_period, `${isoDay(slip.wage_period.from)} — ${isoDay(slip.wage_period.to)}`);
  row(t.wage_period_days, slip.wage_period.days);
  row(t.employee_name, slip.employee.name);
  row(t.employee_code, value(t, slip.employee.code));
  row(t.relation_name, value(t, slip.employee.father_or_mother_or_spouse_name));
  row(t.designation, value(t, slip.employee.designation));
  row(t.uan, value(t, slip.employee.uan));
  row(t.bank_account, value(t, slip.employee.bank_account));
  row(
    t.attendance,
    slip.attendance.value === null || slip.attendance.value === undefined
      ? t.not_recorded
      : `${slip.attendance.value} ${slip.attendance.kind === "unit" ? t.units : t.days}`
  );
  out.push(line);
  const amt = (v) => (v === null || v === undefined ? t.not_recorded : `${t.money} ${money(v)}`);
  row(t.basic_wages, amt(slip.earnings.basic));
  row(t.da, amt(slip.earnings.da));
  row(t.allowances, amt(slip.earnings.allowances));
  row(t.overtime_wages, amt(slip.earnings.overtime));
  row(t.gross_wages, amt(slip.gross_wages));
  out.push(line);
  row(t.pf, amt(slip.deductions.pf));
  row(t.esi, amt(slip.deductions.esi));
  row(t.other_deductions, amt(slip.deductions.other));
  row(t.total_deductions, amt(slip.total_deductions));
  row(t.net_wages, amt(slip.net_wages));
  out.push(line);
  row(t.employer_signature, slip.signature.name);
  row(t.retain_until, isoDay(slip.retain_until));
  out.push("");
  out.push(t.derived_note);
  out.push(slip.form_source_note);
  return out.join("\n");
}

/* ── Printable HTML ────────────────────────────────────────────────── */

const STYLE = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font-family: "Noto Sans", "Segoe UI", system-ui, sans-serif; margin: 0; padding: 24px;
         color: #111; background: #fff; font-size: 13px; line-height: 1.45; }
  .sheet { max-width: 820px; margin: 0 auto; }
  .hint { font-size: 11px; color: #555; border: 1px dashed #bbb; padding: 6px 10px;
          border-radius: 6px; margin-bottom: 16px; }
  h1 { font-size: 18px; margin: 0 0 2px; letter-spacing: .02em; }
  .meta { color: #444; font-size: 12px; margin-bottom: 12px; }
  .superseded { background: #fff4e5; border: 1px solid #e0a458; color: #7a4a00;
                padding: 8px 10px; border-radius: 6px; font-weight: 600; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
  th, td { border: 1px solid #999; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #f2f2f2; font-weight: 600; width: 42%; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  tr.total th, tr.total td { font-weight: 700; background: #fafafa; }
  .absent { color: #777; font-style: italic; }
  .note { font-size: 11px; color: #333; border-top: 1px solid #ccc; padding-top: 8px; margin-top: 14px; }
  .sign { margin-top: 34px; display: flex; justify-content: space-between; gap: 40px; }
  .sign div { flex: 1; }
  .sign .line { border-top: 1px solid #333; padding-top: 4px; margin-top: 40px; font-size: 12px; }
  @media print { .hint { display: none; } body { padding: 0; } @page { size: A4; margin: 14mm; } }
`;

function htmlRow(t, label, raw, { numeric = false, formatter } = {}) {
  const shown = value(t, raw, { formatter });
  const cls = raw === null || raw === undefined || raw === "" ? "absent" : numeric ? "num" : "";
  return `<tr><th scope="row">${escapeHtml(label)}</th><td class="${cls}">${escapeHtml(shown)}</td></tr>`;
}

export function renderSlipHtml(slip, language) {
  const lang = resolveLanguage(language || slip.language);
  const t = stringsFor(lang);
  const amt = (v) => (v === null || v === undefined ? null : `${t.money} ${money(v)}`);

  const rows = [
    htmlRow(t, t.slip_number, slip.slip_number),
    htmlRow(t, t.date_of_issue, isoDay(slip.issue_date)),
    htmlRow(t, t.establishment, slip.establishment.name),
    htmlRow(t, t.establishment_address, slip.establishment.address),
    htmlRow(t, t.registration_number, slip.establishment.registration_number),
    htmlRow(t, t.wage_period, `${isoDay(slip.wage_period.from)} — ${isoDay(slip.wage_period.to)}`),
    htmlRow(t, t.wage_period_days, slip.wage_period.days, { numeric: true }),
    htmlRow(t, t.employee_name, slip.employee.name),
    htmlRow(t, t.employee_code, slip.employee.code),
    htmlRow(t, t.relation_name, slip.employee.father_or_mother_or_spouse_name),
    htmlRow(t, t.designation, slip.employee.designation),
    htmlRow(t, t.uan, slip.employee.uan),
    htmlRow(t, t.bank_account, slip.employee.bank_account),
    htmlRow(
      t,
      t.attendance,
      slip.attendance.value === null || slip.attendance.value === undefined
        ? null
        : `${slip.attendance.value} ${slip.attendance.kind === "unit" ? t.units : t.days}`
    ),
    htmlRow(t, t.basic_wages, amt(slip.earnings.basic), { numeric: true }),
    htmlRow(t, t.da, amt(slip.earnings.da), { numeric: true }),
    htmlRow(t, t.allowances, amt(slip.earnings.allowances), { numeric: true }),
    htmlRow(t, t.overtime_wages, amt(slip.earnings.overtime), { numeric: true }),
  ].join("\n");

  const totals = [
    htmlRow(t, t.gross_wages, amt(slip.gross_wages), { numeric: true }),
    htmlRow(t, t.pf, amt(slip.deductions.pf), { numeric: true }),
    htmlRow(t, t.esi, amt(slip.deductions.esi), { numeric: true }),
    htmlRow(t, t.other_deductions, amt(slip.deductions.other), { numeric: true }),
    htmlRow(t, t.total_deductions, amt(slip.total_deductions), { numeric: true }),
    `<tr class="total"><th scope="row">${escapeHtml(t.net_wages)}</th><td class="num">${escapeHtml(
      amt(slip.net_wages)
    )}</td></tr>`,
  ].join("\n");

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(t.slip_title)} — ${escapeHtml(slip.slip_number)}</title>
<style>${STYLE}</style>
</head>
<body>
<div class="sheet">
  <div class="hint">${escapeHtml(t.print_hint)}</div>
  <h1>${escapeHtml(t.slip_title)}</h1>
  <div class="meta">${escapeHtml(t.slip_number)}: ${escapeHtml(slip.slip_number)} · ${escapeHtml(
    t.date_of_issue
  )}: ${escapeHtml(isoDay(slip.issue_date))}</div>
  ${slip.status === "superseded" ? `<div class="superseded">${escapeHtml(t.superseded)}</div>` : ""}
  <table>${rows}</table>
  <table>${totals}</table>
  <div class="note">
    <p>${escapeHtml(slip.form_source_note)}</p>
    <p>${escapeHtml(t.retain_until)}: ${escapeHtml(isoDay(slip.retain_until))}</p>
  </div>
  <div class="sign">
    <div><div class="line">${escapeHtml(t.employer_signature)}<br>${escapeHtml(
      slip.signature.name
    )}${slip.signature.place ? ` — ${escapeHtml(slip.signature.place)}` : ""}</div></div>
  </div>
</div>
</body>
</html>`;
}

/* ── Form IX muster roll ───────────────────────────────────────────── */

export function renderMusterHtml(roll, language) {
  const lang = resolveLanguage(language);
  const t = stringsFor(lang);
  const days = Array.from({ length: roll.days_in_month }, (_, i) => i + 1);

  const head = [
    t.sl_no,
    t.employee_name,
    t.employee_code,
    t.designation,
    t.shift,
    t.place_of_work,
    ...days.map(String),
    t.total_days,
    t.total_ot_hours,
    t.tour_details,
  ];

  const body = roll.employees
    .map((e, idx) => {
      const marks = days.map((d) => (e.day_marks[String(d)] ? t.present : ""));
      return `<tr><td>${idx + 1}</td><td>${escapeHtml(e.name)}</td><td>${escapeHtml(
        e.worker_code || t.not_recorded
      )}</td><td class="absent">${escapeHtml(t.not_recorded)}</td><td class="absent">${escapeHtml(
        t.not_recorded
      )}</td><td class="absent">${escapeHtml(t.not_recorded)}</td>${marks
        .map((m) => `<td class="mark">${m}</td>`)
        .join("")}<td>${e.total_days}</td><td class="absent">${escapeHtml(
        t.not_recorded
      )}</td><td class="absent">${escapeHtml(t.not_recorded)}</td></tr>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(t.muster_title)} — ${escapeHtml(roll.month)}</title>
<style>${STYLE}
  /* Landscape A4 is ~1122px wide; capping the sheet at 820px squeezed the
     name column to 20px while leaving 300px unused. Let the table take the
     page and size columns to their content instead of to an equal share. */
  .sheet { max-width: none; }
  table { table-layout: auto; }
  th, td { padding: 3px 4px; font-size: 9px; }
  th { width: auto; white-space: nowrap; }
  td:nth-child(2) { min-width: 96px; }
  .mark { text-align: center; font-weight: 600; }
  @media print { @page { size: A4 landscape; margin: 10mm; } }
</style>
</head>
<body>
<div class="sheet">
  <div class="hint">${escapeHtml(t.print_hint)}</div>
  <h1>${escapeHtml(t.muster_title)}</h1>
  <div class="meta">${escapeHtml(roll.establishment.name)} · ${escapeHtml(
    t.month
  )}: ${escapeHtml(roll.month)}</div>
  ${
    roll.employees.length === 0
      ? `<p class="absent">${escapeHtml(t.no_engagements)}</p>`
      : `<table><thead><tr>${head
          .map((h) => `<th>${escapeHtml(h)}</th>`)
          .join("")}</tr></thead><tbody>${body}</tbody></table>`
  }
  <div class="note">
    <p>${escapeHtml(roll.form_source_note)}</p>
    <p>${escapeHtml(t.retain_until)}: ${escapeHtml(isoDay(roll.retain_until))}</p>
  </div>
  <div class="sign">
    <div><div class="line">${escapeHtml(t.keeper_signature)}<br>${escapeHtml(
      roll.establishment.name
    )}</div></div>
  </div>
</div>
</body>
</html>`;
}
