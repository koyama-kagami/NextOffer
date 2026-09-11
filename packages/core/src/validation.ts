import { AppError, resumeTemplate } from './types.ts';
import type { DimensionName, Kind, Message, Profile, RecordMap, Review } from './types.ts';

export const kinds: Kind[] = ['knowledge', 'jobs', 'resumes', 'interviews'];
export const safeId = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const stringList = (value: unknown): string[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))
    throw new AppError('VALIDATION', '字符串列表无效', 400);
  return value;
};

export function validateReview(value: unknown, messages: Message[]): Review {
  if (!value || typeof value !== 'object') throw new AppError('VALIDATION', '复盘格式无效', 400);
  const review = value as Record<string, unknown>;
  const names: DimensionName[] = ['技术知识', '项目深度', '问题分析', '表达结构'];
  const candidateIds = new Set(
    messages.filter((message) => message.role === 'candidate').map((message) => message.id),
  );
  if (
    review.rubricVersion !== 1 ||
    !Array.isArray(review.dimensions) ||
    review.dimensions.length !== 4
  )
    throw new AppError('VALIDATION', '复盘维度无效', 400);
  const seen = new Set<string>();
  const dimensions = review.dimensions.map((item) => {
    if (!item || typeof item !== 'object') throw new AppError('VALIDATION', '复盘维度无效', 400);
    const dimension = item as Record<string, unknown>;
    const name = dimension.name as DimensionName;
    const score = dimension.score;
    const evidence = stringList(dimension.evidence);
    const validScore =
      score === null ||
      (typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 100);
    if (
      !names.includes(name) ||
      seen.has(name) ||
      !validScore ||
      evidence.some((id) => !candidateIds.has(id)) ||
      (score !== null && evidence.length === 0)
    )
      throw new AppError('VALIDATION', '复盘评分或证据无效', 400);
    seen.add(name);
    return { name, score: score as number | null, evidence };
  });
  return {
    summary: typeof review.summary === 'string' ? review.summary : '',
    strengths: stringList(review.strengths),
    improvements: stringList(review.improvements),
    dimensions,
    rubricVersion: 1,
  };
}

export function normalize<K extends Kind>(kind: K, value: Record<string, unknown>): RecordMap[K] {
  const text = (key: string, fallback = '') => {
    if (value[key] === undefined) return fallback;
    if (typeof value[key] !== 'string')
      throw new AppError('VALIDATION', `字段必须为字符串: ${key}`, 400);
    return value[key] as string;
  };
  const base = {
    id: text('id'),
    schemaVersion: 1 as const,
    revision: Number(value.revision),
    createdAt: text('createdAt'),
    updatedAt: text('updatedAt'),
  };
  if (!safeId.test(base.id) || !Number.isInteger(base.revision) || base.revision < 1)
    throw new AppError('CORRUPT_RECORD', '记录基础字段无效');
  if (kind === 'knowledge')
    return {
      ...base,
      title: text('title'),
      content: text('content'),
      tags: stringList(value.tags),
    } as RecordMap[K];
  if (kind === 'jobs') {
    const status = value.status ?? 'saved';
    if (!['saved', 'applied', 'test', 'interview', 'offer', 'closed'].includes(String(status)))
      throw new AppError('VALIDATION', '岗位状态无效', 400);
    const deadline = text('deadline');
    const interviewAt = text('interviewAt');
    if (deadline && !/^\d{4}-\d{2}-\d{2}$/.test(deadline))
      throw new AppError('VALIDATION', '截止日期必须为 YYYY-MM-DD', 400);
    if (
      interviewAt &&
      (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(interviewAt) ||
        Number.isNaN(Date.parse(interviewAt)))
    )
      throw new AppError('VALIDATION', '面试时间必须包含时区', 400);
    return {
      ...base,
      company: text('company'),
      title: text('title'),
      jd: text('jd'),
      url: text('url'),
      location: text('location'),
      status,
      deadline,
      interviewAt,
      notes: text('notes'),
      resumeId: text('resumeId'),
      resumeVersion: value.resumeVersion == null ? null : Number(value.resumeVersion),
    } as RecordMap[K];
  }
  if (kind === 'resumes') {
    const version = Number(value.version ?? 1);
    if (!Number.isInteger(version) || version < 1)
      throw new AppError('VALIDATION', '简历版本无效', 400);
    return {
      ...base,
      title: text('title'),
      source: text('source', resumeTemplate),
      version,
    } as RecordMap[K];
  }
  const messages = Array.isArray(value.messages) ? value.messages : [];
  for (const message of messages)
    if (
      !message ||
      typeof message.id !== 'string' ||
      !['interviewer', 'candidate'].includes(message.role) ||
      typeof message.content !== 'string'
    )
      throw new AppError('VALIDATION', '面试消息无效', 400);
  const mode = value.mode ?? 'mock';
  const status = value.status ?? 'active';
  if (!['mock', 'real'].includes(String(mode)) || !['active', 'completed'].includes(String(status)))
    throw new AppError('VALIDATION', '面试类型或状态无效', 400);
  return {
    ...base,
    title: text('title'),
    jobId: text('jobId'),
    resumeId: text('resumeId'),
    resumeVersion: value.resumeVersion == null ? null : Number(value.resumeVersion),
    contextSnapshot: text('contextSnapshot'),
    mode,
    status,
    messages,
    review: value.review == null ? null : validateReview(value.review, messages),
  } as RecordMap[K];
}

export const emptyProfile = (): Profile => ({
  name: '',
  email: '',
  phone: '',
  education: '',
  experience: '',
  skills: '',
  updatedAt: '',
  revision: 0,
});
export function validateProfile(value: unknown): Profile {
  if (!value || typeof value !== 'object') throw new AppError('CORRUPT_RECORD', '个人资料格式无效');
  const profile = value as Record<string, unknown>;
  for (const key of ['name', 'email', 'phone', 'education', 'experience', 'skills', 'updatedAt'])
    if (typeof profile[key] !== 'string')
      throw new AppError('CORRUPT_RECORD', `个人资料字段无效: ${key}`);
  if (!Number.isInteger(profile.revision) || Number(profile.revision) < 0)
    throw new AppError('CORRUPT_RECORD', '个人资料修订号无效');
  return profile as Profile;
}
