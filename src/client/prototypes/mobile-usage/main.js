// PROTOTYPE — Three mobile Usage layouts, switchable with ?variant=A|B|C.

const providers = [
  { name: 'Codex', short: 'codex', color: '#4f46e5', tokens: '11.83B', requests: '68.8K', output: '29.52M', cache: '96.8%', share: 77 },
  { name: 'Grok', short: 'grok', color: '#14b8a6', tokens: '1.58B', requests: '5.8K', output: '3.44M', cache: '97.0%', share: 10 },
  { name: 'OpenCode Go', short: 'opencode', color: '#7c3aed', tokens: '1.27B', requests: '8.3K', output: '5.46M', cache: '87.4%', share: 8 },
  { name: 'Command Code', short: 'command', color: '#0ea5e9', tokens: '695.5M', requests: '1.4K', output: '534.8K', cache: '98.4%', share: 5 },
]

const chart = (compact = false) => `
  <div class="chart ${compact ? 'chart--compact' : ''}">
    <div class="chart__head"><span>${compact ? '7-day activity' : 'Token trend'}</span><b>15.38B total</b></div>
    <svg viewBox="0 0 320 126" role="img" aria-label="Seven day token trend">
      <defs>
        <linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#6d5ce7" stop-opacity=".46"/><stop offset="1" stop-color="#6d5ce7" stop-opacity=".04"/></linearGradient>
      </defs>
      <path class="grid" d="M34 16H310M34 54H310M34 92H310"/>
      <path class="area" d="M34 93 C67 88 86 96 112 94 S156 93 180 89 S217 80 240 35 S280 38 310 75 L310 104 L34 104Z"/>
      <path class="line" d="M34 93 C67 88 86 96 112 94 S156 93 180 89 S217 80 240 35 S280 38 310 75"/>
      <text x="34" y="122">8/26</text><text x="100" y="122">8/28</text><text x="180" y="122">8/30</text><text x="276" y="122">9/1</text>
    </svg>
  </div>`

const filters = () => `
  <div class="filter-row">
    <button>Tokens <span>⌄</span></button><button>Provider <span>⌄</span></button><button>7 days <span>⌄</span></button>
  </div>`

const settingsShell = content => `
  <div class="phone-stage">
    <div class="status"><strong>19:14</strong><span>● ◉ ▰</span><span>5G ▮▮ 100</span></div>
    <section class="settings-shell">
      <header><h1>Settings</h1><button aria-label="Close">×</button></header>
      <nav><span>External Agents</span><b>▥&nbsp; Usage</b><span>☷&nbsp; Plugins</span><span>◌</span></nav>
      <div class="settings-body">${content}</div>
    </section>
  </div>`

function VariantA() {
  return settingsShell(`
    <div class="prototype-note">PROTOTYPE A · Overview first</div>
    <div class="page-head"><div><small>LAST 7 DAYS</small><h2>Usage overview</h2></div><button class="icon-btn">↻</button></div>
    ${filters()}
    <div class="hero-metric"><span>Total tokens</span><strong>15.38B</strong><em>+18% vs previous 7 days</em></div>
    <div class="mini-grid">
      <div><span>Requests</span><b>84.3K</b></div><div><span>Output</span><b>38.96M</b></div><div><span>Cache hit</span><b>96.7%</b></div>
    </div>
    ${chart()}
    <section class="section-block"><div class="section-title"><h3>Providers</h3><span>Share of tokens</span></div>
      <div class="provider-cards">${providers.map(p => `<button class="provider-card"><i style="background:${p.color}"></i><span><b>${p.name}</b><small>${p.requests} requests</small></span><strong>${p.tokens}</strong><em>›</em><u><i style="width:${p.share}%;background:${p.color}"></i></u></button>`).join('')}</div>
    </section>
  `)
}

