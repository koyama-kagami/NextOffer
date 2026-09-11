import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { AppError } from './types.ts';

export async function compileResume(directory: string, source: string): Promise<string> {
  if (/\\(?:input|include|openin|read|usepackage)\s*\{?\s*(?:[A-Za-z]:|\/|\\\\|\.\.)/i.test(source))
    throw new AppError('VALIDATION', '简历源码包含工作区外文件引用', 400);
  await access(join(directory, 'resume.tex')).catch(() => {
    throw new AppError('CORRUPT_RECORD', '简历源码缺失');
  });
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      'xelatex',
      ['-no-shell-escape', '-halt-on-error', '-interaction=nonstopmode', 'resume.tex'],
      {
        cwd: directory,
        env: { ...process.env, openin_any: 'p', openout_any: 'p', TEXMFOUTPUT: directory },
      },
    );
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk).slice(0, 1000);
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new AppError('COMPILE_FAILED', 'XeLaTeX 编译超时'));
    }, 20_000);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(
        (error as NodeJS.ErrnoException).code === 'ENOENT'
          ? new AppError('NO_LATEX', '未安装 XeLaTeX')
          : new AppError('COMPILE_FAILED', '无法启动 XeLaTeX'),
      );
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      code === 0
        ? resolve()
        : reject(
            new AppError(
              'COMPILE_FAILED',
              `XeLaTeX 编译失败${stderr ? `: ${stderr.slice(0, 240)}` : ''}`,
            ),
          );
    });
  });
  return join(directory, 'resume.pdf');
}
