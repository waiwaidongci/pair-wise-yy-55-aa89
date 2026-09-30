import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Input, Popconfirm, Select, Space, Tag, Tooltip } from 'antd'
import { CheckOutlined, CloseOutlined, StopOutlined } from '@ant-design/icons'
import { useDispatch, useSelector } from 'react-redux'
import type { AppDispatch, RootState } from '../store'
import { adoptAllCandidates, adoptCorrection, clearImportSession, importCorrections, keepCurrentRevision, rejectCorrection, setImportBaseline } from '../store'
import { FIELD_LABELS, SAMPLE_CORRECTIONS, changeSummary, deriveRevisions, fieldValueLabel, parseCorrections, type RevisionItem, type RevisionStatus } from '../revision'

const STATUS_META: Record<RevisionStatus, { color: string; label: string }> = {
  candidate: { color: 'processing', label: '候选修订' },
  conflict: { color: 'red', label: '冲突 · 需人工' },
  moved: { color: 'orange', label: '位置已变' },
  same: { color: 'default', label: '与现版一致' },
  invalid: { color: 'default', label: '无法对照' },
}

const DECISION_META = {
  adopted: { color: 'green', label: '已采用' },
  rejected: { color: 'default', label: '已驳回/忽略' },
  'kept-current': { color: 'purple', label: '已保留当前版本' },
} as const

const STATUS_RANK: Record<RevisionStatus, number> = { conflict: 0, candidate: 1, moved: 2, invalid: 3, same: 4 }

