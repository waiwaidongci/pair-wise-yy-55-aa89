import { useMemo, useState } from 'react'
import { Alert, Button, Card, Empty, Input, Popconfirm, Select, Space, Tag, Timeline, Tooltip, Divider, Tabs } from 'antd'
import { CheckOutlined, CloseOutlined, ThunderboltOutlined, WarningOutlined, DisconnectOutlined, HistoryOutlined } from '@ant-design/icons'
import { useDispatch, useSelector } from 'react-redux'
import type { AppDispatch, RootState } from '../store'
import { resolveComment } from '../store'
import {
  adoptAllCandidates,
  adoptCandidate,
  bakeRevision,
  buildSampleRevision,
  discardSession,
  dismissRecovery,
  recomputeForCompare,
  simulatePublishedChange,
  skipCandidate,
  parsePastedRevision,
  describeNoteChange,
} from '../revisionImport'
import type { CandidateRevision, ConflictItem, ScoreNote } from '../types'

const { TextArea } = Input

const DURATION_LABEL: Record<string, string> = { q: '四分', h: '二分', '8': '八分' }

function NoteSummary({ note }: { note: ScoreNote }) {
  return (
    <span className="note-summary">
      <b>{note.key.replace('/', '')}</b>
      <small>{DURATION_LABEL[note.duration] ?? note.duration} · {note.dynamic}{note.accidental ? ` · ${note.accidental}` : ''}{note.tie ? ' · 连音' : ''}{note.expression ? ` · ${note.expression}` : ''}</small>
    </span>
  )
}

function CandidateRow({ candidate, trackName }: { candidate: CandidateRevision; trackName: string }) {
  const dispatch = useDispatch<AppDispatch>()
  const diffs = describeNoteChange(candidate.base, candidate.offline)
  const statusTag = candidate.status === 'adopted'
    ? <Tag color="green">已采纳</Tag>
    : candidate.status === 'skipped'
      ? <Tag>已跳过</Tag>
      : <Tag color="blue">待确认</Tag>
  return (
    <div className={`candidate-row ${candidate.status !== 'pending' ? 'is-decided' : ''}`}>
      <div className="candidate-head">
        <Tag color="blue">{trackName}</Tag>
        <b>第 {candidate.position.measure} 小节 · 第 {candidate.position.beat} 拍</b>
        {statusTag}
      </div>
      <div className="candidate-body">
        <div className="candidate-change">
          {diffs.map((d) => (
            <span key={d.field} className="diff-field">
              <em>{d.field}</em>
              <span className="diff-from">{d.from}</span>
              <span className="diff-arrow">→</span>
              <span className="diff-to">{d.to}</span>
            </span>
          ))}
        </div>
        <div className="candidate-published">
          出版侧当前：<NoteSummary note={candidate.published} />
          {candidate.status === 'pending' && <span className="safe-hint">（出版侧未改，可安全采纳）</span>}
        </div>
      </div>
      {candidate.status === 'pending' && (
        <div className="candidate-actions">
          <Button size="small" type="primary" icon={<CheckOutlined />} onClick={() => dispatch(adoptCandidate(candidate.key))}>采纳</Button>
          <Button size="small" icon={<CloseOutlined />} onClick={() => dispatch(skipCandidate(candidate.key))}>跳过</Button>
        </div>
      )}
    </div>
  )
}

function ConflictCard({ conflict, trackName }: { conflict: ConflictItem; trackName: string }) {
  return (
    <div className="conflict-card">
      <div className="conflict-head">
        <Tag color="red" icon={<WarningOutlined />}>冲突 · 已停止</Tag>
        <Tag color="blue">{trackName}</Tag>
        <b>第 {conflict.position.measure} 小节 · 第 {conflict.position.beat} 拍</b>
      </div>
      <Alert type="error" showIcon message="同一处两边都已修改，不能覆盖" description={conflict.reason} style={{ margin: '8px 0' }} />
      <div className="three-way">
        <div className="three-way-col"><small>基线</small><NoteSummary note={conflict.base} /></div>
        <div className="three-way-col"><small>出版版本</small><NoteSummary note={conflict.published} /></div>
        <div className="three-way-col"><small>校订稿</small><NoteSummary note={conflict.offline} /></div>
      </div>
    </div>
  )
}

