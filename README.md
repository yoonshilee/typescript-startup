# Typescript-Startup

24 节中文 TypeScript 课程，面向有编程基础、希望系统学习 JavaScript / TypeScript 的读者，包含 Java / Python 对照。通过开发笔记 CLI 场景，学习语法、类型建模、异步和 Node.js 工程实践。

路线：**01–04 语言基础 → 05–12 类型系统 → 13–16 运行时与异步 → 17–24 Node 工程**。完整目录在[课程首页](index.html)，另有六份[速查资料](index.html#references)。

## 快速开始

先安装 **Node.js 24.12 以上的 24.x**。克隆或下载仓库后，进入项目根目录执行：

```bash
git clone https://github.com/yoonshilee/typescript-startup.git
cd typescript-startup
npm install -g pnpm@11.22.0
pnpm install --frozen-lockfile
pnpm course
```

打开终端显示的地址（默认 http://127.0.0.1:4173），从第 01 课开始。只阅读时也可直接打开 `index.html`；页面按钮运行 TypeScript 则需要保持课程服务开启。

## 如何练习

1. 阅读课文，在 `src/lesson-NN.ts` 中跟写示例与 Lab。本仓库不附带个人练习代码，请从创建 `src/` 目录和 `src/lesson-01.ts` 开始。
2. 保存后点击代码块下方的“运行示例”。按钮执行的是 TS 文件中的同名无参导出函数，不是 HTML 中的代码；提示 `unavailable` 时，检查文件、函数名和 `export` 是否一致。
3. 运行 `pnpm lesson NN` 验收当前 Lab，例如 `pnpm lesson 01`。先尝试，再看分层提示和折叠答案。

示例使用 `export function demoName() { ... }`；Lab 前保留 `/** @lab */`，避免被示例按钮执行。课号必须补零。网页运行区仅显示返回值；终端 `pnpm examples NN` 仍显示“函数名: 结果”，方便区分批量输出。

| 命令 | 用途 |
| --- | --- |
| `pnpm examples 01` | 批量运行该课已写好的示例 |
| `pnpm lesson 01` | 只验收该课 Lab |
| `pnpm validate` | 校验课程 HTML、链接和结构 |
| `pnpm typecheck` | 检查现有 TypeScript 代码 |
| `pnpm build` | 创建课程源码后，编译到 `dist/` |
| `pnpm test` | 验收全部课程及运行工具 |

首次克隆没有 `src/` 源码，运行示例或 Lab 会提示缺少文件，`pnpm build` 会提示没有输入文件；跟写课程后再运行对应命令。未完成的 Lab 会使全量测试失败，请按课使用 `pnpm lesson NN`。`pnpm check` 和 `pnpm notes` 还需要自行组装 CLI 入口 `src/cli.ts` 与存储实现，详见[最后一课的集成说明](lessons/0024-cli-acceptance-refactor-agent-map.html#acceptance)。

## 参与维护

课程在 `lessons/`，速查在 `reference/`，页面资源在 `assets/`，运行与验收工具在 `scripts/` 和 `tests/`。保持中文说明、英文代码与输出；函数用 lowerCamelCase，类型用 PascalCase。先讲后练，关联示例共用定义，改名同步 HTML 与 TS，不随意改变 Lab 契约。提交前运行 `pnpm validate`、`pnpm typecheck`，并验证受影响的示例、Lab 或工具测试。

课程服务会执行本地代码，仅用于可信代码的本机学习，不要作为公网执行服务部署。

## 许可证

课程正文与仓库代码采用 [MIT 许可证](LICENSE)。
