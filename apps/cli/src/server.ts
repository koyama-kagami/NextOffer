import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { Workspace, AppError, type Kind } from '@nextoffer/core';
import type { AIConfig } from '@nextoffer/ai';
import { environmentConfig, model, interviewAction } from './ai-actions.ts';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const kinds: Kind[] = ['knowledge', 'jobs', 'resumes', 'interviews'];
const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

function send(response: ServerResponse, status: number, payload: unknown) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(payload));
}

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (!request.headers['content-type']?.startsWith('application/json'))
    throw new AppError('VALIDATION', '请求必须使用 application/json。');
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 12 * 1024 * 1024)
      throw new AppError('VALIDATION', '文件过大，单次请求最多 12 MB。');
    chunks.push(chunk);
  }
  try {
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
    return result;
  } catch {
    throw new AppError('VALIDATION', '请求内容不是有效的 JSON 对象。');
  }
}

function textField(input: Record<string, unknown>, key: string): string {
  if (typeof input[key] !== 'string' || !input[key].trim())
    throw new AppError('VALIDATION', `请提供 ${key}。`);
  return input[key] as string;
}

function revisionField(input: Record<string, unknown>): number {
  if (!Number.isInteger(input.revision) || (input.revision as number) < 1)
    throw new AppError('VALIDATION', '请提供有效 revision。');
  return input.revision as number;
}

function errorStatus(code: string) {
  if (code === 'NOT_FOUND') return 404;
  if (code === 'CONFLICT') return 409;
  if (code === 'FORBIDDEN') return 403;
  if (code === 'INTERNAL') return 500;
  return 400;
}