export default function Versions() {
  const dispatch = useDispatch<AppDispatch>()
  const { versions, comments, tracks, historyLogs } = useSelector((state: RootState) => state.score)
  const { session, recoverable, lastError } = useSelector((state: RootState) => state.revisionImport)

  const [rawText, setRawText] = useState('')
  const [compareId, setCompareId] = useState('current')

  const trackName = useMemo(() => (id: string) => tracks.find((t) => t.id === id)?.name ?? id, [tracks])
  const compareOptions = useMemo(() => [
    { value: 'current', label: '当前总谱（含未保存修改）' },
    ...versions.map((v) => ({ value: v.id, label: `${v.id} · ${v.author} · ${v.summary.slice(0, 12)}` })),
  ], [versions])

  const pendingCount = session?.candidates.filter((c) => c.status === 'pending').length ?? 0
  const adoptedCount = session?.candidates.filter((c) => c.status === 'adopted').length ?? 0
  const skippedCount = session?.candidates.filter((c) => c.status === 'skipped').length ?? 0

  const handleParse = (text: string, compare: string) => {
    dispatch(parsePastedRevision({ rawText: text, compareVersionId: compare, versions, currentTracks: tracks }))
  }

  const handleFillSample = () => {
    const sample = buildSampleRevision(tracks)
    setRawText(sample.rawText)
    setCompareId(sample.compareVersionId)
    handleParse(sample.rawText, sample.compareVersionId)
  }

  const handleCompareChange = (value: string) => {
    setCompareId(value)
    if (session) dispatch(recomputeForCompare({ compareVersionId: value, versions, currentTracks: tracks }))
  }

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">版本、评论与出版基线</p>
          <h1>差异比较与审阅</h1>
          <p>比较任意两个版本的音符变化，逐项接受或拒绝；排练场收回的离线校订粘贴进来后，与出版版本三方对照，位置没变的先形成候选，两边都改到同一处的停止并列出双方、禁止覆盖。</p>
        </div>
        <Button type="primary">锁定出版基线</Button>
      </div>

      {recoverable && session && (
        <Alert
          className="recovery-banner"
          type="warning"
          showIcon
          icon={<DisconnectOutlined />}
          message="检测到未完成的校订导入，已为你保留原版本与确认项"
          description={`导入中断或断网后自动保留：来源《${session.source}》，已确认采纳 ${session.decisions ? Object.values(session.decisions).filter((d) => d === 'adopted').length : 0} 项、跳过 ${Object.values(session.decisions).filter((d) => d === 'skipped').length} 项。恢复后可接着处理，不会覆盖出版版本。`}
          action={<Space><Button size="small" type="primary" onClick={() => dispatch(dismissRecovery())}>继续处理</Button><Popconfirm title="放弃本次未完成的校订导入？已确认项将被清除。" onConfirm={() => dispatch(discardSession())}><Button size="small">放弃导入</Button></Popconfirm></Space>}
        />
      )}

      <Tabs items={[
        {
          key: 'import',
          label: <span>校订导入{session ? `（${pendingCount} 待确认）` : ''}</span>,
          children: (
            <div className="import-grid">
              <Card title="① 粘贴排练场校订内容" className="import-paste">
                <p className="muted">排练现场收回的离线校订为 JSON 文本，粘贴到下方并选择对照的出版版本。系统以校订基线、出版版本、校订稿三方对齐：位置没变的小节和音符形成候选修订；同一处两边都改过的立即停止并列出双方内容，不能覆盖。</p>
                <TextArea
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  placeholder="粘贴校订 JSON，或点击下方「填入示例校订」查看演示…"
                  rows={8}
                  style={{ fontFamily: 'monospace', fontSize: 12 }}
                />
                {lastError && <Alert type="error" showIcon message={lastError} style={{ marginTop: 10 }} />}
                <Space style={{ marginTop: 12 }} wrap>
                  <Select value={session?.compareVersionId ?? compareId} style={{ width: 300 }} options={compareOptions} onChange={handleCompareChange} />
                  <Button type="primary" onClick={() => handleParse(rawText, session?.compareVersionId ?? compareId)} disabled={!rawText.trim()}>解析校订并对照</Button>
                  <Button icon={<ThunderboltOutlined />} onClick={handleFillSample}>填入示例校订</Button>
                  {session && <Popconfirm title="清空当前导入会话？未采用的候选与确认项将被清除。" onConfirm={() => dispatch(discardSession())}><Button>清空导入</Button></Popconfirm>}
                </Space>
              </Card>

              <Card
                title="② 候选修订与冲突"
                className="import-merge"
                extra={session && (
                  <Space wrap>
                    <Tag color="blue">候选 {session.candidates.length}</Tag>
                    <Tag color="red">冲突 {session.conflicts.length}</Tag>
                    <Tag>结构 {session.structural.length}</Tag>
                  </Space>
                )}
              >
                {!session && <Empty description="尚未导入校订内容" />}
                {session && (
                  <>
                    <Alert
                      type="info"
                      showIcon
                      style={{ marginBottom: 12 }}
                      message={`对照出版：${session.compareVersionId === 'current' ? '当前总谱（含未保存修改）' : session.compareVersionId}　·　校订基线：${session.baseVersionId}`}
                      description="切换对照的出版版本后，候选修订会立即失效并按新版本重新计算；已确认项若在新版本下变为冲突，将自动作废。"
                    />

                    {session.conflicts.length > 0 && (
                      <div className="merge-section">
                        <Divider orientation="left" orientationMargin={0}><Tag color="red" icon={<WarningOutlined />}>冲突 · {session.conflicts.length} 处（两边都改，禁止覆盖）</Tag></Divider>
                        {session.conflicts.map((c) => <ConflictCard key={c.key} conflict={c} trackName={trackName(c.position.trackId)} />)}
                      </div>
                    )}

                    <div className="merge-section">
                      <Divider orientation="left" orientationMargin={0}><Tag color="blue">候选修订 · {session.candidates.length} 处（位置未变，仅校订侧修改）</Tag></Divider>
                      {session.candidates.length === 0 && <Empty description="没有需要处理的候选修订" />}
                      {session.candidates.map((c) => <CandidateRow key={c.key} candidate={c} trackName={trackName(c.position.trackId)} />)}
                    </div>

                    {session.structural.length > 0 && (
                      <div className="merge-section">
                        <Divider orientation="left" orientationMargin={0}><Tag>结构变化 · {session.structural.length} 处（音符增删，需人工核对）</Tag></Divider>
                        {session.structural.map((s, i) => (
                          <div key={i} className="structural-row">
                            <Tag>{trackName(s.trackId)}</Tag>
                            <span>{s.detail}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="merge-bake">
                      <Space wrap>
                        <Button type="primary" icon={<CheckOutlined />} disabled={!pendingCount} onClick={() => dispatch(adoptAllCandidates())}>一键采纳剩余 {pendingCount} 项候选</Button>
                        <Tooltip title="把已采纳的修订写入总谱并形成新的出版版本；冲突项保持原样、绝不覆盖。采用结果与处理记录会留在版本历史中。">
                          <Button
                            type="primary"
                            ghost
                            icon={<HistoryOutlined />}
                            disabled={adoptedCount === 0}
                            onClick={() => dispatch(bakeRevision)}
                          >
                            采用 {adoptedCount} 项并形成新版本
                          </Button>
                        </Tooltip>
                        <Button icon={<ThunderboltOutlined />} onClick={() => dispatch(simulatePublishedChange)}>演示：出版侧排练后又改了总谱</Button>
                      </Space>
                      <p className="muted" style={{ marginTop: 10 }}>
                        已确认：采纳 {adoptedCount} · 跳过 {skippedCount} · 待处理 {pendingCount}。采用后处理记录写入「操作历史」，版本列表新增一条出版版本。
                      </p>
                    </div>
                  </>
                )}
              </Card>

              {session && session.logs.length > 0 && (
                <Card title="③ 本次导入处理记录" className="import-logs">
                  <Timeline items={session.logs.map((log) => ({ color: log.color, children: <span><small className="muted">{log.time}</small> {log.message}</span> }))} />
                </Card>
              )}
            </div>
          ),
        },
        {
          key: 'diff',
          label: '版本差异',
          children: <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 16 }}>{versions.slice(0, 2).map((version) => <Card key={version.id} title={<span>{version.id} · {version.author} <Tag>{version.time}</Tag></span>}><p>{version.summary}</p>{Object.entries(version.trackNotes).map(([trackId, notes]) => <div className="diff-row" key={trackId}><Tag color="red">修改</Tag><span>{trackName(trackId)}：力度由 mp 调整为 p，增加第 3 拍延音线</span><b>{notes.length} 个音符</b></div>)}<div className="diff-row"><Tag color="green">新增</Tag><span>换页处增加同声部提示音</span><b>2 小节</b></div></Card>)}</div>,
        },
        {
          key: 'comments',
          label: `评论锚点 (${comments.filter((item) => !item.resolved).length})`,
          children: <div style={{ display: 'grid', gridTemplateColumns: '1.3fr .7fr', gap: 16 }}><Card>{comments.map((comment) => <div key={comment.id} style={{ display: 'grid', gridTemplateColumns: '60px 1fr auto', gap: 12, padding: '14px 0', borderBottom: '1px solid #edf0f5' }}><Tag icon={<CheckOutlined />}>第 {comment.measure} 小节</Tag><div><b>{comment.author}</b><p>{comment.content}</p></div><div>{comment.resolved ? <Tag color="green">已解决</Tag> : <Button size="small" onClick={() => dispatch(resolveComment(comment.id))}>应用评论</Button>}</div></div>)}</Card><Card title="待决事项"><Alert type="warning" showIcon message="第 2 小节力度仍未统一" description="接受评论后会更新圆号分谱，但不会覆盖原始版本。" /><div style={{ display: 'flex', gap: 8, marginTop: 14 }}><Button type="primary" icon={<CheckOutlined />}>接受全部</Button><Button danger icon={<CloseOutlined />}>拒绝修改</Button></div></Card></div>,
        },
        {
          key: 'timeline',
          label: '操作历史',
          children: <Card title="版本历史与处理记录"><Timeline items={historyLogs.map((log) => ({ color: log.color, children: <span><small className="muted">{log.time}</small> {log.message}</span> }))} /></Card>,
        },
      ]} />
    </main>
  )
}
