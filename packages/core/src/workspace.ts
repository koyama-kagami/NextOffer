import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import {
  access,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { compileResume } from './latex.ts';
import { searchKnowledge } from './search.ts';
import { AppError } from './types.ts';
import type {
  Interview,
  Kind,
  Knowledge,
  Message,
  Profile,
  RecordMap,
  Resume,
  Review,
  SearchHit,
} from './types.ts';
import {
  emptyProfile,
  kinds,
  normalize,
  safeId,
  validateProfile,
  validateReview,
} from './validation.ts';

type Metadata = Record<string, unknown> & {
  _metaFingerprint?: string;
  sourceFingerprint?: string;
  transcriptFingerprint?: string;
  reviewFingerprint?: string;
  versionFingerprints?: string[];
};

const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const timestamp = () => new Date().toISOString();

export class Workspace {
  readonly root: string;

  constructor(root: string) {
    if (!root?.trim()) throw new AppError('VALIDATION', '工作区路径不能为空', 400);
    this.root = resolve(root);
  }

  async init(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    for (const directory of [...kinds, '.index', '.locks'])
      await mkdir(join(this.root, directory), { recursive: true });
  }

  async list<K extends Kind>(kind: K): Promise<RecordMap[K][]> {
    this.assertKind(kind);
    await this.init();
    await this.assertContained(join(this.root, kind));
    const entries = await readdir(join(this.root, kind), { withFileTypes: true });
    const records: RecordMap[K][] = [];
    for (const entry of entries)
      if (entry.isDirectory() && safeId.test(entry.name))
        records.push(await this.get(kind, entry.name));
    return records.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async get<K extends Kind>(kind: K, id: string): Promise<RecordMap[K]> {
    this.assertKind(kind);
    await this.recordDirectory(kind, id, true);
    return this.withLock(`${kind}-${id}`, () => this.readRecord(kind, id));
  }

  async save<K extends Kind>(kind: K, input: Partial<RecordMap[K]>): Promise<RecordMap[K]> {
    this.assertKind(kind);
    await this.init();
    const suppliedId = input.id;
    if (suppliedId !== undefined && !safeId.test(suppliedId))
      throw new AppError('VALIDATION', '记录 ID 非法', 400);
    if (suppliedId && !Number.isInteger(input.revision))
      throw new AppError('VALIDATION', '更新记录必须提供 revision', 400);
    const id = suppliedId || randomUUID();
    return this.withLock(`${kind}-${id}`, async () => {
      let current: RecordMap[K] | undefined;
      if (suppliedId) {
        await this.recordDirectory(kind, id, true);
        current = await this.readRecord(kind, id);
        if (input.revision !== current.revision)
          throw new AppError('CONFLICT', '记录已被其他操作修改', 409);
      }
      const stamp = timestamp();
      const next: Record<string, unknown> = { ...(current ?? {}), ...input };
      if (kind === 'resumes') {
        const source = (input as Partial<Resume>).source;
        next.version =
          current && typeof source === 'string' && source !== (current as Resume).source
            ? (current as Resume).version + 1
            : ((current as Resume | undefined)?.version ?? 1);
      }
      if (kind === 'interviews') {
        const prior = current as Interview | undefined;
        const resumeId = typeof next.resumeId === 'string' ? next.resumeId : '';
        if (resumeId && (!prior || prior.resumeId !== resumeId))
          next.resumeVersion = (await this.get('resumes', resumeId)).version;
        if (!resumeId) next.resumeVersion = null;
      }
      const record = normalize(kind, {
        ...next,
        id,
        schemaVersion: 1,
        revision: (current?.revision ?? 0) + 1,
        createdAt: current?.createdAt ?? stamp,
        updatedAt: stamp,
      });
      await this.writeRecord(kind, record);
      return record;
    });
  }

  async remove(kind: Kind, id: string, revision: number): Promise<void> {
    this.assertKind(kind);
    await this.recordDirectory(kind, id, true);
    await this.withLock(`${kind}-${id}`, async () => {
      const current = await this.readRecord(kind, id);
      if (current.revision !== revision)
        throw new AppError('CONFLICT', '记录已被其他操作修改', 409);
      await rm(await this.recordDirectory(kind, id, true), { recursive: true });
    });
  }

  async profile(): Promise<Profile> {
    await this.init();
    const path = join(this.root, 'profile.json');
    try {
      await this.assertContained(path);
      return validateProfile(JSON.parse(await readFile(path, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyProfile();
      if (error instanceof AppError) throw error;
      throw new AppError('CORRUPT_RECORD', `个人资料损坏: ${path}`);
    }
  }

  async saveProfile(input: Partial<Profile>): Promise<Profile> {
    await this.init();
    return this.withLock('profile', async () => {
      const current = await this.profile();
      if (current.revision > 0 && !Number.isInteger(input.revision))
        throw new AppError('VALIDATION', '更新个人资料必须提供 revision', 400);
      if (input.revision !== undefined && input.revision !== current.revision)
        throw new AppError('CONFLICT', '个人资料已被修改', 409);
      const result = validateProfile({
        ...current,
        ...input,
        updatedAt: timestamp(),
        revision: current.revision + 1,
      });
      await this.atomicJson(join(this.root, 'profile.json'), result);
      return result;
    });
  }

  async search(query: string): Promise<SearchHit[]> {
    return searchKnowledge(await this.list('knowledge'), query);
  }

  async importKnowledge(name: string, bytes: Uint8Array): Promise<Knowledge> {
    const extension = extname(name).toLowerCase();
    if (!['.md', '.txt', '.pdf'].includes(extension) || basename(name) !== name)
      throw new AppError('VALIDATION', '仅支持安全命名的 Markdown、TXT 或 PDF', 400);
    let content: string;
    if (extension === '.pdf') {
      try {
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const pdf = await pdfjs.getDocument({ data: Uint8Array.from(bytes), useSystemFonts: true })
          .promise;
        const pages: string[] = [];
        for (let index = 1; index <= pdf.numPages; index++) {
          const text = await (await pdf.getPage(index)).getTextContent();
          pages.push(text.items.map((item) => ('str' in item ? item.str : '')).join(' '));
        }
        content = pages.join('\n\n').trim();
      } catch {
        throw new AppError('VALIDATION', 'PDF 无法解析');
      }
      if (!content) throw new AppError('OCR_REQUIRED', 'PDF 没有可提取文本，需要先进行 OCR', 400);
    } else {
      try {
        content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        throw new AppError('VALIDATION', '文本不是有效的 UTF-8', 400);
      }
    }
    const record = await this.save('knowledge', {
      title: basename(name, extension),
      content,
      tags: [],
    });
    const directory = join(this.root, 'knowledge', record.id, 'original');
    await mkdir(directory, { recursive: true });
    await this.atomicWrite(join(directory, name), bytes);
    return record;
  }

  async versions(id: string): Promise<{ version: number; source: string }[]> {
    const resume = await this.get('resumes', id);
    const result: { version: number; source: string }[] = [];
    for (let version = 1; version <= resume.version; version++)
      result.push({
        version,
        source: await this.readSafe(
          join(this.root, 'resumes', id, 'versions', String(version), 'resume.tex'),
        ),
      });
    return result;
  }

  async buildResume(id: string): Promise<string> {
    const resume = await this.get('resumes', id);
    return compileResume(join(this.root, 'resumes', id), resume.source);
  }

  async exportData() {
    return {
      profile: await this.profile(),
      knowledge: await this.list('knowledge'),
      jobs: await this.list('jobs'),
      resumes: await this.list('resumes'),
      interviews: await this.list('interviews'),
    };
  }

  private async readRecord<K extends Kind>(kind: K, id: string): Promise<RecordMap[K]> {
    const directory = await this.recordDirectory(kind, id, true);
    const metadataPath = join(directory, this.metadataName(kind));
    let metadata: Metadata;
    try {
      metadata = JSON.parse(await this.readSafe(metadataPath));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new AppError('NOT_FOUND', `记录不存在: ${id}`, 404);
      if (error instanceof AppError) throw error;
      throw new AppError('CORRUPT_RECORD', `记录损坏: ${metadataPath}`);
    }
    try {
      let changed = metadata._metaFingerprint !== this.metadataFingerprint(kind, metadata);
      if (kind === 'knowledge' || kind === 'jobs') {
        const source = await this.readSafe(
          join(directory, kind === 'knowledge' ? 'source.md' : 'jd.md'),
        );
        changed ||= metadata.sourceFingerprint !== digest(source);
        metadata[kind === 'knowledge' ? 'content' : 'jd'] = source;
      } else if (kind === 'resumes') {
        const version = Number(metadata.version);
        if (!Number.isInteger(version) || version < 1)
          throw new AppError('CORRUPT_RECORD', '简历版本无效');
        const fingerprints = metadata.versionFingerprints;
        if (!Array.isArray(fingerprints) || fingerprints.length !== version)
          throw new AppError('CORRUPT_RECORD', '简历版本索引损坏');
        for (let index = 1; index <= version; index++) {
          const snapshot = await this.readSafe(
            join(directory, 'versions', String(index), 'resume.tex'),
          );
          if (digest(snapshot) !== fingerprints[index - 1])
            throw new AppError('CORRUPT_RECORD', `简历历史版本 ${index} 已被修改`);
        }
        const source = await this.readSafe(join(directory, 'resume.tex'));
        if (metadata.sourceFingerprint !== digest(source)) {
          const nextVersion = version + 1;
          await mkdir(join(directory, 'versions', String(nextVersion)), { recursive: true });
          await this.atomicWrite(
            join(directory, 'versions', String(nextVersion), 'resume.tex'),
            source,
          );
          metadata.version = nextVersion;
          metadata.versionFingerprints = [...fingerprints, digest(source)];
          changed = true;
        }
        metadata.source = source;
      } else {
        const transcript = await this.readSafe(join(directory, 'transcript.md'));
        if (metadata.transcriptFingerprint !== digest(transcript)) {
          metadata.messages = this.parseTranscript(transcript);
          changed = true;
        }
        const reviewPath = join(directory, 'review.json');
        let reviewText = '';
        try {
          reviewText = await this.readSafe(reviewPath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        if (metadata.reviewFingerprint !== digest(reviewText)) {
          metadata.review = reviewText ? JSON.parse(reviewText) : null;
          changed = true;
        }
      }
      const record = normalize(kind, metadata);
      if (changed) {
        metadata.revision = record.revision + 1;
        metadata.updatedAt = timestamp();
        await this.prepareFingerprints(kind, metadata);
        await this.atomicJson(metadataPath, metadata);
        return normalize(kind, metadata);
      }
      return record;
    } catch (error) {
      if (error instanceof AppError && error.code === 'CORRUPT_RECORD') throw error;
      throw new AppError('CORRUPT_RECORD', `记录字段或关联文件损坏: ${metadataPath}`);
    }
  }

  private async writeRecord<K extends Kind>(kind: K, record: RecordMap[K]): Promise<void> {
    const directory = join(this.root, kind, record.id);
    await mkdir(directory, { recursive: true });
    await this.assertContained(directory);
    const metadata: Metadata = { ...record };
    if (kind === 'knowledge' || kind === 'jobs') {
      const source =
        kind === 'knowledge' ? (record as Knowledge).content : (record as RecordMap['jobs']).jd;
      await this.atomicWrite(join(directory, kind === 'knowledge' ? 'source.md' : 'jd.md'), source);
      delete metadata[kind === 'knowledge' ? 'content' : 'jd'];
    } else if (kind === 'resumes') {
      const resume = record as Resume;
      const currentPath = join(directory, 'resume.tex');
      await this.atomicWrite(currentPath, resume.source);
      const versionPath = join(directory, 'versions', String(resume.version), 'resume.tex');
      await mkdir(dirname(versionPath), { recursive: true });
      try {
        await access(versionPath);
        if ((await readFile(versionPath, 'utf8')) !== resume.source)
          throw new AppError('CONFLICT', '简历版本不可覆盖', 409);
      } catch (error) {
        if (error instanceof AppError) throw error;
        await this.atomicWrite(versionPath, resume.source);
      }
      const prior = await this.loadMetadata(join(directory, this.metadataName(kind)));
      metadata.versionFingerprints = [
        ...(prior?.versionFingerprints ?? []).slice(0, resume.version - 1),
        digest(resume.source),
      ];
      delete metadata.source;
    } else {
      const interview = record as Interview;
      await this.atomicWrite(
        join(directory, 'transcript.md'),
        this.formatTranscript(interview.messages),
      );
      if (interview.review) await this.atomicJson(join(directory, 'review.json'), interview.review);
      else await rm(join(directory, 'review.json'), { force: true });
    }
    await this.prepareFingerprints(kind, metadata);
    await this.atomicJson(join(directory, this.metadataName(kind)), metadata);
  }

  private async prepareFingerprints(kind: Kind, metadata: Metadata) {
    const directory = join(this.root, kind, String(metadata.id));
    if (kind === 'knowledge' || kind === 'jobs' || kind === 'resumes')
      metadata.sourceFingerprint = digest(
        await this.readSafe(
          join(
            directory,
            kind === 'knowledge' ? 'source.md' : kind === 'jobs' ? 'jd.md' : 'resume.tex',
          ),
        ),
      );
    if (kind === 'interviews') {
      const transcript = await this.readSafe(join(directory, 'transcript.md'));
      metadata.transcriptFingerprint = digest(transcript);
      let review = '';
      try {
        review = await this.readSafe(join(directory, 'review.json'));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      metadata.reviewFingerprint = digest(review);
    }
    metadata._metaFingerprint = this.metadataFingerprint(kind, metadata);
  }

  private metadataFingerprint(kind: Kind, metadata: Metadata) {
    const ignored = new Set([
      '_metaFingerprint',
      'sourceFingerprint',
      'transcriptFingerprint',
      'reviewFingerprint',
      'versionFingerprints',
      'revision',
      'updatedAt',
    ]);
    if (kind === 'interviews') {
      ignored.add('messages');
      ignored.add('review');
    }
    return digest(
      JSON.stringify(
        Object.fromEntries(
          Object.entries(metadata)
            .filter(([key]) => !ignored.has(key))
            .sort(([a], [b]) => a.localeCompare(b)),
        ),
      ),
    );
  }

  private formatTranscript(messages: Message[]) {
    return messages
      .map((message) => `## ${message.role} (${message.id})\n\n${message.content}`)
      .join('\n\n');
  }
  private parseTranscript(source: string): Message[] {
    if (!source.trim()) return [];
    const heading = /^## (interviewer|candidate) \(([A-Za-z0-9_-]+)\)\r?$/gm;
    const matches = [...source.matchAll(heading)];
    if (!matches.length || source.slice(0, matches[0].index).trim()) {
      throw new AppError('CORRUPT_RECORD', '面试记录 Markdown 格式无效');
    }
    const messages: Message[] = [];
    for (let index = 0; index < matches.length; index++) {
      const match = matches[index];
      const contentStart = match.index + match[0].length;
      const contentEnd = matches[index + 1]?.index ?? source.length;
      const separator = source.slice(contentStart, Math.min(contentStart + 2, contentEnd));
      if (!/^\r?\n/.test(separator))
        throw new AppError('CORRUPT_RECORD', '面试记录 Markdown 格式无效');
      messages.push({
        role: match[1] as Message['role'],
        id: match[2],
        content: source
          .slice(contentStart, contentEnd)
          .replace(/^\r?\n\r?\n/, '')
          .replace(/\s+$/, ''),
      });
    }
    return messages;
  }

  private metadataName(kind: Kind) {
    return kind === 'jobs' ? 'job.json' : kind === 'interviews' ? 'session.json' : 'record.json';
  }
  private assertKind(kind: string): asserts kind is Kind {
    if (!kinds.includes(kind as Kind)) throw new AppError('VALIDATION', '记录类型无效', 400);
  }
  private async recordDirectory(kind: Kind, id: string, mustExist: boolean) {
    if (!safeId.test(id)) throw new AppError('VALIDATION', '记录 ID 非法', 400);
    const path = join(this.root, kind, id);
    if (mustExist) {
      try {
        await this.assertContained(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT')
          throw new AppError('NOT_FOUND', `记录不存在: ${id}`, 404);
        throw error;
      }
    }
    return path;
  }
  private async assertContained(path: string) {
    const [root, actual] = await Promise.all([realpath(this.root), realpath(path)]);
    if (actual !== root && !actual.startsWith(root + sep))
      throw new AppError('VALIDATION', '工作区路径越界', 400);
  }
  private async readSafe(path: string) {
    await this.assertContained(path);
    return readFile(path, 'utf8');
  }
  private async loadMetadata(path: string): Promise<Metadata | undefined> {
    try {
      return JSON.parse(await this.readSafe(path));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }
  private async atomicJson(path: string, value: unknown) {
    await this.atomicWrite(path, JSON.stringify(value, null, 2) + '\n');
  }
  private async atomicWrite(path: string, value: string | Uint8Array) {
    await mkdir(dirname(path), { recursive: true });
    await this.assertContained(dirname(path));
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, value);
    await rename(temporary, path).catch(async (error) => {
      await rm(temporary, { force: true });
      throw error;
    });
  }
  private async withLock<T>(name: string, work: () => Promise<T>): Promise<T> {
    await this.init();
    const path = join(this.root, '.locks', `${name}.lock`);
    const deadline = Date.now() + 3000;
    let handle;
    while (!handle) {
      try {
        handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
        await handle.writeFile(`${process.pid}\n`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || Date.now() >= deadline)
          throw new AppError('CONFLICT', '工作区正被其他进程修改', 409);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    try {
      return await work();
    } finally {
      await handle.close();
      await rm(path, { force: true });
    }
  }
}
