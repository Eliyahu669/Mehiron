# בדיקות קצה-לקצה בדפדפן (Chrome) על גרסת התצוגה המקדימה (מצב מקומי).
# מריצים: npm run build:single && python3 tests/e2e.py
import asyncio, subprocess, sys, os, time
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8766
URL = f'http://127.0.0.1:{PORT}/index.html'
SHOTS = '/home/claude/shots'
fails = []

def check(cond, msg):
    print(('  ✓ ' if cond else '  ✗ ') + msg)
    if not cond: fails.append(msg)

async def nav(pg):
    return await pg.evaluate('() => window.__mehironNav ? window.__mehironNav() : null')

async def ui(pg):
    return await pg.evaluate("""() => ({
      pills: [...document.querySelectorAll('.topbar .pill.on')].map(e => e.textContent),
      q: document.querySelector('.search input')?.value,
      mode: document.querySelector('.mode-seg .on')?.textContent,
      sheets: document.querySelectorAll('.sheet').length,
      toast: document.querySelector('.toast')?.textContent || '' })""")

async def back(pg, wait=250):
    await pg.go_back(); await pg.wait_for_timeout(wait)

async def main():
    os.makedirs(SHOTS, exist_ok=True)
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT)], cwd=os.path.join(ROOT, 'dist-single'), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
            ctx = await b.new_context(viewport={'width': 400, 'height': 860}, device_scale_factor=2)
            pg = await ctx.new_page()
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            await pg.goto('about:blank'); await pg.goto(URL); await pg.wait_for_timeout(900)

            print('אחורה – בלי לחיצה עדיין אין רשומות בהיסטוריה')
            n = await nav(pg); check(n['depth'] == 0, f"depth=0 לפני פעולת משתמש ({n['depth']})")

            print('אחורה מחלון "עדכן מחירון" (הבאג שדווח)')
            await pg.click('text=עדכן מחירון'); await pg.wait_for_timeout(200)
            n = await nav(pg); check(n['depth'] == 2, f"שומר + חלון = 2 ({n['depth']})")
            await back(pg); s = await ui(pg)
            check(s['sheets'] == 0 and pg.url.startswith('http'), 'אחורה סגר את החלון ונשארנו באפליקציה')

            print('סינונים: Apple ← מסך ← דגם, ואחורה בסדר הפוך')
            await pg.click('.topbar .pill:has-text("Apple")'); await pg.click('.topbar .pill:has-text("מסך")'); await pg.wait_for_timeout(150)
            await pg.click('.card.list .row >> nth=0'); await pg.wait_for_timeout(300)
            n = await nav(pg); check(n['depth'] == 4, f"שומר + 2 סינונים + דגם = 4 ({n['depth']})")
            await back(pg); s = await ui(pg); check(s['sheets'] == 0 and s['pills'] == ['Apple', 'מסך'], f'1: נסגר הדגם {s}')
            await back(pg); s = await ui(pg); check(s['pills'] == ['Apple'], f'2: בוטל "מסך" {s}')
            await back(pg); s = await ui(pg); check(s['pills'] == [], f'3: בוטל Apple {s}')
            await back(pg); s = await ui(pg); check('לחץ שוב' in s['toast'] and pg.url.startswith('http'), f'4: הודעת יציאה, עדיין באפליקציה {s}')

            print('לחיצה אחרי ההודעה מחזירה את השומר; הקלדה היא רמה')
            await pg.click('.search input'); await pg.keyboard.type('a54', delay=40); await pg.wait_for_timeout(200)
            n = await nav(pg); check(n['depth'] == 2, f"שומר + חיפוש = 2 ({n['depth']})")
            await back(pg); s = await ui(pg); check(s['q'] == '', f'אחורה ניקה את החיפוש {s}')

            print('סגירה מהממשק (כפתור "חזרה") שומרת על עומק נכון')
            await pg.fill('.search input', ''); await pg.click('.topbar .pill:has-text("Samsung")'); await pg.click('.card.list .row >> nth=0'); await pg.wait_for_timeout(250)
            await pg.click('text=‹ חזרה'); await pg.wait_for_timeout(300)
            n = await nav(pg); check(n['depth'] == 2 and n['levels'] == 1, f"אחרי סגירה מהממשק: עומק {n['depth']}, רמות {n['levels']}")
            await back(pg); s = await ui(pg); check(s['pills'] == [], f'אחורה ביטל את Samsung {s}')

            print('מחירון מכשירים: נפרד לגמרי, ואחורה חוזר לתיקונים')
            await pg.click('.mode-seg button:has-text("מכשירים")'); await pg.wait_for_timeout(150)
            await pg.click('.search input'); await pg.keyboard.type('17 פרו 256', delay=30); await pg.wait_for_timeout(300)
            rows = await pg.locator('.card.list .row').all_inner_texts()
            check(len(rows) >= 1 and all('256' in r or 'גרסאות' in r for r in rows[:2]), f'תוצאות מכשירים: {[r.splitlines()[0] for r in rows[:3]]}')
            await pg.click('.card.list .row >> nth=0'); await pg.wait_for_timeout(250)
            t = await pg.inner_text('.sheet'); check('מסך' not in t and 'סוללה' not in t, 'עמוד מכשיר בלי תיקונים')
            await back(pg); await back(pg); s = await ui(pg); check(s['mode'] == 'מחירון מכשירים' and s['q'] == '', f'אחורה: נסגר הדגם ונוקה החיפוש {s}')
            await back(pg); s = await ui(pg); check(s['mode'] == 'מחירון תיקונים', f'אחורה חזר למחירון תיקונים {s}')

            print('בחירה מרובה: שינוי מחיר גורף ומחיקה')
            await pg.click('.icon-btn[title="הגדרות"]'); await pg.wait_for_timeout(200)
            await pg.click('.sheet .pill:has-text("פריטים")'); await pg.click('.sheet .pill:has-text("ספק חלקים")'); await pg.wait_for_timeout(200)
            await pg.fill('input[placeholder="חיפוש פריט…"]', 'a54'); await pg.wait_for_timeout(200)
            before = await pg.locator('.sheet .card.list .row').all_inner_texts()
            await pg.click('.sheet button:has-text("בחירה")'); await pg.wait_for_timeout(100)
            await pg.click('.sheet .card.list .row >> nth=0'); await pg.click('.sheet .card.list .row >> nth=1'); await pg.wait_for_timeout(100)
            check('נבחרו 2' in await pg.inner_text('.selbar'), 'נבחרו 2 פריטים')
            await pg.click('.selbar button:has-text("שנה מחיר")'); await pg.click('.bulk button:has-text("+/- ₪")')
            await pg.fill('.bulk input', '10'); await pg.wait_for_timeout(100)
            await pg.screenshot(path=f'{SHOTS}/e2e-bulk.png')
            await pg.click('.bulk button:has-text("החל על 2")'); await pg.wait_for_timeout(300)
            toast = await pg.inner_text('.toast'); check('עודכן מחיר ל-2' in toast, f'הודעה: {toast}')
            after = await pg.locator('.sheet .card.list .row').all_inner_texts()
            def price(r): return int(r.split('\n')[-1].replace('₪', '').replace(',', '').strip())
            check(price(after[0]) == price(before[0]) + 10 and price(after[1]) == price(before[1]) + 10, f'המחירים עלו ב-10: {price(before[0])}→{price(after[0])}, {price(before[1])}→{price(after[1])}')
            count0 = len(after)
            await pg.click('.sheet button:has-text("בחירה")'); await pg.click('.sheet .card.list .row >> nth=0'); await pg.wait_for_timeout(100)
            await pg.click('.selbar button:has-text("מחק")'); await pg.wait_for_timeout(100)
            check('לחץ שוב' in await pg.inner_text('.selbar'), 'מחיקה דורשת לחיצה שנייה')
            await pg.click('.selbar button:has-text("לחץ שוב")'); await pg.wait_for_timeout(300)
            check(len(await pg.locator('.sheet .card.list .row').all_inner_texts()) == count0 - 1, 'פריט אחד נמחק')
            print('אחורה ממצב בחירה ואז מההגדרות')
            await pg.click('.sheet button:has-text("בחירה")'); await pg.wait_for_timeout(100)
            await back(pg); check(await pg.locator('.selbar').count() == 0 and await pg.locator('.sheet').count() == 1, 'אחורה יצא ממצב בחירה')
            await back(pg); check(await pg.locator('.sheet').count() == 0, 'אחורה סגר את ההגדרות')

            print('הגדרות נשמרות אוטומטית (גם ביציאה עם אחורה)')
            await pg.click('.icon-btn[title="הגדרות"]'); await pg.click('.sheet .pill:has-text("עלות עבודה")'); await pg.wait_for_timeout(150)
            cell = pg.locator('.grid-table tbody tr >> nth=0').locator('input >> nth=0')
            await cell.fill('260'); await back(pg, 400)
            await pg.click('.icon-btn[title="הגדרות"]'); await pg.click('.sheet .pill:has-text("עלות עבודה")'); await pg.wait_for_timeout(150)
            v = await pg.locator('.grid-table tbody tr >> nth=0').locator('input >> nth=0').input_value()
            check(v == '260', f'הערך נשמר אחרי אחורה ({v})')
            await cell.fill('250'); await pg.click('text=‹ סגור'); await pg.wait_for_timeout(300)

            print('עובד: רואה רק מחיר סופי')
            await pg.click('.icon-btn[title="הגדרות"]'); await pg.click('.sheet .pill:has-text("עובדים")'); await pg.wait_for_timeout(150)
            await pg.click('text=צפה כמו העובד'); await pg.wait_for_timeout(400)
            await pg.click('.search input'); await pg.keyboard.type('a54 מסך', delay=20); await pg.wait_for_timeout(300)
            await pg.click('.card.list .row >> nth=0'); await pg.wait_for_timeout(300)
            t = await pg.inner_text('.sheet')
            check('הצג פירוט פנימי' not in t and 'בקש פירוט' in t, 'בלי פירוט פנימי, עם כפתור בקשה')
            await back(pg); await back(pg)
            await pg.click('text=חזרה למנהל'); await pg.wait_for_timeout(300)

            print('יציאה: אחורה כפול במסך הבית')
            await pg.click('.brand'); await pg.wait_for_timeout(100)
            await back(pg, 200); check('לחץ שוב' in (await ui(pg))['toast'], 'אחורה ראשון: הודעה')
            await pg.go_back(); await pg.wait_for_timeout(600)
            check(pg.url == 'about:blank', f'אחורה שני: יצאנו ({pg.url})')

            print('אין אף רשומת היסטוריה שנוצרה בלי פעולת משתמש')
            # (הדף כבר נסגר; בודקים בהרצה נפרדת קצרה)
            pg2 = await ctx.new_page(); await pg2.goto(URL); await pg2.wait_for_timeout(700)
            for sel in ['text=עדכן מחירון', 'text=‹ ביטול', '.topbar .pill:has-text("Apple")', '.card.list .row >> nth=0']:
                await pg2.click(sel); await pg2.wait_for_timeout(250)
            await pg2.go_back(); await pg2.wait_for_timeout(200)
            await pg2.click('.topbar .pill:has-text("מסך")'); await pg2.wait_for_timeout(200)
            n = await nav(pg2)
            pushes = [x for x in n['log'] if x['op'] == 'push']
            check(len(pushes) > 0 and all(x['active'] for x in pushes), f"{len(pushes)} pushState, כולם עם הפעלת משתמש")
            check(not errs, f'בלי שגיאות JS {errs[:3]}')
            await b.close()
    finally:
        srv.terminate()
    print('\n' + ('הכול עבר ✓' if not fails else f'נכשלו {len(fails)}:\n - ' + '\n - '.join(fails)))
    sys.exit(1 if fails else 0)

asyncio.run(main())
