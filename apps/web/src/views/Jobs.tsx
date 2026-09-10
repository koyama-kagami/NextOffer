import { useState } from 'react';
import { Plus, ArrowUpRight, CalendarDays, MapPin, Trash2, Search } from 'lucide-react';
import type { RecordMap } from '@nextoffer/core';
import { save, remove, type ViewProps } from '../api';
import { Heading, Empty, Field, Modal, dateLabel } from '../components';
type Job = RecordMap['jobs'];
const stages: Record<Job['status'], string> = {
  saved: '待投递',
  applied: '已投递',
  test: '笔试中',
  interview: '面试中',
  offer: '已获 Offer',
  closed: '已结束',
};
const blank: Partial<Job> = {
  company: '',
  title: '',
  jd: '',
  url: '',
  location: '',
  status: 'saved',
  deadline: '',
  interviewAt: '',
  notes: '',
  resumeId: '',
  resumeVersion: null,
};
export default function Jobs({ data, refresh, run, busy }: ViewProps) {
  const [editing, setEditing] = useState<Partial<Job> | null>(null),
    [selected, setSelected] = useState(''),
    [filter, setFilter] = useState('all'),
    [search, setSearch] = useState('');
  const jobs = data.jobs.filter(
    (j) =>
      (filter === 'all' || j.status === filter) &&
      `${j.company} ${j.title}`.toLowerCase().includes(search.toLowerCase()),
  );
  const job = data.jobs.find((j) => j.id === selected);
  const events = data.jobs
    .flatMap((j) => [
      ...(j.deadline ? [{ date: j.deadline, job: j, label: '投递截止' }] : []),
      ...(j.interviewAt ? [{ date: j.interviewAt, job: j, label: '面试安排' }] : []),
    ])
    .sort((a, b) => a.date.localeCompare(b.date));
  return (
    <>
      <Heading
        eyebrow="MAKE YOUR NEXT MOVE"
        title="每个机会，认真以待。"
        description="从心仪岗位到下一份 Offer，清晰记录每一步。"
      >
        <a className="button" href="https://www.zhipin.com/" target="_blank" rel="noreferrer">
          <Search size={16} />
          寻找岗位
          <ArrowUpRight size={14} />
        </a>
        <button className="primary" onClick={() => setEditing({ ...blank })}>
          <Plus size={17} />
          添加岗位
        </button>
      </Heading>
      <div className="jobs-layout">
        <section className="panel jobs-main">
          <div className="jobs-filters">
            <div className="filter-pills">
              {[
                ['all', '全部机会'],
                ['saved', '待投递'],
                ['interview', '面试中'],
                ['offer', 'Offer'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  className={filter === value ? 'selected' : ''}
                  onClick={() => setFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <input
              aria-label="搜索岗位"
              className="compact-search"
              placeholder="搜索公司或岗位"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {jobs.length ? (
            <div className="job-table">
              <div className="job-table-head">
                <span>公司 / 岗位</span>
                <span>当前进度</span>
                <span>投递截止</span>
                <span />
              </div>
              {jobs.map((j) => (
                <button key={j.id} className="job-row" onClick={() => setSelected(j.id)}>
                  <div className="job-identity">
                    <span className="company-avatar">{j.company.slice(0, 1)}</span>
                    <span>
                      <strong>{j.company}</strong>
                      <small>
                        {j.title}
                        {j.location && ` · ${j.location}`}
                      </small>
                    </span>
                  </div>
                  <span className={`stage stage-${j.status}`}>{stages[j.status]}</span>
                  <span className="date-data">{j.deadline ? dateLabel(j.deadline) : '—'}</span>
                  <ArrowUpRight size={16} />
                </button>
              ))}
            </div>
          ) : (
            <Empty
              title={data.jobs.length ? '没有符合条件的岗位' : '下一站，从一个机会开始'}
              description={
                data.jobs.length
                  ? '调整筛选或搜索词，查看其他机会。'
                  : '保存岗位描述、投递时间和面试安排，让准备更有方向。'
              }
              action={!data.jobs.length ? '添加第一个岗位' : undefined}
              onAction={() => setEditing({ ...blank })}
            />
          )}
        </section>
        <aside className="panel schedule">
          <div className="panel-heading">
            <CalendarDays size={18} />
            <h2>日程与截止</h2>
          </div>
          <p className="muted">把重要的时间留在眼前。</p>
          {events.length ? (
            <div className="timeline">
              {events.map((item, i) => (
                <button key={i} className="timeline-item" onClick={() => setSelected(item.job.id)}>
                  <time>
                    {dateLabel(item.date)}
                    {item.label === '面试安排' && (
                      <small>
                        {new Date(item.date).toLocaleTimeString('zh-CN', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </small>
                    )}
                  </time>
                  <span>
                    <strong>{item.job.company}</strong>
                    <small>
                      {item.label} · {item.job.title}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="schedule-empty">
              还没有日程。
              <br />
              为岗位设置截止日期或面试时间，安排会出现在这里。
            </p>
          )}
        </aside>
      </div>
      {job && !editing && (
        <Modal title={`${job.company} · ${job.title}`} onClose={() => setSelected('')}>
          <div className="job-meta">
            <span className={`stage stage-${job.status}`}>{stages[job.status]}</span>
            {job.location && (
              <span>
                <MapPin size={14} />
                {job.location}
              </span>
            )}
            {job.url && (
              <a href={safeUrl(job.url)} target="_blank" rel="noreferrer">
                岗位来源 <ArrowUpRight size={13} />
              </a>
            )}
          </div>
          <dl className="detail-grid">
            <div>
              <dt>投递截止</dt>
              <dd>{job.deadline || '未设置'}</dd>
            </div>
            <div>
              <dt>面试时间</dt>
              <dd>
                {job.interviewAt ? new Date(job.interviewAt).toLocaleString('zh-CN') : '未设置'}
              </dd>
            </div>
            <div>
              <dt>投递简历</dt>
              <dd>
                {data.resumes.find((r) => r.id === job.resumeId)?.title || '未关联'}
                {job.resumeVersion && ` · v${job.resumeVersion}`}
              </dd>
            </div>
          </dl>
          <h3>岗位描述</h3>
          <div className="prose">{job.jd || '暂无描述'}</div>
          {job.notes && (
            <>
              <h3>备注</h3>
              <div className="prose">{job.notes}</div>
            </>
          )}
          <div className="modal-actions">
            <button
              className="danger"
              onClick={() => {
                if (window.confirm('删除这个岗位？'))
                  void run(async () => {
                    await remove('jobs', job.id, job.revision);
                    setSelected('');
                    await refresh();
                  });
              }}
            >
              <Trash2 size={16} />
              删除
            </button>
            <button className="primary" onClick={() => setEditing(job)}>
              编辑岗位
            </button>
          </div>
        </Modal>
      )}
      {editing && (
        <Modal title={editing.id ? '编辑岗位' : '添加岗位'} onClose={() => setEditing(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await save('jobs', editing);
                await refresh();
                setEditing(null);
              });
            }}
          >
            <div className="form-grid">
              {[
                ['company', '公司'],
                ['title', '岗位'],
                ['location', '地点'],
                ['url', '来源链接'],
              ].map(([key, label]) => (
                <Field key={key} label={label}>
                  <input
                    required={key === 'company' || key === 'title'}
                    type={key === 'url' ? 'url' : 'text'}
                    value={String(editing[key as keyof Job] || '')}
                    onChange={(e) => setEditing({ ...editing, [key]: e.target.value })}
                  />
                </Field>
              ))}
              <Field label="当前进度">
                <select
                  value={editing.status}
                  onChange={(e) =>
                    setEditing({ ...editing, status: e.target.value as Job['status'] })
                  }
                >
                  {Object.entries(stages).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="投递截止">
                <input
                  type="date"
                  value={editing.deadline}
                  onChange={(e) => setEditing({ ...editing, deadline: e.target.value })}
                />
              </Field>
              <Field label="面试时间（本地时区）">
                <input
                  type="datetime-local"
                  value={localDate(editing.interviewAt || '')}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      interviewAt: e.target.value ? new Date(e.target.value).toISOString() : '',
                    })
                  }
                />
              </Field>
              <Field label="关联简历">
                <select
                  value={editing.resumeId}
                  onChange={(e) => {
                    const resume = data.resumes.find((r) => r.id === e.target.value);
                    setEditing({
                      ...editing,
                      resumeId: resume?.id || '',
                      resumeVersion: resume?.version ?? null,
                    });
                  }}
                >
                  <option value="">暂不关联</option>
                  {data.resumes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.title} · v{r.version}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="岗位描述 JD">
              <textarea
                rows={6}
                value={editing.jd}
                onChange={(e) => setEditing({ ...editing, jd: e.target.value })}
              />
            </Field>
            <Field label="备注">
              <textarea
                rows={3}
                value={editing.notes}
                onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
              />
            </Field>
            <div className="modal-actions">
              <button className="primary" disabled={busy}>
                保存岗位
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
function localDate(value: string) {
  if (!value) return '';
  const d = new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function safeUrl(value: string) {
  try {
    const u = new URL(value);
    return ['http:', 'https:'].includes(u.protocol) ? u.href : undefined;
  } catch {
    return undefined;
  }
}
