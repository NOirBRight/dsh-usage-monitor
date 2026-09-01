import { afterEach, describe, expect, it, vi } from 'vitest'
import { installUsageNavIcon, recordsTouchSettingsNav } from '../src/client/nav-icon.ts'

class FakeEl {
  tagName: string
  parentElement: FakeEl | null = null
  readonly children: FakeEl[] = []
  textContent = ''
  innerHTML = ''
  private readonly attrs = new Map<string, string>()

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase()
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value)
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null
  }

  getAttributeNames(): string[] {
    return [...this.attrs.keys()]
  }

  throwOnRemove = false

  removeAttribute(name: string): void {
    if (this.throwOnRemove) throw new Error('remove failed')
    this.attrs.delete(name)
  }

  append(...nodes: FakeEl[]): void {
    for (const node of nodes) {
      node.parentElement = this
      this.children.push(node)
    }
  }

  matches(selector: string): boolean {
    if (selector.includes(' ')) return false
    return this.tagName === selector.toUpperCase()
  }

  closest(selector: string): FakeEl | null {
    let current: FakeEl | null = this
    while (current !== null) {
      if (current.matches(selector)) return current
      current = current.parentElement
    }
    return null
  }

  querySelector(selector: string): FakeEl | null {
    return this.querySelectorAll(selector)[0] ?? null
  }

  querySelectorAll(selector: string): FakeEl[] {
    const found: FakeEl[] = []
    const visit = (node: FakeEl): void => {
      for (const child of node.children) {
        if (child.matches(selector) || (selector === 'nav button' && child.tagName === 'BUTTON' && child.closest('nav'))) {
          found.push(child)
        }
        visit(child)
      }
    }
    visit(this)
    if (selector === 'nav button' && this.tagName === 'BUTTON' && this.closest('nav')) found.unshift(this)
    return found
  }
}

class FakeObserver {
  static instances: FakeObserver[] = []
  callback: MutationCallback
  disconnected = false
  throwOnDisconnect = false
  takeCount = 0
  constructor(callback: MutationCallback) {
    this.callback = callback
    FakeObserver.instances.push(this)
  }
  observe(): void { this.disconnected = false }
  disconnect(): void {
    if (this.throwOnDisconnect) throw new Error('disconnect failed')
    this.disconnected = true
  }
  takeRecords(): MutationRecord[] {
    this.takeCount++
    return []
  }
  deliver(records: MutationRecord[]): void {
    this.callback(records, this as unknown as MutationObserver)
  }
}

function record(target: FakeEl, added: FakeEl[] = []): MutationRecord {
  return {
    type: 'childList',
    target: target as unknown as Node,
    addedNodes: added as unknown as NodeList,
    removedNodes: [] as unknown as NodeList,
    previousSibling: null,
    nextSibling: null,
    attributeName: null,
    attributeNamespace: null,
    oldValue: null,
  }
}

function labeledButton(text: string): FakeEl {
  const nav = new FakeEl('nav')
  const button = new FakeEl('button')
  const span = new FakeEl('span')
  span.textContent = text
  const svg = new FakeEl('svg')
  button.append(span, svg)
  nav.append(button)
  return nav
}

let rafs: FrameRequestCallback[] = []

function stubDom(buttons: FakeEl[] = []): void {
  FakeObserver.instances = []
  rafs = []
  vi.stubGlobal('Element', FakeEl)
  vi.stubGlobal('MutationObserver', FakeObserver)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafs.push(cb)
    return rafs.length
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    rafs[id - 1] = () => {}
  })
  vi.stubGlobal('document', {
    body: {},
    querySelectorAll: (selector: string) => selector === 'nav button' ? buttons : [],
  })
}

