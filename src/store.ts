import { configureStore, createSlice, current, type PayloadAction } from '@reduxjs/toolkit'
import { createApi, fakeBaseQuery } from '@reduxjs/toolkit/query/react'
import type { CorrectionEntry, ImportSession, LogEntry, RevisionDecision, ScoreComment, ScoreNote, ScoreVersion, Track } from './types'
import { seedComments, seedLogs, seedTracks, seedVersions } from './mock'
import { changeSummary, deriveRevisions } from './revision'

const SESSION_KEY = 'yy55-revision-import'
const LOG_KEY = 'yy55-revision-log'

interface ScoreState {
  tracks: Track[]
  selectedTrackId: string
  selectedNoteIndex: number
  history: string[]
  future: string[]
  comments: ScoreComment[]
  versions: ScoreVersion[]
  dirty: boolean
  importSession: ImportSession | null
  logs: LogEntry[]
  adoptionsSinceSave: number
}

function loadJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function nowTime() { return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) }

const restoredSession = loadJSON<ImportSession>(SESSION_KEY)
const restoredLogs = loadJSON<LogEntry[]>(LOG_KEY)

const initialState: ScoreState = {
  tracks: structuredClone(seedTracks), selectedTrackId: 'TR-01', selectedNoteIndex: 2, history: [], future: [], comments: structuredClone(seedComments), versions: structuredClone(seedVersions), dirty: false,
  importSession: restoredSession,
  logs: restoredLogs ?? structuredClone(seedLogs),
  adoptionsSinceSave: 0,
}

// 导入中断/断网后恢复：原对照版本与已确认项都保留在本地会话里，接着处理
if (restoredSession) {
  const pending = restoredSession.corrections.filter((item) => !restoredSession.decisions[item.id]).length
  const confirmed = restoredSession.corrections.length - pending
  initialState.logs.unshift({ id: `LG-restore-${Date.now()}`, time: nowTime(), kind: 'system', text: `恢复未完成的校订导入：对照版本 ${restoredSession.baselineVersionId} 与 ${confirmed} 项确认结果已保留，${pending} 项待继续处理` })
}

