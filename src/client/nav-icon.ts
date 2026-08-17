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

/** Watch the settings nav and keep the Usage glyph in place across re-renders. */
export function installUsageNavIcon(): () => void {
  if (typeof document === 'undefined' || document.body === null) return () => {}
  let scheduled = false
  const flush = (): void => {
    scheduled = false
    patch()
  }
  const observer = new MutationObserver(() => {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(flush)
  })
  observer.observe(document.body, { childList: true, subtree: true })
  patch()
  return () => observer.disconnect()
}
