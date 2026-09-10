#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { Workspace, AppError, resumeTemplate, type Kind } from '@nextoffer/core';
import { environmentConfig, model, interviewAction } from './ai-actions.ts';

const help = `NextOffer · 下一站

用法：npm run cli -- <命令> [参数] [--workspace <目录>] [--json]

  init                          初始化个人工作区
  profile get|save --input FILE  查看 / 保存个人资料
  job list|get ID|save|delete ID 岗位记录
  knowledge list|get ID|save     知识资料
  knowledge import FILE         导入 Markdown / TXT / PDF
  knowledge search QUERY        本地检索
  resume list|get ID|save        简历记录
  resume create --title TITLE   从 LaTeX 模板创建简历
  resume versions ID|build ID    版本历史 / 编译 PDF
  interview list|get ID|save     面试会话与复盘
  ai ask QUESTION               根据知识库回答
  ai question|review ID          面试下一题 / 总结复盘
  ai resume ID --instruction TXT 生成 LaTeX 修改建议（不写入）
  export                        导出业务数据，不含模型 Key
  ui [--port 4317] [--dev]       启动本地网页

save 读取 --input FILE（JSON）或 stdin。更新必须保留 id 和 revision。
delete 必须提供 --revision N。数据目录默认 ./workspace。
AI 使用 NEXT_OFFER_BASE_URL、NEXT_OFFER_MODEL、NEXT_OFFER_API_KEY。
Coding agent 可直接使用 CLI 和工作区文件，不必配置上述变量。`;

const aliases: Record<string, Kind> = {
  job: 'jobs',
  knowledge: 'knowledge',
  resume: 'resumes',
  interview: 'interviews',
};

async function inputJSON(file?: string): Promise<Record<string, unknown>> {
  let content: string;
  if (file) content = await readFile(file, 'utf8');
  else {
    if (process.stdin.isTTY)
      throw new AppError('VALIDATION', '请用 --input 提供 JSON 文件，或通过 stdin 传入。');
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    content = Buffer.concat(chunks).toString('utf8');
  }
  try {
    const value = JSON.parse(content.replace(/^\uFEFF/, ''));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new AppError('VALIDATION', '输入必须是有效的 JSON 对象。');
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      workspace: { type: 'string', default: process.env.NEXT_OFFER_WORKSPACE || './workspace' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h' },
      input: { type: 'string' },
      title: { type: 'string' },
      company: { type: 'string' },
      revision: { type: 'string' },
      port: { type: 'string', default: '4317' },
      dev: { type: 'boolean' },
      instruction: { type: 'string' },
    },
  });
  const [command, action, id] = positionals;
  const output = (data: unknown) =>
    process.stdout.write(
      JSON.stringify({ ok: true, data }, null, values.json ? undefined : 2) + '\n',
    );
  if (!command || command === 'help' || values.help) {
    values.json ? output({ help }) : process.stdout.write(help + '\n');
    return;
  }
  const workspace = new Workspace(resolve(values.workspace!));
  if (command === 'init') {
    await workspace.init();
    output({ workspace: workspace.root });
    return;
  }
  if (command === 'ui') {
    const port = Number(values.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new AppError('VALIDATION', '端口必须在 1–65535 之间。');
    const { startServer } = await import('./server.ts');
    const server = await startServer({ workspace: workspace.root, port, dev: values.dev });
    output({ url: server.url, workspace: workspace.root });
    const stop = async () => {
      await server.close();
      process.exit(0);
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    return;
  }
  await workspace.init();
  if (command === 'export') {
    output(await workspace.exportData());
    return;
  }
  if (command === 'profile') {
    if (action === 'save') output(await workspace.saveProfile(await inputJSON(values.input)));
    else if (action === 'get' || !action) output(await workspace.profile());
    else throw new AppError('VALIDATION', 'profile 支持 get / save。');
    return;
  }
  if (command === 'ai') {
    const config = environmentConfig();
    if (action === 'ask' && id) {
      const question = positionals.slice(2).join(' ');
      const sources = await workspace.search(question);
      output({ answer: await model(config).ask(question, sources), sources });
    } else if ((action === 'question' || action === 'review') && id) {
      const session = await workspace.get('interviews', id);
      output(await interviewAction(workspace, config, action, id, session.revision));
    } else if (action === 'resume' && id && values.instruction) {
      const resume = await workspace.get('resumes', id);
      output({ source: await model(config).reviseResume(resume.source, values.instruction) });
    } else
      throw new AppError(
        'VALIDATION',
        '请使用 ai ask / question / review / resume，参数见 --help。',
      );
    return;
  }
  const kind = aliases[command];
  if (!kind) throw new AppError('VALIDATION', '未知命令，请运行 --help。');
  if (action === 'list' || !action) output(await workspace.list(kind));
  else if (action === 'get' && id) output(await workspace.get(kind, id));
  else if (action === 'save') output(await workspace.save(kind, await inputJSON(values.input)));
  else if (action === 'delete' && id) {
    const revision = Number(values.revision);
    if (!Number.isInteger(revision) || revision < 1)
      throw new AppError('VALIDATION', '删除必须提供 --revision N。');
    await workspace.remove(kind, id, revision);
    output({ deleted: id });
  } else if (command === 'knowledge' && action === 'import' && id)
    output(await workspace.importKnowledge(basename(id), await readFile(id)));
  else if (command === 'knowledge' && action === 'search' && id)
    output(await workspace.search(positionals.slice(2).join(' ')));
  else if (command === 'resume' && action === 'create')
    output(
      await workspace.save('resumes', {
        title: values.title || '我的简历',
        source: resumeTemplate,
      }),
    );
  else if (command === 'resume' && action === 'versions' && id)
    output(await workspace.versions(id));
  else if (command === 'resume' && action === 'build' && id)
    output({ path: await workspace.buildResume(id) });
  else if (command === 'job' && action === 'add' && id && values.company && values.title)
    output(
      await workspace.save('jobs', {
        company: values.company,
        title: values.title,
        jd: await readFile(id, 'utf8'),
      }),
    );
  else throw new AppError('VALIDATION', '参数不完整，请运行 --help。');
}

main().catch((error: unknown) => {
  const known = error instanceof Error && 'code' in error;
  const code = known ? String(error.code) : 'INTERNAL';
  const message = error instanceof Error ? error.message : '操作失败。';
  process.stdout.write(JSON.stringify({ ok: false, error: { code, message } }) + '\n');
  process.exitCode = 1;
});
