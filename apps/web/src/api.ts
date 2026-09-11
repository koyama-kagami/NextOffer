import type { Profile, RecordMap, Kind } from '@nextoffer/core';
export type Bootstrap = {
  token: string;
  workspace: string;
  profile: Profile;
  knowledge: RecordMap['knowledge'][];
  jobs: RecordMap['jobs'][];
  resumes: RecordMap['resumes'][];
  interviews: RecordMap['interviews'][];
  ai: { baseUrl: string; model: string; configured: boolean };
};
let token = '';
export async function api<T>(
  path: string,
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST',
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-NextOffer-Token': token } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!result.ok) throw new Error(result.error?.message || '请求失败，请重试。');
  if (path === '/bootstrap') token = result.data.token;
  return result.data;
}
export const save = <K extends Kind>(kind: K, value: Partial<RecordMap[K]>) =>
  api<RecordMap[K]>(`/records/${kind}`, value);
export const remove = (kind: Kind, id: string, revision: number) =>
  api(`/records/${kind}/${id}?revision=${revision}`, undefined, 'DELETE');
export type ViewProps = {
  data: Bootstrap;
  refresh: () => Promise<void>;
  run: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
  busy: boolean;
  dirty?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
};
