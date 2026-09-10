import Session from './InterviewSession';
import { useState } from 'react';
import { Plus, Send, Sparkles, ArrowUpRight, MessagesSquare } from 'lucide-react';
import type { RecordMap } from '@nextoffer/core';
import { api, save, type ViewProps } from '../api';
import { Heading, Empty, Modal, Field, dateLabel } from '../components';
type Interview = RecordMap['interviews'];
export default function Interviews(props: ViewProps) {
  const { data, refresh, run, busy } = props;
  const [selected, setSelected] = useState(''),
    [creating, setCreating] = useState(false),
    [draft, setDraft] = useState({
      title: '',
      jobId: '',
      resumeId: '',
      mode: 'mock' as 'mock' | 'real',
    });
  const interview = data.interviews.find((i) => i.id === selected) || data.interviews[0];
  const reviewed = data.interviews.filter((i) => i.review);
  const dimensions = ['技术知识', '项目深度', '问题分析', '表达结构'];
  return (
    <>
      <Heading
        eyebrow="PRACTICE. REFLECT. GROW."
        title="每一次表达，都更进一步。"
        description="模拟练习或记录真实面试，让反馈成为下一次的准备。"
      >
        <button className="primary" onClick={() => setCreating(true)}>
          <Plus size={17} />
          新建面试
        </button>
      </Heading>
      <section className="ability-overview panel">
        <div>
          <p className="eyebrow">能力概览</p>
          <h2>从回答中，看见成长</h2>
          <p className="muted">
            {reviewed.length
              ? `基于 ${reviewed.length} 次已复盘面试`
              : '完成一次面试复盘后，开始积累评估。'}
          </p>
        </div>
        <div className="ability-bars">
          {dimensions.map((name) => {
            const scores = reviewed.flatMap((i) =>
              i
                .review!.dimensions.filter((d) => d.name === name && d.score !== null)
                .map((d) => d.score!),
            );
            const score = scores.length
              ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
              : null;
            return (
              <div className="ability" key={name}>
                <div>
                  <span>{name}</span>
                  <small>
                    {score === null ? '尚未评估' : `${score} / 100 · ${scores.length} 个样本`}
                  </small>
                </div>
                <div className="ability-track">
                  {score !== null && <span style={{ width: `${score}%` }} />}
                </div>
              </div>
            );
          })}
        </div>
      </section>
      <div className="interview-layout">
        <aside className="panel session-list">
          <div className="list-caption">
            面试记录<span>{data.interviews.length} 次</span>
          </div>
          {data.interviews.length ? (
            data.interviews.map((i) => (
              <button
                key={i.id}
                className={`note-item ${interview?.id === i.id ? 'selected' : ''}`}
                onClick={() => setSelected(i.id)}
              >
                <h3>{i.title}</h3>
                <p>
                  {data.jobs.find((j) => j.id === i.jobId)?.company || '自由练习'} ·{' '}
                  {i.mode === 'mock' ? '模拟面试' : '真实面试'}
                </p>
                <small>
                  {dateLabel(i.updatedAt)} · {i.status === 'completed' ? '已复盘' : '进行中'}
                </small>
              </button>
            ))
          ) : (
            <p className="list-empty">
              你的每一次练习
              <br />
              都会保留在这里。
            </p>
          )}
        </aside>
        <section className="panel conversation-panel">
          {interview ? (
            <Session key={interview.id} interview={interview} {...props} />
          ) : (
            <Empty
              title="给下一次面试，留一场预演"
              description="关联目标岗位与简历，从一道问题开始。也可以录入真实面试，回看表现。"
              action="开始第一场面试"
              onAction={() => setCreating(true)}
            />
          )}
        </section>
      </div>
      {creating && (
        <Modal title="新建面试" onClose={() => setCreating(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const item = await save('interviews', {
                  ...draft,
                  messages: [],
                  status: 'active',
                  review: null,
                });
                await refresh();
                setSelected(item.id);
                setCreating(false);
              });
            }}
          >
            <Field label="面试名称">
              <input
                required
                placeholder="例如：后端开发 · 一面练习"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </Field>
            <div className="form-grid">
              <Field label="记录类型">
                <select
                  value={draft.mode}
                  onChange={(e) => setDraft({ ...draft, mode: e.target.value as 'mock' | 'real' })}
                >
                  <option value="mock">模拟面试</option>
                  <option value="real">真实面试记录</option>
                </select>
              </Field>
              <Field label="关联岗位">
                <select
                  value={draft.jobId}
                  onChange={(e) => setDraft({ ...draft, jobId: e.target.value })}
                >
                  <option value="">自由练习</option>
                  {data.jobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.company} · {j.title}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="关联简历">
              <select
                value={draft.resumeId}
                onChange={(e) => setDraft({ ...draft, resumeId: e.target.value })}
              >
                <option value="">暂不关联</option>
                {data.resumes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title} · v{r.version}
                  </option>
                ))}
              </select>
            </Field>
            <div className="modal-actions">
              <button className="primary" disabled={busy}>
                创建面试
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
