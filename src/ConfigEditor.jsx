import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, ChevronDown, ChevronRight, Download, Loader2, MapPin,
  RefreshCw, Trash2, UploadCloud, X,
} from 'lucide-react'
import {
  adjacentPort, buildStructuralSignature, clearanceSeconds, computeMaximalSafeSets,
  ensurePairConsistency, extractActiveMatrix, isIntercardinal, isSetSafe, normalizeConfig, padMatrix,
  portLabel, resetDependents, serializeConfig, syncLanes, validateDraft,
} from './configEditorUtils.js'

const STEP_TITLES = [
  '1. Tata Letak Octagon',
  '2. Matriks Konflik',
  '3. Urutan Fallback',
  '4. Parameter Fisik & Default',
]

function Banner({ kind = 'info', children }) {
  const cls = kind === 'error' ? 'bg-rose-500/10 text-rose-300 ring-rose-500/30'
    : kind === 'warn' ? 'bg-amber-500/10 text-amber-300 ring-amber-500/30'
      : kind === 'success' ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30'
        : 'bg-sky-500/10 text-sky-300 ring-sky-500/30'
  return <div className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ring-1 ${cls}`}>{children}</div>
}

function NumberField({ label, value, onChange, min, max, step = 1, suffix }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-slate-400">{label}{suffix ? <span className="text-slate-500"> ({suffix})</span> : null}</span>
      <input type="number" value={value} min={min} max={max} step={step}
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        className="rounded-lg border border-[#2b3540] bg-[#10161c] px-3 py-2 text-slate-200 outline-none focus:border-sky-500" />
    </label>
  )
}
function TextField({ label, value, onChange }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-slate-400">{label}</span>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-[#2b3540] bg-[#10161c] px-3 py-2 text-slate-200 outline-none focus:border-sky-500" />
    </label>
  )
}

function Stepper({ steps, current, onSelect, warnings }) {
  return (
    <ol className="mb-5 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {steps.map((t, i) => (
        <li key={t}>
          <button onClick={() => onSelect(i)}
            className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm font-semibold transition ${i === current ? 'border-sky-500/40 bg-sky-500/10 text-sky-200' : 'border-[#232c36] bg-[#10161c] text-slate-400 hover:bg-[#1a222b]'}`}>
            <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${i === current ? 'bg-sky-500 text-slate-900' : 'bg-[#232c36] text-slate-300'}`}>{i + 1}</span>
            <span className="flex-1">{t.split('. ')[1]}</span>
            {warnings[i] ? <span className="h-2 w-2 rounded-full bg-amber-400" title="Peringatan" /> : null}
          </button>
        </li>
      ))}
    </ol>
  )
}

/* ───────── Step 1: Octagon Layout ───────── */
function Octagon({ meta, onTogglePort }) {
  const V = {
    0: [130, 70], 1: [230, 70], 2: [290, 130], 3: [290, 230],
    4: [230, 290], 5: [130, 290], 6: [70, 230], 7: [70, 130],
  }
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  const panels = [
    { p: 0, type: 'cardinal', a: V[0], b: V[1], la: V[0], lb: V[1] },
    { p: 2, type: 'cardinal', a: V[2], b: V[3], la: V[2], lb: V[3] },
    { p: 4, type: 'cardinal', a: V[4], b: V[5], la: V[4], lb: V[5] },
    { p: 6, type: 'cardinal', a: V[6], b: V[7], la: V[6], lb: V[7] },
    { p: 1, type: 'inter', a: V[1], b: V[2], ua: [290, 126], ub: [290, 36] },
    { p: 3, type: 'inter', a: V[3], b: V[4], ua: [234, 290], ub: [324, 290] },
    { p: 5, type: 'inter', a: V[5], b: V[6], ua: [70, 234], ub: [70, 324] },
    { p: 7, type: 'inter', a: V[7], b: V[0], ua: [126, 70], ub: [36, 70] },
  ]
  const labelPos = (panel, unfolded) => {
    if (panel.type === 'cardinal') {
      const m = mid(panel.a, panel.b)
      if (panel.p === 0) return [m[0], m[1] - 10]
      if (panel.p === 4) return [m[0], m[1] + 18]
      if (panel.p === 2) return [m[0] + 14, m[1] + 4]
      return [m[0] - 14, m[1] + 4]
    }
    if (unfolded) {
      const m = mid(panel.ua, panel.ub)
      if (panel.p === 1) return [m[0] + 14, m[1] + 4]
      if (panel.p === 3) return [m[0], m[1] + 18]
      if (panel.p === 5) return [m[0] - 14, m[1] + 4]
      return [m[0], m[1] - 10]
    }
    const m = mid(panel.a, panel.b)
    if (panel.p === 1) return [m[0] + 12, m[1] - 4]
    if (panel.p === 3) return [m[0] + 12, m[1] + 12]
    if (panel.p === 5) return [m[0] - 12, m[1] + 12]
    return [m[0] - 12, m[1] - 4]
  }

  return (
    <svg viewBox="0 0 360 360" className="mx-auto w-full max-w-[360px]">
      <polygon points={`${V[0][0]},${V[0][1]} ${V[1][0]},${V[1][1]} ${V[2][0]},${V[2][1]} ${V[3][0]},${V[3][1]} ${V[4][0]},${V[4][1]} ${V[5][0]},${V[5][1]} ${V[6][0]},${V[6][1]} ${V[7][0]},${V[7][1]}`}
        fill="none" stroke="#1e293b" strokeWidth="1" />
      {panels.map((panel) => {
        const enabled = meta.ports[panel.p].enabled
        const si = meta.streamPortMap.indexOf(panel.p)
        const unfolded = panel.type === 'inter' && !!meta.rotatedPorts?.[String(panel.p)]
        const stroke = enabled ? '#6366f1' : '#334155'
        const dim = enabled ? 1 : 0.45
        const [lx, ly] = labelPos(panel, unfolded)
        const bar = (x1, y1, x2, y2, key, extra = {}) => (
          <line key={key} x1={x1} y1={y1} x2={x2} y2={y2}
            stroke={stroke} strokeWidth={14} strokeLinecap="round" opacity={dim}
            className="cursor-pointer" onClick={() => onTogglePort(panel.p)} {...extra} />
        )
        return (
          <g key={panel.p}>
            {panel.type === 'cardinal' && bar(panel.a[0], panel.a[1], panel.b[0], panel.b[1], 'bar')}
            {panel.type === 'inter' && !unfolded && bar(panel.a[0], panel.a[1], panel.b[0], panel.b[1], 'bar')}
            {panel.type === 'inter' && unfolded && (
              <>
                <line x1={panel.a[0]} y1={panel.a[1]} x2={panel.b[0]} y2={panel.b[1]}
                  stroke="#ef4444" strokeWidth={3} strokeDasharray="6 4" opacity={0.7} />
                {bar(panel.ua[0], panel.ua[1], panel.ub[0], panel.ub[1], 'ubar')}
              </>
            )}
            <text x={lx} y={ly} textAnchor="middle" className="pointer-events-none fill-slate-200 font-semibold" style={{ fontSize: 11 }}>
              P{panel.p} {portLabel(panel.p)}
            </text>
            {enabled && si >= 0 && (
              <text x={lx} y={ly + 12} textAnchor="middle" className="pointer-events-none fill-emerald-400" style={{ fontSize: 10 }}>S{si}</text>
            )}
          </g>
        )
      })}
      <circle cx={180} cy={180} r="16" fill="#0c1116" stroke="#232c36" />
      <text x={180} y={184} textAnchor="middle" className="fill-slate-500" style={{ fontSize: 9 }}>NODE</text>
    </svg>
  )
}

function StepLayout({ draft, setDraft, onStructural }) {
  const meta = draft._ui_meta
  const n = meta.streamPortMap.length
  const [msg, setMsg] = useState(null)

  const applyStructural = (mutate) => {
    const nextBase = mutate(structuredClone(draft))
    const before = buildStructuralSignature(draft._ui_meta, draft.streams, draft.lanes)
    const after = buildStructuralSignature(nextBase._ui_meta, nextBase.streams, nextBase.lanes)
    if (before !== after) {
      onStructural(nextBase)
    } else {
      setDraft(nextBase)
    }
  }

  const togglePort = (p) => {
    const enabled = meta.ports[p].enabled
    if (enabled && n <= 2) { setMsg('Minimal 2 titik/stream aktif.'); return }
    setMsg(null)
    applyStructural((d) => {
      const m = d._ui_meta
      m.ports[p].enabled = !enabled
      const spm = m.ports.filter((x) => x.enabled).map((x) => x.port)
      const oldMap = m.streamPortMap
      const byPort = {}
      oldMap.forEach((port, i) => { byPort[port] = { stream: d.streams[i], rt: m.rightTurn[i], pp: m.pairedPort[i] } })
      d.streams = spm.map((port) => byPort[port]?.stream || { lane_count: 1 })
      m.streamPortMap = spm
      m.rightTurn = spm.map((port) => !!byPort[port]?.rt)
      m.pairedPort = spm.map((port) => byPort[port]?.pp ?? null)
      // if an unfolded port lost its pair, clear unfold
      spm.forEach((port, i) => {
        if (m.rightTurn[i] && m.pairedPort[i] != null && !spm.includes(m.pairedPort[i])) {
          m.rightTurn[i] = false
          m.pairedPort[i] = null
          if (m.rotatedPorts) m.rotatedPorts[String(port)] = false
        }
      })
      ensurePairConsistency(m)
      d.lanes = syncLanes(m)
      d = resetDependents(d)
      return d
    })
  }

  const toggleRotatePort = (p) => {
    if (!isIntercardinal(p)) return
    const si = meta.streamPortMap.indexOf(p)
    const nextPort = adjacentPort(p)
    const nextActive = meta.streamPortMap.includes(nextPort)
    const willUnfold = !meta.rotatedPorts?.[String(p)]
    if (si < 0) { setMsg('Aktifkan port ini terlebih dahulu.'); return }
    if (willUnfold && !nextActive) { setMsg(`Unfold butuh lampu setelahnya (Port ${nextPort}) aktif agar bisa dipasangkan.`); return }
    setMsg(null)
    applyStructural((d) => {
      const m = d._ui_meta
      const rp = { ...(m.rotatedPorts || {}) }
      rp[String(p)] = willUnfold
      m.rotatedPorts = rp
      m.rightTurn[si] = willUnfold
      m.pairedPort[si] = willUnfold ? nextPort : null
      ensurePairConsistency(m)
      d.lanes = syncLanes(m)
      d = resetDependents(d)
      return d
    })
  }

  const setLanesCount = (si, val) => {
    const v = Math.min(3, Math.max(1, val))
    setDraft((d) => {
      const nd = structuredClone(d)
      nd.streams[si].lane_count = v
      return nd
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-slate-400">Aktif: <b className="text-slate-200">{n}</b>/8 (min 2). Klik batang panel untuk aktif/nonaktif. Port interkardinal (P1,P3,P5,P7) dapat diluruskan (unfold) dari kartu.</span>
      </div>
      {msg && <Banner kind="warn"><AlertTriangle size={16} className="mt-0.5 shrink-0" />{msg}</Banner>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-[#232c36] bg-[#10161c] p-4">
          <p className="mb-2 text-sm text-slate-400">8 panel octagon: kardinal tetap, interkardinal dapat diluruskan (+45° CW) dari poros pasangannya.</p>
          <Octagon meta={meta} onTogglePort={togglePort} />
        </div>
        <div className="space-y-2">
          {meta.streamPortMap.map((port, si) => {
            const inter = isIntercardinal(port)
            const unfolded = inter && !!meta.rotatedPorts?.[String(port)]
            return (
              <div key={port} className="rounded-xl border border-[#232c36] bg-[#10161c] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold text-slate-200">Stream S{si} <span className="text-slate-500">(Port {port} {portLabel(port)})</span></p>
                    {meta.pairedPort[si] != null && <p className="text-xs text-sky-400">Dipasangkan → Port {meta.pairedPort[si]}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-slate-400">Lajur</span>
                    <div className="flex items-center gap-1">
                      <button onClick={() => setLanesCount(si, (draft.streams[si]?.lane_count || 1) - 1)} className="h-7 w-7 rounded bg-[#232c36] text-slate-200">-</button>
                      <span className="w-6 text-center text-sm font-semibold">{draft.streams[si]?.lane_count || 1}</span>
                      <button onClick={() => setLanesCount(si, (draft.streams[si]?.lane_count || 1) + 1)} className="h-7 w-7 rounded bg-[#232c36] text-slate-200">+</button>
                    </div>
                    {inter && (
                      <button onClick={() => toggleRotatePort(port)} title="Luruskan / Unfold (+45°)"
                        className={`rounded border px-2 py-1 text-xs font-semibold ${unfolded ? 'border-amber-400/40 bg-amber-500/15 text-amber-300' : 'border-[#2b3540] bg-[#1a222b] text-slate-300'}`}>
                        {unfolded ? 'Tutup (Normal)' : 'Luruskan / Unfold (+45°)'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
          {n === 0 && <p className="text-sm text-slate-500">Tidak ada stream aktif.</p>}
        </div>
      </div>
    </div>
  )
}

/* ───────── Step 2: Conflict Matrix ───────── */
function StepConflictMatrix({ draft, setDraft, onEdited }) {
  const n = draft.streams.length
  const active = useMemo(() => extractActiveMatrix(draft.conflict_matrix, n), [draft.conflict_matrix, n])
  const [reviewState, setReviewState] = useState({ n, set: new Set() })
  const [hover, setHover] = useState(null)
  const reviewed = reviewState.n === n ? reviewState.set : new Set()

  const togglePair = (i, j) => {
    if (i === j || i >= n || j >= n) return
    setDraft((d) => {
      const nd = structuredClone(d)
      const a = extractActiveMatrix(nd.conflict_matrix, n)
      a[i][j] = a[i][j] ? 0 : 1
      a[j][i] = a[i][j]
      nd.conflict_matrix = padMatrix(n, a)
      return nd
    })
    onEdited?.()
    const key = [Math.min(i, j), Math.max(i, j)].join('-')
    setReviewState((s) => {
      const base = s.n === n ? s.set : new Set()
      return { n, set: new Set([...base, key]) }
    })
  }

  const pairs = []
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pairs.push([i, j])
  const unreviewed = pairs.filter(([i, j]) => !reviewed.has(`${i}-${j}`))
  const maximal = useMemo(() => computeMaximalSafeSets(active), [active])
  const inAny = new Set(maximal.flat())
  const isolated = Array.from({ length: n }, (_, i) => i).filter((i) => n >= 2 && !inAny.has(i))

  const isHoverCell = (i, j) => hover && ((hover.i === i && hover.j === j) || (hover.i === j && hover.j === i))
  const hoverRow = hover ? hover.i : null
  const hoverCol = hover ? hover.j : null
  const headHl = (idx, type) => hover && ((type === 'row' && (idx === hoverRow || idx === hoverCol)) || (type === 'col' && (idx === hoverCol || idx === hoverRow)))

  return (
    <div className="space-y-4">
      {unreviewed.length > 0 && (
        <Banner kind="warn"><AlertTriangle size={16} className="mt-0.5 shrink-0" />{unreviewed.length} pasangan aktif belum ditinjau (non-blocking).</Banner>
      )}
      {isolated.length > 0 && (
        <Banner kind="warn"><AlertTriangle size={16} className="mt-0.5 shrink-0" />Stream terisolasi/tidak masuk kombinasi aman maksimal: {isolated.map((i) => `S${i}`).join(', ')} (non-blocking).</Banner>
      )}
      <p className="text-sm text-slate-400">Grid 8×8 simetris. Klik sel aktif (m,n) untuk toggle 0 (Hijau/Aman) ↔ 1 (Merah/Konflik) sekaligus cermin (n,m). Diagonal dan stream non-aktif terkunci.</p>
      <div className="overflow-auto rounded-xl border border-[#232c36]">
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-[#10161c] px-2 py-2 text-slate-500">m\n</th>
              {Array.from({ length: 8 }, (_, j) => (
                <th key={j} className={`px-2 py-2 font-semibold ${j >= n ? 'bg-[#0c1116] text-slate-600' : headHl(j, 'col') ? 'bg-sky-500/20 text-sky-200' : 'bg-[#10161c] text-slate-300'}`}>S{j}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 8 }, (_, i) => (
              <tr key={i}>
                <th className={`sticky left-0 z-10 px-2 py-2 font-semibold ${i >= n ? 'bg-[#0c1116] text-slate-600' : headHl(i, 'row') ? 'bg-sky-500/20 text-sky-200' : 'bg-[#10161c] text-slate-300'}`}>S{i}</th>
                {Array.from({ length: 8 }, (_, j) => {
                  const inactive = i >= n || j >= n
                  const diag = i === j
                  const val = inactive ? (diag ? 0 : 1) : (active[i]?.[j] ? 1 : 0)
                  const hl = isHoverCell(i, j)
                  const locked = inactive || diag
                  const cls = inactive
                    ? 'bg-[#0b0f14] text-slate-700 cursor-not-allowed'
                    : diag
                      ? 'bg-[#141a21] text-slate-500 cursor-not-allowed'
                      : val === 0
                        ? (hl ? 'bg-emerald-500/30' : 'bg-emerald-500/15') + ' text-emerald-300 cursor-pointer hover:bg-emerald-500/30'
                        : (hl ? 'bg-rose-500/30' : 'bg-rose-500/15') + ' text-rose-300 cursor-pointer hover:bg-rose-500/30'
                  return (
                    <td key={j}
                      onMouseEnter={() => !locked && setHover({ i, j })}
                      onMouseLeave={() => setHover(null)}
                      onClick={() => !locked && togglePair(i, j)}
                      className={`border border-[#232c36] px-2 py-2 text-center font-semibold select-none ${cls}`}>
                      {diag ? '–' : val}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">Matriks disimpan selalu 8×8 (baris/kolom stream non-aktif dipadding konflik=1, diagonal 0).</p>
    </div>
  )
}

