import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { AppThunk } from './store'
import type { CandidateRevision, ConflictItem, ImportLog, ImportLogColor, OfflineRevision, RevisionSession, ScoreNote, ScoreVersion, StructuralChange, Track } from './types'

const STORAGE_KEY = 'yy55-revision-import'

// ---------- 持久化：中断 / 断网时保留原版本与确认项 ----------
function loadSession(): RevisionSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as RevisionSession
    if (parsed && parsed.status !== 'completed') return parsed
    return null
  } catch {
    return null
  }
}

function persist(session: RevisionSession | null) {
  try {
    if (session && session.status !== 'completed') localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* 隐私模式等场景下静默失败，不影响主流程 */
  }
}

function nowTime() {
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}
function uid(prefix: string) { return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}` }

// ---------- 音符比较与位置工具 ----------
export function noteEqual(a: ScoreNote, b: ScoreNote): boolean {
  return a.key === b.key && a.duration === b.duration && a.accidental === b.accidental
    && a.dynamic === b.dynamic && a.tie === b.tie && a.expression === b.expression
}

export function posKey(trackId: string, index: number) { return `${trackId}#${index}` }
export function measureOf(index: number) { return Math.floor(index / 4) + 1 }
export function beatOf(index: number) { return (index % 4) + 1 }

export interface NoteFieldDiff { field: string; from: string; to: string }

const DYNAMIC_LABEL: Record<string, string> = { pp: 'pp 很弱', p: 'p 弱', mp: 'mp 中弱', mf: 'mf 中强', f: 'f 强', ff: 'ff 很强' }

export function describeNoteChange(base: ScoreNote, next: ScoreNote): NoteFieldDiff[] {
  const diffs: NoteFieldDiff[] = []
  if (base.key !== next.key) diffs.push({ field: '音高', from: base.key.replace('/', ''), to: next.key.replace('/', '') })
  if (base.duration !== next.duration) diffs.push({ field: '时值', from: base.duration, to: next.duration })
  if (base.accidental !== next.accidental) diffs.push({ field: '临时记号', from: base.accidental ?? '还原', to: next.accidental ?? '还原' })
  if (base.dynamic !== next.dynamic) diffs.push({ field: '力度', from: DYNAMIC_LABEL[base.dynamic] ?? base.dynamic, to: DYNAMIC_LABEL[next.dynamic] ?? next.dynamic })
  if (base.tie !== next.tie) diffs.push({ field: '延音线', from: base.tie ? '有' : '无', to: next.tie ? '有' : '无' })
  if (base.expression !== next.expression) diffs.push({ field: '表情', from: base.expression || '无', to: next.expression || '无' })
  return diffs
}

// ---------- 三方合并：基线 / 出版侧 / 校订侧 ----------
export interface MergeResult {
  candidates: CandidateRevision[]
  conflicts: ConflictItem[]
  structural: StructuralChange[]
  consistent: number
}

export function computeMerge(
  base: Record<string, ScoreNote[]>,
  published: Record<string, ScoreNote[]>,
  offline: Record<string, ScoreNote[]>,
): MergeResult {
  const candidates: CandidateRevision[] = []
  const conflicts: ConflictItem[] = []
  const structural: StructuralChange[] = []
  let consistent = 0

  const trackIds = new Set([...Object.keys(base), ...Object.keys(offline), ...Object.keys(published)])
  for (const trackId of trackIds) {
    const b = base[trackId] ?? []
    const p = published[trackId] ?? []
    const o = offline[trackId] ?? []
    const maxLen = Math.max(b.length, p.length, o.length)
    for (let i = 0; i < maxLen; i++) {
      const hasB = i < b.length
      const hasO = i < o.length
      const hasP = i < p.length
      // 位置本身发生增删：无法按小节/音符对齐，归入结构变化人工复核
      if (!hasB && hasO) {
        structural.push({ trackId, measure: measureOf(i), beat: beatOf(i), kind: 'added', detail: `校订稿新增第 ${measureOf(i)} 小节第 ${beatOf(i)} 拍音符` })
        continue
      }
      if (hasB && !hasO) {
        structural.push({ trackId, measure: measureOf(i), beat: beatOf(i), kind: 'removed', detail: `校订稿删除第 ${measureOf(i)} 小节第 ${beatOf(i)} 拍音符` })
        continue
      }
      if (!hasB && !hasO) continue
      const bn = b[i]!
      const on = o[i]!
      // 校订侧未改动该位置：不产生候选
      if (noteEqual(on, bn)) continue

      const position = { trackId, measure: measureOf(i), beat: beatOf(i), noteIndex: i }
      if (!hasP) {
        // 出版侧已删除该位置，校订侧又改了：两边都动过，停止并列出
        conflicts.push({ key: posKey(trackId, i), position, base: bn, published: bn, offline: on, reason: '出版版本已删除该音符位置，校订稿却做了修改' })
        continue
      }
      const pn = p[i]!
      const pubChanged = !noteEqual(pn, bn)
      if (!pubChanged) {
        // 只有校订侧改、出版侧未动：安全候选
        candidates.push({ key: posKey(trackId, i), position, base: bn, published: pn, offline: on, status: 'pending' })
      } else if (noteEqual(pn, on)) {
        // 双方改成一致：无需覆盖
        consistent += 1
      } else {
        // 同一处两边都改且不一致：冲突，禁止覆盖
        conflicts.push({ key: posKey(trackId, i), position, base: bn, published: pn, offline: on, reason: '出版版本与校订稿对同一音符的修改不一致' })
      }
    }
  }
  return { candidates, conflicts, structural, consistent }
}

