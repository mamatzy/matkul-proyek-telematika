import { useEffect, useReducer, useState } from 'react'
import {
  Activity, AlertTriangle, ArrowLeft, ArrowUp, Car, Cpu, CornerUpRight, MemoryStick, RotateCcw,
  ScrollText, Server, ShieldCheck, Siren, SlidersHorizontal, Thermometer, Timer, TrendingUp,
  Video, Wifi, WifiOff,
} from 'lucide-react'

/* ───────────── mock data & helpers ───────────── */
const blank = (c = 'RED') => Object.fromEntries(Object.keys(DIRS).map((d) => [d, { straight: c, right: c }]))

const DIRS = {
  N: { name: 'North Bound', role: 'Master', latency: null },
  E: { name: 'East Bound', role: 'Slave 1', latency: 12 },
  S: { name: 'South Bound', role: 'Slave 2', latency: 18 },
  W: { name: 'West Bound', role: 'Slave 3', latency: null }, // timed out → safe mode
}
const ORDER = ['N', 'E', 'S'] // W is in safe mode (blinking amber), skipped by the FSM
const SAFE = { W: true }

const TONE = {
  GREEN: { text: 'text-emerald-400', bg: 'bg-emerald-500/15', ring: 'ring-emerald-500/30', hex: '#34d399' },
  YELLOW: { text: 'text-amber-400', bg: 'bg-amber-500/15', ring: 'ring-amber-500/30', hex: '#fbbf24' },
  RED: { text: 'text-rose-400', bg: 'bg-rose-500/15', ring: 'ring-rose-500/30', hex: '#fb7185' },
}

const TREND = [12, 9, 14, 28, 46, 62, 58, 44, 39, 41, 47, 55, 63, 71, 66, 52] // 06:00 → 21:00

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const drift = (v, a, b, s) => +clamp(v + (Math.random() - 0.5) * s, a, b).toFixed(1)
const dur = (v) => clamp(12 + v * 2, 15, 60) // adaptive green time from vehicle count
const now = () => new Date().toLocaleTimeString('en-GB')

/* ───────────── FSM simulation ───────────── */

function init() {
  const vehicles = { N: 15, E: 9, S: 12, W: 6 }
  return {
    idx: 0, total: dur(vehicles.N), left: 27, emergency: false, vehicles,
    manual: false, signals: blank(),
    cpu: 62.4, ram: 47.8, clock: now(),
    logs: [
      { t: '08:41:12', kind: 'fsm', msg: 'Phase changed: South green for 36s' },
      { t: '08:40:36', kind: 'fsm', msg: 'Phase changed: East green for 30s' },
      { t: '08:39:58', kind: 'net', msg: 'Slave 3 heartbeat timeout, entering safe mode' },
      { t: '08:39:20', kind: 'warn', msg: 'Master CPU temperature above 65°C' },
      { t: '08:38:44', kind: 'net', msg: 'Slave 1 and Slave 2 synchronized' },
    ],
  }
}

function reducer(s, a) {
  if (a.type === 'emergency') {
    const emergency = !s.emergency
    const msg = emergency ? 'Emergency all-red triggered from dashboard' : 'Adaptive mode resumed'
    return { ...s, emergency, logs: [{ t: now(), kind: 'emg', msg }, ...s.logs].slice(0, 20) }
  }
  const base = { ...s, clock: now(), cpu: drift(s.cpu, 54, 74, 1.4), ram: drift(s.ram, 41, 56, 1) }
    if (a.type === 'manual-toggle') {
    if (s.emergency) return s
    const manual = !s.manual
    const signals = manual
      ? Object.fromEntries(Object.keys(DIRS).map((d) => {
          const st = lampStatus(s, d)
          const c = st.safe ? 'RED' : st.color
          return [d, { straight: c, right: c }]
        }))
      : s.signals
    const msg = manual ? 'Manual override on, adaptive FSM paused' : 'Manual override off, adaptive FSM resumed'
    return { ...s, manual, signals, logs: [{ t: now(), kind: 'manual', msg }, ...s.logs].slice(0, 20) }
  }
  if (a.type === 'manual-set') {
    const { dir, set, color } = a
    const msg = `Manual: ${DIRS[dir].name.split(' ')[0]} ${set} set to ${color}`
    return { ...s, signals: { ...s.signals, [dir]: { ...s.signals[dir], [set]: color } }, logs: [{ t: now(), kind: 'manual', msg }, ...s.logs].slice(0, 20) }
  }
  if (a.type === 'manual-all') {
    return { ...s, signals: blank(), logs: [{ t: now(), kind: 'manual', msg: 'Manual: all heads set to RED' }, ...s.logs].slice(0, 20) }
  }
  if (s.emergency || s.manual) return base
  if (s.left > 1) return { ...base, left: s.left - 1 }

  const idx = (s.idx + 1) % ORDER.length
  const vehicles = { ...s.vehicles }
  ORDER.forEach((d) => (vehicles[d] = clamp(Math.round(vehicles[d] + (Math.random() - 0.5) * 8), 3, 30)))
  const dir = ORDER[idx]
  const total = dur(vehicles[dir])
  const msg = `Phase changed: ${DIRS[dir].name.split(' ')[0]} green for ${total}s (${vehicles[dir]} vehicles)`
  return { ...base, idx, vehicles, total, left: total, logs: [{ t: now(), kind: 'fsm', msg }, ...s.logs].slice(0, 20) }
}

