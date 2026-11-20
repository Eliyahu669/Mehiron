import asyncio
from playwright.async_api import async_playwright
URL = 'http://127.0.0.1:8765/index.html'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width': 400, 'height': 860}, device_scale_factor=2)
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('about:blank'); await pg.goto(URL); await pg.wait_for_timeout(900)
        state = lambda: pg.evaluate("""() => ({ pills: [...document.querySelectorAll('.pill.on')].map(e=>e.textContent), q: document.querySelector('.search input').value, mode: document.querySelector('.mode-seg .on')?.textContent, sheet: !!document.querySelector('.sheet'), toast: document.querySelector('.toast')?.textContent || '' })""")
        # תיקונים: Apple ואז מסך
        await pg.click('.pill:has-text("Apple")'); await pg.click('.pill:has-text("מסך")'); await pg.wait_for_timeout(200)
        rows = await pg.locator('.card.list .row').all_inner_texts()
        print('repairs Apple+מסך rows:', len(rows), '|', rows[0].replace('\n',' / ') if rows else '')
        await pg.click('.card.list .row >> nth=0'); await pg.wait_for_timeout(300)
        t = await pg.inner_text('.sheet'); print('repair sheet has devices?', 'מכשיר למכירה' in t and 'גרסאות' in t, '| subtitle:', t.split('\n')[2])
        await pg.go_back(); await pg.wait_for_timeout(250); print('back1:', await state())
        await pg.go_back(); await pg.wait_for_timeout(250); print('back2:', await state())
        await pg.go_back(); await pg.wait_for_timeout(250); print('back3:', await state())
        await pg.go_back(); await pg.wait_for_timeout(250); print('back4 (should warn):', await state(), pg.url)
        await pg.wait_for_timeout(2300)
        await pg.go_back(); await pg.wait_for_timeout(250); print('back5 after 2s (warn again):', (await state())['toast'], pg.url)
        # מכשירים
        await pg.click('.mode-seg button:has-text("מכשירים")'); await pg.wait_for_timeout(200)
        await pg.fill('.search input', '17 פרו 256'); await pg.wait_for_timeout(300)
        rows = await pg.locator('.card.list .row').all_inner_texts()
        print('devices "17 פרו 256":', [r.replace('\n',' / ') for r in rows[:3]])
        await pg.click('.card.list .row >> nth=0'); await pg.wait_for_timeout(300)
        t = await pg.inner_text('.sheet'); print('device sheet has repairs?', 'מסך' in t or 'סוללה' in t, '|', t.replace('\n',' / ')[:160])
        await pg.screenshot(path='/home/claude/shots/16-device-sheet.png')
        await pg.go_back(); await pg.wait_for_timeout(200)
        await pg.click('.pill:has-text("שעונים")'); await pg.fill('.search input', ''); await pg.wait_for_timeout(200)
        rows = await pg.locator('.card.list .row').all_inner_texts()
        print('devices wear:', [r.split('\n')[0] for r in rows[:5]])
        await pg.screenshot(path='/home/claude/shots/17-devices.png')
        await pg.go_back(); await pg.wait_for_timeout(200); print('dev back1:', await state())
        await pg.go_back(); await pg.wait_for_timeout(200); print('dev back2:', await state())
        # יציאה: שתי לחיצות רצופות במסך הבית
        await pg.go_back(); await pg.wait_for_timeout(200); await pg.go_back(); await pg.wait_for_timeout(600)
        print('after double back url:', pg.url)
        print('errors:', errs[:5]); await b.close()
asyncio.run(main())
