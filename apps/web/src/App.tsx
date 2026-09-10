import { useCallback, useEffect, useState } from 'react';
import {
  ArrowUpRight,
  BookOpen,
  FileText,
  BriefcaseBusiness,
  MessagesSquare,
  Settings,
  RefreshCw,
  Download,
  Check,
  X,
} from 'lucide-react';
import { api, type Bootstrap } from './api';
import { Modal, Field } from './components';
import Knowledge from './views/Knowledge';
import Jobs from './views/Jobs';
import Resumes from './views/Resumes';
import Interviews from './views/Interviews';
const tabs = [
  { id: 'knowledge', label: '资料', icon: BookOpen },
  { id: 'resumes', label: '简历', icon: FileText },
  { id: 'jobs', label: '岗位', icon: BriefcaseBusiness },
  { id: 'interviews', label: '面试', icon: MessagesSquare },
] as const;
export default function App() {
  const [tab, setTab] = useState('knowledge'),
    [data, setData] = useState<Bootstrap | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [settings, setSettings] = useState(false),
    [dirty, setDirty] = useState(false);
  const allowNavigation = () => !dirty || window.confirm('简历有未保存的修改，确定放弃并继续？');
  const navigate = (nextTab: string) => {
    if (nextTab !== tab && allowNavigation()) setTab(nextTab);
  };
  const refresh = useCallback(async () => {
    setData(await api<Bootstrap>('/bootstrap'));
  }, []);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setError('');
    setBusy(true);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败，请重试。');
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void run(refresh);
  }, [run, refresh]);
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate('knowledge');
          }}
        >
          <span className="brand-mark">
            <ArrowUpRight size={25} />
          </span>
          NextOffer<span className="brand-dot">.</span>
        </a>
        <div className="sidebar-caption">个人求职工作台</div>
        <nav aria-label="工作台导航">
          {tabs.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${tab === item.id ? 'active' : ''}`}
              onClick={() => navigate(item.id)}
            >
              <item.icon size={19} strokeWidth={1.65} />
              <span>{item.label}</span>
              {tab === item.id && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="workspace-label">
            <span className="status-dot" />
            本地工作区
          </div>
          <p>准备充分，从容向前。</p>
          <button className="nav-item" onClick={() => setSettings(true)}>
            <Settings size={18} />
            <span>模型设置</span>
          </button>
        </div>
      </aside>
      <main>
        <div className="topbar">
          <span>
            我的工作台<span className="breadcrumb-slash">/</span>
            {tabs.find((t) => t.id === tab)?.label}
          </span>
          <div className="topbar-actions">
            <span className="local-label">文件保存在本机</span>
            <button
              className="icon-button"
              aria-label="刷新工作区"
              title="刷新工作区"
              disabled={busy}
              onClick={() => {
                if (allowNavigation()) void run(refresh);
              }}
            >
              <RefreshCw size={16} className={busy ? 'spinning' : ''} />
            </button>
            <a
              className="icon-button"
              href="/api/export"
              download="nextoffer.json"
              aria-label="导出工作区"
              title="导出工作区"
            >
              <Download size={16} />
            </a>
          </div>
        </div>
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button className="icon-button" onClick={() => setError('')} aria-label="关闭错误">
              <X size={16} />
            </button>
          </div>
        )}
        <div className="page">
          {data ? (
            tab === 'knowledge' ? (
              <Knowledge {...{ data, refresh, run, busy }} />
            ) : tab === 'jobs' ? (
              <Jobs {...{ data, refresh, run, busy }} />
            ) : tab === 'resumes' ? (
              <Resumes {...{ data, refresh, run, busy, dirty }} onDirtyChange={setDirty} />
            ) : (
              <Interviews {...{ data, refresh, run, busy }} />
            )
          ) : (
            <div className="empty">
              <p>{busy ? '正在打开工作区…' : '工作区暂时无法读取。'}</p>
              {!busy && <button onClick={() => void run(refresh)}>重新加载</button>}
            </div>
          )}
        </div>
      </main>
      {settings && data && (
        <SettingsModal
          data={data}
          onClose={() => setSettings(false)}
          onSave={async (value) => {
            const result = await run(async () => {
              const ai = await api<Bootstrap['ai']>('/settings', value);
              setData((previous) => (previous ? { ...previous, ai } : previous));
              return true;
            });
            if (result) setSettings(false);
          }}
          busy={busy}
        />
      )}
    </div>
  );
}
function SettingsModal({
  data,
  onClose,
  onSave,
  busy,
}: {
  data: Bootstrap;
  onClose: () => void;
  onSave: (v: unknown) => Promise<void>;
  busy: boolean;
}) {
  const [baseUrl, setBaseUrl] = useState(data.ai.baseUrl),
    [model, setModel] = useState(data.ai.model),
    [apiKey, setKey] = useState('');
  return (
    <Modal title="连接你的模型" onClose={onClose}>
      <p className="muted modal-intro">
        连接 OpenAI 兼容接口后，即可使用资料问答、简历建议和面试复盘。任务所需资料会发送至此服务商。
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onSave({ baseUrl, model, apiKey });
        }}
      >
        <Field label="接口地址">
          <input
            required
            type="url"
            placeholder="https://your-provider.com/v1"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </Field>
        <Field label="模型名称">
          <input
            required
            placeholder="服务商提供的模型 ID"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />
        </Field>
        <Field label="API Key">
          <input
            type="password"
            autoComplete="off"
            required={!data.ai.configured}
            placeholder={data.ai.configured ? '已配置；留空保留当前 Key' : '输入你自己的 API Key'}
            value={apiKey}
            onChange={(e) => setKey(e.target.value)}
          />
        </Field>
        <p className="hint">Key 仅保留在本次服务进程内，不写入资料或浏览器存储。</p>
        <div className="modal-actions">
          {data.ai.configured && (
            <button type="button" onClick={() => void onSave({ clear: true })}>
              清除连接
            </button>
          )}
          <button className="primary" disabled={busy}>
            <Check size={16} />
            保存连接
          </button>
        </div>
      </form>
    </Modal>
  );
}
