import type { CorrectionEntry, ImportSession, NotePatch, RevisionDecision, ScoreNote, Track } from './types'

/** 每小节音符数，与总谱编辑/分谱页的小节切分保持一致 */
export const MEASURE_SIZE = 4

export const FIELD_ORDER = ['key', 'duration', 'accidental', 'dynamic', 'tie', 'expression'] as const
export type PatchField = (typeof FIELD_ORDER)[number]

export const FIELD_LABELS: Record<PatchField, string> = {
  key: '音高', duration: '时值', accidental: '临时记号', dynamic: '力度', tie: '延音线', expression: '表情',
}

const DURATIONS = ['q', 'h', '8'] as const
const ACCIDENTALS = ['#', 'b', 'n'] as const
const DYNAMICS = ['pp', 'p', 'mp', 'mf', 'f', 'ff'] as const

export function fieldValueLabel(field: PatchField, value: unknown): string {
  if (value === undefined || value === null || value === '') return '（空）'
  if (field === 'duration') return ({ q: '四分音符', h: '二分音符', '8': '八分音符' } as Record<string, string>)[String(value)] ?? String(value)
  if (field === 'tie') return value ? '有' : '无'
  return String(value)
}

export type FieldKind = 'clean' | 'both-changed' | 'current-changed' | 'noop'

export interface FieldComparison {
  field: PatchField
  base: unknown
  current: unknown
  incoming: unknown
  kind: FieldKind
}

export type RevisionStatus = 'candidate' | 'conflict' | 'moved' | 'same' | 'invalid'

export interface RevisionItem {
  correction: CorrectionEntry
  trackId: string
  globalIndex: number
  status: RevisionStatus
  reason?: string
  fields: FieldComparison[]
  decision?: RevisionDecision
}

/** 校订条目 id 由内容决定：中断后重新粘贴同一张校订表时可沿用已确认项 */
export function correctionId(trackId: string, measure: number, note: number, patch: NotePatch): string {
  const norm = FIELD_ORDER.filter((f) => patch[f] !== undefined).map((f) => `${f}=${JSON.stringify(patch[f])}`).join('|')
  return `${trackId}#${measure}#${note}#${norm}`
}

