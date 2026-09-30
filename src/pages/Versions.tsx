import { Card, Button, Tag, Tabs, Timeline, Alert } from 'antd'
import { CheckOutlined, CloseOutlined, CommentOutlined } from '@ant-design/icons'
import { useDispatch, useSelector } from 'react-redux'
import type { AppDispatch, RootState } from '../store'
import { resolveComment } from '../store'

export default function Versions() {
  const dispatch = useDispatch<AppDispatch>()
  const { versions, comments } = useSelector((state: RootState) => state.score)
  return <main className="page">
    <div className="page-head"><div><p className="eyebrow">版本、评论与出版基线</p><h1>差异比较与审阅</h1><p>比较任意两个版本的音符变化，逐项接受或拒绝，并将评论锚定到具体小节。</p></div><Button type="primary">锁定出版基线</Button></div>
    <Tabs items={[
      { key: 'diff', label: '版本差异', children: <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:16}}>{versions.slice(0,2).map((version)=><Card key={version.id} title={<span>{version.id} · {version.author} <Tag>{version.time}</Tag></span>}><p>{version.summary}</p>{Object.entries(version.trackNotes).map(([trackId,notes])=><div className="diff-row" key={trackId}><Tag color="red">修改</Tag><span>{trackId}：力度由 mp 调整为 p，增加第 3 拍延音线</span><b>{notes.length} 个音符</b></div>)}<div className="diff-row"><Tag color="green">新增</Tag><span>换页处增加同声部提示音</span><b>2 小节</b></div></Card>)}</div> },
      { key: 'comments', label: `评论锚点 (${comments.filter((item)=>!item.resolved).length})`, children: <div style={{display:'grid',gridTemplateColumns:'1.3fr .7fr',gap:16}}><Card>{comments.map((comment)=><div key={comment.id} style={{display:'grid',gridTemplateColumns:'60px 1fr auto',gap:12,padding:'14px 0',borderBottom:'1px solid #edf0f5'}}><Tag icon={<CommentOutlined />}>第 {comment.measure} 小节</Tag><div><b>{comment.author}</b><p>{comment.content}</p></div><div>{comment.resolved ? <Tag color="green">已解决</Tag> : <Button size="small" onClick={()=>dispatch(resolveComment(comment.id))}>应用评论</Button>}</div></div>)}</Card><Card title="待决事项"><Alert type="warning" showIcon message="第 2 小节力度仍未统一" description="接受评论后会更新圆号分谱，但不会覆盖原始版本。" /><div style={{display:'flex',gap:8,marginTop:14}}><Button type="primary" icon={<CheckOutlined />}>接受全部</Button><Button danger icon={<CloseOutlined />}>拒绝修改</Button></div></Card></div> },
      { key: 'timeline', label: '操作历史', children: <Card><Timeline items={[{color:'green',children:'16:28 沈青提交 v12：调整终段和声与连音线'},{color:'blue',children:'15:40 方亦修改圆号力度，生成本地草稿'},{color:'gray',children:'14:10 发布 v11：单簧管移调分谱'}]} /></Card> },
    ]} />
  </main>
}