// 生成一份示例离线校订：以当前总谱为对照，构造 2 处两边都改的冲突与 5 处仅校订侧改动的候选
export function buildSampleRevision(currentTracks: Track[]): { rawText: string; compareVersionId: string } {
  const clone = () => Object.fromEntries(currentTracks.map((t) => [t.id, structuredClone(t.notes)]))
  const base = clone()
  // 排练基线：把出版侧在排练后改过的 2 个音符回退，形成“旧基线”
  base['TR-01']![1]!.key = 'c/5'
  base['TR-03']![2]!.key = 'b/3'
  const revised = clone()
  // 校订侧改动
  revised['TR-01']![1]!.key = 'e/5'        // 与出版侧 d/5 冲突
  revised['TR-03']![2]!.key = 'd/4'        // 与出版侧 c/4 冲突
  revised['TR-02']![5]!.key = 'g/4'        // 候选
  revised['TR-04']![7]!.key = 'a/3'        // 候选
  revised['TR-01']![9]!.key = 'g/5'        // 候选
  revised['TR-02']![0]!.dynamic = 'f'      // 候选
  revised['TR-03']![4]!.key = 'f/4'        // 候选
  const obj = {
    source: '排练场 · 09-29 晚场',
    baseVersionId: 'v12',
    revisedAt: '2026-09-29 21:40',
    baseTrackNotes: base,
    trackNotes: revised,
  }
  return { rawText: JSON.stringify(obj, null, 2), compareVersionId: 'current' }
}

// 解析粘贴的校订 JSON
export function parseRevisionText(rawText: string): { revision: OfflineRevision; error?: undefined } | { revision?: undefined; error: string } {
  let obj: unknown
  try {
    obj = JSON.parse(rawText)
  } catch {
    return { error: '无法解析 JSON：请粘贴排练场导出的校订内容（JSON 格式）。' }
  }
  const o = obj as Record<string, unknown>
  const trackNotes = o.trackNotes as Record<string, ScoreNote[]> | undefined
  if (!trackNotes || typeof trackNotes !== 'object') return { error: '校订内容缺少 trackNotes 字段。' }
  const baseTrackNotes = (o.baseTrackNotes as Record<string, ScoreNote[]> | undefined) ?? trackNotes
  const revision: OfflineRevision = {
    id: uid('OFF'),
    source: String(o.source ?? '排练场校订'),
    baseVersionId: String(o.baseVersionId ?? 'v12'),
    revisedAt: String(o.revisedAt ?? nowTime()),
    baseTrackNotes,
    trackNotes,
  }
  return { revision }
}

// 对照出版版本解析：选中版本有该声部用版本，否则回退到当前总谱
export function resolvePublishedNotes(
  compareVersionId: string,
  versions: ScoreVersion[],
  currentTracks: Track[],
): Record<string, ScoreNote[]> {
  const current = Object.fromEntries(currentTracks.map((t) => [t.id, t.notes]))
  if (compareVersionId === 'current') return current
  const version = versions.find((v) => v.id === compareVersionId)
  if (!version) return current
  return Object.fromEntries(currentTracks.map((t) => [t.id, version.trackNotes[t.id] ?? t.notes]))
}

function makeLog(color: ImportLogColor, message: string): ImportLog {
  return { id: uid('LOG'), time: nowTime(), color, message }
}

interface RevisionImportState {
  session: RevisionSession | null
  recoverable: boolean
  lastError: string | null
}

