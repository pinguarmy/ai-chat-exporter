export function redactShareText(text: string): { text: string; replacements: number } {
  let replacements = 0
  const replace = (match: string, prefix = '') => {
    if (match.slice(prefix.length) === '[REDACTED]') return match
    replacements++
    return `${prefix}[REDACTED]`
  }
  const redacted = text
    .replace(/((?:[?&]|\b)(?:access_token|refresh_token|token|api[_-]?key|password|secret|signature|sig)=)[^\s&#)"']+/gi, replace)
    .replace(/((?:authorization|cookie|set-cookie)\s*:\s*)[^\r\n]+/gi, replace)
    .replace(/((?:["']?(?:api[_-]?key|password|secret|access_token|refresh_token)["']?)\s*:\s*["'])[^"'\r\n]+/gi, replace)
    .replace(/\b(sk-[a-zA-Z0-9_-]{16,}|gh[pousr]_[a-zA-Z0-9]{16,})\b/g, () => { replacements++; return '[REDACTED]' })
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, (_m, prefix) => { replacements++; return prefix })
  return { text: redacted, replacements }
}
