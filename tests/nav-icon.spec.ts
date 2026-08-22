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
  takeCount = 0
  constructor(callback: MutationCallback) {
    this.callback = callback
    FakeObserver.instances.push(this)
  }
  observe(): void { this.disconnected = false }
  disconnect(): void { this.disconnected = true }
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

  it('disconnects and cancels a pending frame on dispose', () => {
    stubDom()
    const stop = installUsageNavIcon()
    FakeObserver.instances[0]?.deliver([record(labeledButton('Usage'))])
    expect(rafs).toHaveLength(1)
    stop()
    expect(FakeObserver.instances[0]?.disconnected).toBe(true)
    flush()
  })
})