function flush(): void {
  const queued = rafs.splice(0, rafs.length)
  for (const cb of queued) cb(0)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('recordsTouchSettingsNav', () => {
  it('ignores conversation subtree mutations', () => {
    vi.stubGlobal('Element', FakeEl)
    const chat = new FakeEl('div')
    const line = new FakeEl('span')
    line.textContent = 'hello'
    chat.append(line)
    expect(recordsTouchSettingsNav([record(chat)])).toBe(false)
  })

  it('detects insertion of the Usage nav button', () => {
    vi.stubGlobal('Element', FakeEl)
    const dialog = new FakeEl('div')
    const nav = labeledButton('用量')
    dialog.append(nav)
    expect(recordsTouchSettingsNav([record(new FakeEl('body'), [dialog])])).toBe(true)
    expect(recordsTouchSettingsNav([record(nav)])).toBe(true)
  })
})

describe('installUsageNavIcon', () => {
  it('does not schedule a frame for conversation mutations', () => {
    stubDom()
    installUsageNavIcon()
    const chat = new FakeEl('div')
    FakeObserver.instances[0]?.deliver([record(chat)])
    expect(rafs).toHaveLength(0)
  })

  it('coalesces a labeled-nav burst into one patch and drains self-records', () => {
    const nav = labeledButton('Usage')
    const button = nav.children[0]!
    stubDom([button])
    installUsageNavIcon()
    const observer = FakeObserver.instances[0]!
    observer.deliver([record(nav)])
    observer.deliver([record(nav)])
    observer.deliver([record(nav)])
    expect(rafs).toHaveLength(1)
    flush()
    expect(observer.takeCount).toBeGreaterThan(0)
    expect(button.children[1]?.getAttribute('data-dsh-um-icon')).toBe('usage')
  })

  it('ignores a queued RAF callback after disposal', () => {
    const nav = labeledButton('Usage')
    const button = nav.children[0]!
    const replacementNav = labeledButton('用量')
    const replacementButton = replacementNav.children[0]!
    const buttons = [button]
    stubDom(buttons)
    vi.stubGlobal('cancelAnimationFrame', () => {})
    const stop = installUsageNavIcon()
    const observer = FakeObserver.instances[0]!
    observer.deliver([record(nav)])
    expect(rafs).toHaveLength(1)
    stop()
    buttons[0] = replacementButton
    flush()
    expect(replacementButton.children[1]!.getAttribute('data-dsh-um-icon')).toBeNull()
  })

  it('disconnects and cancels a pending frame on dispose', () => {
    stubDom()
    const stop = installUsageNavIcon()
    FakeObserver.instances[0]?.deliver([record(labeledButton('Usage'))])
    expect(rafs).toHaveLength(1)
    stop()
    expect(FakeObserver.instances[0]?.disconnected).toBe(true)
    flush()
  })

  it('patches only a unique owner and restores the complete SVG snapshot', () => {
    const nav = labeledButton('Usage')
    const button = nav.children[0]!
    const svg = button.children[1]!
    svg.setAttribute('class', 'gear')
    svg.setAttribute('viewBox', '1 2 3 4')
    svg.setAttribute('fill', 'currentColor')
    svg.setAttribute('data-dsh-um-icon', 'legacy')
    svg.innerHTML = '<path/>'
    stubDom([button])
    const stop = installUsageNavIcon()
    expect(svg.getAttribute('data-dsh-um-icon')).toBe('usage')
    expect(svg.innerHTML).not.toBe('<path/>')
    const observer = FakeObserver.instances[0]!

    const duplicate = labeledButton('用量')
    stubDom([button, duplicate.children[0]!])
    observer.deliver([record(duplicate)])
    flush()
    expect(svg.getAttribute('data-dsh-um-icon')).toBe('legacy')
    expect(svg.getAttribute('viewBox')).toBe('1 2 3 4')
    expect(svg.getAttribute('fill')).toBe('currentColor')
    expect(svg.getAttribute('class')).toBe('gear')
    expect(svg.innerHTML).toBe('<path/>')
    expect(duplicate.children[0]!.children[1]!.getAttribute('data-dsh-um-icon')).toBeNull()
    stop()
  })

  it('rolls back a previous owner before patching its replacement', () => {
    const firstNav = labeledButton('Usage')
    const firstButton = firstNav.children[0]!
    const firstSvg = firstButton.children[1]!
    firstSvg.innerHTML = '<path/>'
    const replacementNav = labeledButton('用量')
    const replacementButton = replacementNav.children[0]!
    stubDom([firstButton])
    const stop = installUsageNavIcon()
    const observer = FakeObserver.instances[0]!
    stubDom([replacementButton])
    observer.deliver([record(replacementNav)])
    flush()
    expect(firstSvg.getAttribute('data-dsh-um-icon')).toBeNull()
    expect(firstSvg.innerHTML).toBe('<path/>')
    expect(replacementButton.children[1]!.getAttribute('data-dsh-um-icon')).toBe('usage')
    stop()
    expect(replacementButton.children[1]!.getAttribute('data-dsh-um-icon')).toBeNull()
  })

  it('counts a labeled button without an SVG as an owner', () => {
    const nav = labeledButton('Usage')
    const button = nav.children[0]!
    const duplicate = labeledButton('用量')
    duplicate.children[0]!.children.pop()
    stubDom([button])
    const stop = installUsageNavIcon()
    const observer = FakeObserver.instances[0]!
    stubDom([button, duplicate.children[0]!])
    observer.deliver([record(duplicate)])
    flush()
    expect(button.children[1]!.getAttribute('data-dsh-um-icon')).toBeNull()
    stop()
  })

  it('retains snapshots when a restore fails and retries on the next mutation', () => {
    const nav = labeledButton('Usage')
    const button = nav.children[0]!
    const svg = button.children[1]!
    svg.innerHTML = '<path/>'
    const duplicateNav = labeledButton('用量')
    const duplicateButton = duplicateNav.children[0]!
    const buttons = [button]
    stubDom(buttons)
    const stop = installUsageNavIcon()
    const observer = FakeObserver.instances[0]!
    svg.throwOnRemove = true
    buttons.push(duplicateButton)
    observer.deliver([record(duplicateNav)])
    expect(() => flush()).toThrow('remove failed')
    svg.throwOnRemove = false
    observer.deliver([record(duplicateNav)])
    flush()
    expect(svg.getAttribute('data-dsh-um-icon')).toBeNull()
    expect(svg.innerHTML).toBe('<path/>')
    stop()
  })

  it('leaves the page untouched when observer features are unavailable', () => {
    const nav = labeledButton('Usage')
    const button = nav.children[0]!
    stubDom([button])
    vi.stubGlobal('MutationObserver', undefined)
    const stop = installUsageNavIcon()
    expect(button.children[1]!.getAttribute('data-dsh-um-icon')).toBeNull()
    stop()
  })

  it('reports independent cleanup failures as AggregateError', () => {
    const nav = labeledButton('Usage')
    const button = nav.children[0]!
    const svg = button.children[1]!
    stubDom([button])
    const stop = installUsageNavIcon()
    const observer = FakeObserver.instances[0]!
    observer.throwOnDisconnect = true
    svg.throwOnRemove = true
    expect(() => stop()).toThrow(AggregateError)
    observer.throwOnDisconnect = false
    svg.throwOnRemove = false
    expect(() => stop()).not.toThrow()
  })
})