function VariantB() {
  return settingsShell(`
    <div class="prototype-note">PROTOTYPE B · Provider first</div>
    <div class="page-head"><div><small>USAGE</small><h2>Where tokens went</h2></div><button class="range-button">7D⌄</button></div>
    <div class="metric-strip"><span><small>Tokens</small><b>15.38B</b></span><span><small>Requests</small><b>84.3K</b></span><span><small>Cache</small><b>96.7%</b></span></div>
    <div class="provider-stack">${providers.map((p, index) => `
      <article class="provider-panel ${index === 0 ? 'is-open' : ''}">
        <button><i style="background:${p.color}"></i><span><b>${p.name}</b><small>${p.share}% of token usage</small></span><strong>${p.tokens}</strong><em>${index === 0 ? '⌃' : '⌄'}</em></button>
        ${index === 0 ? `<div class="provider-detail"><div><span>Requests<b>${p.requests}</b></span><span>Output<b>${p.output}</b></span><span>Cache<b>${p.cache}</b></span></div>${chart(true)}<button class="text-button">View Codex models →</button></div>` : ''}
      </article>`).join('')}</div>
    <button class="trend-drawer"><span>⌁</span><b>Compare provider trends</b><em>›</em></button>
  `)
}

function VariantC() {
  return settingsShell(`
    <div class="prototype-note">PROTOTYPE C · Focused tabs</div>
    <div class="page-head"><div><small>ANALYTICS</small><h2>Usage</h2></div><button class="range-button">Aug 26 – Sep 1</button></div>
    <div class="tabs"><button class="active">Overview</button><button>Providers</button><button>Models</button></div>
    <div class="insight-card">
      <div class="ring"><svg viewBox="0 0 42 42"><circle cx="21" cy="21" r="15.9"/><circle class="ring-value" cx="21" cy="21" r="15.9"/></svg><span><b>96.7%</b><small>cache hit</small></span></div>
      <div><small>Biggest opportunity</small><h3>OpenCode cache trails by 9.3%</h3><p>Improving it to the average would avoid about <b>118M</b> uncached input tokens.</p></div>
    </div>
    <div class="headline-grid"><div><span>Tokens</span><b>15.38B</b><small>↑ 18%</small></div><div><span>Requests</span><b>84.3K</b><small>↑ 6%</small></div></div>
    ${chart()}
    <section class="ranked"><div class="section-title"><h3>Top providers</h3><button>See all</button></div>${providers.slice(0, 3).map((p, i) => `<div><strong>${i + 1}</strong><i style="background:${p.color}"></i><span><b>${p.name}</b><small>${p.requests} requests</small></span><em>${p.tokens}</em></div>`).join('')}</section>
  `)
}

const variants = {
  A: { name: 'Overview first', render: VariantA },
  B: { name: 'Provider first', render: VariantB },
  C: { name: 'Focused tabs', render: VariantC },
}

const currentKey = () => {
  const value = new URLSearchParams(location.search).get('variant')?.toUpperCase()
  return value && variants[value] ? value : 'A'
}

function switcher(key) {
  return `<div class="prototype-switcher"><button data-step="-1" aria-label="Previous variant">←</button><strong>${key} — ${variants[key].name}</strong><button data-step="1" aria-label="Next variant">→</button></div>`
}

function render() {
  const key = currentKey()
  document.querySelector('#app').innerHTML = variants[key].render() + switcher(key)
  document.querySelectorAll('[data-step]').forEach(button => button.addEventListener('click', () => cycle(Number(button.dataset.step))))
}

function cycle(step) {
  const keys = Object.keys(variants)
  const next = keys[(keys.indexOf(currentKey()) + step + keys.length) % keys.length]
  const url = new URL(location.href)
  url.searchParams.set('variant', next)
  history.replaceState({}, '', url)
  render()
}

addEventListener('keydown', event => {
  const target = event.target
  if (target instanceof HTMLElement && (target.matches('input, textarea, [contenteditable]'))) return
  if (event.key === 'ArrowLeft') cycle(-1)
  if (event.key === 'ArrowRight') cycle(1)
})

render()
