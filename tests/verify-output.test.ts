/**
 * Verification test for comprehensive markdown output quality
 * Tests all the fixes: Unicode filenames, paragraph preservation, code blocks, LaTeX, etc.
 */

import { describe, it, expect } from 'vitest'
import { conversationToMarkdown, generateMarkdownFilename } from '../src/lib/export-markdown'
import { generateFilename } from '../src/lib/filename'
import type { Conversation, ExportOptions } from '../src/lib/types'

describe('Output Quality Verification', () => {
  const defaultOptions: ExportOptions = {
    format: 'markdown',
    includeMetadata: true,
    includeCodeBlocks: true,
    includeImages: true
  }

  const createRichConversation = (): Conversation => ({
    id: 'test-conv-rich',
    title: '父亲体检报告分析与病情评估',
    url: 'https://claude.ai/chat/abc123-def456',
    messages: [
      {
        id: 'msg-1',
        role: 'user',
        content: '请帮我分析这份体检报告中的关键指标',
        timestamp: new Date('2026-06-11T10:30:00Z').getTime()
      },
      {
        id: 'msg-2',
        role: 'assistant',
        content: `## 体检报告分析

根据您提供的体检报告，以下是关键指标的分析：

### 1. 血常规

- **白细胞计数**: 6.5 × 10^9/L（正常范围：4.0-10.0）
- **红细胞计数**: 4.8 × 10^12/L（正常范围：3.5-5.5）
- **血红蛋白**: 145 g/L（正常范围：120-160）

### 2. 肝功能

- **谷丙转氨酶(ALT)**: 25 U/L（正常范围：0-40）
- **谷草转氨酶(AST)**: 22 U/L（正常范围：0-40）

### 3. 血糖

空腹血糖为 5.2 mmol/L，属于正常范围。根据公式，BMI 计算如下：

$$BMI = \\frac{体重(kg)}{身高(m)^2} = \\frac{70}{1.75^2} = 22.86$$

这是一个理想的 BMI 值。

### 4. 代码示例

以下是健康风险评估的 Python 代码：

\`\`\`python
def assess_health_risk(bmi, blood_pressure):
    """评估健康风险"""
    risk_level = "低"
    
    if bmi > 28:
        risk_level = "高"
    elif bmi > 24:
        risk_level = "中等"
    
    if blood_pressure > 140:
        risk_level = "高"
    
    return risk_level

result = assess_health_risk(22.86, 120)
print(f"健康风险等级: {result}")
\`\`\`

### 总结

总体来看，各项指标均在正常范围内。建议：

1. 保持良好的饮食习惯
2. 每周进行至少 150 分钟的中等强度运动
3. 定期复查，建议每半年一次
4. 保持良好的作息规律`,
        timestamp: new Date('2026-06-11T10:31:00Z').getTime()
      }
    ],
    platform: 'claude',
    createdAt: new Date('2026-06-11T10:30:00Z').getTime()
  })

  describe('Unicode Filename Support', () => {
    it('should preserve Chinese characters in filename', () => {
      const conv = createRichConversation()
      const filename = generateFilename('{title}', conv)
      
      expect(filename).toBe('父亲体检报告分析与病情评估')
      expect(filename).toContain('父亲')
      expect(filename).toContain('评估')
    })

    it('should generate correct filename with date pattern', () => {
      const conv = createRichConversation()
      const filename = generateFilename('{date}-{title}', conv)
      
      expect(filename).toMatch(/^\d{4}-\d{2}-\d{2}-父亲体检报告分析与病情评估$/)
    })

    it('should preserve Chinese in markdown filename', () => {
      const conv = createRichConversation()
      const filename = generateMarkdownFilename(conv)
      
      expect(filename).toBe('父亲体检报告分析与病情评估.md')
    })

    it('should preserve Japanese characters', () => {
      const conv = createRichConversation()
      conv.title = 'テスト会話の分析'
      const filename = generateFilename('{title}', conv)
      
      expect(filename).toBe('テスト会話の分析')
    })

    it('should preserve Korean characters', () => {
      const conv = createRichConversation()
      conv.title = '대화 분석'
      const filename = generateFilename('{title}', conv)
      
      expect(filename).toBe('대화-분석')
    })

    it('should preserve Arabic characters', () => {
      const conv = createRichConversation()
      conv.title = 'تحليل المحادثة'
      const filename = generateFilename('{title}', conv)
      
      expect(filename).toBe('تحليل-المحادثة')
    })
  })

  describe('Markdown Content Quality', () => {
    it('should have H1 title', () => {
      const conv = createRichConversation()
      const md = conversationToMarkdown(conv, defaultOptions)
      
      expect(md).toContain('# 父亲体检报告分析与病情评估')
    })

    it('should have metadata section', () => {
      const conv = createRichConversation()
      const md = conversationToMarkdown(conv, defaultOptions)
      
      expect(md).toContain('## Metadata')
      expect(md).toContain('**Platform:** Claude')
      expect(md).toContain('**Visible messages:** 2')
      expect(md).toContain('**URL:** https://claude.ai/chat/abc123-def456')
    })

    it('should format user messages with emoji', () => {
      const conv = createRichConversation()
      const md = conversationToMarkdown(conv, defaultOptions)
      
      expect(md).toContain('### 👤 User')
      expect(md).toContain('请帮我分析这份体检报告中的关键指标')
    })

    it('should format assistant messages with emoji', () => {
      const conv = createRichConversation()
      const md = conversationToMarkdown(conv, defaultOptions)
      
      expect(md).toContain('### 🤖 Assistant')
    })

    it('should preserve code blocks as-is', () => {
      const conv = createRichConversation()
      const md = conversationToMarkdown(conv, defaultOptions)
      
      expect(md).toContain('```python')
      expect(md).toContain('def assess_health_risk(bmi, blood_pressure):')
      expect(md).toContain('```')
    })

    it('should preserve LaTeX equations', () => {
      const conv = createRichConversation()
      const md = conversationToMarkdown(conv, defaultOptions)
      
      expect(md).toContain('$$BMI = \\frac{体重(kg)}{身高(m)^2} = \\frac{70}{1.75^2} = 22.86$$')
    })

    it('should preserve headers', () => {
      const conv = createRichConversation()
      const md = conversationToMarkdown(conv, defaultOptions)
      
      expect(md).toContain('## 体检报告分析')
      expect(md).toContain('### 1. 血常规')
      expect(md).toContain('### 2. 肝功能')
      expect(md).toContain('### 总结')
    })

    it('should preserve bullet lists', () => {
      const conv = createRichConversation()
      const md = conversationToMarkdown(conv, defaultOptions)
      
      expect(md).toContain('- **白细胞计数**: 6.5 × 10^9/L')
      expect(md).toContain('- **红细胞计数**: 4.8 × 10^12/L')
    })

    it('should preserve numbered lists', () => {
      const conv = createRichConversation()
      const md = conversationToMarkdown(conv, defaultOptions)
      
      expect(md).toContain('1. 保持良好的饮食习惯')
      expect(md).toContain('2. 每周进行至少 150 分钟')
      expect(md).toContain('3. 定期复查')
      expect(md).toContain('4. 保持良好的作息规律')
    })

    it('should have footer', () => {
      const conv = createRichConversation()
      const md = conversationToMarkdown(conv, defaultOptions)
      
      expect(md).toContain('---')
      expect(md).toContain('Exported from Claude')
    })

    it('should have blank lines between sections', () => {
      const conv = createRichConversation()
      const md = conversationToMarkdown(conv, defaultOptions)
      
      // Double newlines separate paragraphs
      expect(md).toContain('\n\n')
    })

    it('should preserve paragraph breaks between text paragraphs', () => {
      const conv: Conversation = {
        id: 'test-para',
        title: 'Paragraph Test',
        url: 'https://example.com',
        messages: [{
          id: 'msg-1',
          role: 'assistant',
          content: 'First paragraph with **bold** and *italic*.\n\nSecond paragraph after double newline.\n\nThird paragraph.'
        }],
        platform: 'chatgpt'
      }
      const md = conversationToMarkdown(conv, defaultOptions)
      
      // Verify paragraph breaks are preserved as double newlines
      expect(md).toContain('First paragraph with **bold** and *italic*.\n\nSecond paragraph after double newline.\n\nThird paragraph.')
      // Verify headers are not stripped
      expect(md).toContain('### 🤖 Assistant')
    })

    it('should preserve headers within content', () => {
      const conv: Conversation = {
        id: 'test-headers',
        title: 'Header Test',
        url: 'https://example.com',
        messages: [{
          id: 'msg-1',
          role: 'assistant',
          content: '# Title\n\nFirst paragraph.\n\n## Subheading\n\n- List item 1\n- List item 2'
        }],
        platform: 'chatgpt'
      }
      const md = conversationToMarkdown(conv, defaultOptions)
      
      // Headers preserved in content
      expect(md).toContain('# Title')
      expect(md).toContain('## Subheading')
      expect(md).toContain('- List item 1')
      expect(md).toContain('- List item 2')
    })

    it('should preserve LaTeX equations in markdown', () => {
      const conv: Conversation = {
        id: 'test-latex',
        title: 'LaTeX Test',
        url: 'https://example.com',
        messages: [{
          id: 'msg-1',
          role: 'assistant',
          content: 'The formula is:\n\n$$E = mc^2$$\n\nThis is a famous equation.'
        }],
        platform: 'chatgpt'
      }
      const md = conversationToMarkdown(conv, defaultOptions)
      
      expect(md).toContain('$$E = mc^2$$')
      expect(md).toContain('This is a famous equation.')
    })
  })

  describe('Code Block Preservation in Markdown', () => {
    it('should not mangle code inside triple backticks', () => {
      const conv: Conversation = {
        id: 'test-code',
        title: 'Code Test',
        url: 'https://example.com',
        messages: [{
          id: 'msg-1',
          role: 'assistant',
          content: 'Here is code:\n\n```javascript\nconst x = 1;\nconst y = {\n  a: 2,\n  b: 3\n};\n```\n\nAnd after code.'
        }],
        platform: 'chatgpt'
      }
      const md = conversationToMarkdown(conv, defaultOptions)
      
      expect(md).toContain('```javascript')
      expect(md).toContain('const x = 1;')
      expect(md).toContain('const y = {')
      expect(md).toContain('a: 2,')
      expect(md).toContain('b: 3')
      expect(md).toContain('```')
      expect(md).toContain('And after code.')
    })
  })
})
