// כפתור/מחוות "אחורה" של הטלפון.
// בהיסטוריה של הדפדפן יש תמיד רשומת "שומר" אחת מעל הבסיס. כל אחורה מגיע לכאן,
// מבטל את הרמה האחרונה שנפתחה (חלון, עריכה, סינון, חיפוש) ומחזיר את השומר.
// כשאין יותר מה לבטל: אחורה ראשון מציג הודעה, אחורה שני תוך 2 שניות יוצא מהאפליקציה.
import { useEffect, useLayoutEffect, useRef } from 'react';

const stack = [];
let guarded = false;
let lastRootBack = 0;
let onRootBack = null;
const EXIT_WINDOW = 2000;

const pushGuard = () => { try { history.pushState({ mehiron: 'guard' }, ''); } catch { /* */ } };

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    if (!guarded) return;
    const top = stack.pop();
    if (top) {
      pushGuard();
      top.ref.current();
      return;
    }
    const now = Date.now();
    if (now - lastRootBack < EXIT_WINDOW) {
      guarded = false;
      try { history.back(); } catch { /* */ } // יציאה מהאפליקציה
      return;
    }
    lastRootBack = now;
    pushGuard();
    onRootBack?.();
  });
}

/** פעם אחת באפליקציה: מתקין את השומר. onFirstBack = מה להציג באחורה הראשון במסך הבית */
export function useExitGuard(onFirstBack) {
  const ref = useRef(onFirstBack);
  ref.current = onFirstBack;
  useEffect(() => {
    onRootBack = () => ref.current?.();
    if (!guarded) { guarded = true; pushGuard(); }
    return () => { onRootBack = null; };
  }, []);
}

/** כל עוד open=true – הרמה רשומה, ואחורה יפעיל את onBack. סגירה מהממשק פשוט מוחקת אותה.
 *  top = חלון ראשי (נרשם לפני חלונות פנימיים שנפתחים באותו רגע) */
export function useBack(open, onBack, top = false) {
  const ref = useRef(onBack);
  ref.current = onBack;
  const useEff = top ? useLayoutEffect : useEffect;
  useEff(() => {
    if (!open) return undefined;
    const entry = { ref };
    stack.push(entry);
    return () => {
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [open]);
}
