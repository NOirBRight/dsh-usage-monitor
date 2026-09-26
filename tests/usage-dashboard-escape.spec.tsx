// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UsageDashboard } from '../src/client/UsageDashboard.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    disconnect(): void {}
  })
})
afterEach(() => {
  act(() => { while (roots.length > 0) roots.pop()?.unmount() })
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('UsageDashboard Escape handling', () => {
  it.each([
    ['metric', 'token'],
    ['by', 'provider'],
    ['group', 'day'],
  ] as const)('closes the %s menu without dismissing the settings modal', (label, value) => {
    let modalDismissals = 0
    const onModalKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) modalDismissals++
    }
    document.addEventListener('keydown', onModalKeyDown)

    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    roots.push(root)
    act(() => {
      root.render(
        <UsageDashboard
          t={key => key}
          locale="en"
          queryUsage={() => new Promise(() => undefined)}
        />,
      )
    })

    try {
      const trigger = host.querySelector<HTMLButtonElement>(`[aria-label="${label} ${value}"]`)
      expect(trigger).not.toBeNull()
      act(() => { trigger?.click() })
      const option = host.querySelector<HTMLButtonElement>('[role="option"]')
      expect(option).not.toBeNull()
      option?.focus()

      const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      act(() => { option?.dispatchEvent(escape) })

      expect(escape.defaultPrevented).toBe(true)
      expect(modalDismissals).toBe(0)
      expect(host.querySelector('[role="listbox"]')).toBeNull()
      expect(document.activeElement).toBe(trigger)

      const delegatedEscape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      act(() => { trigger?.dispatchEvent(delegatedEscape) })
      expect(delegatedEscape.defaultPrevented).toBe(false)
      expect(modalDismissals).toBe(1)
    } finally {
      document.removeEventListener('keydown', onModalKeyDown)
    }
  })
})
