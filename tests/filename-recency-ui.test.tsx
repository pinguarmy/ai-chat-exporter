import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FilenameEditor } from '../src/components/FilenameEditor'

afterEach(cleanup)

describe('last message filename controls', () => {
  it('exposes localized tokens and their recency limitation without changing the saved pattern', () => {
    const onChange = vi.fn()
    render(<FilenameEditor value="{last_message_datetime}" onChange={onChange} defaultOpen locale="zh-CN" />)
    expect(screen.getByText(/不是下载时间/)).toBeTruthy()
    expect(screen.getByText(/使用设备本地时间并附时区偏移/)).toBeTruthy()
    expect(screen.getByText('→ unknown')).toBeTruthy()
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /最后可见消息日期与时间/ }))
    expect(onChange).toHaveBeenCalledWith('{last_message_datetime}{last_message_datetime}')
  })
})
