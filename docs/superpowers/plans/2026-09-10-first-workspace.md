# NextOffer 第一版实施计划

> **For agentic workers:** Use subagent-driven-development or executing-plans to implement task-by-task. Shared interfaces are defined in `docs/contracts.md`.

**Goal:** 实现可本地运行的个人求职工作台，CLI 与 Web 共享数据，支持用户模型 API 与 coding agent 导入结果。

**Architecture:** TypeScript 文件核心库、独立模型适配库、Node 本地服务、React Web。API Key 仅来自当前用户输入或环境变量，不预置公共 Key；本轮不使用任何已有凭据。

**Tech Stack:** Node 22.13+、TypeScript、React、Vite、Zod、pdfjs-dist、Node test runner。

**Spec:** ../specs/2026-09-10-nextoffer-design.md

## Global Constraints

- 单用户、本地运行、中文 UI；不引入数据库服务、消息队列。
- CLI/Web 同一核心，Markdown、LaTeX、JSON 为可编辑事实源。
- 用户自备模型，不创建或复用开发者凭据。模型测试使用本地 HTTP 测试服务。
- 真实资料初始为空；浏览器测试在独立临时工作区生成示例。
- TUI、语音、自动采集和自动填写不进入本阶段。

## Task 1: 文件核心

Files: `packages/core/src/{types,workspace,validation,index,search,latex}.ts`, `tests/core.test.ts`.

Interfaces: `docs/contracts.md` 的 Workspace、RecordMap、SearchHit。

- [x] 写入与重读、并发旧 revision 拒绝、非法路径、中文检索、版本保存测试；先运行并观察缺失实现失败。
- [x] 实现校验、原子写入与跨进程写锁；直接读取 Markdown/LaTeX 文本。编译仅允许固定 XeLaTeX 参数并限制时间。
- [x] `npm test` 验证真实临时目录的持久化、坏记录及冲突。

```ts
const workspace = new Workspace(tempDirectory);
await workspace.init();
const job = await workspace.save('jobs', { company: '示例公司', title: '后端实习', jd: '熟悉 SQL' });
assert.equal((await workspace.get('jobs', job.id)).jd, '熟悉 SQL');
await assert.rejects(workspace.save('jobs', { ...job, revision: 0 }));
```

## Task 2: AI 任务

Files: `packages/ai/src/index.ts`, `tests/ai.test.ts`.

- [x] 用本地 HTTP 服务验证兼容 API 请求、无 Key 配置错误、失败和超时、无效结构化结果。
- [x] 实现知识问答、简历建议、面试下一题和结构化复盘；证据 ID 限定为实际提供的回答。
- [x] 运行 `npm test`，不调用付费 API。

## Task 3: Web UI

Files: `apps/web/src/{App,api,components,views/*}.tsx`, `apps/web/src/styles.css`, `apps/web/vite.config.ts`.

- [x] 实现四入口导航、可访问表单、空状态、载入及错误状态；接口消费见 contracts。
- [x] 实现笔记上传/问答、岗位与日程、简历源码与版本差异、文字面试/复盘及证据概览。
- [x] 通过浏览器验证桌面与移动布局、键盘关闭弹窗和实际保存重读。

## Task 4: CLI、本地服务与集成

Files: `apps/cli/src/{index,server}.ts`, `tests/integration.test.ts`, `skills/nextoffer/SKILL.md`, README.

- [x] 先验证 CLI JSON、HTTP 写凭证/来源拒绝、共享目录同步与模型错误。
- [x] CLI 通用 list/get/save/delete、import/search/build/ui；HTTP 对应核心功能。
- [x] 开发及生产构建可运行；无 Key 功能完整、AI 请求明确提示配置。
- [x] `npm run typecheck`, `npm test`, `npm run build`，浏览器真实交互并截图检查。

## UI 约定

Paper #F7F8FA, ink #202C2A, muted #707C78, line #E5E9E7, green #28795F, pale #EAF3ED。
界面用系统中文黑体，英文标题用 Georgia 作小范围对比，数据用等宽字体。
固定窄侧栏，留白工作区，面试概览用真实样本条形图；不显示虚构统计。

## 执行记录

- 2026-09-10：用户已批准设计并要求实现简洁、美观、轻量版本。工作在独立 feature branch。
- 接口审查：核心/AI/UI/CLI 共享 `docs/contracts.md`，各任务有独立文件边界；用户自备 Key 覆盖技能默认的创建 Key 流程。

- 完成：28 项核心、模型及集成测试通过；2 项浏览器流程通过，覆盖桌面保存重读、简历取消导航保护和移动布局。类型检查、生产构建、格式检查通过。
- 限制：未连接真实模型；当前机器未安装 XeLaTeX，实际 PDF 编译待用户环境验证。TUI、语音、自动采集和自动填写留待后续。
