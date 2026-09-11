import { useState } from 'react';
import { Copy, Save } from 'lucide-react';
import { api, type ViewProps } from '../api';
import { Field } from '../components';
export default function ProfileEditor({ data, refresh, run, busy }: ViewProps) {
  const [profile, setProfile] = useState(data.profile),
    [copied, setCopied] = useState('');
  const fields = [
    ['name', '姓名'],
    ['email', '邮箱'],
    ['phone', '电话'],
    ['education', '教育经历'],
    ['experience', '工作与项目经历'],
    ['skills', '技能'],
  ] as const;
  return (
    <section className="panel profile-panel">
      <div className="panel-heading">
        <h2>一份资料，多次使用</h2>
      </div>
      <p className="muted">保存常用信息，投递时按需复制。</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const updated = await api<typeof profile>('/profile', profile);
            setProfile(updated);
            await refresh();
          });
        }}
      >
        <div className="profile-fields">
          {fields.map(([key, label]) => (
            <Field key={key} label={label}>
              <div className="copy-field">
                {['education', 'experience', 'skills'].includes(key) ? (
                  <textarea
                    rows={4}
                    value={profile[key]}
                    onChange={(e) => setProfile({ ...profile, [key]: e.target.value })}
                  />
                ) : (
                  <input
                    value={profile[key]}
                    type={key === 'email' ? 'email' : 'text'}
                    onChange={(e) => setProfile({ ...profile, [key]: e.target.value })}
                  />
                )}
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`复制${label}`}
                  onClick={() =>
                    void run(async () => {
                      await navigator.clipboard.writeText(profile[key]);
                      setCopied(label);
                    })
                  }
                >
                  <Copy size={16} />
                </button>
              </div>
            </Field>
          ))}
        </div>
        <div className="modal-actions">
          <span className="hint" role="status">
            {copied && `已复制${copied}`}
          </span>
          <button disabled={busy} className="primary">
            <Save size={16} />
            保存资料
          </button>
        </div>
      </form>
    </section>
  );
}