function snapshot(state: ScoreState) { state.history.push(JSON.stringify(state.tracks)); if (state.history.length > 40) state.history.shift(); state.future = []; state.dirty = true; localStorage.setItem('yy55-score-draft', JSON.stringify({ tracks: state.tracks, comments: state.comments })) }
function pushLog(state: ScoreState, kind: LogEntry['kind'], text: string) {
  state.logs.unshift({ id: `LG-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, time: nowTime(), kind, text })
  if (state.logs.length > 120) state.logs.length = 120
  localStorage.setItem(LOG_KEY, JSON.stringify(state.logs))
}
function persistSession(state: ScoreState) {
  if (state.importSession) localStorage.setItem(SESSION_KEY, JSON.stringify(state.importSession))
  else localStorage.removeItem(SESSION_KEY)
}
function transposeKey(key: string, semitones: number) {
  const chromatic = ['c','c#','d','d#','e','f','f#','g','g#','a','a#','b']
  const [pitch, octaveText] = key.split('/')
  let index = chromatic.indexOf(pitch!.replace('b', '')) + semitones
  let octave = Number(octaveText)
  while (index < 0) { index += 12; octave -= 1 }
  while (index >= 12) { index -= 12; octave += 1 }
  return `${chromatic[index]}/${octave}`
}

const scoreSlice = createSlice({
  name: 'score',
  initialState,
  reducers: {
    selectTrack(state, action: PayloadAction<string>) { state.selectedTrackId = action.payload; state.selectedNoteIndex = 0 },
    selectNote(state, action: PayloadAction<number>) { state.selectedNoteIndex = action.payload },
    addNote(state) {
      snapshot(state); const track = state.tracks.find((item) => item.id === state.selectedTrackId)!; const template = track.notes[Math.min(track.notes.length - 1, state.selectedNoteIndex)]
      track.notes.splice(state.selectedNoteIndex + 1, 0, { id: `N-${Date.now()}`, key: template?.key ?? 'c/4', duration: 'q', dynamic: template?.dynamic ?? 'mf', tie: false, expression: '' }); state.selectedNoteIndex += 1
    },
    removeNote(state) { snapshot(state); const track = state.tracks.find((item) => item.id === state.selectedTrackId)!; if (track.notes.length > 1) track.notes.splice(state.selectedNoteIndex, 1); state.selectedNoteIndex = Math.max(0, state.selectedNoteIndex - 1) },
    updateNote(state, action: PayloadAction<Partial<ScoreNote>>) { snapshot(state); const track = state.tracks.find((item) => item.id === state.selectedTrackId)!; Object.assign(track.notes[state.selectedNoteIndex]!, action.payload) },
    transposeTrack(state, action: PayloadAction<number>) { snapshot(state); const track = state.tracks.find((item) => item.id === state.selectedTrackId)!; track.notes.forEach((note) => { note.key = transposeKey(note.key, action.payload) }); track.transposition += action.payload },
    undo(state) { const previous = state.history.pop(); if (!previous) return; state.future.push(JSON.stringify(state.tracks)); state.tracks = JSON.parse(previous); state.dirty = true },
    redo(state) { const next = state.future.pop(); if (!next) return; state.history.push(JSON.stringify(state.tracks)); state.tracks = JSON.parse(next); state.dirty = true },
    resolveComment(state, action: PayloadAction<string>) { const comment = state.comments.find((item) => item.id === action.payload); if (comment) comment.resolved = true; state.dirty = true },
    saveVersion(state) {
      const adopted = state.adoptionsSinceSave
      const version: ScoreVersion = { id: `v${state.versions.length + 13}`, author: '当前用户', time: nowTime(), summary: `保存当前总谱与分谱调整${adopted ? `（含 ${adopted} 项排练校订）` : ''}`, trackNotes: Object.fromEntries(state.tracks.map((track) => [track.id, structuredClone(current(track).notes)])) }
      state.versions.unshift(version)
      state.adoptionsSinceSave = 0
      pushLog(state, 'version', `形成版本 ${version.id}：${version.summary}`)
      // 出版版本一变，未确认的候选修订立即失效并按新版本重算（候选为派生数据，自动重算）
      if (state.importSession) {
        state.importSession.baselineVersionId = version.id
        state.importSession.baselineSnapshot = structuredClone(version)
        pushLog(state, 'rebase', `出版版本更新为 ${version.id}，候选修订已按新版本重算，已确认项保留`)
        persistSession(state)
      }
      state.dirty = false; localStorage.removeItem('yy55-score-draft')
    },
    restoreDraft(state) { const raw = localStorage.getItem('yy55-score-draft'); if (!raw) return; const draft = JSON.parse(raw); state.tracks = draft.tracks; state.comments = draft.comments; state.dirty = true },
    importCorrections(state, action: PayloadAction<{ entries: CorrectionEntry[]; errors: string[] }>) {
      const { entries, errors } = action.payload
      const previous = state.importSession
      const decisions: Record<string, RevisionDecision> = {}
      let carried = 0
      for (const entry of entries) {
        const kept = previous?.decisions[entry.id]
        if (kept) { decisions[entry.id] = kept; carried += 1 }
      }
      const baselineVersionId = previous?.baselineVersionId ?? state.versions[0]!.id
      const baselineSnapshot = previous?.baselineSnapshot ?? structuredClone(current(state.versions[0]!))
      state.importSession = { corrections: entries, baselineVersionId, baselineSnapshot, decisions, startedAt: previous?.startedAt ?? new Date().toISOString() }
      pushLog(state, 'import', `导入校订 ${entries.length} 项（对照 ${baselineVersionId}）${errors.length ? `，${errors.length} 条无法解析已跳过` : ''}${carried ? `，沿用 ${carried} 项已确认结果` : ''}`)
      persistSession(state)
    },
    setImportBaseline(state, action: PayloadAction<string>) {
      const session = state.importSession
      if (!session) return
      const version = state.versions.find((item) => item.id === action.payload)
      if (!version || version.id === session.baselineVersionId) return
      session.baselineVersionId = version.id
      session.baselineSnapshot = structuredClone(current(version))
      pushLog(state, 'rebase', `对照出版版本切换为 ${version.id}，候选修订已按新版本重算，已确认项保留`)
      persistSession(state)
    },
    adoptCorrection(state, action: PayloadAction<string>) {
      const session = state.importSession
      if (!session || session.decisions[action.payload]) return
      const item = deriveRevisions(session, state.tracks).find((entry) => entry.correction.id === action.payload)
      if (!item || item.status !== 'candidate') return
      snapshot(state)
      const track = state.tracks.find((entry) => entry.id === item.trackId)!
      const note = track.notes[item.globalIndex]! as unknown as Record<string, unknown>
      for (const field of item.fields) if (field.kind === 'clean') note[field.field] = field.incoming
      session.decisions[item.correction.id] = 'adopted'
      state.adoptionsSinceSave += 1
      pushLog(state, 'adopt', `采用校订 ${track.name} 第 ${item.correction.measure} 小节第 ${item.correction.note} 音：${changeSummary(item)}`)
      persistSession(state)
    },
    adoptAllCandidates(state) {
      const session = state.importSession
      if (!session) return
      const items = deriveRevisions(session, state.tracks).filter((entry) => entry.status === 'candidate' && !session.decisions[entry.correction.id])
      if (!items.length) return
      snapshot(state)
      for (const item of items) {
        const track = state.tracks.find((entry) => entry.id === item.trackId)!
        const note = track.notes[item.globalIndex]! as unknown as Record<string, unknown>
        for (const field of item.fields) if (field.kind === 'clean') note[field.field] = field.incoming
        session.decisions[item.correction.id] = 'adopted'
        state.adoptionsSinceSave += 1
        pushLog(state, 'adopt', `采用校订 ${track.name} 第 ${item.correction.measure} 小节第 ${item.correction.note} 音：${changeSummary(item)}`)
      }
      persistSession(state)
    },
    rejectCorrection(state, action: PayloadAction<string>) {
      const session = state.importSession
      if (!session || session.decisions[action.payload]) return
      const item = deriveRevisions(session, state.tracks).find((entry) => entry.correction.id === action.payload)
      if (!item) return
      session.decisions[item.correction.id] = 'rejected'
      const track = state.tracks.find((entry) => entry.id === item.trackId)
      pushLog(state, 'reject', `驳回校订 ${track?.name ?? item.trackId} 第 ${item.correction.measure} 小节第 ${item.correction.note} 音`)
      persistSession(state)
    },
    keepCurrentRevision(state, action: PayloadAction<string>) {
      const session = state.importSession
      if (!session || session.decisions[action.payload]) return
      const item = deriveRevisions(session, state.tracks).find((entry) => entry.correction.id === action.payload)
      if (!item || item.status !== 'conflict') return
      session.decisions[item.correction.id] = 'kept-current'
      const track = state.tracks.find((entry) => entry.id === item.trackId)
      pushLog(state, 'conflict', `冲突保留当前版本：${track?.name ?? item.trackId} 第 ${item.correction.measure} 小节第 ${item.correction.note} 音，校订内容未覆盖，可在总谱编辑中手动合并`)
      persistSession(state)
    },
    clearImportSession(state) {
      const session = state.importSession
      if (!session) return
      const adopted = Object.values(session.decisions).filter((decision) => decision === 'adopted').length
      pushLog(state, 'system', `校订导入结束：共 ${session.corrections.length} 项，采用 ${adopted} 项，驳回/忽略 ${Object.keys(session.decisions).length - adopted} 项`)
      state.importSession = null
      persistSession(state)
    },
  },
})

export const scoreApi = createApi({
  reducerPath: 'scoreApi',
  baseQuery: fakeBaseQuery(),
  endpoints: (builder) => ({
    getPublishingProfile: builder.query<{ title: string; publisher: string; pages: number; deadline: string }, void>({ queryFn: async () => ({ data: { title: '《潮汐线》室内交响作品', publisher: '云谱出版社', pages: 46, deadline: '2026-10-12' } }) }),
  }),
})

export const { selectTrack, selectNote, addNote, removeNote, updateNote, transposeTrack, undo, redo, resolveComment, saveVersion, restoreDraft, importCorrections, setImportBaseline, adoptCorrection, adoptAllCandidates, rejectCorrection, keepCurrentRevision, clearImportSession } = scoreSlice.actions
export const store = configureStore({ reducer: { score: scoreSlice.reducer, [scoreApi.reducerPath]: scoreApi.reducer }, middleware: (getDefault) => getDefault().concat(scoreApi.middleware) })
export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