/* ───────── Step 3: Fallback Sequence ───────── */
function StepFallbackSequence({ draft, setDraft, onEdited }) {
  const n = draft.streams.length
  const active = useMemo(() => extractActiveMatrix(draft.conflict_matrix, n), [draft.conflict_matrix, n])
  const maximal = useMemo(() => computeMaximalSafeSets(active), [active])
  const phases = draft.fallback_sequence || []

  const addPhase = (set) => {
    if (!isSetSafe(active, set)) return
    onEdited?.()
    setDraft((d) => ({ ...d, fallback_sequence: [...d.fallback_sequence, { active_streams: [...set], duration_s: 30 }] }))
  }
  const updatePhase = (idx, patch) => {
    onEdited?.()
    setDraft((d) => {
      const nd = structuredClone(d)
      nd.fallback_sequence[idx] = { ...nd.fallback_sequence[idx], ...patch }
      return nd
    })
  }
  const removePhase = (idx) => { onEdited?.(); setDraft((d) => ({ ...d, fallback_sequence: d.fallback_sequence.filter((_, i) => i !== idx) })) }
  const movePhase = (idx, dir) => { onEdited?.(); setDraft((d) => {
    const arr = [...d.fallback_sequence]
    const j = idx + dir
    if (j < 0 || j >= arr.length) return d
    ;[arr[idx], arr[j]] = [arr[j], arr[idx]]
    return { ...d, fallback_sequence: arr }
  }) }

  const covered = new Set(phases.flatMap((p) => p.active_streams || []))
  const missing = Array.from({ length: n }, (_, i) => i).filter((i) => !covered.has(i))

  return (
    <div className="space-y-4">
      <Banner kind="info">Kombinasi hijau maksimal (Bron–Kerbosch) dihitung dari matriks Step 2: <b>{maximal.length}</b> set.</Banner>
      <div>
        <p className="mb-2 text-sm font-semibold text-slate-300">Pilih/tambah fase dari kombinasi aman maksimal</p>
        <div className="flex flex-wrap gap-2">
          {maximal.map((set, idx) => (
            <button key={idx} onClick={() => addPhase(set)}
              className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-sm text-emerald-200 hover:bg-emerald-500/20">
              + [{set.map((s) => `S${s}`).join(', ')}]
            </button>
          ))}
          {maximal.length === 0 && <span className="text-sm text-slate-500">Tidak ada kombinasi (periksa stream/matriks).</span>}
        </div>
      </div>
      {missing.length > 0 && (
        <Banner kind="warn"><AlertTriangle size={16} className="mt-0.5 shrink-0" />Stream belum masuk fase mana pun: {missing.map((i) => `S${i}`).join(', ')} (non-blocking).</Banner>
      )}
      <div className="space-y-2">
        <p className="text-sm font-semibold text-slate-300">Timeline fase (urutan)</p>
        {phases.map((ph, idx) => {
          const safe = isSetSafe(active, ph.active_streams || [])
          return (
            <div key={idx} className={`flex flex-wrap items-center gap-2 rounded-lg border p-3 ${safe ? 'border-[#232c36] bg-[#10161c]' : 'border-rose-500/40 bg-rose-500/10'}`}>
              <span className="font-semibold text-slate-200">Fase {idx + 1}</span>
              <span className="text-sm text-slate-400">[{(ph.active_streams || []).map((s) => `S${s}`).join(', ')}]</span>
              <label className="flex items-center gap-1 text-sm text-slate-300">Durasi
                <input type="number" min={1} value={ph.duration_s}
                  onChange={(e) => updatePhase(idx, { duration_s: Number(e.target.value) })}
                  className="w-20 rounded border border-[#2b3540] bg-[#0c1116] px-2 py-1" /> s
              </label>
              {!safe && <span className="text-xs text-rose-300">Kombinasi konflik</span>}
              <div className="ml-auto flex gap-1">
                <button onClick={() => movePhase(idx, -1)} className="rounded bg-[#232c36] p-1.5 text-slate-300 hover:bg-[#2b3540]" title="Naik"><ArrowUp size={14} /></button>
                <button onClick={() => movePhase(idx, 1)} className="rounded bg-[#232c36] p-1.5 text-slate-300 hover:bg-[#2b3540]" title="Turun"><ArrowDown size={14} /></button>
                <button onClick={() => removePhase(idx)} className="rounded bg-rose-500/20 p-1.5 text-rose-300 hover:bg-rose-500/30" title="Hapus"><Trash2 size={14} /></button>
              </div>
            </div>
          )
        })}
        {phases.length === 0 && <p className="text-sm text-slate-500">Belum ada fase. Tambah dari kombinasi di atas.</p>}
      </div>
    </div>
  )
}

