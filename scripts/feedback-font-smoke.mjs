import { chromium } from 'playwright'
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

const root = process.cwd()
const profile = await mkdtemp(path.join(os.tmpdir(), 'exporter-font-'))
const output = '/tmp/aichatexporter-ui-20261020'
await mkdir(output, { recursive: true })
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
  ignoreDefaultArgs: ['--disable-extensions'],
  args: [
    '--headless=new',
    `--disable-extensions-except=${root}/ai-chat-exporter`,
    `--load-extension=${root}/ai-chat-exporter`
  ]
})
try {
  const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'))
  const id = new URL(worker.url()).host
  const pages = [
    'popup.html',
    'options.html',
    'tabs/preview.html',
    'tabs/recovery.html',
    'tabs/export-workspace.html'
  ]
  for (const locale of ['en', 'zh-CN', 'zh-TW', 'de', 'ja', 'ko']) {
    await worker.evaluate(async locale => {
      const all = await chrome.storage.local.get(null)
      const key =
        Object.keys(all).find(k => all[k] && typeof all[k] === 'object' && 'locale' in all[k]) ||
        'settings'
      await chrome.storage.local.set({
        [key]: { ...(all[key] || {}), locale },
        'conversation-font-check': {
          id: 'font-check',
          title: 'Typography / 字体 / 書体 / 글꼴',
          platform: 'claude',
          url: 'https://example.com',
          sourceCompleteness: 'verified',
          messages: [
            { id: 'u', role: 'user', content: 'Text / 正文 / 本文 / 본문' },
            { id: 'a', role: 'assistant', content: '```python\n    print(1)\n```' }
          ]
        }
      })
    }, locale)
    for (const route of pages) {
      const page = await context.newPage()
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto(
        `chrome-extension://${id}/${route}${route === 'tabs/preview.html' ? '?id=font-check' : ''}`
      )
      await page.locator('#root > *').first().waitFor()
      if (route === 'options.html') {
        await page
          .locator('select')
          .filter({ has: page.locator('option[value="zh-CN"]') })
          .selectOption(locale)
      }
      await page.waitForFunction(locale => document.documentElement.lang === locale, locale)
      await page.evaluate(() => document.fonts.ready)
      const fonts = await page.evaluate(() => {
        const body = getComputedStyle(document.body).fontFamily
        const differences = [...document.querySelectorAll('h1,h2,h3,button,input,select,textarea')]
          .filter(el => el.getClientRects().length && getComputedStyle(el).fontFamily !== body)
          .map(el => ({ tag: el.tagName, font: getComputedStyle(el).fontFamily }))
        return { body, differences, overflow: document.documentElement.scrollWidth > innerWidth }
      })
      assert.deepEqual(fonts.differences, [], `${locale} ${route} UI font mismatch`)
      assert.ok(
        fonts.body.includes('Iowan Old Style') && fonts.body.endsWith('serif'),
        'Expected the confirmed serif typography'
      )
      const regional = {
        'zh-CN': 'Songti SC',
        'zh-TW': 'Songti TC',
        ja: 'Hiragino Mincho ProN',
        ko: 'AppleMyungjo'
      }[locale]
      if (regional)
        assert.ok(fonts.body.includes(regional), `${locale} regional serif fallback missing`)
      assert.equal(fonts.overflow, false, `${route} overflow`)
      if (route === 'tabs/preview.html') {
        const codeFont = await page
          .locator('pre code')
          .first()
          .evaluate(el => getComputedStyle(el).fontFamily)
        assert.ok(/mono|menlo/i.test(codeFont), 'Code must retain its monospace font')
      }
      if (route === 'options.html') {
        const layout = await page.evaluate(() => ({
          toggles: [...document.querySelectorAll('.toggle')].map(
            el => el.getBoundingClientRect().width
          ),
          headingHeight: document.querySelector('.schedule-card-header h2')?.getBoundingClientRect()
            .height
        }))
        assert.ok(
          layout.toggles.every(width => width <= 40),
          'Toggle stretched by settings row CSS'
        )
        assert.ok(
          layout.headingHeight > 0 && layout.headingHeight < 60,
          'Schedule heading squeezed into a vertical column'
        )
      }
      if (route === 'popup.html' || route === 'options.html')
        assert.equal(
          await page
            .locator('a[href="https://github.com/pinguarmy/ai-chat-exporter/issues"]')
            .count(),
          1
        )
      await page.screenshot({
        path: `${output}/${locale}-${route.replaceAll('/', '-')}.png`,
        fullPage: true
      })
      console.log(locale, route, fonts.body, 'font/width passed')
      await page.close()
    }
  }
  const page = await context.newPage()
  // Serve the exact checked-in static files by interception, not a replacement server.
  await page.route('https://feedback.test/**', async route => {
    const file = new URL(route.request().url()).pathname.slice(1) || 'uninstall.html'
    assert.ok(['uninstall.html', 'uninstall.css', 'uninstall.js', 'typography.css'].includes(file))
    await route.fulfill({
      body: await readFile(path.join(root, file)),
      contentType: file.endsWith('.css')
        ? 'text/css'
        : file.endsWith('.js')
          ? 'text/javascript'
          : 'text/html'
    })
  })
  await page.route('https://feedback.pengyuhao.com/api/feedback', async route => {
    const body = route.request().postDataJSON()
    assert.ok(body.text.includes('代码缩进'))
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, id: body.id })
    })
  })
  for (const language of ['en', 'zh']) {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('https://feedback.test/uninstall.html')
    await page.locator('#language').selectOption(language)
    await page.locator('input').first().check()
    await page.locator('#notes').fill('Code spacing needs improvement / 代码缩进')
    await page.locator('#submit').click()
    await page
      .getByText(
        language === 'zh' ? '谢谢，反馈已收到。' : 'Thank you. Your feedback has been received.',
        { exact: true }
      )
      .waitFor()
    assert.equal(await page.locator('#submit').isDisabled(), true)
    assert.equal(await page.locator('a[href="mailto:extensions@pengyuhao.com"]').count(), 1)
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false
    )
    await page.screenshot({ path: `${output}/${language}-feedback.png`, fullPage: true })
  }
  console.log(
    'Optional feedback selection, free text, bilingual layout passed. Screenshots:',
    output
  )
} finally {
  await context.close()
  assert.ok(profile.startsWith(path.join(os.tmpdir(), 'exporter-font-')))
  await rm(profile, { recursive: true, force: true })
}
