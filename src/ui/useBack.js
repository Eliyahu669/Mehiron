// כפתור/מחוות "אחורה" של הטלפון (Double Back to Exit).
//
// מבנה ההיסטוריה: [בסיס][שומר][רמה 1]…[רמה n] – רשומה אחת לכל רמה פתוחה (חלון, עריכה, סינון, חיפוש).
// אחורה סוגר את הרמה העליונה. במסך הבית אחורה ראשון מציג הודעה, ואחורה שני יוצא מהאפליקציה.
//
// חשוב: Chrome ו-Safari מדלגים באחורה על רשומות שנוצרו בלי פעולת משתמש (History Manipulation
// Intervention), ואז אחורה יוצא מהאפליקציה. לכן רשומות נוספות רק בזמן לחיצה/הקלדה של המשתמש,
// ואחרי כל אחורה מחכים ללחיצה חדשה לפני שמוסיפים רשומה. אין אף pushState בלי הפעלת משתמש.
import { useEffect, useLayoutEffect, useRef } from 'react';

const levels = []; // רמות פתוחות לפי סדר הפתיחה
let depth = 0; // כמה רשומות שלנו יש כרגע מעל הבסיס
let expectedPops = 0; // popstate שנגרמו מ-history.go שלנו (סגירה מהממשק)
let needFresh = false; // אחרי אחורה הדפדפן לא מכבד הפעלה ישנה – צריך לחיצה חדשה
let installed = false;
let onRootBack = null;
let scheduled = false;
const log = []; // לבדיקות: כל pushState והאם הייתה הפעלת משתמש

const activationOk = () => {
  if (needFresh) return false;
  const ua = typeof navigator !== 'undefined' ? navigator.userActivation : null;
  return ua ? ua.isActive : true;
};

function sync() {
  scheduled = false;
  if (!installed) return;
  const want = 1 + levels.length;
  if (want > depth) {
    if (!activationOk()) return; // יתווסף בלחיצה הבאה
    while (depth < want) {
      log.push({ op: 'push', active: navigator.userActivation ? navigator.userActivation.isActive : null });
      try { history.pushState({ mehiron: depth + 1 }, ''); } catch { return; }
      depth++;
    }
  } else if (want < depth) {
    const k = depth - want;
    depth = want;
    expectedPops++;
    log.push({ op: 'go', k });
    try { history.go(-k); } catch { expectedPops--; }
  }
}

function scheduleSync() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(sync);
}

function install() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const fresh = () => { needFresh = false; scheduleSync(); };
  // פעולות משתמש שנותנות "הפעלה" – מאפשרות להוסיף רשומות (ולהחזיר את השומר אחרי אחורה)
  for (const ev of ['click', 'keydown', 'pointerup', 'touchend']) window.addEventListener(ev, fresh, true);
  window.addEventListener('popstate', () => {
    needFresh = true;
    if (expectedPops > 0) { expectedPops--; return; }
    depth = Math.max(0, depth - 1); // אחורה של המשתמש
    const top = levels.pop();
    if (top) { top.ref.current(); return; }
    onRootBack?.(); // במסך הבית: "לחץ שוב אחורה כדי לצאת". אחורה נוסף יוצא (אין שומר עד הלחיצה הבאה)
  });
  window.__mehironNav = () => ({ depth, levels: levels.length, expectedPops, needFresh, log: [...log] });
}

/** פעם אחת באפליקציה. onFirstBack = מה להציג כשלוחצים אחורה במסך הבית */
export function useExitGuard(onFirstBack) {
  const ref = useRef(onFirstBack);
  ref.current = onFirstBack;
  useEffect(() => {
    install();
    onRootBack = () => ref.current?.();
    scheduleSync();
    return () => { onRootBack = null; };
  }, []);
}

/** כל עוד open=true – הרמה פתוחה, ואחורה יפעיל את onBack. סגירה מהממשק מורידה את הרשומה שלה.
 *  top = חלון ראשי (נרשם לפני חלונות פנימיים שנפתחים באותו רגע) */
export function useBack(open, onBack, top = false) {
  const ref = useRef(onBack);
  ref.current = onBack;
  const useEff = top ? useLayoutEffect : useEffect;
  useEff(() => {
    if (!open) return undefined;
    install();
    const entry = { ref };
    levels.push(entry);
    scheduleSync();
    return () => {
      const i = levels.indexOf(entry);
      if (i >= 0) { levels.splice(i, 1); scheduleSync(); }
    };
  }, [open]);
}
