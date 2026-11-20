import asyncio
from playwright.async_api import async_playwright
URL = 'file:///home/claude/mehiron/dist-single/index.html'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        pg = await b.new_page(viewport={'width': 400, 'height': 860}, device_scale_factor=2)
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(URL); await pg.wait_for_timeout(900)
        # עריכת פריט מתוך עמוד הדגם
        await pg.fill('.search input', 'a54 מסך'); await pg.wait_for_timeout(200)
        await pg.click('.row >> nth=0'); await pg.wait_for_timeout(300)
        await pg.click('text=הצג פירוט פנימי'); await pg.click('button.disc:has-text("ערוך") >> nth=0'); await pg.wait_for_timeout(300)
        await pg.screenshot(path='/home/claude/shots/11-edit.png')
        await pg.fill('.field:has-text("מחיר ספק") input', '199'); await pg.click('button:has-text("שמור") >> nth=0'); await pg.wait_for_timeout(400)
        print('toast:', await pg.inner_text('.toast'))
        await pg.click('text=‹ ביטול'); await pg.wait_for_timeout(300)
        print('A54 quote:', (await pg.inner_text('.quote')).replace('\n',' | ')[:160])
        await pg.click('text=‹ חזרה')
        # הוספת פריט ידני חדש
        await pg.click('.icon-btn[title="הגדרות"]'); await pg.wait_for_timeout(200)
        await pg.click(".pill:has-text(\"פריטים\")"); await pg.wait_for_timeout(200)
        await pg.click('.pill:has-text("אר.פי")'); await pg.click('.actions .btn.primary:has-text("פריט")')
        await pg.fill('.field:has-text("שם הדגם") input', 'מטען מהיר 25W'); await pg.fill('.field:has-text("מחיר ספק") input', '30')
        await pg.click('button:has-text("שמור") >> nth=0'); await pg.wait_for_timeout(300)
        await pg.fill('input[placeholder="חיפוש פריט…"]', 'מטען'); await pg.wait_for_timeout(200)
        await pg.screenshot(path='/home/claude/shots/12-items.png')
        await pg.click('text=‹ ביטול'); await pg.fill('.search input', 'מטען'); await pg.wait_for_timeout(200)
        await pg.click('.row >> nth=0'); await pg.wait_for_timeout(300)
        print('charger:', (await pg.inner_text('.sheet')).replace('\n',' | ')[:160])
        await pg.click('text=‹ חזרה'); await pg.fill('.search input', 'mibox'); await pg.wait_for_timeout(200)
        print('mibox rows:', await pg.locator('.card.list .row').count())
        print('errors:', errs[:5]); await b.close()
asyncio.run(main())
