import { test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startServer } from '../../apps/cli/src/server.ts';
import { Workspace } from '@nextoffer/core';

let running: Awaited<ReturnType<typeof startServer>>;
let directory: string;
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'nextoffer-browser-'));
  running = await startServer({ workspace: directory, port: 0 });
});
test.afterAll(async () => {
  await running?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('real personal-workspace journey persists notes, profile, resume, JD and interview', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(running.url);
  await page.getByRole('button', { name: '新建笔记', exact: true }).click();
  await page.getByLabel('标题', { exact: true }).fill('缓存一致性 · 项目复盘');
  await page
    .getByLabel('内容', { exact: true })
    .fill('项目里采用先更新数据库，再删除缓存。\n\n需要处理删除失败与重试。');
  await page.getByRole('button', { name: '保存笔记', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: '缓存一致性 · 项目复盘', exact: true }).last(),
  ).toBeVisible();
  await page.getByRole('button', { name: '个人资料', exact: true }).click();
  await page.getByLabel('姓名', { exact: true }).fill('测试同学');
  await page.getByRole('button', { name: '保存资料', exact: true }).click();
  await expect.poll(async () => (await new Workspace(directory).profile()).name).toBe('测试同学');
  await page.getByLabel('姓名', { exact: true }).fill('测试同学二');
  await page.getByRole('button', { name: '保存资料', exact: true }).click();
  await expect.poll(async () => (await new Workspace(directory).profile()).name).toBe('测试同学二');

  await page.getByRole('button', { name: '简历', exact: true }).click();
  await page.getByRole('button', { name: '新建简历', exact: true }).click();
  await page.getByLabel('简历名称').fill('后端实习 · 简历');
  await page.getByRole('button', { name: '创建简历', exact: true }).click();
  await expect(page.getByLabel('LaTeX 源码', { exact: true })).toBeVisible();
  const source = await page.getByLabel('LaTeX 源码', { exact: true }).inputValue();
  const draft = source.replace('你的姓名', '测试同学');
  await page.getByLabel('LaTeX 源码', { exact: true }).fill(draft);
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: '岗位', exact: true }).click();
  await expect(page.getByLabel('LaTeX 源码', { exact: true })).toHaveValue(draft);
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: '刷新工作区', exact: true }).click();
  await expect(page.getByLabel('LaTeX 源码', { exact: true })).toHaveValue(draft);
  await page.getByRole('button', { name: '保存版本', exact: true }).click();
  await expect(page.getByText('已保存 v2', { exact: true })).toBeVisible();
  await page.getByLabel('历史版本', { exact: true }).selectOption('1');
  await expect(page.getByRole('heading', { name: '原版本', exact: true })).toBeVisible();

  await page.getByRole('button', { name: '岗位', exact: true }).click();
  await page.getByRole('button', { name: '添加岗位', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('公司', { exact: true }).fill('示例科技');
  await dialog.getByLabel('岗位', { exact: true }).fill('后端开发实习生');
  await dialog.getByLabel('地点', { exact: true }).fill('上海');
  await dialog.getByLabel('投递截止', { exact: true }).fill('2026-09-30');
  await dialog
    .getByLabel('岗位描述 JD')
    .fill('熟悉 TypeScript、SQL 与缓存，能够清晰表达设计取舍。');
  await dialog
    .getByLabel('关联简历', { exact: true })
    .selectOption({ label: '后端实习 · 简历 · v2' });
  await dialog.getByRole('button', { name: '保存岗位', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.job-row')).toContainText('示例科技');
  await page.screenshot({ path: 'test-results/jobs-desktop.png', fullPage: true });

  await page.getByRole('button', { name: '面试', exact: true }).click();
  await page.getByRole('button', { name: '新建面试', exact: true }).click();
  await page.getByLabel('面试名称', { exact: true }).fill('后端一面复盘');
  await page.getByLabel('记录类型', { exact: true }).selectOption('real');
  await page.getByRole('button', { name: '创建面试', exact: true }).click();
  await page.getByLabel('面试记录内容').fill('我说明了缓存失效的顺序和重试机制。');
  await page.getByRole('button', { name: '保存记录', exact: true }).click();
  await expect(page.locator('.message.candidate')).toContainText('重试机制');
  await page.getByRole('button', { name: '结束并生成复盘', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('API Key');
  await page.reload();
  await page.getByRole('button', { name: '面试', exact: true }).click();
  await expect(page.locator('.message.candidate')).toContainText('重试机制');
  await expect(page.getByText('尚未评估', { exact: true })).toHaveCount(4);
  expect(errors).toEqual([]);
});

test('mobile navigation, settings keyboard focus and no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(running.url);
  await page.getByRole('button', { name: '模型设置', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  for (const name of ['资料', '简历', '岗位', '面试']) {
    await page.getByRole('button', { name, exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.screenshot({ path: 'test-results/interview-mobile.png', fullPage: true });
});
