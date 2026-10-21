# Claude Code

> 📄 本文件对应 `source/README.md`（原文 43 行）。英文原文一字未改，每段下方是中文对照。

![](https://img.shields.io/badge/Node.js-18%2B-brightgreen?style=flat-square) [![npm]](https://www.npmjs.com/package/@anthropic-ai/claude-code)

[npm]: https://img.shields.io/npm/v/@anthropic-ai/claude-code.svg?style=flat-square

**译**：一行徽章：Node.js 18 或更高；另一行是 npm 的版本号徽章（`![](...)` 的写法是「只有图、没有替代文字」，点进去是 npm 包页面）。

---

Claude Code is an agentic coding tool that lives in your terminal, understands your codebase, and helps you code faster by executing routine tasks, explaining complex code, and handling git workflows -- all through natural language commands. Use it in your terminal, IDE, or tag @claude on Github.

**译**：Claude Code 是一个 **agentic（智能体式）编程工具**，它住在你的终端里，能读懂你的代码库，通过执行日常琐事、解释复杂代码、处理 git 工作流来帮你更快地写代码——而这一切都通过**自然语言指令**完成。你可以在终端里用它、在 IDE 里用它，或者在 GitHub 上 @claude。

**注**：这句话里有三个词值得单独记：
- `agentic` = 有自主行动能力的（不只是聊天，会动手做事）
- `routine tasks` = 日常琐事、重复性任务
- `natural language commands` = 自然语言指令（用说话的方式下命令，而不是敲命令参数）

**注**：`--` 这种写法是英文里的「破折号」，等同于中文的「——」，不是代码。

---

**Learn more at [Claude Code Homepage](https://claude.com/product/claude-code)** | [Documentation](https://code.claude.com/docs/en/overview)

**译**：想了解更多，看 [Claude Code 主页] | [文档]

**注**：`[文字](链接)` 是 Markdown 的标准链接写法。

---

<img src="https://github.com/anthropics/claude-code/blob/main/demo.gif?raw=1" />

**译**：一张演示动图（`demo.gif`）。

**注**：这里用了 HTML 的 `<img>` 标签而不是 Markdown 的 `![]()`，因为要给图片加 `?raw=1` 参数强制 GitHub 返回原始文件而不是网页。`<img>` 标签没有闭合标签 `/`，在 HTML 里是合法的（叫「空元素」）。

---

## Get started

**译**：## 快速开始

---

1. Install Claude Code:

```sh
npm install -g @anthropic-ai/claude-code
```

**译**：1. 安装 Claude Code：

**注**：这条命令逐段拆开：

| 片段 | 含义 |
|------|------|
| `npm install` | 安装一个包 |
| `-g` | global，装到全局（装完在任何目录都能敲 `claude`） |
| `@anthropic-ai/claude-code` | 包名，`@anthropic-ai` 是作用域 |

---

2. Navigate to your project directory and run `claude`.

**译**：2. 切换到你的项目目录，然后运行 `claude`。

**注**：`Navigate to` = 导航到、切换到（就是 `cd`）。注意它特意说「切到**你的项目目录**再运行」——因为 Claude Code 会把**当前目录**当作工作区，它读文件、改文件都是相对于这个目录。

---

## Reporting Bugs

We welcome your feedback. Use the `/bug` command to report issues directly within Claude Code, or file a [GitHub issue](https://github.com/anthropics/claude-code/issues).

**译**：## 报告 Bug

我们很欢迎你的反馈。你可以在 Claude Code 里直接用 `/bug` 命令报告问题，或者提交一个 GitHub issue。

**注**：
- `/bug` 开头的斜杠表示这是 Claude Code **内部的斜杠命令**（slash command），不是终端命令。写法是先在对话里敲 `/bug`，然后按提示描述问题。
- `file an issue` 里的 `file` 是动词，意思是「提交、立案」，不是「文件」。

---

## Connect on Discord

Join the [Claude Developers Discord](https://anthropic.com/discord) to connect with other developers using Claude Code. Get help, share feedback, and discuss your projects with the community.

**译**：## 在 Discord 上联系我们

加入 [Claude 开发者 Discord]，和其他正在使用 Claude Code 的开发者建立联系。在这里获取帮助、分享反馈，和社区一起讨论你的项目。

**注**：`connect with` = 与……建立联系；`community` = 社区。

---

## Data collection, usage, and retention

When you use Claude Code, we collect feedback, which includes usage data (such as code acceptance or rejections), associated conversation data, and user feedback submitted via the `/bug` command.

**译**：## 数据收集、使用与保留

当你使用 Claude Code 时，我们会收集反馈信息，包括**使用数据**（例如代码被采纳或被拒绝）、相关联的对话数据，以及你通过 `/bug` 命令提交的反馈。

**注**：三个标题词要分清：
- `collection` = 收集
- `usage` = 使用（怎么用这些数据）
- `retention` = 保留（存多久）

**注**：`code acceptance or rejections` 指的是——AI 建议改一段代码，你按了「接受」还是「拒绝」。这是衡量 AI 好用程度最直接的指标。

---

### How we use your data

See our [data usage policies](https://code.claude.com/docs/en/data-usage).

**译**：### 我们如何使用你的数据

见我们的[数据使用政策]。

---

### Privacy safeguards

We have implemented several safeguards to protect your data, including limited retention periods for sensitive information and restricted access to user session data.

For full details, please review our [Commercial Terms of Service](https://www.anthropic.com/legal/commercial-terms) and [Privacy Policy](https://www.anthropic.com/legal/privacy).

**译**：### 隐私保护措施

我们实施了多项保护措施来保护你的数据，包括**对敏感信息设定有限的保留期限**，以及**限制对用户会话数据的访问**。

完整细节请查阅我们的[商业服务条款]和[隐私政策]。

**注**：
- `safeguards` = 防护措施、保障机制
- `retention periods` = 保留期限（存多久之后删掉）
- `restricted access to` = 对……的访问受限

---

## 读这份 README 能看出什么

| 观察 | 说明 |
|------|------|
| 全文没有任何「怎么读源码」「怎么贡献」 | 这是**面向使用者**的 README，不是面向开发者的 |
| 没有 LICENSE 文件内容 | 只在 `package.json` 里写 `SEE LICENSE IN README.md`，但 README 里其实也没贴许可证全文 |
| 强调「在你的项目目录里运行」 | 说明它是以**当前目录为工作区**的 agent |
| 单独有「数据收集」一节 | 因为它会把你**代码片段发给模型**，这在合规上是必须声明的 |
| 有 `/bug` 命令 | 说明斜杠命令系统是它的核心交互方式之一（对应手册 [05 篇](../docs/05-提示词与命令.md)） |

---

**下一步**：`src/entrypoints/cli.tsx` 的注解版 → [`src/entrypoints/cli.tsx`](src/entrypoints/cli.tsx)
