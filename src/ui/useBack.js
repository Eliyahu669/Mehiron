// כפתור/מחוות "אחורה" של הטלפון סוגר את החלון העליון במקום לצאת מהאפליקציה
import { useEffect, useLayoutEffect, useRef } from 'react';

const stack = [];
let ignorePops = 0;

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    if (ignorePops > 0) { ignorePops--; return; }
    const top = stack.pop();
    if (top) top.ref.current();
  });
}

/** כשהחלון פתוח – נרשמת "רמה" בהיסטוריה. אחורה סוגר אותו; סגירה מהממשק מנקה את הרמה.
 *  top = חלון ראשי (נרשם לפני חלונות פנימיים שנפתחים באותו רגע) */
export function useBack(open, onBack, top = false) {
  const ref = useRef(onBack);
  ref.current = onBack;
  const useEff = top ? useLayoutEffect : useEffect;
  useEff(() => {
    if (!open) return undefined;
    const entry = { ref };
    stack.push(entry);
    try { history.pushState({ mehiron: stack.length }, ''); } catch { /* */ }
    return () => {
      const i = stack.indexOf(entry);
      if (i >= 0) { // נסגר מהממשק (לא ממחוות אחורה) – מורידים את הרמה מההיסטוריה
        stack.splice(i, 1);
        ignorePops++;
        try { history.back(); } catch { ignorePops--; }
      }
    };
  }, [open]);
}
