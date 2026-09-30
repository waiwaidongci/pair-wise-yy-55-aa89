import { Alert, Button, Card, Col, Progress, Row, Table, Tag } from 'antd'
import { useNavigate } from 'react-router-dom'
import { useSelector } from 'react-redux'
import type { RootState } from '../store'
import { scoreApi } from '../store'

export default function Overview() {
  const navigate = useNavigate()
  const tracks = useSelector((state: RootState) => state.score.tracks)
  const comments = useSelector((state: RootState) => state.score.comments)
  const { data } = scoreApi.endpoints.getPublishingProfile.useQuery()
  return <main className="page">
    <div className="page-head"><div><p className="eyebrow">乐谱、移调与出版准备</p><h1>{data?.title ?? '总谱出版工作台'}</h1><p>统一管理多声部总谱、移调乐器分谱、换页提示、版本差异与评论锚点。</p></div><Button type="primary" onClick={() => navigate('/score')}>进入总谱编辑</Button></div>
    <Row gutter={[14,14]} className="metrics"><Col xs={24} sm={12} xl={6}><Card className="metric"><span>声部数量</span><strong>{tracks.length}</strong><small>4 个乐手分谱</small></Card></Col><Col xs={24} sm={12} xl={6}><Card className="metric"><span>总谱小节</span><strong>12</strong><small>4/4 拍 · C 大调</small></Card></Col><Col xs={24} sm={12} xl={6}><Card className="metric"><span>待处理评论</span><strong>{comments.filter((item) => !item.resolved).length}</strong><small>指挥与作曲意见</small></Card></Col><Col xs={24} sm={12} xl={6}><Card className="metric"><span>预计页数</span><strong>{data?.pages ?? 46}</strong><small>交付 {data?.deadline ?? '2026-10-12'}</small></Card></Col></Row>
    <Alert type="warning" showIcon message="轮次差异需要处理" description="圆号第 2 小节力度与现行出版稿不一致；单簧管分谱第 6 小节换页提示尚未确认。" action={<Button size="small" onClick={() => navigate('/versions')}>查看差异</Button>} style={{ marginBottom: 16 }} />
    <Row gutter={[16,16]}><Col xs={24} xl={16}><Card title="声部与出版状态"><Table rowKey="id" pagination={false} dataSource={tracks} columns={[{title:'声部',dataIndex:'name'},{title:'乐器',dataIndex:'instrument'},{title:'移调',render:(_value,row)=><Tag color={row.transposition ? 'purple' : 'blue'}>{row.transposition ? `${row.transposition > 0 ? '+' : ''}${row.transposition} 半音` : '不移调'}</Tag>},{title:'小节',render:(_value,row)=>`${new Set(row.notes.map(note=>note.id.split('-')[1])).size} 组 / ${row.notes.length} 音`},{title:'状态',render:()=><Tag color="green">可排版</Tag>}]} /></Card></Col><Col xs={24} xl={8}><Card title="出版检查"><div className="check-row"><span>和弦拼写校验</span><b className="success">通过</b></div><div className="check-row"><span>节奏完整性</span><b className="success">通过</b></div><div className="check-row"><span>换页与提示音</span><b className="danger">2 项待处理</b></div><div className="check-row"><span>分谱移调</span><b className="success">已与总谱同步</b></div><Progress percent={82} strokeColor="#2563eb" /><p className="muted">完成全部评论处理后方可锁定出版版本。</p></Card></Col></Row>
  </main>
}
