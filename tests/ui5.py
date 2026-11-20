import asyncio
from playwright.async_api import async_playwright
URL = 'file:///home/claude/mehiron/dist-single/index.html'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        pg = await b.new_page(viewport={'width': 400, 'height': 860})
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('about:blank'); await pg.goto(URL); await pg.wait_for_timeout(800)
        sheets = lambda: pg.locator('.sheet').count()
        await pg.fill('.search input', 'a54 מסך'); await pg.click('.card.list .row >> nth=0'); await pg.wait_for_timeout(200)
        print('1 open model, sheets =', await sheets())
        await pg.go_back(); await pg.wait_for_timeout(200)
        print('2 back → sheets =', await sheets(), '| still in app:', pg.url.endswith('index.html'))
        # מודל → פירוט → ערוך (3 רמות) ואז אחורה 3 פעמים
        await pg.click('.card.list .row >> nth=0'); await pg.click('text=הצג פירוט פנימי'); await pg.click('button.disc:has-text("ערוך") >> nth=0'); await pg.wait_for_timeout(200)
        print('3 model+settings+edit, sheets =', await sheets(), '| edit form:', await pg.locator('text=עריכת פריט').count())
        await pg.go_back(); await pg.wait_for_timeout(200)
        print('4 back → edit closed:', await pg.locator('text=עריכת פריט').count() == 0, '| sheets =', await sheets())
        await pg.go_back(); await pg.wait_for_timeout(200)
        print('5 back → sheets =', await sheets())
        await pg.go_back(); await pg.wait_for_timeout(200)
        print('6 back → sheets =', await sheets(), '| still in app:', pg.url.endswith('index.html'))
        # סגירה מהממשק ואז אחורה – לא אמור לסגור משהו אחר או לצאת
        await pg.click('.card.list .row >> nth=0'); await pg.wait_for_timeout(150)
        await pg.click('text=‹ חזרה'); await pg.wait_for_timeout(200)
        print('7 ui-close, sheets =', await sheets(), '| url ok:', pg.url.endswith('index.html'))
        await pg.click('.icon-btn[title="הגדרות"]'); await pg.wait_for_timeout(150)
        await pg.go_back(); await pg.wait_for_timeout(200)
        print('8 settings + back → sheets =', await sheets(), '| url ok:', pg.url.endswith('index.html'))
        print('errors:', errs); await b.close()
asyncio.run(main())
