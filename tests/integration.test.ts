import assert from 'node:assert/strict';
import { test } from 'node:test';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('CLI persists records, returns machine JSON, and does not initialize on help', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nextoffer-cli-'));
  const run = (...args: string[]) =>
    spawnSync(
      process.execPath,
      ['--import', 'tsx', 'apps/cli/src/index.ts', ...args, '--workspace', root, '--json'],
      { encoding: 'utf8', env: { ...process.env, NEXT_OFFER_API_KEY: '' } },
    );
  try {
    const help = run('help');
    assert.equal(help.status, 0);
    assert.match(JSON.parse(help.stdout).data.help, /NextOffer/);
    await assert.rejects(access(join(root, 'jobs')));
    const init = run('init');
    assert.equal(init.status, 0, init.stderr);
    assert.equal(JSON.parse(init.stdout).ok, true);
    const input = join(root, 'job-input.json');
    await writeFile(
      input,
      JSON.stringify({ company: '示例团队', title: '开发实习', jd: '熟悉 TypeScript' }),
    );
    const saved = JSON.parse(run('job', 'save', '--input', input).stdout);
    assert.equal(saved.ok, true);
    const read = JSON.parse(run('job', 'get', saved.data.id).stdout);
    assert.equal(read.data.jd, '熟悉 TypeScript');
    const invalid = run('job', 'get', '../outside');
    assert.notEqual(invalid.status, 0);
    assert.equal(JSON.parse(invalid.stdout).ok, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('HTTP completes a model-assisted interview and persists scores on a 100-point scale', async () => {
  const { startServer } = await import('../apps/cli/src/server.ts');
  const { Workspace } = await import('@nextoffer/core');
  const root = await mkdtemp(join(tmpdir(), 'nextoffer-model-'));
  const provider = createServer(async (request, response) => {
    for await (const _chunk of request) {
      /* consume the request */
    }
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: '能解释缓存与数据库的一致性取舍。',
                strengths: ['表述清楚'],
                improvements: ['补充异常处理'],
                rubricVersion: 1,
                dimensions: ['技术知识', '项目深度', '问题分析', '表达结构'].map((name) => ({
                  name,
                  score: 75,
                  evidence: ['answer-1'],
                })),
              }),
            },
          },
        ],
      }),
    );
  });
  await new Promise<void>((done) => provider.listen(0, '127.0.0.1', done));
  const port = (provider.address() as { port: number }).port;
  const server = await startServer({ workspace: root, port: 0 });
  try {
    const snapshot = await (await fetch(`${server.url}/api/bootstrap`)).json();
    const headers = {
      'content-type': 'application/json',
      'x-nextoffer-token': snapshot.data.token,
      origin: server.url,
    };
    await fetch(`${server.url}/api/settings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        baseUrl: `http://127.0.0.1:${port}/v1`,
        model: 'test',
        apiKey: 'test-only',
      }),
    });
    const workspace = new Workspace(root);
    const note = await workspace.save('knowledge', {
      title: '项目笔记',
      content: '通过索引降低查询开销。',
    });
    const summary = await (
      await fetch(`${server.url}/api/ai/ask`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ question: '概括要点', noteId: note.id }),
      })
    ).json();
    assert.equal(summary.data.sources[0]?.id, note.id);
    const session = await workspace.save('interviews', {
      title: '缓存练习',
      messages: [
        { id: 'question-1', role: 'interviewer', content: '如何处理缓存一致性？' },
        { id: 'answer-1', role: 'candidate', content: '写数据库后使缓存失效，并考虑重试。' },
      ],
    });
    const response = await fetch(`${server.url}/api/ai/review`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ id: session.id, revision: session.revision }),
    });
    const result = await response.json();
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.review.dimensions[0].score, 75);
    assert.equal((await workspace.get('interviews', session.id)).status, 'completed');
  } finally {
    await server.close();
    provider.closeAllConnections();
    await new Promise<void>((done) => provider.close(() => done()));
    await rm(root, { recursive: true, force: true });
  }
});

test('HTTP protects writes, shares CLI records, and exports no settings', async () => {
  const { startServer } = await import('../apps/cli/src/server.ts');
  const { Workspace } = await import('@nextoffer/core');
  const root = await mkdtemp(join(tmpdir(), 'nextoffer-http-'));
  const server = await startServer({ workspace: root, port: 0 });
  const fetchJSON = async (path: string, init?: RequestInit) => {
    const response = await fetch(`${server.url}/api${path}`, init);
    return { status: response.status, body: await response.json() };
  };
  try {
    const { body: bootstrap } = await fetchJSON('/bootstrap');
    const headers = {
      'content-type': 'application/json',
      'x-nextoffer-token': bootstrap.data.token,
      origin: server.url,
    };
    assert.equal(
      (
        await fetchJSON('/records/jobs', {
          method: 'POST',
          body: '{}',
          headers: { 'content-type': 'application/json' },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetchJSON('/records/jobs', {
          method: 'POST',
          body: '{}',
          headers: { ...headers, origin: 'https://untrusted.example' },
        })
      ).status,
      403,
    );
    const result = await fetchJSON('/records/jobs', {
      method: 'POST',
      headers,
      body: JSON.stringify({ company: '示例团队', title: '前端实习', jd: 'React' }),
    });
    assert.equal(result.status, 200);
    assert.equal((await new Workspace(root).get('jobs', result.body.data.id)).title, '前端实习');
    assert.equal(
      (
        await fetchJSON('/ai/ask', {
          method: 'POST',
          headers,
          body: JSON.stringify({ question: 'React 是什么' }),
        })
      ).body.error.code,
      'AI_NOT_CONFIGURED',
    );
    await fetchJSON('/settings', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        baseUrl: 'https://provider.example/v1',
        model: 'my-model',
        apiKey: 'test-session-secret',
      }),
    });
    const switched = await fetchJSON('/settings', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        baseUrl: 'https://different-provider.example/v1',
        model: 'my-model',
        apiKey: '',
      }),
    });
    assert.equal(switched.status, 400, 'Changing provider must not reuse the previous secret');
    assert.ok(
      !JSON.stringify((await fetchJSON('/bootstrap')).body).includes('test-session-secret'),
    );
    assert.ok(!JSON.stringify((await fetchJSON('/export')).body).includes('test-session-secret'));
    const malformed = await fetchJSON('/records/jobs', { method: 'POST', headers, body: '{' });
    assert.equal(malformed.status, 400);
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});