export function parseCorrections(text: string, tracks: Track[]): { entries: CorrectionEntry[]; errors: string[] } {
  const errors: string[] = []
  const entries: CorrectionEntry[] = []
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    return { entries, errors: [`JSON 解析失败：${(error as Error).message}`] }
  }
  if (!Array.isArray(raw)) return { entries, errors: ['校订内容必须是 JSON 数组，每条包含 trackId / measure / note 及要修改的字段'] }
  const seen = new Map<string, number>()
  raw.forEach((row, index) => {
    const at = `第 ${index + 1} 条`
    if (typeof row !== 'object' || row === null) { errors.push(`${at}：不是有效的对象`); return }
    const record = row as Record<string, unknown>
    const trackId = String(record.trackId ?? record.track ?? '')
    const track = tracks.find((item) => item.id === trackId)
    if (!track) { errors.push(`${at}：声部 ${trackId || '（未填写 trackId）'} 不存在`); return }
    const measure = Number(record.measure ?? record.小节)
    const noteNo = Number(record.note ?? record.音 ?? record.音符)
    if (!Number.isInteger(measure) || measure < 1) { errors.push(`${at}：小节号无效`); return }
    if (!Number.isInteger(noteNo) || noteNo < 1) { errors.push(`${at}：音符序号无效`); return }
    const globalIndex = (measure - 1) * MEASURE_SIZE + (noteNo - 1)
    if (globalIndex >= track.notes.length) { errors.push(`${at}：${track.name} 第 ${measure} 小节第 ${noteNo} 音超出当前总谱范围`); return }
    const patch: NotePatch = {}
    const fieldErrors: string[] = []
    if (record.key !== undefined) {
      if (typeof record.key === 'string' && /^[a-g][#b]?\/\d$/.test(record.key)) patch.key = record.key
      else fieldErrors.push('音高格式应为 c/4、f#/3 等形式')
    }
    if (record.duration !== undefined) {
      if (typeof record.duration === 'string' && (DURATIONS as readonly string[]).includes(record.duration)) patch.duration = record.duration as ScoreNote['duration']
      else fieldErrors.push('时值仅支持 q / h / 8')
    }
    if (record.accidental !== undefined) {
      if (typeof record.accidental === 'string' && (ACCIDENTALS as readonly string[]).includes(record.accidental)) patch.accidental = record.accidental as ScoreNote['accidental']
      else fieldErrors.push('临时记号仅支持 # / b / n')
    }
    if (record.dynamic !== undefined) {
      if (typeof record.dynamic === 'string' && (DYNAMICS as readonly string[]).includes(record.dynamic)) patch.dynamic = record.dynamic as ScoreNote['dynamic']
      else fieldErrors.push('力度仅支持 pp / p / mp / mf / f / ff')
    }
    if (record.tie !== undefined) {
      if (typeof record.tie === 'boolean') patch.tie = record.tie
      else fieldErrors.push('延音线 tie 应为布尔值')
    }
    if (record.expression !== undefined) {
      if (typeof record.expression === 'string' && record.expression.length <= 24) patch.expression = record.expression
      else fieldErrors.push('表情标记应为不超过 24 字的文本')
    }
    if (fieldErrors.length) { errors.push(`${at}：${fieldErrors.join('；')}`); return }
    if (!FIELD_ORDER.some((f) => patch[f] !== undefined)) { errors.push(`${at}：未包含可应用的字段（支持 key / duration / accidental / dynamic / tie / expression）`); return }
    const id = correctionId(trackId, measure, noteNo, patch)
    const duplicate = seen.get(id)
    if (duplicate !== undefined) { errors.push(`${at}：与第 ${duplicate + 1} 条重复`); return }
    seen.set(id, index)
    entries.push({ id, trackId, measure, note: noteNo, patch })
  })
  return { entries, errors }
}

/**
 * 三方对照：对照版本（基线）× 当前总谱 × 校订内容。
 * 位置（音符 id）未变才形成候选；同一处两边都改过则为冲突，绝不自动覆盖。
 * 候选是派生结果：出版版本或总谱一变，重新调用即按最新数据重算。
 */
export function deriveRevisions(
  session: Pick<ImportSession, 'corrections' | 'baselineSnapshot' | 'decisions'>,
  tracks: Track[],
): RevisionItem[] {
  return session.corrections.map((correction) => {
    const globalIndex = (correction.measure - 1) * MEASURE_SIZE + (correction.note - 1)
    const decision = session.decisions[correction.id]
    const base: RevisionItem = { correction, trackId: correction.trackId, globalIndex, status: 'invalid', fields: [], decision }
    const track = tracks.find((item) => item.id === correction.trackId)
    if (!track) return { ...base, reason: '声部在当前总谱中不存在' }
    const baselineNotes = session.baselineSnapshot.trackNotes[correction.trackId]
    if (!baselineNotes) return { ...base, reason: `对照版本 ${session.baselineSnapshot.id} 缺少该声部，无法对照` }
    const currentNote = track.notes[globalIndex]
    const baselineNote = baselineNotes[globalIndex]
    if (!currentNote || !baselineNote || currentNote.id !== baselineNote.id) {
      return { ...base, status: 'moved', reason: '音符位置已变化（当前总谱与对照版本不一致），未形成候选，请人工核对' }
    }
    const fields: FieldComparison[] = FIELD_ORDER.filter((f) => correction.patch[f] !== undefined).map((field) => {
      const incoming = correction.patch[field]
      const baseValue = baselineNote[field]
      const currentValue = currentNote[field]
      const kind: FieldKind = incoming === currentValue ? 'noop'
        : baseValue === currentValue ? 'clean'
        : incoming === baseValue ? 'current-changed'
        : 'both-changed'
      return { field, base: baseValue, current: currentValue, incoming, kind }
    })
    const status: RevisionStatus = fields.some((f) => f.kind === 'both-changed' || f.kind === 'current-changed')
      ? 'conflict'
      : fields.some((f) => f.kind === 'clean')
        ? 'candidate'
        : 'same'
    return { ...base, status, fields }
  })
}

export function changeSummary(item: RevisionItem): string {
  return item.fields
    .filter((f) => f.kind === 'clean')
    .map((f) => `${FIELD_LABELS[f.field]} ${fieldValueLabel(f.field, f.current)} → ${fieldValueLabel(f.field, f.incoming)}`)
    .join('，')
}

/** 排练现场校订表示例：含候选、冲突、与现版一致及无法解析的条目 */
export const SAMPLE_CORRECTIONS = JSON.stringify([
  { trackId: 'TR-01', measure: 1, note: 3, key: 'f/5' },
  { trackId: 'TR-02', measure: 3, note: 2, dynamic: 'f', expression: 'marcato' },
  { trackId: 'TR-03', measure: 2, note: 1, dynamic: 'pp' },
  { trackId: 'TR-04', measure: 2, note: 4, key: 'b/2' },
  { trackId: 'TR-01', measure: 1, note: 1, dynamic: 'mp' },
  { trackId: 'TR-09', measure: 1, note: 1, dynamic: 'p' },
], null, 2)
