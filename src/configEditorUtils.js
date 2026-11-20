const PORT_LABELS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

export const DEFAULTS = {
  min_green: 10,
  max_extra_green: 40,
  y_sec: 3,
  conflict_zone_meter: 150,
  vehicle_speed_kmh: 36,
  saturation_headway_sec: 2.1,
  re_evaluate_interval_sec: 10,
  serial_port: '/dev/ttyUSB0',
  baud_rate: 115200,
  yolo_poll_interval_sec: 2,
}

function clampInt(v, min, max, d) {
  const n = Number(v)
  if (!Number.isFinite(n)) return d
  return Math.min(max, Math.max(min, Math.round(n)))
}
function clampNum(v, min, max, d) {
  const n = Number(v)
  if (!Number.isFinite(n)) return d
  return Math.min(max, Math.max(min, n))
}

function defaultPorts() {
  return Array.from({ length: 8 }, (_, p) => ({ port: p, enabled: [0, 2, 4, 6].includes(p) }))
}

export function defaultRotatedPorts() {
  return { '1': false, '3': false, '5': false, '7': false }
}

function normalizeRotatedPorts(meta) {
  if (meta && meta.rotatedPorts && typeof meta.rotatedPorts === 'object') {
    return { '1': !!meta.rotatedPorts['1'], '3': !!meta.rotatedPorts['3'], '5': !!meta.rotatedPorts['5'], '7': !!meta.rotatedPorts['7'] }
  }
  if (meta && meta.rotated45) {
    return { '1': true, '3': true, '5': true, '7': true }
  }
  return defaultRotatedPorts()
}

function defaultMeta() {
  const ports = defaultPorts()
  const streamPortMap = ports.filter((p) => p.enabled).map((p) => p.port)
  const n = streamPortMap.length
  return {
    version: 2,
    ports,
    rotatedPorts: defaultRotatedPorts(),
    streamPortMap,
    rightTurn: Array(n).fill(false),
    pairedPort: Array(n).fill(null),
  }
}

function identity8() {
  return Array.from({ length: 8 }, (_, i) =>
    Array.from({ length: 8 }, (_, j) => (i === j ? 0 : 1)),
  )
}

export function padMatrix(activeN, activeMatrix) {
  const out = identity8()
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      if (i < activeN && j < activeN) out[i][j] = i === j ? 0 : (activeMatrix?.[i]?.[j] ? 1 : 0)
      else if (i === j) out[i][j] = 0
      else out[i][j] = 1
    }
  }
  return out
}

export function extractActiveMatrix(m, n) {
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 0 : (m?.[i]?.[j] ? 1 : 0))),
  )
}

function inferMetaFromRaw(raw, n) {
  const meta = raw?._ui_meta
  if (meta && Array.isArray(meta.ports) && Array.isArray(meta.streamPortMap)) {
    const ports = Array.from({ length: 8 }, (_, p) => {
      const found = meta.ports.find((x) => x?.port === p)
      return { port: p, enabled: !!found?.enabled }
    })
    const spm = meta.streamPortMap.filter((p) => Number.isInteger(p) && p >= 0 && p < 8).slice(0, n)
    const nn = spm.length || n
    const rt = Array.from({ length: nn }, (_, i) => !!meta.rightTurn?.[i])
    const pp = Array.from({ length: nn }, (_, i) => {
      const v = meta.pairedPort?.[i]
      return Number.isInteger(v) && v >= 0 && v < 8 ? v : null
    })
    ports.forEach((p) => { p.enabled = spm.includes(p.port) })
    if (spm.length < 2) return defaultMeta()
    return { version: 2, ports, rotatedPorts: normalizeRotatedPorts(meta), streamPortMap: spm, rightTurn: rt, pairedPort: pp }
  }
  let enabledPorts = []
  if (!enabledPorts.length) {
    const order = [0, 2, 4, 6, 1, 3, 5, 7]
    enabledPorts = order.slice(0, Math.max(2, Math.min(8, n || 4)))
  }
  const ports = Array.from({ length: 8 }, (_, p) => ({ port: p, enabled: enabledPorts.includes(p) }))
  const streamPortMap = ports.filter((p) => p.enabled).map((p) => p.port)
  const nn = streamPortMap.length
  return { version: 2, ports, rotatedPorts: defaultRotatedPorts(), streamPortMap, rightTurn: Array(nn).fill(false), pairedPort: Array(nn).fill(null) }
}