function lampStatus(s, dir) {
  if (s.manual && !s.emergency) return { color: s.signals[dir].straight, dur: null, note: 'Manual override' }
  if (SAFE[dir]) return { color: 'YELLOW', dur: null, note: 'Flashing amber (safe mode)', safe: true }
  if (s.emergency) return { color: 'RED', dur: null, note: 'Emergency all-red' }
  if (ORDER[s.idx] === dir) return { color: s.left <= 3 ? 'YELLOW' : 'GREEN', dur: s.total, left: s.left }
  let wait = s.left
  for (let i = (s.idx + 1) % ORDER.length; ORDER[i] !== dir; i = (i + 1) % ORDER.length) wait += dur(s.vehicles[ORDER[i]])
  return { color: 'RED', dur: wait }
}

/* ───────────── shared UI ───────────── */

const WS_URL = 'ws://localhost:8765'
const STALE_MS = 3000

function useCameraFeeds(url = WS_URL) {
  const [feeds, setFeeds] = useState({})
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    let ws, retry
    let closed = false
    const connect = () => {
      ws = new WebSocket(url)
      ws.onopen = () => setConnected(true)
      ws.onerror = () => ws.close()
      ws.onclose = () => {
        setConnected(false)
        if (!closed) retry = setTimeout(connect, 2000)
      }
      ws.onmessage = (e) => {
        try {
          const m = JSON.parse(e.data)
          if (!m.dir || !DIRS[m.dir]) return
          const boxes = Array.isArray(m.boxes) ? m.boxes : []
          setFeeds((f) => ({
            ...f,
            [m.dir]: {
              image: m.image
                ? (m.image.startsWith('data:') ? m.image : `data:image/jpeg;base64,${m.image}`)
                : null,
              width: m.width || 1280,
              height: m.height || 720,
              boxes,
              count: m.count ?? boxes.length,
              ts: Date.now(),
            },
          }))
        } catch { /* abaikan pesan rusak */ }
      }
    }
    connect()
    return () => { closed = true; clearTimeout(retry); ws?.close() }
  }, [url])

  return { feeds, connected }
}

const Card = ({ title, icon: Icon, right, className = '', children }) => (
  <section className={`flex flex-col rounded-2xl border border-[#232c36] bg-[#141a21] p-5 ${className}`}>
    <header className="mb-4 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-[15px] font-semibold text-slate-300">
        <Icon size={16} className="text-slate-500" />
        {title}
      </h2>
      {right}
    </header>
    {children}
  </section>
)