const persisted = loadSession()
const initialState: RevisionImportState = {
  session: persisted,
  recoverable: !!persisted,
  lastError: null,
}

const revisionImportSlice = createSlice({
  name: 'revisionImport',
  initialState,
  reducers: {
    parsePastedRevision(state, action: PayloadAction<{ rawText: string; compareVersionId: string; versions: ScoreVersion[]; currentTracks: Track[] }>) {
      const { rawText, compareVersionId, versions, currentTracks } = action.payload
      const parsed = parseRevisionText(rawText)
      if (parsed.error) {
        state.lastError = parsed.error
        return
      }
      const revision = parsed.revision!
      const published = resolvePublishedNotes(compareVersionId, versions, currentTracks)
      const merge = computeMerge(revision.baseTrackNotes, published, revision.trackNotes)
      const session: RevisionSession = {
        id: uid('SES'),
        status: 'editing',
        rawText,
        source: revision.source,
        baseVersionId: revision.baseVersionId,
        compareVersionId,
        revisions: [revision],
        candidates: merge.candidates,
        conflicts: merge.conflicts,
        structural: merge.structural,
        decisions: {},
        logs: [
          makeLog('blue', `导入校订《${revision.source}》：基线 ${revision.baseVersionId}，对照出版 ${compareVersionId === 'current' ? '当前总谱（含未保存修改）' : compareVersionId}`),
          makeLog('green', `位置对齐完成：${merge.candidates.length} 处候选修订，${merge.conflicts.length} 处冲突（已停止，禁止覆盖），${merge.structural.length} 处结构变化，${merge.consistent} 处双方一致`),
        ],
        createdAt: nowTime(),
        updatedAt: nowTime(),
      }
      state.session = session
      state.recoverable = false
      state.lastError = null
      persist(session)
    },

    // 出版版本一变：候选立即失效并按新版本重算，已确认项若不再安全则作废
    recomputeForCompare(state, action: PayloadAction<{ compareVersionId: string; versions: ScoreVersion[]; currentTracks: Track[] }>) {
      const session = state.session
      if (!session) return
      const { compareVersionId, versions, currentTracks } = action.payload
      const revision = session.revisions[0]!
      const published = resolvePublishedNotes(compareVersionId, versions, currentTracks)
      const merge = computeMerge(revision.baseTrackNotes, published, revision.trackNotes)

      const validKeys = new Set(merge.candidates.map((c) => c.key))
      const invalidated: string[] = []
      const decisions = { ...session.decisions }
      for (const key of Object.keys(decisions)) {
        if (!validKeys.has(key)) {
          invalidated.push(key)
          delete decisions[key]
        }
      }
      // 保留仍有效候选的既有决定，其余候选重置为待处理
      merge.candidates.forEach((c) => {
        if (decisions[c.key] === 'adopted') c.status = 'adopted'
        else if (decisions[c.key] === 'skipped') c.status = 'skipped'
        else c.status = 'pending'
      })

      session.compareVersionId = compareVersionId
      session.candidates = merge.candidates
      session.conflicts = merge.conflicts
      session.structural = merge.structural
      session.decisions = decisions
      session.updatedAt = nowTime()
      session.logs.push(makeLog('orange', `对照出版版本切换为 ${compareVersionId === 'current' ? '当前总谱' : compareVersionId}，候选已按新版本重算：${merge.candidates.length} 处候选、${merge.conflicts.length} 处冲突`))
      invalidated.forEach((key) => session.logs.push(makeLog('red', `原确认项 ${key} 在新版本下变为冲突或已失效，决定作废，需重新确认`)))
      persist(session)
    },

    adoptCandidate(state, action: PayloadAction<string>) {
      const session = state.session
      if (!session) return
      const candidate = session.candidates.find((c) => c.key === action.payload)
      if (!candidate || candidate.status === 'adopted') return
      candidate.status = 'adopted'
      session.decisions[candidate.key] = 'adopted'
      session.updatedAt = nowTime()
      session.logs.push(makeLog('green', `采纳 ${candidate.position.trackId} 第 ${candidate.position.measure} 小节第 ${candidate.position.beat} 拍修订`))
      persist(session)
    },

    skipCandidate(state, action: PayloadAction<string>) {
      const session = state.session
      if (!session) return
      const candidate = session.candidates.find((c) => c.key === action.payload)
      if (!candidate || candidate.status === 'skipped') return
      candidate.status = 'skipped'
      session.decisions[candidate.key] = 'skipped'
      session.updatedAt = nowTime()
      session.logs.push(makeLog('gray', `跳过 ${candidate.position.trackId} 第 ${candidate.position.measure} 小节第 ${candidate.position.beat} 拍修订`))
      persist(session)
    },

    adoptAllCandidates(state) {
      const session = state.session
      if (!session) return
      let count = 0
      session.candidates.forEach((c) => {
        if (c.status === 'pending') { c.status = 'adopted'; session.decisions[c.key] = 'adopted'; count += 1 }
      })
      if (count) session.logs.push(makeLog('green', `一键采纳全部 ${count} 处待处理候选修订`))
      session.updatedAt = nowTime()
      persist(session)
    },

    discardSession(state) {
      state.session = null
      state.recoverable = false
      state.lastError = null
      persist(null)
    },

    dismissRecovery(state) {
      state.recoverable = false
      persist(null)
    },

    markCompleted(state) {
      if (!state.session) return
      state.session.status = 'completed'
      state.session.updatedAt = nowTime()
      persist(null)
      state.session = null
      state.recoverable = false
    },

    setLastError(state, action: PayloadAction<string | null>) {
      state.lastError = action.payload
    },
  },
})

