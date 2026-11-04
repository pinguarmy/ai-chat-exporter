import { describe, it, expect } from 'vitest'
import { extractChatGptEvents, toolSummary } from '../src/lib/execution-trace'

describe('extractChatGptEvents', () => {
  it('extracts tool events from content.parts strings', () => {
    const nodes = [
      {
        id: 'node-1',
        parent: 'parent-1',
        message: {
          id: 'msg-1',
          author: { role: 'tool', name: 'python' },
          content: { parts: ['result from python tool'] },
          create_time: 1700000000,
        },
      },
    ]
    const events = extractChatGptEvents(nodes)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      id: 'msg-1',
      kind: 'tool_result',
      toolName: 'python',
      content: 'result from python tool',
      timestamp: 1700000000000,
    })
  })

  it('extracts text from content.parts objects with .text property', () => {
    const nodes = [
      {
        message: {
          id: 'msg-2',
          author: { role: 'tool', name: 'browser' },
          content: { parts: [{ text: 'browsed page content' }] },
        },
      },
    ]
    const events = extractChatGptEvents(nodes)
    expect(events).toHaveLength(1)
    expect(events[0].content).toBe('browsed page content')
  })

  it('falls back to content.text when parts is empty (code/execution_output)', () => {
    const nodes = [
      {
        message: {
          id: 'msg-code',
          author: { role: 'tool', name: 'python' },
          content: {
            content_type: 'code',
            parts: [],
            text: 'print("hello world")',
          },
        },
      },
    ]
    const events = extractChatGptEvents(nodes)
    expect(events).toHaveLength(1)
    expect(events[0].content).toBe('print("hello world")')
  })

  it('falls back to content.text when parts is absent for execution_output', () => {
    const nodes = [
      {
        message: {
          id: 'msg-exec',
          author: { role: 'tool', name: 'python' },
          content: {
            content_type: 'execution_output',
            text: 'hello world\n42',
          },
        },
      },
    ]
    const events = extractChatGptEvents(nodes)
    expect(events).toHaveLength(1)
    expect(events[0].content).toBe('hello world\n42')
  })

  it('does NOT fall back to content.text for unknown content_type (prevents hidden thinking leak)', () => {
    const nodes = [
      {
        message: {
          id: 'msg-thinking',
          author: { role: 'tool', name: 'unknown_tool' },
          content: {
            content_type: 'model_editable_context',
            parts: [],
            text: 'hidden internal reasoning that must not appear',
          },
        },
      },
    ]
    const events = extractChatGptEvents(nodes)
    expect(events).toHaveLength(1)
    expect(events[0].content).toBe('')
  })

  it('does NOT fall back to content.text when content_type is absent', () => {
    const nodes = [
      {
        message: {
          id: 'msg-no-type',
          author: { role: 'tool', name: 'some_tool' },
          content: {
            parts: [],
            text: 'could be hidden thinking',
          },
        },
      },
    ]
    const events = extractChatGptEvents(nodes)
    expect(events).toHaveLength(1)
    expect(events[0].content).toBe('')
  })

  it('prefers parts content over content.text when parts has text', () => {
    const nodes = [
      {
        message: {
          id: 'msg-both',
          author: { role: 'tool', name: 'python' },
          content: {
            parts: ['from parts'],
            text: 'from text field',
          },
        },
      },
    ]
    const events = extractChatGptEvents(nodes)
    expect(events[0].content).toBe('from parts')
  })

  it('extracts assistant tool_call events with recipient', () => {
    const nodes = [
      {
        message: {
          id: 'msg-call',
          author: { role: 'assistant' },
          recipient: 'python',
          content: { parts: ['run this code'] },
        },
      },
    ]
    const events = extractChatGptEvents(nodes)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      kind: 'tool_call',
      toolName: 'python',
      content: 'run this code',
    })
  })

  it('skips visually hidden messages', () => {
    const nodes = [
      {
        message: {
          id: 'hidden',
          author: { role: 'tool', name: 'python' },
          content: { parts: ['hidden result'] },
          metadata: { is_visually_hidden_from_conversation: true },
        },
      },
    ]
    expect(extractChatGptEvents(nodes)).toHaveLength(0)
  })

  it('skips regular user/assistant messages without recipient', () => {
    const nodes = [
      { message: { id: 'user', author: { role: 'user' }, content: { parts: ['hello'] } } },
      { message: { id: 'asst', author: { role: 'assistant' }, content: { parts: ['hi'] } } },
    ]
    expect(extractChatGptEvents(nodes)).toHaveLength(0)
  })

  it('marks error events via metadata.is_error', () => {
    const nodes = [
      {
        message: {
          id: 'err',
          author: { role: 'tool', name: 'python' },
          content: { text: 'Traceback...' },
          metadata: { is_error: true },
        },
      },
    ]
    const events = extractChatGptEvents(nodes)
    expect(events[0].status).toBe('error')
  })

  it('handles nodes with no message gracefully', () => {
    expect(extractChatGptEvents([{}, null, undefined, { message: null }])).toEqual([])
  })

  it('synthesizes a realistic ChatGPT code tool roundtrip', () => {
    const nodes = [
      {
        id: 'node-call',
        message: {
          id: 'call-1',
          author: { role: 'assistant' },
          recipient: 'python',
          content: { content_type: 'code', parts: [], text: 'import math\nmath.sqrt(144)' },
          create_time: 1700000010,
        },
      },
      {
        id: 'node-result',
        parent: 'node-call',
        message: {
          id: 'result-1',
          author: { role: 'tool', name: 'python' },
          content: { content_type: 'execution_output', parts: [], text: '12.0' },
          create_time: 1700000011,
          metadata: { tool_call_id: 'call_abc123' },
        },
      },
    ]
    const events = extractChatGptEvents(nodes)
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      kind: 'tool_call',
      toolName: 'python',
      content: 'import math\nmath.sqrt(144)',
    })
    expect(events[1]).toMatchObject({
      kind: 'tool_result',
      toolName: 'python',
      content: '12.0',
      callId: 'call_abc123',
      parentId: 'node-call',
    })
  })
})

describe('toolSummary', () => {
  it('counts tool calls by name', () => {
    const events = [
      { id: '1', kind: 'tool_call' as const, toolName: 'python', status: 'unknown' as const, content: '' },
      { id: '2', kind: 'tool_result' as const, toolName: 'python', status: 'unknown' as const, content: '' },
      { id: '3', kind: 'tool_call' as const, toolName: 'python', status: 'unknown' as const, content: '' },
      { id: '4', kind: 'tool_call' as const, toolName: 'browser', status: 'unknown' as const, content: '' },
    ]
    const summary = toolSummary(events)
    expect(summary).toContain('python × 2')
    expect(summary).toContain('browser × 1')
  })

  it('returns empty for undefined', () => {
    expect(toolSummary(undefined)).toEqual([])
  })
})
