# NextOffer · 下一站

从第一份实习，到心仪的 Offer。

个人求职小工具。一个本地工作区，保存笔记、简历、岗位和面试记录。提供轻量 Web 界面及可被 coding agent 调用的 CLI，无需数据库服务。

## 开始使用

需要 Node.js 22.13+。

```sh
git clone git@github.com:koyama-kagami/NextOffer.git
cd NextOffer
npm install
npm run build
npm start
```

打开终端显示的本机地址，默认是 `http://127.0.0.1:4317`。资料默认存放在当前目录的 `workspace/`，已加入 Git 忽略。关闭服务后文件仍保留。

开发模式：`npm run dev`。指定工作区或端口：

```sh
npm start -- --workspace ./my-career --port 4318
```

自定义目录可能包含个人资料，请自行加入 Git 忽略。服务只监听本机，不作为公网部署或多用户系统使用。

## 四个入口

- **资料**：新建笔记、导入 Markdown/TXT/文本型 PDF，本地段落检索、AI 引用问答；维护网申常用信息并复制。
- **简历**：编辑 LaTeX、保留版本、比较 AI 修改建议、采纳后保存。PDF 编译需要本机安装含中文支持的 XeLaTeX（TeX Live 或 MiKTeX）。缺少编译器时仍可编辑源码。
- **岗位**：保存 JD、链接、进度、投递截止与面试时间，关联投递时的简历版本。
- **面试**：文字模拟面试、真实面试记录、AI 复盘；四个能力维度关联回答证据，无样本显示尚未评估。

初始工作区没有演示数据。TUI、语音面试、自动岗位采集和自动网申不包含在此版本。

## 使用自己的模型

在网页「模型设置」填写 OpenAI 兼容接口地址（如服务商的 `/v1` 地址）、模型名和自己的 API Key。Key 仅保存在本次服务进程内，重启后需要重新输入，不写入浏览器存储或导出文件。

也可在启动 CLI/网页前设置环境变量：

| 变量 | 说明 |
| --- | --- |
| `NEXT_OFFER_BASE_URL` | HTTPS 接口地址；本机模型允许回环 HTTP |
| `NEXT_OFFER_MODEL` | 服务商的模型名称 |
| `NEXT_OFFER_API_KEY` | 用户自己的 Key；不要提交到 Git |
| `NEXT_OFFER_WORKSPACE` | 可选的默认工作区路径 |

未连接模型时，资料管理、检索、简历编辑、日程与面试记录仍可使用。AI 操作会把所需资料发给所选模型服务商，不会假装生成成功。

## CLI / coding agent

CLI 和 Web 使用同一核心、同一目录。外部 agent 可使用自己的模型，无需为 NextOffer 另配 Key。

```sh
node --import tsx apps/cli/src/index.ts init --json
node --import tsx apps/cli/src/index.ts knowledge import ./note.md --json
node --import tsx apps/cli/src/index.ts knowledge search "缓存一致性" --json
node --import tsx apps/cli/src/index.ts job save --input job.json --json
node --import tsx apps/cli/src/index.ts resume create --title "后端岗位简历" --json
node --import tsx apps/cli/src/index.ts interview list --json
node --import tsx apps/cli/src/index.ts help --json
```

`job.json` 最小示例：

```json
{ "company": "示例公司", "title": "后端实习", "jd": "熟悉 TypeScript 和 SQL", "status": "saved" }
```

更新记录先 `get ID`，修改后通过 `save --input FILE` 保存，保留 `id` 与 `revision`。遇到 `CONFLICT` 重新读取并合并修改。CLI 输出 `{ok:true,data}` 或 `{ok:false,error}`，失败退出码非零；`--json` 输出单行。使用 `node --import tsx` 可避免 npm 脚本横幅干扰 JSON 解析。

配套 [Skill](skills/nextoffer/SKILL.md) 说明 agent 如何检索、编辑简历、记录问答与提交复盘。

## 开发与验证

```sh
npm run typecheck
npm test
npm run build
npm run format:check
npm run test:e2e
```

测试使用临时工作区和本地模型替身，不消耗真实 API。浏览器测试在 Windows 使用已安装的 Edge，其他系统先运行 `npx playwright install chromium`。LaTeX 编译与真实模型效果还取决于本机安装和用户提供方。

```text
packages/core/  文件存储、校验、检索与简历编译
packages/ai/    用户模型接口与结构化任务
apps/cli/      CLI 及本机 HTTP 服务
apps/web/      React 界面
skills/        coding agent 调用指南
```

范围与接口见 [设计](docs/superpowers/specs/2026-09-10-nextoffer-design.md)、[契约](docs/contracts.md) 和 [实施计划](docs/superpowers/plans/2026-09-10-first-workspace.md)。
