/**
 * Official settings.section slot has no icon field (label/order/locale only).
 * Replace the gear only when one nav button owns the Usage label.
 */

const LABELS = new Set(['Usage', '用量'])
const MARK = 'data-dsh-um-icon'
const CHANGED_ATTRIBUTES = [MARK, 'viewBox', 'fill'] as const

type SvgSnapshot = {
  svg: SVGElement
  attributes: Array<[string, string | null]>
  innerHTML: string
}

type UsageOwner = {
  svg: SVGElement | null
}

const BARS = [
  '<rect x="2.2" y="8.2" width="2.8" height="5.6" rx="0.6" fill="currentColor"/>',
  '<rect x="6.6" y="3.4" width="2.8" height="10.4" rx="0.6" fill="currentColor"/>',
  '<rect x="11" y="5.8" width="2.8" height="8" rx="0.6" fill="currentColor"/>',
].join('')

function aggregateErrors(errors: unknown[], message: string): Error {
  if (errors.length === 1) {
    const error = errors[0]
    return error instanceof Error ? error : new Error(String(error))
  }
  if (typeof AggregateError === 'function') return new AggregateError(errors, message)
  return new Error(message + ': ' + errors.map(error => error instanceof Error ? error.message : String(error)).join('; '))
}

function attributeNames(svg: SVGElement): string[] {
  if (typeof svg.getAttributeNames === 'function') return svg.getAttributeNames()
  const attributes = svg.attributes
  if (attributes !== undefined) {
    const names: string[] = []
    for (let index = 0; index < attributes.length; index += 1) {
      const name = attributes.item(index)?.name
      if (name !== undefined) names.push(name)
    }
    return names
  }
  return [...CHANGED_ATTRIBUTES]
}

function snapshot(svg: SVGElement): SvgSnapshot {
  return {
    svg,
    attributes: attributeNames(svg).map(name => [name, svg.getAttribute(name)]),
    innerHTML: svg.innerHTML,
  }
}

function restore(snapshotValue: SvgSnapshot): void {
  const { svg } = snapshotValue
  const names = attributeNames(svg)
  if (typeof svg.removeAttribute === 'function') {
    for (const name of names) svg.removeAttribute(name)
  }
  for (const [name, value] of snapshotValue.attributes) {
    if (value !== null) svg.setAttribute(name, value)
  }
  svg.innerHTML = snapshotValue.innerHTML
}

function usageOwners(): UsageOwner[] {
  if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return []
  const owners: UsageOwner[] = []
  for (const button of document.querySelectorAll('nav button')) {
    if (typeof button.querySelectorAll !== 'function' || typeof button.querySelector !== 'function') continue
    const label = [...button.querySelectorAll('span')].find(span => LABELS.has(span.textContent?.trim() ?? ''))
    if (label === undefined) continue
    const svg = button.querySelector('svg')
    owners.push({ svg })
  }
  return owners
}

function patchOwner(owner: UsageOwner, snapshots: Map<SVGElement, SvgSnapshot>): void {
  if (owner.svg === null) {
    if (snapshots.size > 0) rollback(snapshots)
    return
  }
  for (const svg of snapshots.keys()) {
    if (svg !== owner.svg) {
      rollback(snapshots)
      break
    }
  }
  patch(owner, snapshots)
}

function patch(owner: UsageOwner, snapshots: Map<SVGElement, SvgSnapshot>): void {
  const { svg } = owner
  if (svg === null || typeof svg.getAttribute !== 'function' || typeof svg.setAttribute !== 'function' || typeof svg.removeAttribute !== 'function') return
  if (!snapshots.has(svg)) snapshots.set(svg, snapshot(svg))
  if (svg.getAttribute(MARK) === 'usage') return
  svg.setAttribute(MARK, 'usage')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('fill', 'none')
  svg.innerHTML = BARS
}

function rollback(snapshots: Map<SVGElement, SvgSnapshot>): void {
  const errors: unknown[] = []
  for (const value of snapshots.values()) {
    try {
      restore(value)
    } catch (error) {
      errors.push(error)
    }
  }
  if (errors.length > 0) throw aggregateErrors(errors, 'usage nav icon rollback failed')
  snapshots.clear()
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
  const ElementConstructor = globalThis.Element
  if (typeof ElementConstructor !== 'function' || !(node instanceof ElementConstructor)) return false
  if (typeof node.closest !== 'function' || typeof node.querySelector !== 'function'
    || typeof node.matches !== 'function' || typeof node.querySelectorAll !== 'function') return false
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

/**
 * Watch the settings nav and keep the Usage glyph in place across re-renders.
 * The disposer disconnects observation, cancels one pending frame, and restores
 * every SVG changed by this installation. Missing DOM features leave the page untouched.
 */
export function installUsageNavIcon(): () => void {
  if (typeof document === 'undefined' || document.body === null) return () => {}
  if (typeof document.querySelectorAll !== 'function') return () => {}
  const Observer = globalThis.MutationObserver
  const requestFrame = globalThis.requestAnimationFrame
  const cancelFrame = globalThis.cancelAnimationFrame
  if (typeof Observer !== 'function' || typeof requestFrame !== 'function' || typeof cancelFrame !== 'function') return () => {}

  const snapshots = new Map<SVGElement, SvgSnapshot>()
  let frame = 0
  let disposed = false
  let observer: MutationObserver | undefined
  try {
    observer = new Observer(records => {
      if (disposed || !recordsTouchSettingsNav(records)) return
      if (frame !== 0) return
      frame = requestFrame(() => {
        if (disposed) return
        frame = 0
        const owners = usageOwners()
        const errors: unknown[] = []
        try {
          if (owners.length === 1) patchOwner(owners[0]!, snapshots)
          else rollback(snapshots)
        } catch (error) {
          errors.push(error)
        }
        try {
          if (typeof observer?.takeRecords === 'function') observer.takeRecords()
        } catch (error) {
          errors.push(error)
        }
        if (errors.length > 0) throw aggregateErrors(errors, 'usage nav icon mutation failed')
      })
    })
    if (observer === undefined || typeof observer.observe !== 'function' || typeof observer.disconnect !== 'function') return () => {}
    observer.observe(document.body, { childList: true, subtree: true })
    const owners = usageOwners()
    if (owners.length === 1) patchOwner(owners[0]!, snapshots)
    if (typeof observer?.takeRecords === 'function') observer.takeRecords()
  } catch (error) {
    const errors: unknown[] = [error]
    try {
      if (observer !== undefined && typeof observer.disconnect === 'function') observer.disconnect()
    } catch (cleanupError) {
      errors.push(cleanupError)
    }
    try {
      rollback(snapshots)
    } catch (rollbackError) {
      errors.push(rollbackError)
    }
    throw aggregateErrors(errors, 'usage nav icon installation failed')
  }

  return () => {
    if (disposed) return
    disposed = true
    const errors: unknown[] = []
    try {
      observer?.disconnect()
    } catch (error) {
      errors.push(error)
    }
    if (frame !== 0) {
      try {
        cancelFrame(frame)
      } catch (error) {
        errors.push(error)
      }
      frame = 0
    }
    try {
      rollback(snapshots)
    } catch (error) {
      errors.push(error)
    }
    if (errors.length > 0) throw aggregateErrors(errors, 'usage nav icon cleanup failed')
  }
}
