import { randomUUID } from 'node:crypto';
import { Workspace, AppError, type Interview } from '@nextoffer/core';
import { ModelClient, type AIConfig } from '@nextoffer/ai';

export function environmentConfig(): AIConfig {
  return {
    baseUrl: process.env.NEXT_OFFER_BASE_URL || '',
    model: process.env.NEXT_OFFER_MODEL || '',
    apiKey: process.env.NEXT_OFFER_API_KEY || '',
  };
}

export function model(config: AIConfig): ModelClient {
  if (!config.baseUrl || !config.model || !config.apiKey)
    throw new AppError('AI_NOT_CONFIGURED', '请先在模型设置中填写接口地址、模型和自己的 API Key。');
  return new ModelClient(config);
}

async function context(workspace: Workspace, interview: Interview): Promise<string> {
  const parts: string[] = [];
  if (interview.jobId) {
    const job = await workspace.get('jobs', interview.jobId);
    parts.push(`目标岗位：${job.company} / ${job.title}\n${job.jd}`);
    if (!interview.resumeId && job.resumeId) {
      const versions = await workspace.versions(job.resumeId);
      const version = versions.find((v) => v.version === job.resumeVersion);
      if (version) parts.push(`投递简历版本 ${version.version}：\n${version.source}`);
    }
  }
  if (interview.resumeId) {
    const versions = await workspace.versions(interview.resumeId);
    const chosen = versions.find((v) => v.version === interview.resumeVersion) || versions.at(-1);
    if (chosen) parts.push(`简历版本 ${chosen.version}：\n${chosen.source}`);
  }
  const query =
    interview.messages
      .slice(-2)
      .map((m) => m.content)
      .join(' ') || interview.title;
  const hits = await workspace.search(query);
  parts.push(...hits.slice(0, 4).map((h) => `资料 ${h.title} 第 ${h.paragraph} 段：${h.excerpt}`));
  return parts.join('\n\n').slice(0, 24000);
}

export async function interviewAction(
  workspace: Workspace,
  config: AIConfig,
  action: 'question' | 'review',
  id: string,
  revision: number,
) {
  const client = model(config);
  const interview = await workspace.get('interviews', id);
  if (interview.revision !== revision)
    throw new AppError('CONFLICT', '面试记录已更新，请刷新后重试。');
  if (action === 'question' && (interview.status === 'completed' || interview.mode === 'real'))
    throw new AppError('VALIDATION', '只有进行中的模拟面试可以生成问题。');
  if (action === 'review' && !interview.messages.some((m) => m.role === 'candidate'))
    throw new AppError('VALIDATION', '请先保存至少一条回答，再生成复盘。');
  const prompt = interview.contextSnapshot || (await context(workspace, interview));
  if (action === 'review') {
    const review = await client.review(interview, prompt);
    return workspace.save('interviews', {
      ...interview,
      contextSnapshot: prompt,
      review,
      status: 'completed',
    });
  }
  const content = await client.nextQuestion(interview, prompt);
  return workspace.save('interviews', {
    ...interview,
    contextSnapshot: prompt,
    messages: [...interview.messages, { id: randomUUID(), role: 'interviewer', content }],
  });
}
