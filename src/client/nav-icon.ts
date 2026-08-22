/** Swap the settings-nav gear for a usage bar-chart glyph. */

const LABELS = new Set(['Usage', '用量'])
const MARK = 'data-dsh-um-icon'

const BARS = `
  <rect x="2.2" y="8.2" width="2.8" height="5.6" rx="0.6" fill="currentColor"/>
  <rect x="6.6" y="3.4" width="2.8" height="10.4" rx="0.6" fill="currentColor"/>
  <rect x="11" y="5.8" width="2.8" height="8" rx="0.6" fill="currentColor"/>
`

function patch(): void {
  for (const button of document.querySelectorAll('nav button')) {
    const label = [...button.querySelectorAll('span')].find(span => LABELS.has(span.textContent?.trim() ?? ''))
    if (label === undefined) continue
    const svg = button.querySelector('svg')
    if (svg === null || svg.getAttribute(MARK) === 'usage') continue
    svg.setAttribute(MARK, 'usage')
    svg.setAttribute('viewBox', '0 0 16 16')
    svg.setAttribute('fill', 'none')
    svg.innerHTML = BARS
  }
}

export function recordsTouchSettingsNav(records: Iterable<MutationRecord>, labels: ReadonlySet<string> = LABELS): boolean {
  for (const record of records) {
    if (touchesSettingsNav(record.target, labels)) return true
    for (const added of record.addedNodes) {
      if (touchesSettingsNav(added, labels)) return true
    }
  }
  return false
}

function touchesSettingsNav(node: Node, labels: ReadonlySet<string>): boolean {
  if (!(node instanceof Element)) return false
  if (node.closest('nav') !== null) return true
  if (node.querySelector('nav') !== null) return true
  const buttons = node.matches('button') ? [node, ...node.querySelectorAll('button')] : [...node.querySelectorAll('button')]
  for (const button of buttons) {
    for (const span of button.querySelectorAll('span')) {
      if (labels.has(span.textContent?.trim() ?? '')) return true
    }
  }
  return false
}

/** Watch the settings nav and keep the Usage glyph in place across re-renders. */
export function installUsageNavIcon(): () => void {
  if (typeof document === 'undefined' || document.body === null) return () => {}
  let frame = 0
  const observer = new MutationObserver((records) => {
    if (!recordsTouchSettingsNav(records)) return
    if (frame !== 0) return
    frame = requestAnimationFrame(() => {
      frame = 0
      patch()
      observer.takeRecords()
    })
  })
  observer.observe(document.body, { childList: true, subtree: true })
  patch()
  observer.takeRecords()
  return () => {
    observer.disconnect()
    if (frame !== 0) cancelAnimationFrame(frame)
    frame = 0
  }
}
