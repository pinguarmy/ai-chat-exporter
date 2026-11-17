export const SUPPORT_URL = 'https://github.com/pinguarmy/ai-chat-exporter/issues'
export const UNINSTALL_URL = 'https://pinguarmy.github.io/ai-chat-exporter/uninstall.html'

/** Register on worker startup too, so existing installations receive the URL. */
export async function registerUninstallFeedback(): Promise<void> {
  try {
    if (typeof chrome.runtime.setUninstallURL === 'function') {
      await chrome.runtime.setUninstallURL(UNINSTALL_URL)
    }
  } catch {
    console.warn('[Support] Could not register optional uninstall feedback')
  }
}

export function supportLabel(locale: string): string {
  return ({ 'zh-CN': '帮助与反馈', 'zh-TW': '說明與意見', de: 'Hilfe & Feedback', ja: 'ヘルプとフィードバック', ko: '도움말 및 피드백' } as Record<string, string>)[locale] || 'Help & feedback'
}
