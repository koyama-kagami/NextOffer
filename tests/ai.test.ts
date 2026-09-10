import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { test } from 'node:test';
import { AIError, ModelClient } from '@nextoffer/ai';

type Captured = { url?: string; headers: IncomingMessage['headers']; body: any };

async function provider(content: string, status = 200) {
  let captured: Captured | undefined;
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    captured = {
      url: request.url,
      headers: request.headers,
      body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
    };
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(
      status === 200
        ? JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] })
        : content,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1/`,
    captured: () => captured,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

const clientFor = (baseUrl: string, apiKey = 'local-test-key') =>
  new ModelClient({ baseUrl, model: 'user-model', apiKey });

test('ask sends only the selected model and grounded source notes to the compatible endpoint', async () => {
  const fake = await provider('根据《项目复盘》第 3 段，建议先量化结果。');
  try {
    const answer = await clientFor(fake.baseUrl).ask('怎么改经历？', [
      { id: 'k1', title: '项目复盘', excerpt: '吞吐提升 30%', score: 0.9, paragraph: 3 },
    ]);
    assert.equal(answer, '根据《项目复盘》第 3 段，建议先量化结果。');
    const request = fake.captured();
    assert.equal(request?.url, '/v1/chat/completions');
    assert.equal(request?.headers.authorization, 'Bearer local-test-key');
    assert.equal(request?.body.model, 'user-model');
    const prompt = request?.body.messages.map((message: any) => message.content).join('\n');
    assert.match(prompt, /项目复盘/);
    assert.match(prompt, /第 3 段/);
    assert.match(prompt, /吞吐提升 30%/);
  } finally {
    await fake.close();
  }
});

test('configuration rejects missing credentials and non-loopback plain HTTP endpoints', async () => {
  assert.throws(
    () => clientFor('https://provider.example/v1', ''),
    (error: unknown) => error instanceof AIError && error.code === 'AI_NOT_CONFIGURED',
  );
  assert.throws(
    () => clientFor('http://provider.example/v1'),
    (error: unknown) => error instanceof AIError && error.code === 'AI_INVALID_CONFIG',
  );
});

test('provider failures expose neither provider body nor API key', async () => {
  const fake = await provider('upstream leaked-secret diagnostic', 500);
  try {
    await assert.rejects(
      clientFor(fake.baseUrl, 'secret-key').ask('问题', []),
      (error: unknown) => {
        assert(error instanceof AIError);
        assert.equal(error.code, 'AI_PROVIDER_ERROR');
        assert.doesNotMatch(error.message, /leaked-secret|secret-key/);
        return true;
      },
    );
  } finally {
    await fake.close();
  }
});

test('a stalled provider is aborted at the client timeout without retrying', async () => {
  let requests = 0;
  let expire: () => void;
  const server = createServer((_request, _response) => {
    requests += 1;
    expire();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((callback: (...args: any[]) => void, delay?: number, ...args: any[]) => {
    if (delay !== 45_000) return originalSetTimeout(callback, delay, ...args);
    // Trigger the client deadline after the request arrives, independent of machine load.
    expire = () => callback(...args);
    return originalSetTimeout(expire, 5000);
  }) as typeof setTimeout;
  try {
    await assert.rejects(
      clientFor(`http://127.0.0.1:${address.port}/v1`).ask('问题', []),
      (error: unknown) => error instanceof AIError && error.code === 'AI_TIMEOUT',
    );
    assert.equal(requests, 1);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('oversized provider responses are rejected before JSON parsing', async () => {
  const fake = await provider('x'.repeat(1024 * 1024));
  try {
    await assert.rejects(
      clientFor(fake.baseUrl).ask('问题', []),
      (error: unknown) => error instanceof AIError && error.code === 'AI_RESPONSE_TOO_LARGE',
    );
  } finally {
    await fake.close();
  }
});

test('reviseResume removes Markdown fences and returns raw LaTeX', async () => {
  const fake = await provider(
    '```latex\n\\documentclass{ctexart}\n\\begin{document}新版\\end{document}\n```',
  );
  try {
    assert.equal(
      await clientFor(fake.baseUrl).reviseResume('旧版', '突出成果'),
      '\\documentclass{ctexart}\n\\begin{document}新版\\end{document}',
    );
    const prompt = fake
      .captured()
      ?.body.messages.map((message: any) => message.content)
      .join('\n');
    assert.match(prompt, /不得编造.*经历/);
    assert.match(prompt, /指标/);
    assert.match(prompt, /技能/);
  } finally {
    await fake.close();
  }
});

