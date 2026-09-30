export interface ScoreNote {
  id: string
  key: string
  duration: 'q' | 'h' | '8'
  accidental?: '#' | 'b' | 'n'
  dynamic: 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff'
  tie: boolean
  expression: string
}

export interface Track {
  id: string
  name: string
  instrument: string
  clef: 'treble' | 'bass' | 'alto'
  transposition: number
  color: string
  notes: ScoreNote[]
}

export interface ScoreComment {
  id: string
  measure: number
  author: string
  content: string
  resolved: boolean
}

export interface ScoreVersion {
  id: string
  author: string
  time: string
  summary: string
  trackNotes: Record<string, ScoreNote[]>
}

export type NotePatch = Partial<Pick<ScoreNote, 'key' | 'duration' | 'accidental' | 'dynamic' | 'tie' | 'expression'>>

/** 一条离线校订：定位到某声部某小节的某个音符，patch 为要修改的字段 */
export interface CorrectionEntry {
  id: string
  trackId: string
  measure: number
  note: number
  patch: NotePatch
}

export type RevisionDecision = 'adopted' | 'rejected' | 'kept-current'

/** 一次校订导入会话：校订内容、对照的出版版本快照与已确认项都会被本地保留 */
export interface ImportSession {
  corrections: CorrectionEntry[]
  baselineVersionId: string
  baselineSnapshot: ScoreVersion
  decisions: Record<string, RevisionDecision>
  startedAt: string
}

export interface LogEntry {
  id: string
  time: string
  kind: 'import' | 'adopt' | 'reject' | 'conflict' | 'rebase' | 'version' | 'system'
  text: string
}
