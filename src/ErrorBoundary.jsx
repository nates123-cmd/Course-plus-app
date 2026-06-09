// App-level error boundary — a render error in any screen used to take the whole
// tree down to a blank page. This catches it, shows the actual message + where it
// happened, and offers a reset that clears persisted UI state (a stale saved
// route/filter pointing at deleted demo data is the usual culprit) then reloads.
import { Component } from 'react'

const KEYS = ['course.route', 'course.openTasksFilter', 'course.openTasksFilter.v2', 'course.areasOpen', 'course.mode']

export class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null, info: null } }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error, info) { this.setState({ info }); console.error('Course+ crashed:', error, info) }

  reset = () => { try { KEYS.forEach((k) => localStorage.removeItem(k)) } catch {} ; location.reload() }
  retry = () => this.setState({ error: null, info: null })

  render() {
    if (!this.state.error) return this.props.children
    const msg = String(this.state.error?.message || this.state.error)
    const stack = this.state.info?.componentStack || ''
    const wrap = { fontFamily: "'Hanken Grotesk', sans-serif", color: '#1b2024' }
    const btn = (bg, color, brd) => ({ fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer',
      borderRadius: 9, padding: '9px 15px', background: bg, color, border: brd || '1px solid transparent' })
    return (
      <div style={{ ...wrap, minHeight: '100vh', background: '#f4f5f6', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ width: '100%', maxWidth: 560, background: '#fff', border: '1px solid #e7e9eb', borderRadius: 14, padding: '26px 26px 22px', boxShadow: '0 8px 30px rgba(20,24,28,0.07)' }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Something broke on this screen</div>
          <div style={{ fontSize: 13, color: '#5a626a', lineHeight: 1.55, marginBottom: 14 }}>
            Most often a saved view pointing at data that changed. Reset usually fixes it. If it keeps happening, send me the message below.
          </div>
          <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#b0573f', background: '#faf3f1',
            border: '1px solid rgba(176,87,63,0.2)', borderRadius: 9, padding: '10px 12px', marginBottom: 12,
            whiteSpace: 'pre-wrap', userSelect: 'text', WebkitUserSelect: 'text' }}>{msg}</div>
          {stack && <details style={{ marginBottom: 16 }}>
            <summary style={{ fontSize: 12, color: '#8b939b', cursor: 'pointer' }}>where it happened</summary>
            <pre style={{ fontSize: 11, color: '#5a626a', whiteSpace: 'pre-wrap', userSelect: 'text', WebkitUserSelect: 'text', marginTop: 8 }}>{stack.trim()}</pre>
          </details>}
          <div style={{ display: 'flex', gap: 9 }}>
            <button onClick={this.reset} style={btn('#277059', '#fff')}>Reset &amp; reload</button>
            <button onClick={this.retry} style={btn('transparent', '#1b2024', '1px solid #d6dadd')}>Try again</button>
          </div>
        </div>
      </div>
    )
  }
}