test('provider redirects are rejected before credentials can reach another endpoint', async () => {
  let redirectedRequests = 0;
  const receiver = createServer((_request, response) => {
    redirectedRequests += 1;
    response.end('{}');
  });
  await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
  const receiverAddress = receiver.address();
  assert(receiverAddress && typeof receiverAddress === 'object');
  const redirector = createServer((_request, response) => {
    response.writeHead(307, { location: `http://127.0.0.1:${receiverAddress.port}/captured` });
    response.end();
  });
  await new Promise<void>((resolve) => redirector.listen(0, '127.0.0.1', resolve));
  const redirectAddress = redirector.address();
  assert(redirectAddress && typeof redirectAddress === 'object');
  try {
    await assert.rejects(
      clientFor(`http://127.0.0.1:${redirectAddress.port}/v1`).ask('问题', []),
      (error: unknown) => error instanceof AIError && error.code === 'AI_NETWORK_ERROR',
    );
    assert.equal(redirectedRequests, 0);
  } finally {
    await Promise.all([
      new Promise<void>((resolve, reject) =>
        redirector.close((error) => (error ? reject(error) : resolve())),
      ),
      new Promise<void>((resolve, reject) =>
        receiver.close((error) => (error ? reject(error) : resolve())),
      ),
    ]);
  }
});

test('nextQuestion receives the full interviewer flow and context', async () => {
  const fake = await provider('你如何验证这个优化？');
  const interview = {
    id: 'i1',
    schemaVersion: 1,
    revision: 2,
    createdAt: '',
    updatedAt: '',
    title: '模拟',
    jobId: 'j1',
    resumeId: 'r1',
    mode: 'mock',
    status: 'active',
    review: null,
    messages: [
      { id: 'q1', role: 'interviewer', content: '介绍项目' },
      { id: 'a1', role: 'candidate', content: '优化了缓存' },
    ],
  } as const;
  try {
    assert.equal(
      await clientFor(fake.baseUrl).nextQuestion(interview as any, '岗位要求：性能优化'),
      '你如何验证这个优化？',
    );
    const prompt = fake
      .captured()
      ?.body.messages.map((message: any) => message.content)
      .join('\n');
    assert.match(prompt, /介绍项目/);
    assert.match(prompt, /优化了缓存/);
    assert.match(prompt, /岗位要求：性能优化/);
  } finally {
    await fake.close();
  }
});

test('review validates four dimensions and removes fabricated or non-candidate evidence', async () => {
  const result = {
    summary: '有实际案例，分析仍可深入',
    strengths: ['能说明结果'],
    improvements: ['补充验证方法'],
    rubricVersion: 1,
    dimensions: [
      { name: '技术知识', score: 80, evidence: ['a1', 'invented'] },
      { name: '项目深度', score: 70, evidence: ['q1'] },
      { name: '问题分析', score: null, evidence: [] },
      { name: '表达结构', score: 101, evidence: ['a1'] },
    ],
  };
  const fake = await provider(`\n\`\`\`json\n${JSON.stringify(result)}\n\`\`\``);
  const interview = {
    messages: [
      { id: 'q1', role: 'interviewer', content: '问题' },
      { id: 'a1', role: 'candidate', content: '回答' },
    ],
  } as any;
  try {
    await assert.rejects(
      clientFor(fake.baseUrl).review(interview, '上下文'),
      (error: unknown) => error instanceof AIError && error.code === 'AI_INVALID_RESPONSE',
    );
  } finally {
    await fake.close();
  }

  result.dimensions[3].score = 75;
  const valid = await provider(JSON.stringify(result));
  try {
    const review = await clientFor(valid.baseUrl).review(interview, '上下文');
    assert.deepEqual(review.dimensions[0].evidence, ['a1']);
    assert.equal(review.dimensions[1].score, null);
    assert.deepEqual(review.dimensions[1].evidence, []);
  } finally {
    await valid.close();
  }
});

test('review reports malformed structured output explicitly', async () => {
  const fake = await provider('{not-json');
  try {
    await assert.rejects(
      clientFor(fake.baseUrl).review({ messages: [] } as any, ''),
      (error: unknown) => error instanceof AIError && error.code === 'AI_INVALID_RESPONSE',
    );
  } finally {
    await fake.close();
  }
});
