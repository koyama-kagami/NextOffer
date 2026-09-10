import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppError, Workspace, resumeTemplate } from '@nextoffer/core';

async function fixture(run: (root: string, workspace: Workspace) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'nextoffer-core-'));
  try {
    const workspace = new Workspace(root);
    await workspace.init();
    await run(root, workspace);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function rejectsCode(promise: Promise<unknown>, code: string) {
  await assert.rejects(
    promise,
    (error: unknown) => error instanceof AppError && error.code === code,
  );
}

function minimalPdf(text = ''): Buffer {
  const stream = text ? `BT /F1 12 Tf 72 100 Td (${text}) Tj ET` : '';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n `)
    .join('\n')}\n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'ascii');
}

test('init is idempotent and profile has usable empty defaults', () =>
  fixture(async (_root, workspace) => {
    await workspace.init();
    assert.deepEqual(await workspace.profile(), {
      name: '',
      email: '',
      phone: '',
      education: '',
      experience: '',
      skills: '',
      updatedAt: '',
      revision: 0,
    });
    const profile = await workspace.saveProfile({ name: '小林', revision: 0 });
    assert.equal(profile.revision, 1);
    assert.equal((await workspace.profile()).name, '小林');
    await rejectsCode(workspace.saveProfile({ name: '旧值', revision: 0 }), 'CONFLICT');
    await rejectsCode(workspace.saveProfile({ name: '遗漏修订号' }), 'VALIDATION');
  }));

test('records persist defaults and enforce revisions for update and remove', () =>
  fixture(async (_root, workspace) => {
    const job = await workspace.save('jobs', {
      company: '字节',
      title: '工程师',
      jd: 'TypeScript',
    });
    assert.equal(job.status, 'saved');
    assert.equal(job.revision, 1);
    await rejectsCode(workspace.save('jobs', { id: job.id, title: '无修订号' }), 'VALIDATION');
    await rejectsCode(workspace.save('jobs', { ...job, revision: 0, title: '冲突' }), 'CONFLICT');
    const updated = await workspace.save('jobs', { ...job, title: '高级工程师' });
    assert.equal(updated.revision, 2);
    await rejectsCode(workspace.remove('jobs', job.id, 1), 'CONFLICT');
    await workspace.remove('jobs', job.id, 2);
    await rejectsCode(workspace.get('jobs', job.id), 'NOT_FOUND');
  }));

test('external Markdown edits are returned and participate in revision conflicts', () =>
  fixture(async (root, workspace) => {
    const job = await workspace.save('jobs', { company: 'A', title: '后端', jd: '旧 JD' });
    await writeFile(join(root, 'jobs', job.id, 'jd.md'), '外部修改的 JD\n', 'utf8');
    const changed = await workspace.get('jobs', job.id);
    assert.equal(changed.jd, '外部修改的 JD\n');
    assert.equal(changed.revision, 2);
    await rejectsCode(workspace.save('jobs', { ...job, notes: 'stale' }), 'CONFLICT');
  }));

test('external metadata edits bump revision before stale saves', () =>
  fixture(async (root, workspace) => {
    const job = await workspace.save('jobs', { company: 'A', title: '原岗位' });
    const path = join(root, 'jobs', job.id, 'job.json');
    const metadata = JSON.parse(await readFile(path, 'utf8'));
    metadata.title = '外部岗位';
    await writeFile(path, JSON.stringify(metadata), 'utf8');
    const changed = await workspace.get('jobs', job.id);
    assert.equal(changed.title, '外部岗位');
    assert.equal(changed.revision, 2);
    await rejectsCode(workspace.save('jobs', { ...job, notes: '旧页面' }), 'CONFLICT');
  }));

test('corrupt records and unsafe ids fail explicitly', () =>
  fixture(async (root, workspace) => {
    const job = await workspace.save('jobs', { company: 'A', title: 'B' });
    await writeFile(join(root, 'jobs', job.id, 'job.json'), '{', 'utf8');
    await rejectsCode(workspace.get('jobs', job.id), 'CORRUPT_RECORD');
    await rejectsCode(workspace.get('jobs', '../outside'), 'VALIDATION');
    const outside = await mkdtemp(join(tmpdir(), 'nextoffer-outside-'));
    try {
      await symlink(outside, join(root, 'knowledge', 'escape'), 'junction');
      await rejectsCode(workspace.get('knowledge', 'escape'), 'VALIDATION');
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  }));

test('knowledge import and Chinese keyword search return paragraph evidence', () =>
  fixture(async (root, workspace) => {
    const note = await workspace.importKnowledge(
      '项目笔记.md',
      new TextEncoder().encode('支付系统使用幂等键。\n\n消息队列处理异步任务。'),
    );
    const hits = await workspace.search('支付 幂等');
    assert.equal(hits[0]?.id, note.id);
    assert.equal(hits[0]?.paragraph, 1);
    assert.match(hits[0]?.excerpt ?? '', /幂等键/);
    assert.equal(
      await readFile(join(root, 'knowledge', note.id, 'original', '项目笔记.md'), 'utf8'),
      '支付系统使用幂等键。\n\n消息队列处理异步任务。',
    );
    await rejectsCode(workspace.importKnowledge('bad.exe', new Uint8Array()), 'VALIDATION');
  }));

test('PDF import accepts Node buffers and rejects image-only or blank documents', () =>
  fixture(async (_root, workspace) => {
    const document = await workspace.importKnowledge('resume.pdf', minimalPdf('Buffer PDF text'));
    assert.match(document.content, /Buffer PDF text/);
    await rejectsCode(workspace.importKnowledge('scan.pdf', minimalPdf()), 'OCR_REQUIRED');
  }));

test('resume versions are immutable and external LaTeX changes create a version', () =>
  fixture(async (root, workspace) => {
    const resume = await workspace.save('resumes', { title: '中文简历', source: resumeTemplate });
    const updated = await workspace.save('resumes', {
      ...resume,
      source: resumeTemplate + '\n新经历',
    });
    assert.deepEqual(
      (await workspace.versions(resume.id)).map((v) => v.version),
      [1, 2],
    );
    await writeFile(
      join(root, 'resumes', resume.id, 'resume.tex'),
      resumeTemplate + '\n外部修改',
      'utf8',
    );
    const external = await workspace.get('resumes', resume.id);
    assert.equal(external.version, 3);
    assert.match(external.source, /外部修改/);
    assert.equal(updated.version, 2);
  }));

test('tampered resume snapshots fail instead of losing historical content', () =>
  fixture(async (root, workspace) => {
    const resume = await workspace.save('resumes', { title: '简历', source: '第一版' });
    const updated = await workspace.save('resumes', { ...resume, source: '第二版' });
    await writeFile(
      join(root, 'resumes', resume.id, 'versions', '1', 'resume.tex'),
      '篡改',
      'utf8',
    );
    await rejectsCode(workspace.get('resumes', updated.id), 'CORRUPT_RECORD');
  }));

test('resume version is generated by core and interview captures the selected version', () =>
  fixture(async (_root, workspace) => {
    const resume = await workspace.save('resumes', { title: '简历', source: '内容', version: 99 });
    assert.equal(resume.version, 1);
    const interview = await workspace.save('interviews', { title: '面试', resumeId: resume.id });
    assert.equal(interview.resumeVersion, 1);
    assert.equal(interview.contextSnapshot, '');
  }));

test('interview review accepts 100-point scores and requires evidence for scored dimensions', () =>
  fixture(async (_root, workspace) => {
    const interview = await workspace.save('interviews', {
      title: '模拟',
      messages: [{ id: 'answer-1', role: 'candidate', content: '我的回答' }],
      review: {
        summary: '复盘',
        strengths: [],
        improvements: [],
        rubricVersion: 1,
        dimensions: [
          { name: '技术知识', score: 75, evidence: ['answer-1'] },
          { name: '项目深度', score: null, evidence: [] },
          { name: '问题分析', score: null, evidence: [] },
          { name: '表达结构', score: null, evidence: [] },
        ],
      },
    });
    assert.equal(interview.review?.dimensions[0].score, 75);
    await rejectsCode(
      workspace.save('interviews', {
        ...interview,
        review: {
          ...interview.review!,
          dimensions: interview.review!.dimensions.map((d, i) =>
            i === 0 ? { ...d, score: 101, evidence: ['answer-1'] } : d,
          ),
        },
      }),
      'VALIDATION',
    );
    await rejectsCode(
      workspace.save('interviews', {
        ...interview,
        review: {
          ...interview.review!,
          dimensions: interview.review!.dimensions.map((d, i) =>
            i === 0 ? { ...d, score: 80, evidence: [] } : d,
          ),
        },
      }),
      'VALIDATION',
    );
  }));

test('external interview transcript and review edits become canonical record changes', () =>
  fixture(async (root, workspace) => {
    const interview = await workspace.save('interviews', {
      title: '外部编辑',
      messages: [{ id: 'answer-1', role: 'candidate', content: '旧回答' }],
    });
    const dir = join(root, 'interviews', interview.id);
    await writeFile(
      join(dir, 'transcript.md'),
      '## candidate (answer-1)\n\n外部修改的回答\n',
      'utf8',
    );
    const changed = await workspace.get('interviews', interview.id);
    assert.equal(changed.messages[0].content, '外部修改的回答');
    assert.equal(changed.revision, 2);
    await writeFile(
      join(dir, 'review.json'),
      JSON.stringify({
        summary: '外部复盘',
        strengths: [],
        improvements: [],
        rubricVersion: 1,
        dimensions: ['技术知识', '项目深度', '问题分析', '表达结构'].map((name) => ({
          name,
          score: 75,
          evidence: ['answer-1'],
        })),
      }),
      'utf8',
    );
    const reviewed = await workspace.get('interviews', interview.id);
    assert.equal(reviewed.review?.summary, '外部复盘');
    assert.equal(reviewed.revision, 3);
  }));

test('external multiline interview answers round-trip without omitted text', () =>
  fixture(async (root, workspace) => {
    const interview = await workspace.save('interviews', { title: '多段回答' });
    const transcript = '## candidate (answer-1)\n\nedited\nline2\n\nline3';
    await writeFile(join(root, 'interviews', interview.id, 'transcript.md'), transcript, 'utf8');
    const changed = await workspace.get('interviews', interview.id);
    assert.equal(changed.messages[0].content, 'edited\nline2\n\nline3');
    await workspace.save('interviews', { ...changed, title: '保存后' });
    assert.match(
      await readFile(join(root, 'interviews', interview.id, 'transcript.md'), 'utf8'),
      /edited\nline2\n\nline3$/,
    );
  }));

test('metadata cannot select a resume version outside its record directory', () =>
  fixture(async (root, workspace) => {
    const resume = await workspace.save('resumes', { title: '简历', source: resumeTemplate });
    const path = join(root, 'resumes', resume.id, 'record.json');
    const metadata = JSON.parse(await readFile(path, 'utf8'));
    metadata.version = '../../outside';
    await writeFile(path, JSON.stringify(metadata), 'utf8');
    await rejectsCode(workspace.get('resumes', resume.id), 'CORRUPT_RECORD');
  }));

test('export returns all business data without internal fingerprints', () =>
  fixture(async (_root, workspace) => {
    await workspace.save('knowledge', { title: '笔记', content: '内容' });
    const data = await workspace.exportData();
    assert.equal(data.knowledge.length, 1);
    assert.equal(JSON.stringify(data).includes('fingerprint'), false);
  }));
