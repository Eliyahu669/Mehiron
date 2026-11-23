// ערכי ברירת מחדל – לפי "מחירון עבודה לטכנאי", עדכון נובמבר 2026. בכל טווח נלקח המקסימום (לפי הנחיית אליהו)

export const REPAIRS = [
  { id: 'screen', label: 'מסך', words: ['מסך', 'מסכים', 'screen', 'lcd', 'display'] },
  { id: 'battery', label: 'סוללה', words: ['סוללה', 'סוללות', 'battery', 'בטריה'] },
  { id: 'port', label: 'שקע טעינה', words: ['שקע', 'טעינה', 'port', 'charging'] },
  { id: 'back', label: 'גב אחורי', words: ['גב', 'זכוכית', 'back'] },
  { id: 'camera', label: 'מצלמה', words: ['מצלמה', 'camera'] },
  { id: 'housing', label: 'החלפת גוף', words: ['גוף', 'housing', 'שלדה'] },
];

// סדרות בטבלת עלות העבודה. לסדרות המקוריות יש זיהוי אוטומטי (auto); לכל סדרה אפשר להוסיף "תחילת שם" (prefixes).
// המנהל משנה שמות, מוסיף ומוחק סדרות בהגדרות – הרשימה שלו נשמרת ב-config.laborGroups
export const LABOR_GROUPS = [
  { id: 'iphone:new', label: 'iPhone 14–18', family: 'iphone', tier: 'new', auto: 'iPhone 14 ומעלה, Air, 16e', prefixes: [] },
  { id: 'iphone:old', label: 'iPhone X–13', family: 'iphone', tier: 'old', auto: 'iPhone X / XR / XS, 11–13', prefixes: [] },
  { id: 'galaxy:z', label: 'Galaxy Z (מתקפלים)', family: 'galaxy-z', tier: 'z', auto: 'Galaxy Z', prefixes: [] },
  { id: 'galaxy:s', label: 'Galaxy S (דגל)', family: 'galaxy-s', tier: 's', auto: 'Galaxy S', prefixes: [] },
  { id: 'galaxy:a', label: 'Galaxy A (ביניים)', family: 'galaxy-a', tier: 'a', auto: 'Galaxy A', prefixes: [] },
  { id: 'galaxy:note', label: 'Galaxy Note', family: 'galaxy-note', auto: 'Galaxy Note', prefixes: [] },
  { id: 'galaxy:mje', label: 'Galaxy M / J / E', families: ['galaxy-m', 'galaxy-j', 'galaxy-e'], auto: 'Galaxy M / J / E', prefixes: [] },
  { id: 'xiaomi', label: 'Xiaomi / POCO F', family: 'xiaomi', auto: 'Xiaomi / Mi / POCO F', prefixes: [] },
  { id: 'redmi', label: 'Redmi / Redmi Note', family: 'redmi', auto: 'Redmi / Redmi Note', prefixes: [] },
];

/** הסדרות שבתוקף: של המנהל אם שמר, אחרת המקוריות */
export const laborGroupsOf = (cfg) => (Array.isArray(cfg?.laborGroups) && cfg.laborGroups.length ? cfg.laborGroups : LABOR_GROUPS);

export const DEFAULT_CONFIG = {
  version: 1,
  laborUpdated: 'נובמבר 2026',
  laborGroups: null,
  labor: {
    'iphone:new': { screen: 250, battery: 150, port: 350, back: 200, housing: 400, camera: 300 },
    'iphone:old': { screen: 150, battery: 100, port: 250, back: 350, housing: 300, camera: 200 },
    'galaxy:z': { screen: 500, battery: 200, port: 250, back: 150, camera: 250 },
    'galaxy:s': { screen: 180, battery: 120, port: 150, back: 100, camera: 150 },
    'galaxy:a': { screen: 120, battery: 100, port: 120, back: 80, camera: 100 },
    'galaxy:note': { screen: 180, battery: 120, port: 150, back: 100, camera: 150 }, // כמו Galaxy S (דגל)
    'galaxy:mje': { screen: 120, battery: 100, port: 120, back: 80, camera: 100 }, // כמו Galaxy A (ביניים)
    'xiaomi': { screen: 150, battery: 120, port: 150, back: 100, camera: 200 },
    'redmi': { screen: 120, battery: 100, port: 100, back: 80, camera: 120 },
  },
  // חריגים: scope = 'model' (דגם מדויק) או 'series' (כל הדגמים שמתחילים בשם). group = שיוך לעמודה בטבלה, labor = סכומים ספציפיים
  laborRules: [
    { id: 'r-14pro', scope: 'series', match: 'iPhone 14 Pro', labor: { back: 350 }, note: 'גב בלייזר (14 Pro ומעלה בסדרה)' },
  ],
  addons: [
    { id: 'bms', label: 'צריבת/העברת BMS', amount: 100, repairs: ['battery'], families: ['iphone'] },
    { id: 'faceid', label: 'שמירת Face ID (מצלמה קדמית)', amount: 250, repairs: ['camera'], families: ['iphone'] },
    { id: 'complex', label: 'מכשיר מורכב (תיקון קודם, ברגים חרושים, דבק)', amount: 80, manager: true },
    { id: 'corrosion', label: 'ניקוי קורוזיה (ללא אחריות)', amount: 150, manager: true },
    { id: 'backup-s', label: 'גיבוי / העברת נתונים עד 30GB', amount: 100, manager: true },
    { id: 'backup-l', label: 'גיבוי / העברת נתונים מעל 30GB', amount: 150, manager: true },
  ],
  // אחוז רווח לפי סגמנט (רמות גימור) של רשימת המכשירים
  margins: { entry: 15, mid: 15, flagship: 8, premium: 8, tablet: 8, wearable: 25, accessory: 85 },
  // רווח מינימלי / מקסימלי בשקלים (כולל מע"מ) לכל סגמנט. ריק = בלי הגבלה. אחוז ריק + מינימום = סכום קבוע
  marginMin: {},
  marginMax: {},
  marginOverrides: {}, // row:<מזהה שורה> → אחוז רווח לשורה (מחליף את הכלל של הסגמנט)
  ignoredDevices: [], // פריטים מהודעות ספקים שבחרו "דלג תמיד": { key, label }
  // מחירון תיקונים: סוגי תיקון שהמנהל הוסיף, רמות איכות לכל סוג (null = ברירת המחדל ב-repairs.js),
  // מילים שאינן איכות (לא נשאלים עליהן), ושורות חלקים שבחרו "דלג תמיד"
  customRepairs: null,
  qualities: {},
  qualityNoise: [],
  ignoredParts: [],
  partColumns: {}, // עמודות קובץ "חלקי חילוף" לכל חברה (ריק = ברירת המחדל ב-repairs.js)
  repairModelsRemoved: [], // דגמים שנמחקו מרשימת התיקונים – לא חוזרים אליה מרשימת המכשירים
  vat: 18, // לחישוב "רווח אחרי מע"מ" בפירוט הפנימי
  rounding: { step: 10, mode: 'ceil' },
  adminPhone: '0502272669', // לכאן נשלחות בקשות פירוט מהעובדים
  freshness: { green: 7, orange: 14 },
  priceOverrides: {}, // key → מחיר סופי ידני
  suppliers: [
    { id: 'rp', name: 'אר.פי מובייל', type: 'devices', phone: '' },
    { id: 'asi', name: 'אסי סלולר', type: 'devices', phone: '' },
    { id: 'parts1', name: 'ספק חלקים (מחירון סמסונג)', type: 'parts', phone: '' },
  ],
};

