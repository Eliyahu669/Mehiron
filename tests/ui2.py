import asyncio
from playwright.async_api import async_playwright
URL = 'file:///home/claude/mehiron/dist-single/index.html'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        pg = await b.new_page(viewport={'width': 400, 'height': 860}, device_scale_factor=2)
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: m.type == 'error' and errs.append(m.text))
        await pg.goto(URL); await pg.wait_for_timeout(1000)
        # ייבוא PDF לספק החלקים
        await pg.click('text=עדכן מחירון'); await pg.wait_for_timeout(200)
        await pg.select_option('select', 'parts1')
        await pg.set_input_files('input[type=file]', '/mnt/user-data/uploads/5f0cfc5e-DOC-20261119-WA0018.pdf')
        await pg.wait_for_timeout(4000)
        stat = await pg.inner_text('.stat') if await pg.locator('.stat').count() else 'NO STAT'
        print('pdf stat:', stat.replace('\n', ' | '))
        await pg.click('text=שמור ועדכן'); await pg.wait_for_timeout(500)
        print('toast:', await pg.inner_text('.toast') if await pg.locator('.toast').count() else '-')
        # חריג לסדרה: Galaxy Note -> עמודת S
        await pg.click('.icon-btn[title="הגדרות"]'); await pg.click('text=חריגים'); await pg.click('text=חריג חדש')
        await pg.fill('input[list=model-names]', 'Galaxy Note')
        await pg.select_option('.sheet select', 'galaxy:s')
        await pg.click('text=אישור'); await pg.click('.pill-btn:has-text("שמור")'); await pg.wait_for_timeout(400)
        await pg.fill('.search input', 'note 20 מסך'); await pg.wait_for_timeout(300)
        print('note 20 row:', (await pg.inner_text('.card.list')).replace('\n', ' | ')[:200])
        # שמירה נשמרת אחרי רענון
        await pg.reload(); await pg.wait_for_timeout(1000)
        await pg.fill('.search input', 'note 20 מסך'); await pg.wait_for_timeout(300)
        print('after reload:', (await pg.inner_text('.card.list')).replace('\n', ' | ')[:120])
        await pg.screenshot(path='/home/claude/shots/10-note.png')
        print('errors:', errs[:5])
        await b.close()
asyncio.run(main())
