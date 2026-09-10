import ProfileEditor from './ProfileEditor';
import { useState, type ChangeEvent } from 'react';
import { Plus, Upload, Search, Sparkles, FileText, Copy, Save, Trash2 } from 'lucide-react';
import type { RecordMap, SearchHit } from '@nextoffer/core';
import { api, save, remove, type ViewProps } from '../api';
import { Heading, Empty, Field, Modal, dateLabel } from '../components';
export default function Knowledge({ data, refresh, run, busy }: ViewProps) {
  const [section, setSection] = useState('notes'),
    [selected, setSelected] = useState(''),
    [editing, setEditing] = useState<Partial<RecordMap['knowledge']> | null>(null),
    [query, setQuery] = useState(''),
    [hits, setHits] = useState<SearchHit[] | null>(null),
    [question, setQuestion] = useState(''),
    [answer, setAnswer] = useState<{ answer: string; sources: SearchHit[] } | null>(null);
  const note = data.knowledge.find((n) => n.id === selected) || data.knowledge[0];
  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    await run(async () => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      for (const b of bytes) binary += String.fromCharCode(b);
      const item = await api<RecordMap['knowledge']>('/import', {
        name: file.name,
        base64: btoa(binary),
      });
      setSelected(item.id);
      await refresh();
    });
    e.target.value = '';
  }
  return (
    <>
      <Heading
        eyebrow="YOUR KNOWLEDGE, CONNECTED"
        title="积累，成为你的底气。"
        description="把经历与知识放在一起，为下一次机会做好准备。"
      >
        <label className="button upload-button">
          <Upload size={16} />
          导入资料
          <input
            aria-label="导入资料"
            type="file"
            accept=".md,.txt,.pdf"
            onChange={(e) => void upload(e)}
            disabled={busy}
          />
        </label>
        <button
          className="primary"
          onClick={() => setEditing({ title: '', content: '', tags: [] })}
        >
          <Plus size={17} />
          新建笔记
        </button>
      </Heading>
      <div className="section-tabs">
        <button
          className={section === 'notes' ? 'selected' : ''}
          onClick={() => setSection('notes')}
        >
          知识笔记 <span>{data.knowledge.length}</span>
        </button>
        <button
          className={section === 'profile' ? 'selected' : ''}
          onClick={() => setSection('profile')}
        >
          个人资料
        </button>
      </div>
      {section === 'profile' ? (
        <ProfileEditor {...{ data, refresh, run, busy }} />
      ) : (
        <div className="knowledge-layout">
          <section className="panel note-browser">
            <form
              className="search-box"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () =>
                  setHits(
                    query.trim()
                      ? await api<SearchHit[]>(`/search?q=${encodeURIComponent(query)}`)
                      : null,
                  ),
                );
              }}
            >
              <Search size={17} />
              <input
                aria-label="搜索资料"
                placeholder="搜索你的知识与经历"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  if (!e.target.value) setHits(null);
                }}
              />
              <button className="text-button">搜索</button>
            </form>
            <div className="list-caption">
              {hits ? '检索结果' : '全部笔记'}
              <span>{hits?.length ?? data.knowledge.length} 篇</span>
            </div>
            {hits ? (
              hits.length ? (
                hits.map((hit, i) => (
                  <button
                    className="note-item"
                    key={`${hit.id}-${i}`}
                    onClick={() => {
                      setSelected(hit.id);
                      setHits(null);
                    }}
                  >
                    <h3>{hit.title}</h3>
                    <p>{hit.excerpt}</p>
                    <small>第 {hit.paragraph} 段</small>
                  </button>
                ))
              ) : (
                <p className="list-empty">没有找到匹配内容，试试其他关键词。</p>
              )
            ) : (
              data.knowledge.map((n) => (
                <button
                  key={n.id}
                  className={`note-item ${note?.id === n.id ? 'selected' : ''}`}
                  onClick={() => setSelected(n.id)}
                >
                  <div className="note-title">
                    <FileText size={16} />
                    <h3>{n.title}</h3>
                  </div>
                  <p>{n.content.slice(0, 80) || '暂未添加内容'}</p>
                  <small>
                    {dateLabel(n.updatedAt)}
                    {n.tags.length > 0 && ` · ${n.tags.join(' / ')}`}
                  </small>
                </button>
              ))
            )}
            {!data.knowledge.length && !hits && (
              <div className="list-empty">支持 Markdown、TXT 和文本型 PDF</div>
            )}
          </section>
          <section className="panel note-detail">
            {note ? (
              <>
                <div className="detail-toolbar">
                  <span className="eyebrow">KNOWLEDGE NOTE</span>
                  <div>
                    <button onClick={() => setEditing(note)}>编辑</button>
                    <button
                      className="icon-button danger"
                      aria-label="删除笔记"
                      onClick={() => {
                        if (window.confirm(`删除「${note.title}」？`))
                          void run(async () => {
                            await remove('knowledge', note.id, note.revision);
                            await refresh();
                          });
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                <h2>{note.title}</h2>
                <div className="tag-row">
                  {note.tags.map((t) => (
                    <span className="tag" key={t}>
                      {t}
                    </span>
                  ))}
                </div>
                <div className="prose">{note.content || '这篇笔记还没有内容。'}</div>
              </>
            ) : (
              <Empty
                title="让你的积累，有迹可循"
                description="导入一份项目笔记，或写下值得保留的经历。"
                action="写下第一篇笔记"
                onAction={() => setEditing({ title: '', content: '', tags: [] })}
              />
            )}
          </section>
          <section className="panel ask-panel">
            <div className="panel-heading">
              <Sparkles size={17} />
              <h2>问问你的资料</h2>
            </div>
            <p className="muted">基于已有资料回答，保留可追溯的引用。</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () =>
                  setAnswer(await api('/ai/ask', { question, noteId: note?.id })),
                );
              }}
            >
              <textarea
                aria-label="资料问题"
                required
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="例如：我有哪些体现问题解决能力的项目经历？"
                rows={4}
              />
              <button disabled={busy} className="primary">
                <Sparkles size={15} />
                {busy ? '处理中…' : '查找答案'}
              </button>
            </form>
            {note && (
              <button
                className="summarize-button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    setAnswer(
                      await api('/ai/ask', {
                        question: '请总结这篇笔记的要点，并引用相关段落。',
                        noteId: note.id,
                      }),
                    );
                  })
                }
              >
                <FileText size={14} />
                总结这篇笔记
              </button>
            )}
            {!data.ai.configured && (
              <p className="hint">首次使用，请在「模型设置」连接自己的模型。</p>
            )}
            {answer && (
              <div className="answer">
                <div className="prose">{answer.answer}</div>
                <h3>参考资料</h3>
                {answer.sources.map((s, i) => (
                  <button className="citation" key={i} onClick={() => setSelected(s.id)}>
                    {s.title} · 第 {s.paragraph} 段<small>{s.excerpt}</small>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
      {editing && (
        <Modal title={editing.id ? '编辑笔记' : '新建笔记'} onClose={() => setEditing(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const tags = String(new FormData(e.currentTarget).get('tags') || '')
                .split(/[,，]/)
                .map((tag) => tag.trim())
                .filter(Boolean);
              void run(async () => {
                const n = await save('knowledge', { ...editing, tags });
                await refresh();
                setSelected(n.id);
                setEditing(null);
              });
            }}
          >
            <Field label="标题">
              <input
                required
                value={editing.title}
                onChange={(e) => setEditing({ ...editing, title: e.target.value })}
              />
            </Field>
            <Field label="标签（逗号分隔）">
              <input name="tags" defaultValue={editing.tags?.join(', ')} />
            </Field>
            <Field label="内容">
              <textarea
                rows={12}
                value={editing.content}
                onChange={(e) => setEditing({ ...editing, content: e.target.value })}
              />
            </Field>
            <div className="modal-actions">
              <button className="primary" disabled={busy}>
                <Save size={16} />
                保存笔记
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
