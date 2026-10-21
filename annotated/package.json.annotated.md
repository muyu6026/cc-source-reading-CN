# `package.json` 逐条注解

> 原文件：`source/package.json`（33 行）
> **为什么用 markdown 讲**：JSON 格式**不允许写注释**，强行加 `//` 会让文件变成非法 JSON、编辑器立刻飘红。所以这个文件改用「原片段 + 中文说明」的方式对照。

---

## 完整原文

```json
{
  "name": "@anthropic-ai/claude-code",
  "version": "2.1.88",
  "bin": {
    "claude": "cli.js"
  },
  "engines": {
    "node": ">=18.0.0"
  },
  "type": "module",
  "author": "Anthropic <support@anthropic.com>",
  "license": "SEE LICENSE IN README.md",
  "description": "Use Claude, Anthropic's AI assistant, right from your terminal. Claude can understand your codebase, edit files, run terminal commands, and handle entire workflows for you.",
  "homepage": "https://github.com/anthropics/claude-code",
  "bugs": {
    "url": "https://github.com/anthropics/claude-code/issues"
  },
  "scripts": {
    "prepare": "node -e \"...\""
  },
  "dependencies": {},
  "optionalDependencies": { "...": "..." }
}
```

---

## 一、身份信息：这是个什么包

| 字段 | 原文值 | 中文含义 |
|------|--------|----------|
| `name` | `@anthropic-ai/claude-code` | 包名。`@anthropic-ai` 是 npm 的「作用域」（scope），类似命名空间，防止和别人的 `claude-code` 撞名 |
| `version` | `2.1.88` | 版本号，遵循语义化版本 `主版本.次版本.修订号` |
| `description` | Use Claude, Anthropic's AI assistant, right from your terminal... | **译**：在终端里直接用 Anthropic 的 AI 助手 Claude。它能读懂你的代码库、改文件、跑终端命令，替你处理整条工作流 |
| `author` | `Anthropic <support@anthropic.com>` | 作者 = Anthropic 公司，尖括号里是联系邮箱 |
| `license` | `SEE LICENSE IN README.md` | **译**：许可证见 README.md。这是「不在这里写明、去别处看」的写法——说明它**不是**常见的 MIT / Apache，而是商业许可 |
| `homepage` | `https://github.com/anthropics/claude-code` | 项目主页 |
| `bugs.url` | `https://github.com/anthropics/claude-code/issues` | 去哪提 bug |

> 中文注释：`description` 里那句英文其实是整个项目最好的一句话简介，值得背下来——`understand your codebase, edit files, run terminal commands, and handle entire workflows`。

---

## 二、三个决定「怎么运行」的关键字段

### 1. `bin` —— 为什么敲 `claude` 就能跑

```json
"bin": {
  "claude": "cli.js"
}
```

**中文**：在全局安装（`npm i -g`）后，npm 会创建一条命令 `claude`，它指向包内的 `cli.js`。

**注**：这就是启动链的第一环。用户敲的 `claude` → 实际执行 `cli.js` → 再进到我们刚注释完的 `src/entrypoints/cli.tsx`（编译后的产物就是 `cli.js`）。

### 2. `engines` —— 对 Node 版本的要求

```json
"engines": {
  "node": ">=18.0.0"
}
```

**中文**：要求 Node 18 或更高。`>=` 是「大于等于」。

**注**：为什么是 18？因为项目用到了 `fetch`、`structuredClone` 这些 Node 18 才稳定的 API，以及顶层 `await`（ESM 特性）。

### 3. `type: "module"` —— 这是 ESM，不是 CommonJS

```json
"type": "module"
```

**中文**：声明整个包的 `.js` 文件都按 **ES 模块（ESM）** 解析，而不是老的 CommonJS。

**注**：这条影响非常大——
- 可以用 `import` / `export`（而不是 `require` / `module.exports`）；
- 可以用**顶层 await**（就是 `cli.tsx` 里那种满屏 `await import(...)` 在模块顶层也能成立的原因）；
- 反过来，想用 CommonJS 的文件必须改名 `.cjs`。

> 顺带一个读源码时的坑：源码里写 `import ... from '../utils/config.js'`，**带 `.js` 后缀但实际文件是 `.ts`**。这不是笔误，是 ESM 规范要求「导入路径必须写完整文件名」，TypeScript 编译后 `config.ts` → `config.js`，所以源码里必须按编译后名字写。

---

## 三、`scripts` 里那段「防误发」代码