/* ───────── Step 4: Physical & Defaults + Map Picker ───────── */
function MapDistanceModal({ open, onClose, onApply }) {
  const mapRef = useRef(null)
  const leafletRef = useRef(null)
  const [pts, setPts] = useState([])
  const [ready, setReady] = useState(false)
  const [dist, setDist] = useState(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(async () => {
      const Lmod = await import('leaflet')
      await import('leaflet/dist/leaflet.css')
      const L = Lmod.default || Lmod
      if (cancelled) return
      leafletRef.current = L
      setReady(true)
    })()
    return () => { cancelled = true }
  }, [open])

  useEffect(() => {
    if (!open || !ready || !leafletRef.current) return
    const L = leafletRef.current
    const el = document.getElementById('cfg-map')
    if (!el) return
    const map = L.map(el).setView([-6.2, 106.816], 13)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap' }).addTo(map)
    mapRef.current = { map, L, markers: [], line: null }
    map.on('click', (e) => {
      setPts((p) => (p.length >= 2 ? [e.latlng] : [...p, e.latlng]))
    })
    const t = setTimeout(() => map.invalidateSize(), 50)
    return () => { clearTimeout(t); map.remove(); mapRef.current = null }
  }, [open, ready])

  useEffect(() => {
    const ctx = mapRef.current
    if (!ctx) return
    const { map, L } = ctx
    ctx.markers.forEach((m) => m.remove()); ctx.markers = []
    if (ctx.line) { ctx.line.remove(); ctx.line = null }
    pts.forEach((p) => ctx.markers.push(L.marker(p).addTo(map)))
    if (pts.length === 2) {
      ctx.line = L.polyline(pts, { color: '#38bdf8' }).addTo(map)
      map.fitBounds(L.latLngBounds(pts), { padding: [30, 30] })
      setDist(map.distance(pts[0], pts[1]))
    } else {
      setDist(null)
    }
  }, [pts])

  const handleClose = () => { setPts([]); setDist(null); setReady(false); onClose() }

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-3xl rounded-2xl border border-[#232c36] bg-[#141a21] p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-100">Pilih jarak (geodesic)</h3>
          <button onClick={handleClose} className="rounded p-1 text-slate-400 hover:bg-[#1a222b]"><X size={18} /></button>
        </div>
        <p className="mb-2 text-sm text-slate-400">Klik 2 titik pada peta untuk menghitung jarak dalam meter.</p>
        <div id="cfg-map" className="h-[360px] w-full overflow-hidden rounded-lg border border-[#232c36] bg-[#0c1116]">
          {!ready && <div className="flex h-full items-center justify-center text-slate-400"><Loader2 className="mr-2 animate-spin" size={18} />Memuat peta…</div>}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm text-slate-300">Jarak: <b className="text-sky-300">{dist != null ? `${dist.toFixed(2)} m` : '—'}</b></div>
          <div className="flex gap-2">
            <button onClick={() => setPts([])} className="rounded-lg border border-[#2b3540] px-3 py-1.5 text-sm text-slate-200">Reset titik</button>
            <button onClick={() => { if (dist != null) onApply(Number(dist.toFixed(2))); handleClose() }} disabled={dist == null}
              className="rounded-lg bg-sky-500 px-3 py-1.5 text-sm font-semibold text-slate-900 disabled:opacity-40">Terapkan</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function StepPhysicalDefaults({ draft, setDraft }) {
  const [openMap, setOpenMap] = useState(false)
  const [openDef, setOpenDef] = useState(false)
  const set = (k) => (v) => setDraft((d) => ({ ...d, [k]: v }))
  const clr = clearanceSeconds(draft.conflict_zone_meter, draft.vehicle_speed_kmh)
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[#232c36] bg-[#10161c] p-4">
        <h3 className="mb-3 font-semibold text-slate-200">Parameter Fisik</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1 text-sm">
            <span className="text-slate-400">conflict_zone_meter (m)</span>
            <div className="flex gap-2">
              <input type="number" value={draft.conflict_zone_meter} min={0.1} step={0.1}
                onChange={(e) => set('conflict_zone_meter')(Number(e.target.value))}
                className="flex-1 rounded-lg border border-[#2b3540] bg-[#0c1116] px-3 py-2 text-slate-200 outline-none focus:border-sky-500" />
              <button onClick={() => setOpenMap(true)} className="flex items-center gap-1 rounded-lg border border-[#2b3540] bg-[#1a222b] px-3 py-2 text-sm text-slate-200 hover:bg-[#222c37]"><MapPin size={16} />Peta</button>
            </div>
          </div>
          <NumberField label="vehicle_speed_kmh" suffix="km/h" value={draft.vehicle_speed_kmh} min={0.1} step={0.1} onChange={set('vehicle_speed_kmh')} />
        </div>
        <div className="mt-3 rounded-lg bg-[#0c1116] px-3 py-2 text-sm text-slate-300">
          Pratinjau clearance time: <b className="text-sky-300">{clr != null ? `${clr.toFixed(2)} s` : '—'}</b>
          <span className="text-slate-500"> (jarak / kecepatan)</span>
        </div>
      </div>

      <div className="rounded-xl border border-[#232c36] bg-[#10161c]">
        <button onClick={() => setOpenDef((o) => !o)} className="flex w-full items-center justify-between px-4 py-3 text-left font-semibold text-slate-200">
          <span>Parameter Default</span>
          {openDef ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </button>
        {openDef && (
          <div className="grid grid-cols-1 gap-3 border-t border-[#232c36] p-4 sm:grid-cols-2 lg:grid-cols-3">
            <NumberField label="min_green" value={draft.min_green} min={1} onChange={set('min_green')} />
            <NumberField label="max_extra_green" value={draft.max_extra_green} min={0} onChange={set('max_extra_green')} />
            <NumberField label="y_sec" value={draft.y_sec} min={0} step={0.1} onChange={set('y_sec')} />
            <NumberField label="saturation_headway_sec" value={draft.saturation_headway_sec} min={0.1} step={0.1} onChange={set('saturation_headway_sec')} />
            <NumberField label="re_evaluate_interval_sec" value={draft.re_evaluate_interval_sec} min={0.1} step={0.1} onChange={set('re_evaluate_interval_sec')} />
            <NumberField label="yolo_poll_interval_sec" value={draft.yolo_poll_interval_sec} min={0.1} step={0.1} onChange={set('yolo_poll_interval_sec')} />
            <TextField label="serial_port" value={draft.serial_port} onChange={set('serial_port')} />
            <NumberField label="baud_rate" value={draft.baud_rate} min={1} onChange={set('baud_rate')} />
          </div>
        )}
      </div>
      <MapDistanceModal open={openMap} onClose={() => setOpenMap(false)} onApply={(m) => setDraft((d) => ({ ...d, conflict_zone_meter: m }))} />
    </div>
  )
}

/* ───────── Main ConfigEditor ───────── */
export default function ConfigEditor({ state, page, onNavigate }) {
  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState(null)
  const [offline, setOffline] = useState(false)
  const [saveMsg, setSaveMsg] = useState(null)
  const [saveErr, setSaveErr] = useState(null)
  const [draft, setDraft] = useState(null)
  const [original, setOriginal] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [downstreamDirty, setDownstreamDirty] = useState(false)
  const [confirmReset, setConfirmReset] = useState(null) // next draft awaiting confirmation
  const [lastSyncAt, setLastSyncAt] = useState(null)
  const downloadHandleRef = useRef(null)

  const load = async () => {
    setLoading(true); setLoadError(null); setOffline(false); setLastSyncAt(null)
    try {
      const res = await fetch('/api/config')
      const ct = res.headers.get('content-type') || ''
      const txt = await res.text()
      const looksHtml = /^\s*</.test(txt) || ct.includes('text/html')
      if (!res.ok || looksHtml) {
        throw new Error('offline')
      }
      let json
      try { json = JSON.parse(txt) } catch { throw new Error('offline') }
      const { draft: d, original: o } = normalizeConfig(json)
      setDraft(d); setOriginal(o); setDirty(false); setDownstreamDirty(false); setSaveMsg(null); setSaveErr(null)
    } catch (e) {
      const { draft: d, original: o } = normalizeConfig({})
      setDraft(d); setOriginal(o); setDirty(false); setDownstreamDirty(false)
      if (e.message === 'offline') {
        setOffline(true); setLoadError(null)
      } else {
        setLoadError(e.message || 'Gagal memuat')
      }
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const markDirty = (updater) => {
    setDraft((d) => (typeof updater === 'function' ? updater(d) : updater))
    setDirty(true); setSaveMsg(null)
  }
  const markDownstreamEdited = () => { setDownstreamDirty(true) }

  const onStructural = (nextDraft) => {
    if (downstreamDirty) {
      setConfirmReset(nextDraft)
    } else {
      setDraft(nextDraft); setDirty(true); setSaveMsg(null)
    }
  }
  const confirmApplyReset = () => {
    if (confirmReset) { setDraft(confirmReset); setDirty(true); setDownstreamDirty(false); setSaveMsg(null) }
    setConfirmReset(null)
  }

  const errors = useMemo(() => draft ? validateDraft(draft) : [], [draft])
  const canSave = !!draft && errors.length === 0 && !saving

  const doSave = async () => {
    if (!draft) return
    setSaving(true); setSaveErr(null); setSaveMsg(null)
    try {
      const body = serializeConfig(draft, original)
      const res = await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const txt = await res.text()
      let data = null; try { data = txt ? JSON.parse(txt) : null } catch { data = txt }
      if (!res.ok) {
        const msg = data?.message || data?.error || (typeof data === 'string' && !/^\s*</.test(data) ? data : `HTTP ${res.status}`)
        const details = data?.errors || data?.details
        throw new Error(details ? `${msg}: ${JSON.stringify(details)}` : msg)
      }
      const now = new Date().toLocaleTimeString('en-GB')
      setOriginal(body); setDirty(false); setOffline(false); setLastSyncAt(now)
      setSaveMsg(`Konfigurasi tersimpan ke data/config.json di Raspi dan dikirim ke perangkat keras (${now}).`)
    } catch (e) {
      setSaveErr(e.message || 'Gagal menyimpan')
    } finally { setSaving(false) }
  }

  const doDownload = async () => {
    if (!draft) return
    const body = serializeConfig(draft, original)
    const json = JSON.stringify(body, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    if ('showSaveFilePicker' in window) {
      try {
        if (!downloadHandleRef.current) {
          downloadHandleRef.current = await window.showSaveFilePicker({
            suggestedName: 'config.json',
            types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
          })
        }
        const writable = await downloadHandleRef.current.createWritable()
        await writable.write(blob)
        await writable.close()
        return
      } catch (e) {
        if (e?.name === 'AbortError') return
        downloadHandleRef.current = null
      }
    }
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'config.json'; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const nav = (id) => {
    if (id === page) return
    if (dirty && !window.confirm('Perubahan belum disimpan. Tinggalkan halaman?')) return
    onNavigate(id)
  }

  const stepWarnings = useMemo(() => {
    const w = [false, false, false, false]
    if (!draft) return w
    const n = draft.streams.length
    const active = extractActiveMatrix(draft.conflict_matrix, n)
    const maximal = computeMaximalSafeSets(active)
    const inAny = new Set(maximal.flat())
    if (n >= 2 && Array.from({ length: n }, (_, i) => i).some((i) => !inAny.has(i))) w[1] = true
    const covered = new Set((draft.fallback_sequence || []).flatMap((p) => p.active_streams || []))
    if (Array.from({ length: n }, (_, i) => i).some((i) => !covered.has(i)) && n >= 2) w[2] = true
    return w
  }, [draft])

  return (
    <div className="space-y-4">
      <header className="mb-2 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-slate-100">Location Node 01</h1>
          <p className="text-sm text-slate-500">Konfigurasi sinyal adaptif</p>
          <nav className="mt-2 flex flex-wrap gap-1">
            <button onClick={() => nav('dashboard')} className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-400 hover:bg-[#1a222b] hover:text-slate-200">Dashboard</button>
            <button className="flex items-center gap-2 rounded-lg bg-sky-500/20 px-3 py-1.5 text-sm font-semibold text-sky-300 ring-1 ring-sky-500/30">Konfigurasi</button>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {state.emergency ? <span className="rounded-md bg-rose-500/15 px-2 py-0.5 text-xs font-bold text-rose-400 ring-1 ring-rose-500/30">EMERGENCY</span> : state.manual ? <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-xs font-bold text-amber-400 ring-1 ring-amber-500/30">MANUAL</span> : <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-400 ring-1 ring-emerald-500/30">ADAPTIVE</span>}
          <span className="font-display text-2xl tabular-nums text-slate-300">{state.clock}</span>
        </div>
      </header>

      <section className="rounded-2xl border border-[#232c36] bg-[#141a21] p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-2xl font-bold text-slate-100">Wizard Konfigurasi</h2>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="text-xs text-slate-500">Terakhir sync: {lastSyncAt ?? '—'}</span>
            <button onClick={load} disabled={loading} className="flex items-center gap-2 rounded-lg border border-[#2b3540] bg-[#1a222b] px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-[#222c37] disabled:opacity-50"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} />Muat ulang</button>
            <button onClick={doDownload} disabled={!draft} className="flex items-center gap-2 rounded-lg border border-[#2b3540] bg-[#1a222b] px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-[#222c37] disabled:opacity-50"><Download size={15} />Download config.json</button>
            <button onClick={doSave} disabled={!canSave} className="flex items-center gap-2 rounded-lg bg-sky-500 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40">
              {saving ? <Loader2 size={15} className="animate-spin" /> : <UploadCloud size={15} />}Sync ke Raspi
            </button>
          </div>
        </div>

        {loading && <Banner kind="info"><Loader2 size={16} className="animate-spin" />Memuat konfigurasi dari /api/config…</Banner>}
        {offline && <Banner kind="info"><AlertTriangle size={16} className="mt-0.5 shrink-0" />Backend tidak terhubung — menggunakan konfigurasi default lokal (tetap bisa Download config.json).</Banner>}
        {loadError && <Banner kind="error"><AlertTriangle size={16} className="mt-0.5 shrink-0" />Gagal memuat: {loadError}. <button onClick={load} className="ml-2 underline">Coba lagi</button></Banner>}
        {saveMsg && <Banner kind="success"><CheckCircle2 size={16} className="mt-0.5 shrink-0" />{saveMsg}</Banner>}
        {saveErr && <Banner kind="error"><AlertTriangle size={16} className="mt-0.5 shrink-0" />Gagal simpan: {saveErr}</Banner>}
        {errors.length > 0 && draft && (
          <Banner kind="error"><AlertTriangle size={16} className="mt-0.5 shrink-0" /><div><p className="font-semibold">Validasi:</p><ul className="list-inside list-disc">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul></div></Banner>
        )}

        {draft && (
          <div className="mt-4">
            <Stepper steps={STEP_TITLES} current={step} onSelect={setStep} warnings={stepWarnings} />
            {step === 0 && <StepLayout draft={draft} setDraft={markDirty} onStructural={onStructural} />}
            {step === 1 && <StepConflictMatrix draft={draft} setDraft={markDirty} onEdited={markDownstreamEdited} />}
            {step === 2 && <StepFallbackSequence draft={draft} setDraft={markDirty} onEdited={markDownstreamEdited} />}
            {step === 3 && <StepPhysicalDefaults draft={draft} setDraft={markDirty} />}
            <div className="mt-6 flex items-center justify-between border-t border-[#232c36] pt-4">
              <button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0} className="rounded-lg border border-[#2b3540] px-4 py-2 text-sm font-semibold text-slate-200 disabled:opacity-40">Kembali</button>
              <span className="text-sm text-slate-500">Langkah {step + 1} dari 4 {dirty ? '· belum disimpan' : ''}</span>
              <button onClick={() => setStep((s) => Math.min(3, s + 1))} disabled={step === 3} className="rounded-lg bg-[#232c36] px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-[#2b3540] disabled:opacity-40">Lanjut</button>
            </div>
          </div>
        )}
      </section>

      {confirmReset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-[#232c36] bg-[#141a21] p-5">
            <h3 className="text-lg font-semibold text-slate-100">Ubah struktur stream?</h3>
            <p className="mt-2 text-sm text-slate-400">Perubahan struktur stream akan mereset <b>Step 2 (Matriks Konflik)</b> dan <b>Step 3 (Urutan Fallback)</b>. Lanjutkan?</p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setConfirmReset(null)} className="rounded-lg border border-[#2b3540] px-3 py-2 text-sm text-slate-200">Batal</button>
              <button onClick={confirmApplyReset} className="rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-slate-900">Reset & Terapkan</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
