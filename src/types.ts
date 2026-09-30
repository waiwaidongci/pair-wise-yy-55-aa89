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

// 离线校订：排练现场收回、基于某一基线版本的整份校订快照
export interface OfflineRevision {
  id: string
  source: string
  baseVersionId: string
  revisedAt: string
  baseTrackNotes: Record<string, ScoreNote[]>
  trackNotes: Record<string, ScoreNote[]>
}

export interface NotePosition {
  trackId: string
  measure: number
  beat: number
  noteIndex: number
}

export type CandidateStatus = 'pending' | 'adopted' | 'skipped' | 'invalidated' | 'consistent'

export interface CandidateRevision {
  key: string
  position: NotePosition
  base: ScoreNote
  published: ScoreNote
  offline: ScoreNote
  status: CandidateStatus
}

export interface ConflictItem {
  key: string
  position: NotePosition
  base: ScoreNote
  published: ScoreNote
  offline: ScoreNote
  reason: string
}

export interface StructuralChange {
  trackId: string
  measure: number
  beat: number
  kind: 'added' | 'removed'
  detail: string
}

export type ImportLogColor = 'green' | 'blue' | 'gray' | 'red' | 'orange'

export interface ImportLog {
  id: string
  time: string
  color: ImportLogColor
  message: string
}

export type SessionStatus = 'editing' | 'completed'

export interface RevisionSession {
  id: string
  status: SessionStatus
  rawText: string
  source: string
  baseVersionId: string
  compareVersionId: string
  revisions: OfflineRevision[]
  candidates: CandidateRevision[]
  conflicts: ConflictItem[]
  structural: StructuralChange[]
  decisions: Record<string, 'adopted' | 'skipped'>
  logs: ImportLog[]
  createdAt: string
  updatedAt: string
}