```json
"scripts": {
  "prepare": "node -e \"if (!process.env.AUTHORIZED) { console.error('ERROR: Direct publishing is not allowed.\\nPlease see the release workflow documentation to publish this package.'); process.exit(1); }\""
}
```

**中文**：`prepare` 是 npm 的生命周期钩子，在 `npm install`（本地）和 `npm publish`（发布）之前都会自动执行。这里塞了一段内联 Node 脚本：

- 如果环境变量 `AUTHORIZED` 不存在 → 打印错误并 `exit(1)` 退出；
- 错误信息译文：**「错误：不允许直接发布。请查看发布流程文档来发布这个包。」**

**注**：这是一道「防手滑」闸门——防止有人在自己电脑上直接 `npm publish` 把 Anthropic 的包发出去。它要求发布必须走官方 CI（CI 里会注入 `AUTHORIZED`）。

**注 2**：字符串里的 `\\n` 是**转义**——JSON 里写 `\\n`，实际传给 node 的才是 `\n`（换行）。

---

## 四、最重要的一处：`dependencies` 是空的

```json
"dependencies": {}
```

**中文**：运行时依赖 —— **一个都没有**。

**注**：这是整个仓库最需要注意的地方。一个这种规模的项目不可能零依赖（它用了 React、Ink、zod、commander……）。真相是：

> **依赖在打包时被 Bun 内联进产物了。** 发布的是一个「自包含的单文件包」，所以 `package.json` 里不需要列依赖。

**这直接导致两件事**：

1. **`npm install` 之后跑不起来**。缺 100 多个包，`import 'ink'` 直接报错。
2. **这不是完整可编译的工程**，是「打包产物反编译回来的源码」。`tsconfig.json` 也许在，但 `node_modules` 永远不会齐。

所以我们把它当**源码阅读对象**，不要试图 `npm run build`。

---

## 五、`optionalDependencies`：九个平台专属包

```json
"optionalDependencies": {
  "@img/sharp-darwin-arm64":  "^0.34.2",
  "@img/sharp-darwin-x64":    "^0.34.2",
  "@img/sharp-linux-arm":     "^0.34.2",
  "@img/sharp-linux-arm64":   "^0.34.2",
  "@img/sharp-linux-x64":     "^0.34.2",
  "@img/sharp-linuxmusl-arm64": "^0.34.2",
  "@img/sharp-linuxmusl-x64": "^0.34.2",
  "@img/sharp-win32-arm64":   "^0.34.2",
  "@img/sharp-win32-x64":     "^0.34.2"
}
```

**中文**：这些都是 `sharp`（一个高性能图片处理库）的**平台专属二进制包**。

**注**：为什么这样拆？`sharp` 底层是 C++，得为每个「操作系统 + CPU 架构」组合编译一份二进制。npm 的做法是把它们拆成 9 个包，用 `optionalDependencies`（可选依赖）声明——安装时 npm 只装当前平台能用的那个，其余装不上也**不算失败**。

九个包名逐字拆开看：

| 段 | 含义 |
|----|------|
| `darwin` | macOS 的内核名 |
| `linux` / `linuxmusl` | Linux（glibc）/ Linux（musl，Alpine 那种精简发行版） |
| `win32` | Windows |
| `arm64` / `x64` / `arm` | CPU 架构：ARM 64 位 / x86 64 位 / ARM 32 位 |

**注**：`^0.34.2` 的意思是「允许 0.34.2 及以上，但不要 0.35.0」——`^` 在 0.x 版本上只放开最后一位（因为 0.x 视为不稳定，次版本号变动可能有破坏性）。

**它用在哪**：Claude Code 要读图片（截图、UI 稿）。读进来之后可能得缩放、转格式，那就得靠 `sharp`。

---

## 六、从这个文件能读出什么

只读 33 行，就能确定这几件事：

| 结论 | 依据 |
|------|------|
| 它是终端 CLI，不是库 | 有 `bin`，且命令名就是 `claude` |
| 它要 Node 18+ | `engines.node >= 18.0.0` |
| 它用 ESM，支持顶层 await | `type: "module"` |
| **它不能直接运行** | `dependencies` 是空的，依赖被 Bun 内联了 |
| 它会处理图片 | 九个 `sharp` 平台包 |
| 它是商业许可，非开源协议 | `license: SEE LICENSE IN README.md` |

---

**下一步**：[仓库 README 中英对照](README.annotated.md) → 然后进 `src/entrypoints/cli.tsx` 的注解版。