export async function startServer(options: { workspace: string; port?: number; dev?: boolean }) {
  const workspace = new Workspace(options.workspace);
  await workspace.init();
  const token = randomBytes(32).toString('hex');
  let ai: AIConfig = environmentConfig();
  const settings = () => ({
    baseUrl: ai.baseUrl,
    model: ai.model,
    configured: Boolean(ai.baseUrl && ai.model && ai.apiKey),
  });
  const compiled = new Map<string, { path: string; revision: number }>();
  let vite: import('vite').ViteDevServer | undefined;
  let url = '';
  const server = createServer(async (request, response) => {
    try {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : options.port;
      const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
      const host = request.headers.host || '';
      if (!allowedHosts.includes(host)) throw new AppError('FORBIDDEN', '只允许本机访问。');
      const origin = request.headers.origin;
      if (
        (origin && origin !== `http://${host}`) ||
        request.headers['sec-fetch-site'] === 'cross-site'
      )
        throw new AppError('FORBIDDEN', '请求来源不匹配。');
      const route = new URL(request.url || '/', `http://${host}`);
      const parts = route.pathname.split('/').filter(Boolean);
      if (parts[0] !== 'api') {
        if (request.method !== 'GET' && request.method !== 'HEAD')
          throw new AppError('NOT_FOUND', '页面不存在。');
        if (vite) return vite.middlewares(request, response);
        const dist = resolve(repo, 'dist/web');
        const path = resolve(dist, `.${decodeURIComponent(route.pathname)}`);
        if (!path.startsWith(dist + sep) && path !== dist)
          throw new AppError('FORBIDDEN', '路径无效。');
        let file = path;
        try {
          if (!(await stat(file)).isFile()) file = resolve(dist, 'index.html');
        } catch {
          file = resolve(dist, 'index.html');
        }
        let data: Buffer;
        try {
          data = await readFile(file);
        } catch {
          response.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
          response.end('请先运行 npm run build，或使用 npm run dev。');
          return;
        }
        response.writeHead(200, {
          'content-type': mime[extname(file)] || 'application/octet-stream',
          'x-content-type-options': 'nosniff',
          'referrer-policy': 'no-referrer',
        });
        response.end(request.method === 'HEAD' ? undefined : data);
        return;
      }
      const method = request.method || 'GET';
      if (!['GET', 'POST', 'DELETE'].includes(method))
        throw new AppError('NOT_FOUND', '接口不存在。');
      if (method !== 'GET' && request.headers['x-nextoffer-token'] !== token)
        throw new AppError('FORBIDDEN', '会话已失效，请刷新页面。');
      let result: unknown;
      if (parts[1] === 'bootstrap' && method === 'GET')
        result = {
          ...(await workspace.exportData()),
          token,
          workspace: workspace.root,
          ai: settings(),
        };
      else if (parts[1] === 'export' && method === 'GET') result = await workspace.exportData();
      else if (parts[1] === 'profile' && method === 'POST')
        result = await workspace.saveProfile(await body(request));
      else if (parts[1] === 'records' && kinds.includes(parts[2] as Kind)) {
        const kind = parts[2] as Kind;
        if (method === 'GET')
          result = parts[3] ? await workspace.get(kind, parts[3]) : await workspace.list(kind);
        else if (method === 'POST' && !parts[3])
          result = await workspace.save(kind, await body(request));
        else if (method === 'DELETE' && parts[3]) {
          const revision = Number(route.searchParams.get('revision'));
          if (!Number.isInteger(revision) || revision < 1)
            throw new AppError('VALIDATION', '删除必须提供 revision。');
          await workspace.remove(kind, parts[3], revision);
          result = null;
        } else throw new AppError('NOT_FOUND', '接口不存在。');
      } else if (parts[1] === 'search' && method === 'GET')
        result = await workspace.search(route.searchParams.get('q') || '');
      else if (parts[1] === 'import' && method === 'POST') {
        const input = await body(request);
        result = await workspace.importKnowledge(
          textField(input, 'name'),
          Buffer.from(textField(input, 'base64'), 'base64'),
        );
      } else if (parts[1] === 'resumes' && parts[2]) {
        if (parts[3] === 'versions' && method === 'GET')
          result = await workspace.versions(parts[2]);
        else if (parts[3] === 'build' && method === 'POST') {
          const record = await workspace.get('resumes', parts[2]);
          const path = await workspace.buildResume(parts[2]);
          compiled.set(record.id, { path, revision: record.revision });
          result = { url: `/api/resumes/${record.id}/pdf?r=${record.revision}` };
        } else if (parts[3] === 'pdf' && method === 'GET') {
          const record = await workspace.get('resumes', parts[2]);
          const pdf = compiled.get(record.id);
          if (!pdf || pdf.revision !== record.revision)
            throw new AppError('NOT_FOUND', '请重新编译当前简历。');
          const data = await readFile(pdf.path);
          response.writeHead(200, {
            'content-type': 'application/pdf',
            'cache-control': 'no-store',
          });
          response.end(data);
          return;
        } else throw new AppError('NOT_FOUND', '接口不存在。');
      } else if (parts[1] === 'settings' && method === 'POST') {
        const input = await body(request);
        if (input.clear === true) ai = { baseUrl: '', model: '', apiKey: '' };
        else {
          const next = {
            baseUrl: textField(input, 'baseUrl').trim(),
            model: textField(input, 'model').trim(),
            apiKey:
              typeof input.apiKey === 'string' && input.apiKey.trim()
                ? input.apiKey.trim()
                : ai.apiKey,
          };
          model(next); // Validate before replacing the current configuration.
          if (
            ai.baseUrl &&
            new URL(next.baseUrl).origin !== new URL(ai.baseUrl).origin &&
            !(typeof input.apiKey === 'string' && input.apiKey.trim())
          ) {
            throw new AppError('VALIDATION', '更换模型服务商时，请填写该服务商的 API Key。');
          }
          ai = next;
        }
        result = settings();
      } else if (parts[1] === 'ai' && method === 'POST') {
        const input = await body(request);
        if (parts[2] === 'ask') {
          const question = textField(input, 'question');
          const note =
            typeof input.noteId === 'string' && input.noteId
              ? await workspace.get('knowledge', input.noteId)
              : null;
          const sources = note
            ? note.content
                .split(/\r?\n\s*\r?\n/)
                .slice(0, 20)
                .map((excerpt, index) => ({
                  id: note.id,
                  title: note.title,
                  excerpt: excerpt.slice(0, 3000),
                  score: 1,
                  paragraph: index + 1,
                }))
            : (await workspace.search(question)).slice(0, 12);
          result = { answer: await model(ai).ask(question, sources), sources };
        } else if (parts[2] === 'resume')
          result = {
            source: await model(ai).reviseResume(
              textField(input, 'source'),
              textField(input, 'instruction'),
            ),
          };
        else if (parts[2] === 'question' || parts[2] === 'review')
          result = await interviewAction(
            workspace,
            ai,
            parts[2],
            textField(input, 'id'),
            revisionField(input),
          );
        else throw new AppError('NOT_FOUND', '接口不存在。');
      } else throw new AppError('NOT_FOUND', '接口不存在。');
      send(response, 200, { ok: true, data: result });
    } catch (error) {
      const known =
        error instanceof Error &&
        'code' in error &&
        typeof error.code === 'string' &&
        /^[A-Z_]+$/.test(error.code) &&
        !error.code.startsWith('E');
      const code = known ? String(error.code) : 'INTERNAL';
      send(response, errorStatus(code), {
        ok: false,
        error: { code, message: known ? error.message : '操作失败，请检查工作区权限或稍后重试。' },
      });
    }
  });
  if (options.dev) {
    const { createServer: createVite } = await import('vite');
    vite = await createVite({
      configFile: resolve(repo, 'apps/web/vite.config.ts'),
      server: { middlewareMode: true, hmr: { server } },
      appType: 'spa',
    });
  }
  try {
    await new Promise<void>((resolveListen, reject) => {
      server.once('error', reject);
      server.listen(options.port ?? 4317, '127.0.0.1', resolveListen);
    });
  } catch (error) {
    await vite?.close();
    throw error;
  }
  const address = server.address();
  url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : options.port}`;
  return {
    url,
    workspace,
    close: async () => {
      await vite?.close();
      server.closeIdleConnections();
      await new Promise<void>((done, reject) =>
        server.close((error) => (error ? reject(error) : done())),
      );
    },
  };
}