export function syncLanes(meta) {
  const spm = meta?.streamPortMap || []
  const n = spm.length
  const portToSi = new Map(spm.map((p, i) => [p, i]))
  const grouped = new Set()
  const lanes = []
  for (let i = 0; i < n; i++) {
    if (grouped.has(i)) continue
    const rt = !!meta.rightTurn?.[i]
    const pairPort = meta.pairedPort?.[i]
    const j = rt && pairPort != null ? portToSi.get(pairPort) : undefined
    if (j != null && j !== i && !grouped.has(j)) {
      lanes.push([i, j].sort((a, b) => a - b))
      grouped.add(i); grouped.add(j)
    } else {
      lanes.push([i])
      grouped.add(i)
    }
  }
  lanes.sort((a, b) => a[0] - b[0])
  return lanes
}

export function ensurePairConsistency(meta) {
  const spm = meta?.streamPortMap || []
  const portToSi = new Set(spm)
  const n = spm.length
  meta.rightTurn = Array.from({ length: n }, (_, i) => {
    const on = !!meta.rightTurn?.[i]
    const pp = meta.pairedPort?.[i]
    return on && pp != null && portToSi.has(pp) && pp !== spm[i]
  })
  meta.pairedPort = Array.from({ length: n }, (_, i) => (meta.rightTurn[i] ? meta.pairedPort[i] : null))
}

export function normalizeConfig(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  let streams = Array.isArray(r.streams) ? r.streams : []
  streams = streams.slice(0, 8).map((s) => ({ lane_count: clampInt(s?.lane_count, 1, 3, 1) }))
  if (streams.length < 2) {
    const metaGuess = inferMetaFromRaw(r, streams.length)
    const n = Math.max(2, metaGuess.streamPortMap.length || 2)
    streams = Array.from({ length: n }, (_, i) => streams[i] || { lane_count: 1 })
  }
  const n = streams.length
  const meta = inferMetaFromRaw(r, n)
  if (meta.streamPortMap.length !== n) {
    const order = [0, 2, 4, 6, 1, 3, 5, 7]
    const spm = order.filter((p) => meta.ports[p]?.enabled)
    const fixed = (spm.length >= 2 ? spm : order.slice(0, n)).slice(0, n)
    meta.streamPortMap = fixed
    meta.ports.forEach((p) => { p.enabled = fixed.includes(p.port) })
    meta.rightTurn = Array(n).fill(false).map((_, i) => !!meta.rightTurn[i])
    meta.pairedPort = Array(n).fill(null).map((_, i) => meta.pairedPort[i] ?? null)
  }
  meta.rotatedPorts = normalizeRotatedPorts(meta)
  meta.version = 2
  ensurePairConsistency(meta)
  let lanes = syncLanes(meta)
  if (!lanes.length) lanes = Array.from({ length: n }, (_, i) => [i])

  let matrix8 = identity8()
  if (Array.isArray(r.conflict_matrix)) {
    const m = r.conflict_matrix
    if (m.length === 8) {
      matrix8 = Array.from({ length: 8 }, (_, i) => Array.from({ length: 8 }, (_, j) => (i === j ? 0 : (m[i]?.[j] ? 1 : 0))))
    } else {
      matrix8 = padMatrix(n, extractActiveMatrix(m, n))
    }
  }
  matrix8 = padMatrix(n, extractActiveMatrix(matrix8, n))

  let fs = Array.isArray(r.fallback_sequence) ? r.fallback_sequence : []
  fs = fs.map((ph) => ({
    active_streams: Array.isArray(ph?.active_streams) ? [...new Set(ph.active_streams.filter((x) => Number.isInteger(x) && x >= 0 && x < n))] : [],
    duration_s: clampInt(ph?.duration_s, 1, 600, 30),
  })).filter((ph) => ph.active_streams.length > 0)

  const draft = {
    min_green: clampInt(r.min_green, 1, 600, DEFAULTS.min_green),
    max_extra_green: clampInt(r.max_extra_green, 0, 600, DEFAULTS.max_extra_green),
    y_sec: clampNum(r.y_sec, 0, 60, DEFAULTS.y_sec),
    conflict_zone_meter: clampNum(r.conflict_zone_meter, 0.1, 100000, DEFAULTS.conflict_zone_meter),
    vehicle_speed_kmh: clampNum(r.vehicle_speed_kmh, 0.1, 300, DEFAULTS.vehicle_speed_kmh),
    saturation_headway_sec: clampNum(r.saturation_headway_sec, 0.1, 60, DEFAULTS.saturation_headway_sec),
    re_evaluate_interval_sec: clampNum(r.re_evaluate_interval_sec, 0.1, 3600, DEFAULTS.re_evaluate_interval_sec),
    lanes,
    streams,
    conflict_matrix: matrix8,
    fallback_sequence: fs,
    serial_port: typeof r.serial_port === 'string' ? r.serial_port : DEFAULTS.serial_port,
    baud_rate: clampInt(r.baud_rate, 1, 10000000, DEFAULTS.baud_rate),
    yolo_poll_interval_sec: clampNum(r.yolo_poll_interval_sec, 0.1, 3600, DEFAULTS.yolo_poll_interval_sec),
    _ui_meta: meta,
  }
  return { draft, original: r }
}

