// מצב בהיר / כהה: נשמר במכשיר. בלי בחירה – לפי הגדרת המערכת (index.html מחיל לפני הטעינה, כדי שלא יהבהב)
const KEY = 'mehiron:theme';
const COLORS = { light: '#F5F5F7', dark: '#000000' };

export function currentTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function applyTheme(theme) {
  const t = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', COLORS[t]);
  return t;
}

export function saveTheme(theme) {
  const t = applyTheme(theme);
  try { localStorage.setItem(KEY, t); } catch { /* מצב פרטי / אחסון חסום – רק למסך הזה */ }
  return t;
}
