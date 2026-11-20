import asyncio
from playwright.async_api import async_playwright
URL = 'file:///home/claude/mehiron/dist-single/index.html'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width': 400, 'height': 860}, device_scale_factor=2)
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(URL); await pg.wait_for_timeout(900)
        # מנהל → עובדים → צפה כמו העובד
        await pg.click('.icon-btn[title="הגדרות"]'); await pg.click('.pill:has-text("עובדים")'); await pg.wait_for_timeout(300)
        await pg.screenshot(path='/home/claude/shots/13-users.png')
        await pg.click('text=צפה כמו העובד'); await pg.wait_for_timeout(500)
        await pg.fill('.search input', 'a54 מסך'); await pg.wait_for_timeout(300)
        print('lite row:', (await pg.inner_text('.card.list')).replace('\n',' | ')[:120])
        await pg.click('.card.list .row >> nth=0'); await pg.wait_for_timeout(400)
        txt = await pg.inner_text('.sheet')
        print('lite sheet has internal?', 'פירוט פנימי' in txt and 'הצג פירוט' in txt, '| has request:', 'בקש פירוט' in txt)
        print('lite quote:', (await pg.inner_text('.quote')).replace('\n',' | ')[:150])
        # הוספת תוספת ובדיקת חישוב
        await pg.click('.chip >> nth=0'); await pg.wait_for_timeout(200)
        print('with addon:', (await pg.inner_text('.quote')).replace('\n',' | ')[:110])
        await pg.screenshot(path='/home/claude/shots/14-lite.png')
        # בקשת פירוט (וואטסאפ נפתח בטאב חדש)
        async with ctx.expect_page() as newp:
            await pg.click('text=בקש פירוט >> nth=0')
        np_ = await newp.value
        print('wa url:', np_.url[:90]); await np_.close()
        await pg.click('text=‹ חזרה'); await pg.wait_for_timeout(200)
        # מכשירים במצב עובד
        await pg.fill('.search input', '17 פרו'); await pg.wait_for_timeout(300)
        await pg.click('.card.list .row >> nth=0'); await pg.wait_for_timeout(300)
        seg = pg.locator('text=מכשיר למכירה')
        if await seg.count(): await seg.click(); await pg.wait_for_timeout(200)
        print('lite devices:', (await pg.inner_text('.quote')).replace('\n',' | ')[:150])
        await pg.click('text=‹ חזרה')
        # חזרה למנהל → בקשה מופיעה → אישור
        await pg.click('text=חזרה למנהל'); await pg.wait_for_timeout(300)
        print('banner:', await pg.inner_text('.banner >> nth=0'))
        await pg.click('.banner >> nth=0'); await pg.wait_for_timeout(300)
        await pg.screenshot(path='/home/claude/shots/15-requests.png')
        await pg.click('button:has-text("אשר")'); await pg.wait_for_timeout(300)
        sw = await pg.get_attribute('.switch', 'aria-checked')
        print('switch after approve:', sw)
        await pg.click('text=צפה כמו העובד'); await pg.wait_for_timeout(400)
        await pg.fill('.search input', 'a54 מסך'); await pg.click('.card.list .row >> nth=0'); await pg.wait_for_timeout(300)
        print('approved employee sees internal toggle:', 'הצג פירוט פנימי' in await pg.inner_text('.sheet'))
        print('errors:', errs[:5]); await b.close()
asyncio.run(main())