export function serializeConfig(draft, originalRaw) {
  const n = draft.streams.length
  const matrix8 = padMatrix(n, extractActiveMatrix(draft.conflict_matrix, n))
  const fs = (draft.fallback_sequence || []).map((ph) => ({
    active_streams: (ph.active_streams || []).filter((x) => Number.isInteger(x) && x >= 0 && x < n),
    duration_s: clampInt(ph.duration_s, 1, 600, 30),
  })).filter((ph) => ph.active_streams.length)
  const meta = draft._ui_meta || {}
  const lanes = syncLanes(meta)
  const base = { ...(originalRaw && typeof originalRaw === 'object' ? originalRaw : {}) }
  const outMeta = { ...meta }
  outMeta.rotatedPorts = normalizeRotatedPorts(outMeta)
  outMeta.version = 2
  delete outMeta.rotated45
  Object.assign(base, {
    min_green: clampInt(draft.min_green, 1, 600, DEFAULTS.min_green),
    max_extra_green: clampInt(draft.max_extra_green, 0, 600, DEFAULTS.max_extra_green),
    y_sec: Number(draft.y_sec),
    conflict_zone_meter: Number(draft.conflict_zone_meter),
    vehicle_speed_kmh: Number(draft.vehicle_speed_kmh),
    saturation_headway_sec: Number(draft.saturation_headway_sec),
    re_evaluate_interval_sec: Number(draft.re_evaluate_interval_sec),
    lanes: lanes.length ? lanes : Array.from({ length: n }, (_, i) => [i]),
    streams: draft.streams.map((s) => ({ lane_count: clampInt(s.lane_count, 1, 3, 1) })),
    conflict_matrix: matrix8,
    fallback_sequence: fs,
    serial_port: String(draft.serial_port ?? DEFAULTS.serial_port),
    baud_rate: clampInt(draft.baud_rate, 1, 10000000, DEFAULTS.baud_rate),
    yolo_poll_interval_sec: Number(draft.yolo_poll_interval_sec),
    _ui_meta: outMeta,
  })
  return base
}

export function portLabel(p) {
  return PORT_LABELS[p]
}

export function isIntercardinal(p) { return p % 2 === 1 }

export function pivotPortFor(p) {
  return isIntercardinal(p) ? p - 1 : null
}

export function basePortAngleDeg(p) { return p * 45 }

function toRadCW(deg) {
  return (deg - 90) * Math.PI / 180
}

function pointOnRing(cx, cy, r, deg) {
  const a = toRadCW(deg)
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }
}

export function getPortPosition(p, rotatedPorts, cx, cy, r) {
  const base = basePortAngleDeg(p)
  const rotated = isIntercardinal(p) && !!rotatedPorts?.[String(p)]
  if (!rotated) {
    const pt = pointOnRing(cx, cy, r, base)
    return { x: pt.x, y: pt.y, angleDeg: base, rotated: false, pivot: null }
  }
  const pivot = pivotPortFor(p)
  const pivotPt = pointOnRing(cx, cy, r, basePortAngleDeg(pivot))
  const arm = r * 0.2
  const swing = basePortAngleDeg(pivot) + 15
  const a = toRadCW(swing)
  const x = pivotPt.x + arm * Math.cos(a)
  const y = pivotPt.y + arm * Math.sin(a)
  return { x, y, angleDeg: base, rotated: true, pivot, pivotX: pivotPt.x, pivotY: pivotPt.y }
}