export const {
  parsePastedRevision,
  recomputeForCompare,
  adoptCandidate,
  skipCandidate,
  adoptAllCandidates,
  discardSession,
  dismissRecovery,
  markCompleted,
  setLastError,
} = revisionImportSlice.actions

// ---------- 采用：把确认项落到总谱并形成新版本，处理记录留在版本历史 ----------
export const bakeRevision: AppThunk = (dispatch, getState) => {
  const state = getState()
  const session = state.revisionImport.session
  if (!session) return
  const adopted = session.candidates.filter((c) => c.status === 'adopted')
  const skipped = session.candidates.filter((c) => c.status === 'skipped')
  const changes = adopted.map((c) => ({ trackId: c.position.trackId, index: c.position.noteIndex, note: c.offline }))

  const summary = `采纳排练场校订 ${adopted.length} 项，跳过 ${skipped.length} 项，冲突 ${session.conflicts.length} 项未覆盖`
  const logs: ImportLog[] = [
    makeLog('green', `校订采用完成：${adopted.length} 项修订写入总谱并形成新版本，${skipped.length} 项跳过，${session.conflicts.length} 处冲突保持原样未覆盖`),
    ...adopted.map((c) => makeLog('green', `已写入 ${c.position.trackId} 第 ${c.position.measure} 小节第 ${c.position.beat} 拍`)),
    ...session.conflicts.map((c) => makeLog('red', `冲突未覆盖：${c.position.trackId} 第 ${c.position.measure} 小节 —— ${c.reason}`)),
  ]

  dispatch({ type: 'score/applyRevisionChanges', payload: { changes } })
  dispatch({ type: 'score/saveVersionAs', payload: { summary, author: '当前用户' } })
  dispatch({ type: 'score/appendHistoryLogs', payload: logs })
  dispatch(markCompleted())
}

// 演示：排练后出版侧又改了总谱（候选因此失效，需按新版本重算）
export const simulatePublishedChange: AppThunk = (dispatch, getState) => {
  const before = getState()
  const session = before.revisionImport.session
  if (!session) return
  const target = session.candidates.find((c) => c.key === 'TR-04#7') ?? session.candidates[0]
  if (!target) return
  // 选一个既不同于基线、也不同于校订侧的音，使该候选在重算后变为冲突（两边都改）
  const keys = ['c/4','d/4','e/4','f/4','g/4','a/4','b/4','c/5','d/5','e/5','f/5','g/5','a/5','b/5','c/6']
  const nextKey = keys.find((k) => k !== target.offline.key && k !== target.published.key) ?? 'c/4'
  const publishedNote: ScoreNote = { ...target.published, key: nextKey }
  dispatch({ type: 'score/applyRevisionChanges', payload: { changes: [{ trackId: target.position.trackId, index: target.position.noteIndex, note: publishedNote }] } })
  dispatch({ type: 'score/saveVersionAs', payload: { summary: '排练后出版侧修订（圆号声部微调）', author: '出版 · 赵晴' } })
  dispatch({ type: 'score/appendHistoryLogs', payload: [makeLog('orange', `出版侧在排练后修改了 ${target.position.trackId} 第 ${target.position.measure} 小节，候选修订按新版本重算`) ] })
  const after = getState()
  dispatch(recomputeForCompare({ compareVersionId: session.compareVersionId, versions: after.score.versions, currentTracks: after.score.tracks }))
}

export default revisionImportSlice.reducer
