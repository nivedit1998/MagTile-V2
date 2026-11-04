import { useEffect, useState } from 'react'
import ArcadeScreen from './arcade/ArcadeScreen'
import { pressHardwareKey } from './arcade/shared/hardware'

type Orientation = 'portrait' | 'landscape'
type HomeSection = 'Today' | 'Dinodia' | 'Discover' | 'Arcade' | 'My Life' | 'Settings'

const HOME_SECTIONS: { name: HomeSection; index: string }[] = [
  { name: 'Today', index: '01' },
  { name: 'Dinodia', index: '02' },
  { name: 'Discover', index: '03' },
  { name: 'Arcade', index: '04' },
  { name: 'My Life', index: '05' },
  { name: 'Settings', index: '06' },
]

const PICCO = {
  width: 480,
  height: 800,
  ppi: 235,
  screen: '3.97″ monochrome ePaper',
  controls: 'Touch · Page up · Page down · Function switch',
}

function App() {
  const [orientation, setOrientation] = useState<Orientation>('portrait')
  const [darkMode, setDarkMode] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshCount, setRefreshCount] = useState(0)
  const [latency, setLatency] = useState(650)
  const [selectedSection, setSelectedSection] = useState<HomeSection | null>(null)
  const [activePage, setActivePage] = useState<'home' | 'arcade'>('home')

  useEffect(() => {
    if (!refreshing) return
    const timer = window.setTimeout(() => setRefreshing(false), latency)
    return () => window.clearTimeout(timer)
  }, [refreshing, latency])

  const simulateRefresh = () => {
    setRefreshing(false)
    window.requestAnimationFrame(() => {
      setRefreshCount((count) => count + 1)
      setRefreshing(true)
    })
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">MAGTILE · STAGE 1</p>
          <h1>Picco simulator</h1>
          <p className="lede">
            A design-first workbench for building the monochrome interface before
            it touches firmware or live data.
          </p>
        </div>
        <div className="header-status" aria-label="Simulator status">
          <span className="status-dot" />
          <span>Local simulator ready</span>
        </div>
      </header>

      <section className="workbench" aria-label="BOOX Picco simulator workbench">
        <div className="device-column">
          <div className="device-label">
            <span>BOOX Picco profile</span>
            <span>{orientation === 'portrait' ? '480 × 800' : '800 × 480'} px</span>
          </div>

          <div
            className={`device-frame ${orientation}`}
            data-dark-mode={darkMode}
            data-refreshing={refreshing}
          >
            <div className="device-speaker" aria-hidden="true" />
            <div className="picco-viewport" aria-label="Picco display simulator">
              <div className="screen-surface">
                <div className="screen-chrome">
                  <button className="screen-home-button" onClick={() => setActivePage('home')} type="button" aria-label="Back to home">MAGTILE</button>
                  <span>08:42</span>
                  <span>100%</span>
                </div>

                {activePage === 'home' ? <div className="home-screen">
                  <nav className="home-grid" aria-label="MagTile sections">
                    {HOME_SECTIONS.map((section) => (
                      <button
                        className={`home-tile${selectedSection === section.name ? ' active' : ''}`}
                        key={section.name}
                        onClick={() => {
                          setSelectedSection(section.name)
                          if (section.name === 'Arcade') setActivePage('arcade')
                        }}
                        type="button"
                        aria-pressed={selectedSection === section.name}
                      >
                        <span className="tile-topline">
                          <span className="tile-index">{section.index}</span>
                        </span>
                        <span className="tile-name">{section.name}</span>
                      </button>
                    ))}
                  </nav>
                </div> : <ArcadeScreen />}

              </div>
            </div>
            <div className="device-buttons" aria-label="Picco hardware controls">
              <button type="button" aria-label="Page up" onMouseDown={(e) => e.preventDefault()} onClick={() => pressHardwareKey('PageUp')} title="Page up" />
              <button type="button" aria-label="Page down" onMouseDown={(e) => e.preventDefault()} onClick={() => pressHardwareKey('PageDown')} title="Page down" />
              <span className="function-switch" aria-hidden="true" />
            </div>
          </div>

          <p className="device-caption">
            Simulator scale is responsive; the internal canvas preserves the
            Picco display ratio and pixel dimensions.
          </p>
        </div>

        <aside className="control-panel" aria-label="Simulator controls">
          <div className="panel-section">
            <div className="section-heading">
              <span className="section-number">01</span>
              <h2>Display</h2>
            </div>
            <div className="control-row">
              <span>Orientation</span>
              <div className="segmented-control" role="group" aria-label="Orientation">
                <button
                  className={orientation === 'portrait' ? 'selected' : ''}
                  onClick={() => setOrientation('portrait')}
                  type="button"
                >
                  Portrait
                </button>
                <button
                  className={orientation === 'landscape' ? 'selected' : ''}
                  onClick={() => setOrientation('landscape')}
                  type="button"
                >
                  Landscape
                </button>
              </div>
            </div>
            <div className="control-row">
              <span>Colour mode</span>
              <button
                className={`toggle ${darkMode ? 'on' : ''}`}
                onClick={() => setDarkMode((value) => !value)}
                type="button"
                aria-pressed={darkMode}
              >
                <span className="toggle-knob" />
                {darkMode ? 'Dark' : 'Light'}
              </button>
            </div>
          </div>

          <div className="panel-section">
            <div className="section-heading">
              <span className="section-number">02</span>
              <h2>E-ink behaviour</h2>
            </div>
            <button className="refresh-button" onClick={simulateRefresh} type="button">
              <span className="refresh-icon" aria-hidden="true">↻</span>
              Simulate full refresh
            </button>
            <label className="range-control">
              <span>
                <span>Redraw latency</span>
                <strong>{latency} ms</strong>
              </span>
              <input
                type="range"
                min="150"
                max="1200"
                step="50"
                value={latency}
                onChange={(event) => setLatency(Number(event.target.value))}
              />
            </label>
            <p className="microcopy">
              Refreshes are intentionally visible so layouts are judged for
              e-ink rhythm, not just LCD smoothness.
            </p>
          </div>

          <div className="panel-section checklist">
            <div className="section-heading">
              <span className="section-number">03</span>
              <h2>Stage 1 gates</h2>
            </div>
            <div className="check-item complete"><span>✓</span><p>Picco profile: 480 × 800 portrait</p></div>
            <div className="check-item complete"><span>✓</span><p>Browser simulator shell</p></div>
            <div className="check-item"><span>○</span><p>Today page (final screen to design)</p></div>
            <div className="check-item"><span>○</span><p>All 31 approved screen designs</p></div>
            <div className="check-item"><span>○</span><p>Interactive Mac prototype flows</p></div>
          </div>

          <footer className="panel-footer">
            <span>Refreshes: {refreshCount}</span>
            <span>{PICCO.controls}</span>
          </footer>
        </aside>
      </section>
    </main>
  )
}

export default App