const Badge = ({ color, children, pulse }) => (
  <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-bold ring-1 ${TONE[color].bg} ${TONE[color].text} ${TONE[color].ring} ${pulse ? 'animate-pulse' : ''}`}>
    <span className="h-1.5 w-1.5 rounded-full" style={{ background: TONE[color].hex }} />
    {children}
  </span>
)

const Meter = ({ value, max = 100, warn = 70 }) => (
  <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#232c36]">
    <div
      className={`h-full rounded-full transition-all duration-700 ${value >= warn ? 'bg-amber-400' : 'bg-sky-400'}`}
      style={{ width: `${(value / max) * 100}%` }}
    />
  </div>
)

/* ───────────── dashboard cards ───────────── */

function IntersectionDiagram({ state }) {
  const cars = {
    N: { x: 128, y: 88, dx: 0, dy: -15, w: 10, h: 12 },
    S: { x: 182, y: 220, dx: 0, dy: 15, w: 10, h: 12 },
    E: { x: 222, y: 128, dx: 15, dy: 0, w: 12, h: 10 },
    W: { x: 76, y: 182, dx: -15, dy: 0, w: 12, h: 10 },
  }
  const heads = { N: [104, 104], E: [216, 104], S: [216, 216], W: [104, 216] }
  const labels = { N: [160, 16], E: [308, 164], S: [160, 316], W: [12, 164] }

  return (
    <svg viewBox="0 0 320 320" className="mx-auto w-full max-w-[380px]" role="img" aria-label="Intersection diagram">
      <rect x="0" y="120" width="320" height="80" fill="#1e262f" />
      <rect x="120" y="0" width="80" height="320" fill="#1e262f" />
      <g stroke="#3a4655" strokeWidth="2" strokeDasharray="10 8">
        <line x1="0" y1="160" x2="120" y2="160" /><line x1="200" y1="160" x2="320" y2="160" />
        <line x1="160" y1="0" x2="160" y2="120" /><line x1="160" y1="200" x2="160" y2="320" />
      </g>
      <g stroke="#e2e8f0" strokeWidth="3" opacity=".7">
        <line x1="122" y1="118" x2="158" y2="118" /><line x1="162" y1="202" x2="198" y2="202" />
        <line x1="202" y1="122" x2="202" y2="158" /><line x1="118" y1="162" x2="118" y2="198" />
      </g>
      {Object.keys(DIRS).map((d) => {
        const st = lampStatus(state, d)
        const c = cars[d]
        const [hx, hy] = heads[d]
        const [lx, ly] = labels[d]
        const n = Math.min(state.vehicles[d], 5)
        return (
          <g key={d}>
            {Array.from({ length: n }).map((_, i) => (
              <rect key={i} x={c.x + c.dx * i} y={c.y + c.dy * i} width={c.w} height={c.h} rx="2" fill="#64748b" />
            ))}
            <g className={st.safe ? 'animate-pulse' : ''}>
              <circle cx={hx} cy={hy} r="12" fill={TONE[st.color].hex} opacity=".22" />
              <circle cx={hx} cy={hy} r="6" fill={TONE[st.color].hex} />
            </g>
            <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" className="fill-slate-400 text-[13px] font-semibold">{d}</text>
          </g>
        )
      })}
    </svg>
  )
}

function ConstructionDiagram({ state }) {
  // Diagram jalan lurus dengan penyempitan / konstruksi di satu sisi
  return (
    <svg viewBox="0 0 320 320" className="mx-auto w-full max-w-[380px]" role="img" aria-label="Construction diagram">
      <rect x="0" y="120" width="320" height="80" fill="#1e262f" />
      <line x1="0" y1="160" x2="320" y2="160" stroke="#3a4655" strokeWidth="2" strokeDasharray="10 8" />
      
      {/* Area Konstruksi (Memblokir lajur atas) */}
      <rect x="120" y="122" width="80" height="36" rx="4" fill="#fbbf24" opacity="0.8" />
      <g opacity="0.2">
        <line x1="130" y1="122" x2="120" y2="158" stroke="#000" strokeWidth="4" />
        <line x1="150" y1="122" x2="140" y2="158" stroke="#000" strokeWidth="4" />
        <line x1="170" y1="122" x2="160" y2="158" stroke="#000" strokeWidth="4" />
        <line x1="190" y1="122" x2="180" y2="158" stroke="#000" strokeWidth="4" />
      </g>
      <text x="160" y="140" textAnchor="middle" dominantBaseline="middle" className="fill-amber-900 text-[10px] font-bold">AREA KONSTRUKSI</text>

      {/* East Bound (Master) - Lajur bawah mengarah ke kanan */}
      <g>
        <circle cx="100" cy="180" r="12" fill={TONE[lampStatus(state, 'E').color].hex} opacity=".22" />
        <circle cx="100" cy="180" r="6" fill={TONE[lampStatus(state, 'E').color].hex} />
        <text x="100" y="210" textAnchor="middle" className="fill-slate-400 text-[12px] font-semibold">Master (E)</text>
        {/* Dummy cars waiting */}
        <rect x="60" y="172" width="12" height="10" rx="2" fill="#64748b" />
        <rect x="40" y="172" width="12" height="10" rx="2" fill="#64748b" />
      </g>

      {/* West Bound (Slave) - Lajur atas mengarah ke kiri, menunggu sebelum konstruksi */}
      <g className={SAFE['W'] ? 'animate-pulse' : ''}>
        <circle cx="220" cy="140" r="12" fill={TONE[lampStatus(state, 'W').color].hex} opacity=".22" />
        <circle cx="220" cy="140" r="6" fill={TONE[lampStatus(state, 'W').color].hex} />
        <text x="220" y="110" textAnchor="middle" className="fill-slate-400 text-[12px] font-semibold">Slave (W)</text>
        <rect x="248" y="132" width="12" height="10" rx="2" fill="#64748b" />
        <rect x="268" y="132" width="12" height="10" rx="2" fill="#64748b" />
      </g>
    </svg>
  )
}

function PhaseCard({ state }) {
  const dir = ORDER[state.idx]
  const next = DIRS[ORDER[(state.idx + 1) % ORDER.length]].name
  const elapsed = ((state.total - state.left) / state.total) * 100
  if (state.emergency)
    return (
      <Card title="Current active phase" icon={Timer} className="border-rose-500/40">
        <p className="font-display text-5xl font-bold text-rose-400">All red</p>
        <p className="mt-2 text-sm text-slate-400">Adaptive control is paused. All lamps are holding red.</p>
      </Card>
    )
  if (state.manual)
    return (
      <Card title="Current active phase" icon={Timer} className="border-amber-500/40">
        <p className="font-display text-5xl font-bold text-amber-400">Manual</p>
        <p className="mt-2 text-sm text-slate-400">Adaptive FSM is paused. Lamps follow the manual control card.</p>
      </Card>
    )
  return (
    <Card title="Current active phase" icon={Timer} right={<Badge color={state.left <= 3 ? 'YELLOW' : 'GREEN'}>{state.left <= 3 ? 'YELLOW' : 'GREEN'}</Badge>}>
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="font-display text-4xl font-bold leading-none text-slate-100">{DIRS[dir].name}</p>
          <p className="mt-2 text-sm text-slate-400">Next: {next}</p>
        </div>
        <p className={`font-display text-7xl font-bold leading-none tabular-nums ${state.left <= 3 ? TONE.YELLOW.text : TONE.GREEN.text}`}>
          {String(state.left).padStart(2, '0')}<span className="ml-1 text-2xl text-slate-500">s</span>
        </p>
      </div>
      <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-[#232c36]">
        <div className="h-full rounded-full bg-emerald-400 transition-all duration-1000 ease-linear" style={{ width: `${elapsed}%` }} />
      </div>
    </Card>
  )
}

function HealthCard({ state }) {
  const hot = state.cpu >= 70
  const slaves = ['E', 'S', 'W']
  return (
    <Card title="System and hardware health" icon={Server} className="h-full">
      <div className="space-y-5">
        <div>
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-slate-400"><Thermometer size={15} />CPU temperature</span>
            <span className={`font-semibold tabular-nums ${hot ? 'text-amber-400' : 'text-slate-100'}`}>{state.cpu.toFixed(1)}°C</span>
          </div>
          <Meter value={state.cpu} max={90} warn={70} />
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-slate-400"><MemoryStick size={15} />RAM usage</span>
            <span className="font-semibold tabular-nums text-slate-100">{state.ram.toFixed(1)}%</span>
          </div>
          <Meter value={state.ram} />
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2 text-slate-400"><Cpu size={15} />AI inference</span>
          <span className="font-semibold text-slate-100">24 FPS</span>
        </div>
      </div>
      <div className="mt-6 border-t border-[#232c36] pt-4">
        <p className="mb-3 text-sm font-semibold text-slate-300">Connections</p>
        <ul className="space-y-2.5 text-sm">
          <li className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-slate-300"><Wifi size={15} className="text-emerald-400" />Master (this device)</span>
            <span className="text-emerald-400">Online</span>
          </li>
          {slaves.map((d) => (
            <li key={d} className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-slate-300">
                {SAFE[d] ? <WifiOff size={15} className="text-amber-400" /> : <Wifi size={15} className="text-emerald-400" />}
                {DIRS[d].role} ({d})
              </span>
              {SAFE[d] ? <span className="text-amber-400">Timeout</span> : <span className="tabular-nums text-slate-400">{DIRS[d].latency} ms</span>}
            </li>
          ))}
        </ul>
      </div>
    </Card>
  )
}

function TrendCard() {
  const W = 520, H = 150, max = 80
  const pts = TREND.map((v, i) => [(i * W) / (TREND.length - 1), H - (v / max) * H])
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const peak = TREND.indexOf(Math.max(...TREND))
  return (
    <Card title="Traffic trend today" icon={TrendingUp} right={<span className="text-xs text-slate-500">Vehicles per hour</span>}>
      <svg viewBox={`0 0 ${W} ${H + 24}`} className="w-full" role="img" aria-label="Traffic volume line chart">
        <defs>
          <linearGradient id="area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#38bdf8" stopOpacity=".28" />
            <stop offset="1" stopColor="#38bdf8" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((g) => <line key={g} x1="0" x2={W} y1={H * g} y2={H * g} stroke="#232c36" />)}
        <path d={`${line} L${W},${H} L0,${H} Z`} fill="url(#area)" />
        <path d={line} fill="none" stroke="#38bdf8" strokeWidth="2.5" strokeLinejoin="round" />
        <circle cx={pts[peak][0]} cy={pts[peak][1]} r="5" fill="#0c1116" stroke="#38bdf8" strokeWidth="2.5" />
        <text x={pts[peak][0] - 8} y={pts[peak][1] - 10} textAnchor="end" className="fill-slate-300 text-[12px] font-semibold">Peak {TREND[peak]}</text>
        {TREND.map((_, i) => i % 3 === 0 && (
          <text key={i} x={pts[i][0]} y={H + 18} textAnchor={i === 0 ? 'start' : 'middle'} className="fill-slate-500 text-[11px]">{String(6 + i).padStart(2, '0')}:00</text>
        ))}
      </svg>
    </Card>
  )
}

function ActionsCard({ emergency, onToggle }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(t)
  }, [armed])

  const click = () => {
    if (emergency) return onToggle()
    if (!armed) return setArmed(true)
    setArmed(false)
    onToggle()
  }
  return (
    <Card title="Quick actions" icon={Siren}>
      <button
        onClick={click}
        className={`flex w-full items-center justify-center gap-3 rounded-xl px-5 py-5 text-lg font-bold transition focus:outline-none focus-visible:ring-4 focus-visible:ring-rose-400/40 ${
          emergency
            ? 'bg-slate-100 text-slate-900 hover:bg-white'
            : armed
              ? 'animate-pulse bg-rose-500 text-white'
              : 'bg-rose-600 text-white hover:bg-rose-500'
        }`}
      >
        {emergency ? <><RotateCcw size={22} />Resume adaptive mode</> : armed ? <><AlertTriangle size={22} />Press again to confirm</> : <><Siren size={22} />Emergency all-red</>}
      </button>
      <p className="mt-3 text-sm text-slate-500">
        {emergency ? 'All lamps are red. Adaptive control resumes from the last phase.' : 'Forces every lamp to red immediately. Confirm within 3 seconds.'}
      </p>
    </Card>
  )
}

const LOG_ICON = {
  manual: { i: SlidersHorizontal, c: 'text-violet-400' },
  fsm: { i: Activity, c: 'text-sky-400' },
  net: { i: Wifi, c: 'text-emerald-400' },
  warn: { i: AlertTriangle, c: 'text-amber-400' },
  emg: { i: Siren, c: 'text-rose-400' },
}

function LogsCard({ logs }) {
  return (
    <Card title="Recent logs" icon={ScrollText} className="h-full">
      <ul className="max-h-[230px] space-y-1 overflow-y-auto pr-1">
        {logs.slice(0, 7).map((l, i) => {
          const { i: Icon, c } = LOG_ICON[l.kind]
          return (
            <li key={`${l.t}-${i}`} className="flex items-start gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-[#1a222b]">
              <Icon size={15} className={`mt-0.5 shrink-0 ${c}`} />
              <span className="text-slate-300">{l.msg}</span>
              <span className="ml-auto shrink-0 tabular-nums text-slate-500">{l.t}</span>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

const NAMA = { N: 'Utara', E: 'Timur', S: 'Selatan', W: 'Barat' }
const WARNA = { RED: 'merah', YELLOW: 'kuning', GREEN: 'hijau' }
const OPPOSITE = { N: 'S', S: 'N', E: 'W', W: 'E' }
const SETS = [
  { key: 'straight', label: 'Lurus', icon: ArrowUp },
  { key: 'right', label: 'Kanan', icon: CornerUpRight },
]

// Dua kepala lampu bentrok jika: arah tegak lurus (apa pun), atau arah berlawanan
// dengan satu lurus dan satu belok kanan. Satu arah yang sama tidak bentrok.
function conflicts(a, b) {
  if (a[0] === b[0]) return false
  if (OPPOSITE[a[0]] === b[0]) return a[1] !== b[1]
  return true
}

function SignalHead({ color, onPick, disabled, label, icon: Icon }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex flex-col gap-1.5 rounded-xl border border-[#232c36] bg-[#0c1116] p-2">
        {['RED', 'YELLOW', 'GREEN'].map((c) => {
          const on = color === c
          return (
            <button
              key={c} type="button" disabled={disabled} onClick={() => onPick(c)}
              aria-label={`${label}: ${WARNA[c]}`} aria-pressed={on}
              className={`h-8 w-8 rounded-full border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${disabled ? 'cursor-not-allowed' : 'hover:scale-110'}`}
              style={{
                background: on ? TONE[c].hex : '#1a222b',
                borderColor: on ? TONE[c].hex : '#2b3540',
                boxShadow: on ? `0 0 14px ${TONE[c].hex}66` : 'none',
              }}
            />
          )
        })}
      </div>
      <span className="flex items-center gap-1 text-xs font-semibold text-slate-400"><Icon size={13} />{label}</span>
    </div>
  )
}

function ManualCard({ state, dispatch }) {
  const [notice, setNotice] = useState(null)
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(t)
  }, [notice])

  const { manual, emergency } = state
  const editable = manual && !emergency
  const view = (d) => {
    if (editable) return state.signals[d]
    const c = lampStatus(state, d).color
    return { straight: c, right: c }
  }

  const pick = (dir, set, color) => {
    if (color !== 'RED') {
      for (const d of Object.keys(DIRS)) {
        for (const { key, label } of SETS) {
          const other = state.signals[d][key]
          if (other !== 'RED' && conflicts([dir, set], [d, key])) {
            const mine = SETS.find((x) => x.key === set).label
            setNotice(`Ditolak: ${NAMA[dir]} ${mine} tidak bisa ${WARNA[color]} karena ${NAMA[d]} ${label} masih ${WARNA[other]}. Merahkan dulu lampu yang bentrok.`)
            return
          }
        }
      }
    }
    setNotice(null)
    dispatch({ type: 'manual-set', dir, set, color })
  }

  return (
    <Card
      title="Kontrol lampu manual"
      icon={SlidersHorizontal}
      right={
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setNotice(null); dispatch({ type: 'manual-all' }) }}
            disabled={!editable}
            className="rounded-lg border border-[#2b3540] bg-[#1a222b] px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-[#222c37] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Semua merah
          </button>
          <button
            role="switch" aria-checked={manual} disabled={emergency}
            onClick={() => { setNotice(null); dispatch({ type: 'manual-toggle' }) }}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${manual ? 'bg-amber-400 text-slate-900' : 'bg-sky-500/15 text-sky-300 hover:bg-sky-500/25'}`}
          >
            {manual ? 'Mode manual aktif' : 'Aktifkan mode manual'}
          </button>
        </div>
      }
    >
      <p className="mb-4 text-sm text-slate-500">
        {emergency
          ? 'Emergency all-red aktif, kontrol manual dikunci.'
          : manual
            ? 'FSM adaptif dijeda. Klik bulatan lampu untuk mengubah warna. Hijau yang bentrok akan ditolak.'
            : 'Menampilkan status lampu otomatis. Aktifkan mode manual untuk mengubah lampu (FSM adaptif dijeda).'}
      </p>
      {notice && (
        <p role="alert" className="mb-4 flex items-start gap-2 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300 ring-1 ring-rose-500/30">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />{notice}
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Object.keys(DIRS).map((d) => (
          <div key={d} className="rounded-xl border border-[#232c36] bg-[#10161c] p-4">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-display text-lg font-bold text-slate-100">{DIRS[d].name}</h3>
              {SAFE[d] ? <Badge color="YELLOW">Timeout</Badge> : <span className="text-xs text-slate-500">{DIRS[d].role}</span>}
            </div>
            <div className="flex justify-around">
              {SETS.map((s) => (
                <SignalHead
                  key={s.key} label={s.label} icon={s.icon}
                  color={view(d)[s.key]} disabled={!editable}
                  onPick={(c) => pick(d, s.key, c)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

/* ───────────── pages ───────────── */

function Header({ state, right }) {
  return (
    <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        {right}
        <div>
          <h1 className="font-display text-3xl font-bold text-slate-100">Location Node 01</h1>
          <p className="text-sm text-slate-500">Adaptive signal control, edge dashboard</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        {state.emergency ? <Badge color="RED" pulse>EMERGENCY ALL-RED</Badge> : state.manual ? <Badge color="YELLOW">MANUAL OVERRIDE</Badge> : <Badge color="GREEN">ADAPTIVE MODE</Badge>}
        <span className="font-display text-2xl tabular-nums text-slate-300">{state.clock}</span>
      </div>
    </header>
  )
}

function Dashboard({ state, dispatch, open, layout, setLayout }) {
  return (
    <>
      <Header state={state} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Card
          title="Intersection map"
          icon={ShieldCheck}
          className="lg:col-span-5 lg:row-span-2"
          right={
            <div className="flex items-center gap-2">
              <select
                value={layout}
                onChange={(e) => {
                  e.stopPropagation();
                  setLayout(e.target.value);
                }}
                className="cursor-pointer rounded-md border border-[#2b3540] bg-[#1a222b] px-2 py-1.5 text-xs font-semibold text-slate-300 outline-none transition focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
              >
                <option value="intersection">4 Persimpangan</option>
                <option value="construction">Jalan Konstruksi</option>
              </select>
              <span className="hidden items-center gap-1.5 rounded-md bg-sky-500/10 px-2 py-1.5 text-xs font-semibold text-sky-300 sm:flex">
                <Video size={13} />Live cameras
              </span>
            </div>
          }
        >
          <button
            onClick={open}
            aria-label="Open live monitoring"
            className="group relative flex flex-1 items-center justify-center overflow-hidden rounded-xl border border-transparent p-2 transition hover:border-sky-500/40 hover:bg-[#10161c] focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
          >
            {layout === 'intersection' ? <IntersectionDiagram state={state} /> : <ConstructionDiagram state={state} />}
          </button>
        </Card>
        <div className="lg:col-span-4"><PhaseCard state={state} /></div>
        <div className="lg:col-span-3 lg:row-span-2"><HealthCard state={state} /></div>
        <div className="lg:col-span-4"><ActionsCard emergency={state.emergency} onToggle={() => dispatch({ type: 'emergency' })} /></div>
        <div className="lg:col-span-12"><ManualCard state={state} dispatch={dispatch} /></div>
        <div className="lg:col-span-7"><TrendCard /></div>
        <div className="lg:col-span-5"><LogsCard logs={state.logs} /></div>
      </div>
    </>
  )
}

const BOXES = [
  'left-[12%] top-[52%] h-[22%] w-[18%]',
  'left-[46%] top-[40%] h-[20%] w-[16%]',
  'left-[68%] top-[58%] h-[24%] w-[20%]',
  'left-[28%] top-[28%] h-[16%] w-[12%]',
]

function BoxOverlay({ feed }) {
  const fs = feed.height * 0.035
  return (
    <svg
      viewBox={`0 0 ${feed.width} ${feed.height}`}
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 h-full w-full"
    >
      {feed.boxes.map((b, i) => {
        const label = `${b.label ?? 'vehicle'}${b.conf != null ? ` ${Number(b.conf).toFixed(2)}` : ''}`
        const lw = label.length * fs * 0.6 + fs * 0.6
        return (
          <g key={i}>
            <rect
              x={b.x1} y={b.y1} width={b.x2 - b.x1} height={b.y2 - b.y1}
              fill="none" stroke="#34d399" strokeWidth="2" vectorEffect="non-scaling-stroke"
            />
            <rect x={b.x1} y={b.y1 - fs * 1.3} width={lw} height={fs * 1.3} fill="#34d399" opacity=".9" />
            <text x={b.x1 + fs * 0.3} y={b.y1 - fs * 0.35} fontSize={fs} fontWeight="700" fill="#0f172a">{label}</text>
          </g>
        )
      })}
    </svg>
  )
}

function CameraTile({ dir, state, feed, stale }) {
  const st = lampStatus(state, dir)
  const info = DIRS[dir]
  const live = !!feed && !stale
  const down = SAFE[dir] && !live
  const count = live ? feed.count : state.vehicles[dir]

  return (
    <article className="group overflow-hidden rounded-2xl border border-[#232c36] bg-[#141a21]">
      <div className="relative aspect-video overflow-hidden bg-gradient-to-br from-[#10161c] to-[#1b242d]">
        {/* Sumber gambar: feed JSON > aset statis > kosong */}
        {live && feed.image ? (
          <img src={feed.image} alt={`Camera feed ${dir}`} className="absolute inset-0 h-full w-full object-cover" />
        ) : !down && (
          <img
            src={`/assets/cam-${dir.toLowerCase()}.png`}
            alt={`Camera feed ${dir}`}
            className="absolute inset-0 h-full w-full object-cover opacity-50 transition duration-1000 group-hover:scale-105"
          />
        )}

        {!live && (
          <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(#2a3541_1px,transparent_1px),linear-gradient(90deg,#2a3541_1px,transparent_1px)] [background-size:32px_32px]" />
        )}

        {/* Bounding box: real dari JSON, atau mock jika belum ada feed */}
        {live
          ? <BoxOverlay feed={feed} />
          : !down && BOXES.slice(0, Math.min(count, 4)).map((b, i) => (
              <div key={i} className={`absolute rounded-sm border-2 border-emerald-400/80 ${b}`}>
                <span className="absolute -top-5 left-0 rounded bg-emerald-400/90 px-1 text-[10px] font-bold text-slate-900">car 0.9{i + 1}</span>
              </div>
            ))}

        {down && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center text-amber-300">
              <WifiOff className="mx-auto mb-2" size={30} />
              <p className="text-sm font-semibold">No signal, last frame 00:42 ago</p>
            </div>
          </div>
        )}

        <span className={`absolute left-3 top-3 flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-bold shadow ${down ? 'bg-amber-500/90 text-slate-900' : 'bg-rose-600 text-white'}`}>
          <span className={`h-1.5 w-1.5 rounded-full bg-current ${down ? '' : 'animate-pulse'}`} />{down ? 'OFFLINE' : 'LIVE'}
        </span>
        <span className="absolute right-3 top-3 rounded bg-black/40 px-1.5 py-0.5 text-xs tabular-nums text-slate-200 backdrop-blur-sm">
          {state.clock}
        </span>
      </div>

      <div className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-xl font-bold text-slate-100">{info.name} <span className="text-slate-500">({info.role})</span></h3>
          <span className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold ${down ? 'bg-amber-500/15 text-amber-300' : 'bg-emerald-500/10 text-emerald-300'}`}>
            {down ? <WifiOff size={13} /> : <Wifi size={13} />}
            {down ? 'Timeout - Safe Mode' : dir === 'N' ? 'Sync OK (local)' : info.latency ? `Sync OK, ${info.latency} ms` : 'Sync OK'}
          </span>
        </div>
        <p className="flex items-center gap-2 text-sm text-slate-300">
          <Car size={15} className="text-slate-500" />
          {down
            ? <>No data <span className="text-slate-500">(last known: {count} vehicles)</span></>
            : <><b className="tabular-nums">{count}</b> vehicles detected</>}
        </p>
        <p className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
          Status: <Badge color={st.color} pulse={st.safe}>{st.color}</Badge>
          {st.note
            ? <span className="text-slate-500">{st.note}</span>
            : <span>Duration: <b className="tabular-nums">{st.dur}s</b>{st.left ? <span className="text-slate-500"> ({st.left}s left)</span> : <span className="text-slate-500"> until green</span>}</span>}
        </p>
      </div>
    </article>
  )
}
function Monitoring({ state, back, feeds, connected }) {
  return (
    <>
      <Header
        state={state}
        right={
          <button onClick={back} className="flex items-center gap-2 rounded-lg border border-[#2b3540] bg-[#141a21] px-3 py-2 text-sm font-semibold text-slate-200 transition hover:bg-[#1b232c] focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">
            <ArrowLeft size={16} />Back to dashboard
          </button>
        }
      />
      <p className={`mb-3 text-xs ${connected ? 'text-emerald-400' : 'text-slate-500'}`}>
        Camera feed: {connected ? 'connected' : `waiting for ${WS_URL}`}
      </p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {Object.keys(DIRS).map((d) => {
          const feed = feeds[d]
          const stale = feed ? Date.now() - feed.ts > STALE_MS : false
          return <CameraTile key={d} dir={d} state={state} feed={feed} stale={stale} />
        })}
      </div>
    </>
  )
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, undefined, init)
  const [page, setPage] = useState('dashboard')
  const [layout, setLayout] = useState('intersection')
  const { feeds, connected } = useCameraFeeds()

  useEffect(() => {
    const id = setInterval(() => dispatch({ type: 'tick' }), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="min-h-screen bg-[#0c1116] p-4 font-sans text-slate-200 md:p-8">
      <div className="mx-auto max-w-[1400px]">
        {page === 'dashboard'
          ? <Dashboard state={state} dispatch={dispatch} open={() => setPage('monitor')} layout={layout} setLayout={setLayout} />
          : <Monitoring state={state} back={() => setPage('dashboard')} feeds={feeds} connected={connected} />}
      </div>
    </div>
  )
}