export default function RevisionImport() {
  const dispatch = useDispatch<AppDispatch>()
  const { tracks, versions, importSession } = useSelector((state: RootState) => state.score)
  const [text, setText] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [online, setOnline] = useState(() => navigator.onLine)

  useEffect(() => {
    const handleOnline = () => setOnline(true)
    const handleOffline = () => setOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => { window.removeEventListener('online', handleOnline); window.removeEventListener('offline', handleOffline) }
  }, [])

  // 候选修订是派生数据：出版版本或总谱一变即自动按最新数据重算
  const items = useMemo(() => (importSession ? deriveRevisions(importSession, tracks) : []), [importSession, tracks])
  const sorted = useMemo(() => [...items].sort((a, b) => {
    const aDone = a.decision ? 1 : 0
    const bDone = b.decision ? 1 : 0
    return aDone - bDone || STATUS_RANK[a.status] - STATUS_RANK[b.status]
  }), [items])
  const pending = items.filter((item) => !item.decision)
  const candidates = pending.filter((item) => item.status === 'candidate')
  const conflicts = pending.filter((item) => item.status === 'conflict')
  const moved = pending.filter((item) => item.status === 'moved' || item.status === 'invalid')
  const confirmed = items.length - pending.length

  const trackName = (trackId: string) => tracks.find((item) => item.id === trackId)?.name ?? trackId

  const handleImport = () => {
    const result = parseCorrections(text, tracks)
    setErrors(result.errors)
    if (!result.entries.length) return
    dispatch(importCorrections(result))
    setText('')
  }

  const baselineOptions = useMemo(() => {
    const options = versions.map((version) => ({ value: version.id, label: `${version.id} · ${version.author} · ${version.time}` }))
    if (importSession && !versions.some((version) => version.id === importSession.baselineVersionId)) {
      options.unshift({ value: importSession.baselineVersionId, label: `${importSession.baselineVersionId} · ${importSession.baselineSnapshot.author}（本地保留）` })
    }
    return options
  }, [versions, importSession])

  const renderItem = (item: RevisionItem) => {
    const meta = STATUS_META[item.status]
    const decision = item.decision ? DECISION_META[item.decision] : null
    const changedFields = item.fields.filter((field) => field.kind !== 'noop')
    return <div key={item.correction.id} className={`rev-item ${item.decision ? 'decided' : ''}`}>
      <div className="rev-head">
        <Tag color={decision ? decision.color : meta.color}>{decision ? decision.label : meta.label}</Tag>
        <b>{trackName(item.trackId)} · 第 {item.correction.measure} 小节第 {item.correction.note} 音</b>
        {item.status === 'candidate' && !item.decision && <span className="muted">{changeSummary(item)}</span>}
      </div>
      {item.status === 'conflict' && <div className="rev-body">
        <p style={{ margin: '4px 0 0' }}>同一位置校订内容与当前总谱都有修改，已暂停自动处理，不会覆盖任何一方：</p>
        <table className="rev-fields">
          <thead><tr><th>字段</th><th>校订内容</th><th>当前总谱</th><th>基线 {importSession?.baselineVersionId}</th><th>判定</th></tr></thead>
          <tbody>{changedFields.map((field) => <tr key={field.field}>
            <td>{FIELD_LABELS[field.field]}</td>
            <td>{fieldValueLabel(field.field, field.incoming)}</td>
            <td>{fieldValueLabel(field.field, field.current)}</td>
            <td>{fieldValueLabel(field.field, field.base)}</td>
            <td>{field.kind === 'both-changed' ? <Tag color="red">双方均改</Tag> : field.kind === 'current-changed' ? <Tag color="orange">当前已改</Tag> : <Tag color="green">可应用</Tag>}</td>
          </tr>)}</tbody>
        </table>
      </div>}
      {(item.status === 'moved' || item.status === 'invalid') && <div className="rev-body">{item.reason}</div>}
      {item.status === 'same' && <div className="rev-body">校订内容与当前总谱一致，无需处理。</div>}
      {item.status === 'candidate' && item.decision === 'adopted' && <div className="rev-body">已应用：{changeSummary(item)}</div>}
      {!item.decision && <div className="rev-actions">
        {item.status === 'candidate' && <>
          <Button size="small" type="primary" icon={<CheckOutlined />} disabled={!online} onClick={() => dispatch(adoptCorrection(item.correction.id))}>采用</Button>
          <Button size="small" icon={<CloseOutlined />} disabled={!online} onClick={() => dispatch(rejectCorrection(item.correction.id))}>驳回</Button>
        </>}
        {item.status === 'conflict' && <>
          <Button size="small" type="primary" disabled={!online} onClick={() => dispatch(keepCurrentRevision(item.correction.id))}>保留当前版本</Button>
          <Tooltip title="冲突项不能覆盖当前修改，请在总谱编辑中手动合并">
            <Button size="small" icon={<StopOutlined />} disabled>采用校订</Button>
          </Tooltip>
        </>}
        {(item.status === 'moved' || item.status === 'invalid' || item.status === 'same') &&
          <Button size="small" disabled={!online} onClick={() => dispatch(rejectCorrection(item.correction.id))}>忽略</Button>}
      </div>}
    </div>
  }

  return <div style={{ display: 'grid', gap: 16 }}>
    {!online && <Alert type="error" showIcon message="网络连接已断开" description="校订导入已暂停：已确认项与对照版本快照已保存在本地，网络恢复后可继续处理，不会丢失。" />}
    <Card title="1 · 粘贴离线校订">
      <p className="muted">粘贴排练现场收回的校订表（JSON 数组）。每条包含 trackId、measure（小节号）、note（小节内第几音）以及要修改的字段：key / duration / accidental / dynamic / tie / expression。</p>
      <Input.TextArea rows={7} value={text} onChange={(event) => setText(event.target.value)} placeholder='[{"trackId":"TR-03","measure":2,"note":1,"dynamic":"p"}]' style={{ fontFamily: 'monospace' }} />
      {errors.length > 0 && <Alert style={{ marginTop: 10 }} type="warning" showIcon message={`${errors.length} 条校订无法解析，已跳过`} description={<ul style={{ margin: 0, paddingLeft: 18 }}>{errors.map((error) => <li key={error}>{error}</li>)}</ul>} />}
      <Space style={{ marginTop: 10 }} wrap>
        <Button type="primary" disabled={!text.trim() || !online} onClick={handleImport}>{importSession ? '重新导入（沿用已确认项）' : '导入校订'}</Button>
        <Button onClick={() => setText(SAMPLE_CORRECTIONS)}>填入示例校订</Button>
        {importSession && <Popconfirm title="结束本次校订导入？" description="采用结果与处理记录会保留在操作历史中。" onConfirm={() => dispatch(clearImportSession())}><Button danger>结束导入</Button></Popconfirm>}
      </Space>
    </Card>
    {importSession && <>
      <Card title="2 · 选择对照的出版版本">
        <Space wrap>
          <Select value={importSession.baselineVersionId} style={{ width: 300 }} options={baselineOptions} onChange={(value) => dispatch(setImportBaseline(value))} />
          <Tag color="blue">对照基线 {importSession.baselineVersionId}</Tag>
          <span className="muted">{importSession.baselineSnapshot.author} · {importSession.baselineSnapshot.time} · {importSession.baselineSnapshot.summary}</span>
        </Space>
        <Alert style={{ marginTop: 12 }} type="info" showIcon message="出版版本更新或切换后，未确认的候选修订立即失效并按新版本重算；已确认项与处理记录保留。" />
      </Card>
      <Card
        title={`3 · 候选修订（${pending.length} 项待处理）`}
        extra={<Space><span className="muted">候选 {candidates.length} · 冲突 {conflicts.length} · 位置已变 {moved.length} · 已确认 {confirmed}</span><Button type="primary" disabled={!candidates.length || !online} onClick={() => dispatch(adoptAllCandidates())}>采用全部候选（{candidates.length}）</Button></Space>}
      >
        {conflicts.length > 0 && <Alert style={{ marginBottom: 12 }} type="error" showIcon message={`${conflicts.length} 处同一位置两边都有修改`} description="已暂停这些条目的自动处理并列出双方内容，不会覆盖当前总谱；请逐项确认。" />}
        {sorted.length === 0 && <p className="muted">没有可处理的校订条目。</p>}
        {sorted.map(renderItem)}
      </Card>
    </>}
  </div>
}
