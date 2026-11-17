/* Explicit, private feedback submission. No cookies, analytics or auto-send. */
;(() => {
  const endpoint = 'https://feedback.pengyuhao.com/api/feedback'
  const english = Object.fromEntries(
    [...document.querySelectorAll('[data-text]')].map(el => [el.dataset.text, el.textContent])
  )
  const chinese = {
    title: '谢谢你试用 AI Chat Exporter。',
    intro: '哪里可以做得更好？反馈会直接交给开发者，无需登录。',
    reason: '为什么卸载？（可选，可多选）',
    broken: '导出失败或内容不完整',
    format: '导出格式不符合预期',
    feature: '缺少需要的平台或功能',
    usability: '不容易使用',
    need: '暂时不需要',
    other: '其他',
    details: '还有什么想告诉我们？（选填）',
    issueHelp: '遇到使用问题？到 GitHub Issues 获取帮助 →',
    contact: '联系方式（选填）',
    contactHint: '希望收到回复的话，可以留下邮箱或其他联系方式。',
    privacy: '内容仅开发者可见。请勿填写私人聊天或密码。',
    submit: '提交反馈',
    send: '到 GitHub 获取帮助',
    draft: '不需要账号，也不用打开邮件应用。点击提交前不会发送。',
    help: '需要帮助？',
    support:
      '无需账号即可使用上面的私密反馈；也可到 GitHub Issues 公开报告问题和提问。请勿公开私人聊天。',
    open: '到 GitHub 获取帮助 →',
    policy: '隐私政策'
  }
  const language = document.getElementById('language')
  const button = document.getElementById('submit')
  const status = document.getElementById('feedback-status')
  language.value = navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
  let pending = false,
    completed = false,
    requestId,
    lastBody = '',
    statusKey = ''
  const messages = {
    empty: ['Select a reason or add a short note first.', '请先选择一个原因，或填写简短说明。'],
    sending: ['Submitting…', '正在提交…'],
    success: ['Thank you. Your feedback has been received.', '谢谢，反馈已收到。'],
    failed: [
      'Could not submit. Your feedback is still here; please retry.',
      '提交失败。内容已保留，请重试。'
    ],
    limited: [
      'Too many attempts. Your feedback is still here; please try again later.',
      '提交过于频繁。内容已保留，请稍后重试。'
    ]
  }
  function refresh() {
    const zh = language.value === 'zh'
    document.documentElement.lang = zh ? 'zh-CN' : 'en'
    document.querySelectorAll('[data-text]').forEach(el => {
      el.textContent = (zh ? chinese : english)[el.dataset.text]
    })
    button.disabled = pending || completed
    status.textContent = statusKey ? messages[statusKey][zh ? 1 : 0] : ''
  }
  button.addEventListener('click', async () => {
    if (pending || completed) return
    const reasons = [...document.querySelectorAll('input[type="checkbox"]:checked')].map(
      el => el.value
    )
    const text = document.getElementById('notes').value.trim()
    if (!reasons.length && !text) {
      statusKey = 'empty'
      refresh()
      return
    }
    const contact = document.getElementById('contact').value.trim()
    const bodyKey = JSON.stringify({ reasons, text, contact })
    if (bodyKey !== lastBody || !requestId) requestId = crypto.randomUUID()
    lastBody = bodyKey
    pending = true
    statusKey = 'sending'
    refresh()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          id: requestId,
          reasons,
          text,
          contact,
          locale: language.value === 'zh' ? 'zh-CN' : 'en',
          honeypot: document.getElementById('website').value
        })
      })
      const result = await response.json()
      if (response.status !== 201 || result.ok !== true || result.id !== requestId) {
        statusKey = response.status === 429 ? 'limited' : 'failed'
      } else {
        completed = true
        statusKey = 'success'
      }
    } catch {
      statusKey = 'failed'
    } finally {
      clearTimeout(timer)
      pending = false
      refresh()
    }
  })
  document.addEventListener('change', refresh)
  refresh()
})()
