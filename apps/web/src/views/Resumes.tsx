import Diff from './ResumeDiff';
import { useEffect, useState } from 'react';
import { Plus, Save, FileText, Sparkles, Undo2, Check, X, Code2, Download } from 'lucide-react';
import type { RecordMap } from '@nextoffer/core';
import { api, save, type ViewProps } from '../api';
import { Heading, Empty, Field, Modal } from '../components';
const template =
  '\\documentclass[UTF8,a4paper,11pt]{ctexart}\n\\usepackage[margin=2cm]{geometry}\n\\pagestyle{empty}\n\\begin{document}\n\\begin{center}\n{\\LARGE 你的姓名}\\\\[6pt]\n邮箱 · 电话 · 所在城市\n\\end{center}\n\\section*{教育经历}\n学校 · 专业 · 毕业时间\n\\section*{项目经历}\n项目名称：描述你的职责、行动与成果。\n\\section*{技能}\n列出与目标岗位相关的技能。\n\\end{document}\n';
export default function Resumes(props: ViewProps) {
  const { data, refresh, run, busy } = props;
  const [selected, setSelected] = useState(''),
    [creating, setCreating] = useState(false),
    [title, setTitle] = useState('');
  const resume = data.resumes.find((r) => r.id === selected) || data.resumes[0];
  const allowSwitch = () => !props.dirty || window.confirm('简历有未保存的修改，确定放弃并继续？');
  return (
    <>
      <Heading
        eyebrow="TELL YOUR STORY WELL"
        title="把经历，写成下一步。"
        description="在源码与预览之间打磨简历，每一次修改都有迹可循。"
      >
        <button className="primary" onClick={() => setCreating(true)}>
          <Plus size={17} />
          新建简历
        </button>
      </Heading>
      {resume ? (
        <>
          <div className="resume-selector">
            <label>
              当前简历
              <select
                aria-label="当前简历"
                value={resume.id}
                onChange={(e) => {
                  if (allowSwitch()) setSelected(e.target.value);
                }}
              >
                {data.resumes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))}
              </select>
            </label>
            <span className="tag">已保存 v{resume.version}</span>
          </div>
          <Editor key={`${resume.id}-${resume.revision}`} resume={resume} {...props} />
        </>
      ) : (
        <section className="panel">
          <Empty
            title="一份简历，讲清你的价值"
            description="从中文 LaTeX 模板开始，保留每一版，为不同机会认真调整。"
            action="创建第一份简历"
            onAction={() => setCreating(true)}
          />
        </section>
      )}
      {creating && (
        <Modal title="新建简历" onClose={() => setCreating(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!allowSwitch()) return;
              void run(async () => {
                const r = await save('resumes', { title, source: template });
                await refresh();
                setSelected(r.id);
                setCreating(false);
                setTitle('');
              });
            }}
          >
            <Field label="简历名称">
              <input
                required
                placeholder="例如：后端开发 · 秋招"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>
            <p className="hint">将创建一份可编辑的中文 LaTeX 模板。</p>
            <div className="modal-actions">
              <button disabled={busy} className="primary">
                创建简历
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
function Editor({
  resume,
  data,
  refresh,
  run,
  busy,
  onDirtyChange,
}: { resume: RecordMap['resumes'] } & ViewProps) {
  const [source, setSource] = useState(resume.source),
    [instruction, setInstruction] = useState(''),
    [proposal, setProposal] = useState(''),
    [undo, setUndo] = useState<string[]>([]),
    [versions, setVersions] = useState<{ version: number; source: string }[]>([]),
    [comparison, setComparison] = useState(''),
    [pdf, setPdf] = useState(''),
    [preview, setPreview] = useState<'pdf' | 'diff'>('pdf');
  useEffect(() => {
    void run(async () => setVersions(await api(`/resumes/${resume.id}/versions`)));
  }, [resume.id, run]);
  const changed = source !== resume.source;
  useEffect(() => {
    onDirtyChange?.(changed);
    return () => onDirtyChange?.(false);
  }, [changed, onDirtyChange]);
  useEffect(() => {
    if (!changed) return;
    const preventLoss = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', preventLoss);
    return () => window.removeEventListener('beforeunload', preventLoss);
  }, [changed]);
  return (
    <>
      <div className="resume-workspace">
        <section className="panel code-panel">
          <div className="editor-toolbar">
            <span>
              <Code2 size={16} />
              LaTeX 源码 {changed && <small>· 未保存</small>}
            </span>
            <div>
              <button
                aria-label="撤销修改"
                title="撤销最近一次采纳或版本切换"
                disabled={!undo.length}
                onClick={() => {
                  setSource(undo[undo.length - 1]);
                  setUndo(undo.slice(0, -1));
                }}
              >
                <Undo2 size={16} />
              </button>
              <button
                className="primary"
                disabled={busy || !changed}
                onClick={() =>
                  void run(async () => {
                    await save('resumes', { ...resume, source });
                    await refresh();
                  })
                }
              >
                <Save size={15} />
                保存版本
              </button>
            </div>
          </div>
          <textarea
            aria-label="LaTeX 源码"
            className="code-editor"
            spellCheck={false}
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
          <div className="version-tools">
            <label>
              历史版本
              <select
                aria-label="历史版本"
                defaultValue=""
                onChange={(e) => {
                  const v = versions.find((v) => v.version === Number(e.target.value));
                  setComparison(v?.source || '');
                  setPreview('diff');
                }}
              >
                <option value="">选择版本查看差异</option>
                {versions.map((v) => (
                  <option key={v.version} value={v.version}>
                    v{v.version}
                  </option>
                ))}
              </select>
            </label>
            <button
              disabled={!comparison}
              onClick={() => {
                setUndo([...undo, source]);
                setSource(comparison);
              }}
            >
              载入此版本
            </button>
          </div>
        </section>
        <section className="panel preview-panel">
          <div className="editor-toolbar">
            <div className="filter-pills">
              <button
                className={preview === 'pdf' ? 'selected' : ''}
                onClick={() => setPreview('pdf')}
              >
                PDF 预览
              </button>
              <button
                className={preview === 'diff' ? 'selected' : ''}
                onClick={() => setPreview('diff')}
              >
                版本差异
              </button>
            </div>
            <button
              disabled={busy || changed}
              title={changed ? '请先保存修改' : '使用本机 XeLaTeX 编译'}
              onClick={() =>
                void run(async () => {
                  const result = await api<{ url: string }>(`/resumes/${resume.id}/build`, {});
                  setPdf(`${result.url}${result.url.includes('?') ? '&' : '?'}t=${Date.now()}`);
                  setPreview('pdf');
                })
              }
            >
              <FileText size={15} />
              编译预览
            </button>
          </div>
          {preview === 'pdf' ? (
            pdf ? (
              <>
                <iframe title="简历 PDF 预览" src={pdf} />
                <a className="pdf-download" href={pdf} target="_blank" rel="noreferrer">
                  <Download size={15} />
                  打开 PDF
                </a>
              </>
            ) : (
              <div className="pdf-placeholder">
                <FileText size={40} strokeWidth={1} />
                <h3>看见简历的最终样子</h3>
                <p>
                  保存源码后点击「编译预览」。
                  <br />
                  需要本机已安装 XeLaTeX。
                </p>
                {changed && <span className="hint">先保存当前修改，即可编译。</span>}
              </div>
            )
          ) : (
            <div className="diff-view">
              {comparison ? (
                <Diff before={comparison} after={source} />
              ) : (
                <p className="muted">选择左下方的历史版本，查看与当前源码的差异。</p>
              )}
            </div>
          )}
        </section>
      </div>
      <section className="panel resume-ai">
        <div className="panel-heading">
          <Sparkles size={18} />
          <h2>让表达再准确一点</h2>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const result = await api<{ source: string }>('/ai/resume', { source, instruction });
              setProposal(result.source);
            });
          }}
        >
          <input
            aria-label="简历修改要求"
            required
            placeholder="例如：突出项目中的个人贡献，保留真实经历，不添加未经证实的数字"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
          />
          <button disabled={busy} className="primary">
            <Sparkles size={15} />
            生成修改建议
          </button>
        </form>
        <p className="hint">
          {data.ai.configured
            ? `由 ${data.ai.model} 生成建议，确认后才会修改源码。`
            : '请先在「模型设置」连接自己的模型。建议经你确认后才会修改源码。'}
        </p>
        {proposal && (
          <div className="proposal">
            <div className="panel-heading">
              <h3>修改建议</h3>
              <div className="button-row">
                <button onClick={() => setProposal('')}>
                  <X size={15} />
                  拒绝
                </button>
                <button
                  className="primary"
                  onClick={() => {
                    setUndo([...undo, source]);
                    setSource(proposal);
                    setProposal('');
                  }}
                >
                  <Check size={15} />
                  采纳到编辑器
                </button>
              </div>
            </div>
            <Diff before={source} after={proposal} />
          </div>
        )}
      </section>
    </>
  );
}