export function facingRotationDeg(p, rotatedPorts) {
  return (isIntercardinal(p) && !!rotatedPorts?.[String(p)]) ? 45 : 0
}

export function adjacentPort(p) { return (p + 1) % 8 }

export function activeStreamCount(meta) {
  return (meta?.streamPortMap || []).length
}

export function canAddRightTurn(draft) {
  return (draft._ui_meta.streamPortMap || []).length < 8
}

export function computeMaximalSafeSets(activeMatrix) {
  const n = activeMatrix.length
  const adj = Array.from({ length: n }, () => Array(n).fill(false))
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j && !activeMatrix[i][j]) adj[i][j] = true
  const results = []
  const all = new Set(Array.from({ length: n }, (_, i) => i))

  function intersect(a, b) { const r = new Set(); for (const x of a) if (b.has(x)) r.add(x); return r }
  function union(a, b) { const r = new Set(a); for (const x of b) r.add(x); return r }
  function neighbors(v) { const s = new Set(); for (let i = 0; i < n; i++) if (adj[v][i]) s.add(i); return s }

  function bronKerbosch(R, P, X) {
    if (P.size === 0 && X.size === 0) {
      results.push([...R].sort((a, b) => a - b))
      return
    }
    const uSet = union(P, X)
    let u = null, best = -1
    for (const cand of uSet) {
      let c = 0
      for (const v of P) if (adj[cand][v]) c++
      if (c > best) { best = c; u = cand }
    }
    const nu = u == null ? new Set() : neighbors(u)
    const candidates = [...P].filter((v) => !nu.has(v))
    for (const v of candidates) {
      const nv = neighbors(v)
      bronKerbosch(union(R, new Set([v])), intersect(P, nv), intersect(X, nv))
      P.delete(v)
      X.add(v)
    }
  }
  if (n > 0) bronKerbosch(new Set(), all, new Set())
  results.sort((a, b) => b.length - a.length || a.join(',').localeCompare(b.join(',')))
  return results
}

export function isSetSafe(activeMatrix, set) {
  for (let i = 0; i < set.length; i++) for (let j = i + 1; j < set.length; j++) {
    if (activeMatrix[set[i]]?.[set[j]]) return false
  }
  return true
}

export function clearanceSeconds(meters, kmh) {
  const m = Number(meters), k = Number(kmh)
  if (!Number.isFinite(m) || !Number.isFinite(k) || k <= 0) return null
  const mps = (k * 1000) / 3600
  if (mps <= 0) return null
  return m / mps
}

export function validateDraft(draft) {
  const errors = []
  const n = draft.streams?.length || 0
  if (n < 2) errors.push('Minimal 2 stream/titik aktif.')
  if (n > 8) errors.push('Maksimal 8 stream.')
  if (!Array.isArray(draft.conflict_matrix) || draft.conflict_matrix.length !== 8) errors.push('conflict_matrix harus 8x8.')
  ;(draft.streams || []).forEach((s, i) => { if (s.lane_count < 1 || s.lane_count > 3) errors.push(`Stream ${i}: lane_count 1..3.`) })
  if (!(Number(draft.vehicle_speed_kmh) > 0)) errors.push('vehicle_speed_kmh harus > 0.')
  if (!(Number(draft.conflict_zone_meter) > 0)) errors.push('conflict_zone_meter harus > 0.')
  ;(draft.fallback_sequence || []).forEach((ph, i) => {
    if (!(ph.duration_s > 0)) errors.push(`Fase ${i + 1}: durasi harus > 0.`)
    const am = extractActiveMatrix(draft.conflict_matrix, n)
    if (!isSetSafe(am, ph.active_streams || [])) errors.push(`Fase ${i + 1}: kombinasi stream konflik.`)
  })
  return errors
}

export function resetDependents(draft) {
  const n = draft.streams.length
  const nd = {
    ...draft,
    conflict_matrix: padMatrix(n, extractActiveMatrix(identity8(), n)),
    fallback_sequence: [],
  }
  nd.lanes = syncLanes(nd._ui_meta)
  return nd
}

export function buildStructuralSignature(meta, streams, lanes) {
  return JSON.stringify({ spm: meta.streamPortMap, rt: meta.rightTurn, pp: meta.pairedPort, rp: meta.rotatedPorts, n: streams.length, lanes })
}
