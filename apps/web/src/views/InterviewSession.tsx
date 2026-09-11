import { useState } from 'react';
import { Send, Sparkles, ArrowUpRight, MessagesSquare, Trash2, Undo2, Pencil } from 'lucide-react';
import type { RecordMap } from '@nextoffer/core';
import { api, save, remove, type ViewProps } from '../api';
import { Empty } from '../components';
type Interview = RecordMap['interviews'];
export default function Session({
  interview,
  data,
  refresh,
  run,
  busy,
}: { interview: Interview } & ViewProps) {
  const [content, setContent] = useState(''),
    [role, setRole] = useState<'candidate' | 'interviewer'>('candidate'),
    [tab, setTab] = useState('conversation'),
    [editingId, setEditingId] = useState('');
  const review = interview.review;
  return (
    <>
      <div className="session-header">
        <div>
          <h2>{interview.title}</h2>
          <p className="muted">
            {interview.mode === 'mock' ? '模拟面试' : '真实面试记录'} ·{' '}
            {interview.messages.filter((m) => m.role === 'candidate').length} 次回答
          </p>
        </div>
        <div className="filter-pills">
          <button
            className={tab === 'conversation' ? 'selected' : ''}
            onClick={() => setTab('conversation')}
          >
            对话
          </button>
          <button className={tab === 'review' ? 'selected' : ''} onClick={() => setTab('review')}>
            复盘
          </button>
        </div>
      </div>
      {tab === 'review' ? (
        review ? (
          <div className="review-content">
            <h3>本次复盘</h3>
            <p className="prose">{review.summary}</p>
            <div className="form-grid">
              <section>
                <h3>表现亮点</h3>
                <ul>
                  {review.strengths.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </section>
              <section>
                <h3>下一步练习</h3>
                <ul>
                  {review.improvements.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </section>
            </div>
            {review.dimensions.map((d) => (
              <div className="review-dimension" key={d.name}>
                <strong>{d.name}</strong>
                <span>{d.score === null ? '尚未评估' : `${d.score} / 100`}</span>
                {d.evidence.map((id, i) => {
                  const message = interview.messages.find((m) => m.id === id);
                  return (
                    <button
                      key={i}
                      className="evidence"
                      onClick={() => {
                        setTab('conversation');
                        setTimeout(
                          () =>
                            document
                              .getElementById(`message-${id}`)
                              ?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
                          20,
                        );
                      }}
                    >
                      {message ? message.content : `回答 ${id}`}
                      <ArrowUpRight size={14} />
                    </button>
                  );
                })}
              </div>
            ))}
            <p className="hint">评分仅反映已有回答的 AI 评价；无证据的维度不计分。</p>
          </div>
        ) : (
          <Empty title="先表达，再回看" description="保存回答后生成复盘，反馈会关联到具体证据。" />
        )
      ) : (
        <div className="messages">
          {interview.messages.length ? (
            interview.messages.map((m, i) => (
              <article id={`message-${m.id}`} key={m.id} className={`message ${m.role}`}>
                <div className="message-label">
                  <span className="speaker-mark">
                    {m.role === 'candidate' ? '我' : <MessagesSquare size={14} />}
                  </span>
                  {m.role === 'candidate' ? '我的回答' : '面试官'}
                  <small>{String(i + 1).padStart(2, '0')}</small>
                  {interview.status === 'active' && (
                    <button
                      className="icon-button"
                      aria-label={`编辑第 ${i + 1} 条记录`}
                      onClick={() => {
                        setEditingId(m.id);
                        setContent(m.content);
                        setRole(m.role);
                      }}
                    >
                      <Pencil size={13} />
                    </button>
                  )}
                </div>
                <div className="prose">{m.content}</div>
              </article>
            ))
          ) : (
            <div className="conversation-start">
              <MessagesSquare size={30} strokeWidth={1.3} />
              <h3>
                {interview.mode === 'mock'
                  ? '准备好了，就开始吧。'
                  : '把面试中的问题与回答记下来。'}
              </h3>
              <p>
                {interview.mode === 'mock'
                  ? '可以手动记录，也可以让模型根据岗位和简历出题。'
                  : '按发言角色保存问题和回答，完成后生成复盘。'}
              </p>
            </div>
          )}
        </div>
      )}
      <div className="session-actions">
        {interview.mode === 'mock' && (
          <button
            disabled={busy || interview.status === 'completed'}
            onClick={() =>
              void run(async () => {
                await api('/ai/question', { id: interview.id, revision: interview.revision });
                await refresh();
                setTab('conversation');
              })
            }
          >
            <Sparkles size={15} />
            {interview.messages.length ? '生成下一题' : '生成第一题'}
          </button>
        )}
        <button
          disabled={busy || !interview.messages.some((m) => m.role === 'candidate')}
          onClick={() =>
            void run(async () => {
              await api('/ai/review', { id: interview.id, revision: interview.revision });
              await refresh();
              setTab('review');
            })
          }
        >
          <Sparkles size={15} />
          {review ? '重新生成复盘' : '结束并生成复盘'}
        </button>
        {interview.status === 'completed' && (
          <button
            disabled={busy}
            onClick={() => {
              if (window.confirm('重新打开记录？现有复盘将清除，修改后可重新生成。'))
                void run(async () => {
                  await save('interviews', { ...interview, status: 'active', review: null });
                  await refresh();
                  setTab('conversation');
                });
            }}
          >
            <Undo2 size={15} />
            重新打开
          </button>
        )}
        <button
          className="danger"
          disabled={busy}
          onClick={() => {
            if (window.confirm(`删除「${interview.title}」及其对话和复盘？`))
              void run(async () => {
                await remove('interviews', interview.id, interview.revision);
                await refresh();
              });
          }}
        >
          <Trash2 size={15} />
          删除记录
        </button>
      </div>
      {interview.status !== 'completed' && (
        <form
          className="message-composer"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await save('interviews', {
                ...interview,
                review: null,
                messages: editingId
                  ? interview.messages.map((m) =>
                      m.id === editingId ? { ...m, role, content } : m,
                    )
                  : [...interview.messages, { id: crypto.randomUUID(), role, content }],
              });
              setContent('');
              setEditingId('');
              await refresh();
            });
          }}
        >
          <textarea
            aria-label="面试记录内容"
            rows={3}
            required
            placeholder={
              role === 'candidate'
                ? '写下你的回答，可以按背景、行动、结果组织…'
                : '记录面试官的问题…'
            }
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          <div>
            <select
              aria-label="发言角色"
              value={role}
              onChange={(e) => setRole(e.target.value as typeof role)}
            >
              <option value="candidate">我的回答</option>
              <option value="interviewer">面试官问题</option>
            </select>
            <button className="primary" disabled={busy}>
              <Send size={15} />
              {editingId ? '保存修改' : '保存记录'}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={() => {
                  setEditingId('');
                  setContent('');
                }}
              >
                取消修改
              </button>
            )}
          </div>
        </form>
      )}
      {!data.ai.configured && (
        <p className="hint session-hint">
          AI 出题和复盘需要在「模型设置」连接模型；手动记录可直接使用。
        </p>
      )}
    </>
  );
}
