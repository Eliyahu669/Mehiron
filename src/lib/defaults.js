// ערכי ברירת מחדל – לפי "מחירון עבודה לטכנאי", עדכון נובמבר 2026. בכל טווח נלקח המקסימום (לפי הנחיית אליהו)

export const REPAIRS = [
  { id: 'screen', label: 'מסך', words: ['מסך', 'מסכים', 'screen', 'lcd', 'display'] },
  { id: 'battery', label: 'סוללה', words: ['סוללה', 'סוללות', 'battery', 'בטריה'] },
  { id: 'port', label: 'שקע טעינה', words: ['שקע', 'טעינה', 'port', 'charging'] },
  { id: 'back', label: 'גב אחורי', words: ['גב', 'זכוכית', 'back'] },
  { id: 'camera', label: 'מצלמה', words: ['מצלמה', 'camera'] },
  { id: 'housing', label: 'החלפת גוף', words: ['גוף', 'housing', 'שלדה'] },
];

export const LABOR_GROUPS = [
  { id: 'iphone:new', label: 'iPhone 14–18', family: 'iphone', tier: 'new' },
  { id: 'iphone:old', label: 'iPhone X–13', family: 'iphone', tier: 'old' },
  { id: 'galaxy:z', label: 'Galaxy Z (מתקפלים)', family: 'galaxy-z', tier: 'z' },
  { id: 'galaxy:s', label: 'Galaxy S (דגל)', family: 'galaxy-s', tier: 's' },
  { id: 'galaxy:a', label: 'Galaxy A (ביניים)', family: 'galaxy-a', tier: 'a' },
  { id: 'xiaomi', label: 'Xiaomi / POCO F', family: 'xiaomi' },
  { id: 'redmi', label: 'Redmi / Redmi Note', family: 'redmi' },
];

export const DEFAULT_CONFIG = {
  version: 1,
  laborUpdated: 'נובמבר 2026',
  labor: {
    'iphone:new': { screen: 250, battery: 150, port: 350, back: 200, housing: 400, camera: 300 },
    'iphone:old': { screen: 150, battery: 100, port: 250, back: 350, housing: 300, camera: 200 },
    'galaxy:z': { screen: 500, battery: 200, port: 250, back: 150, camera: 250 },
    'galaxy:s': { screen: 180, battery: 120, port: 150, back: 100, camera: 150 },
    'galaxy:a': { screen: 120, battery: 100, port: 120, back: 80, camera: 100 },
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
  margins: { flagship: 8, mid: 15, wearable: 25, accessory: 85, other: null },
  rounding: { step: 10, mode: 'ceil' },
  freshness: { green: 7, orange: 14 },
  priceOverrides: {}, // key → מחיר סופי ידני
  suppliers: [
    { id: 'rp', name: 'אר.פי מובייל', type: 'devices', phone: '' },
    { id: 'asi', name: 'אסי סלולר', type: 'devices', phone: '' },
    { id: 'parts1', name: 'ספק חלקים (מחירון סמסונג)', type: 'parts', phone: '' },
  ],
};

export const CATEGORY_LABELS = { flagship: 'מכשירי דגל (כולל אייפד ו-AirTag)', mid: 'מכשירי ביניים וטאבלטים אחרים', wearable: 'אוזניות ושעונים (מותגים)', accessory: 'אביזרים (מגנים, כבלים, מטענים)', other: 'אחר (ממירים, רמקולים וכו׳)' };
