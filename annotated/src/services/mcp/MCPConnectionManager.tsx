// 【第 1 行】这一行是「本文件不是手写代码」的第一块证据
//
// `react/compiler-runtime` 是 React Compiler 编译产物专用的运行时入口。
// 你把源码里任何一个 .tsx 交给 React Compiler 编译，它都会在文件顶部插入这一行，
// 然后给你一个叫 `_c`（全称 cache）的函数，用来读写「上一次渲染的结果」。
//
// 看到这一行就应该调整阅读预期：
//   · 你读到的是**编译器翻译后的输出**，不是作者敲下的原文
//   · 里面所有的 `if ($[0] !== x) { ... } else { ... }` 都是在模拟 useMemo
//   · 变量名 `t0` `t1` `t2` 是编译器生成的临时量，原始名字已经不可恢复
//
// 这也解释了为什么整个 `source/` 里很多 .tsx 看着比 .ts 难读得多：
// .ts 通常没经过这一步，.tsx 走编译，壳子被撑大了。
import { c as _c } from "react/compiler-runtime";
import React, { createContext, type ReactNode, useContext, useMemo } from 'react';
import type { Command } from '../../commands.js';
import type { Tool } from '../../Tool.js';
import type { MCPServerConnection, ScopedMcpServerConfig, ServerResource } from './types.js';
import { useManageMCPConnections } from './useManageMCPConnections.js';
// 【第 7-15 行】Context 里**只有动作，没有状态**
//
// `MCPConnectionContextValue` 两个字段都是函数：重连一个 MCP server、开关一个 MCP server。
// 没有任何 `connections` `isConnected` `status` 之类的数据字段。
//
// 这是 React Context 的一个常见取舍：
//   · **放动作**（回调）→ Consumer 变化时几乎不会重渲染，因为函数引用可以稳定
//   · **放状态**（数据）→ 任何一处状态变化，所有 Consumer 全部重渲染
//
// MCP 的连接状态本来是会频繁变的（每个 server 都可能 connecting / connected / failed），
// 如果把它塞进这个 Context，那任何一台 server 抖一下，整棵 UI 树都得重画。
// 所以状态走的是别的地方（`useManageMCPConnections` 内部 + app state），
// Context 只负责把「按名字操作某个 server」这两个能力递下去。
//
// 返回值也说明了这件事：`reconnectMcpServer` 返回 `{ client, tools, commands, resources? }`。
// ——调用方关心的是「重连之后新拿到了什么」，而不是「现在全局连接表长什么样」。
// 把结果随调用返回，就不需要把连接表也放进 Context。
interface MCPConnectionContextValue {
  reconnectMcpServer: (serverName: string) => Promise<{
    client: MCPServerConnection;
    tools: Tool[];
    commands: Command[];
    resources?: ServerResource[];
  }>;
  toggleMcpServer: (serverName: string) => Promise<void>;
}
const MCPConnectionContext = createContext<MCPConnectionContextValue | null>(null);
// 【第 16 行】`| null` 加 `null` 默认值 = 一个能被发现的哨兵
//
// `createContext<T | null>(null)` 这个写法在这份源码里到处都是
// （`AppState`、`Stats`、`McpReconnect` 都用同一套）。
//
// 为什么不写 `createContext<MCPConnectionContextValue>({} as any)` 之类的假默认值？
// 因为假默认值的问题不是「编译不过」，而是**错误会被推迟到很深的地方才炸**：
// 调用方拿到一个空对象，`reconnectMcpServer(...)` 变成 `undefined is not a function`，
// 栈里指向的是按钮的 onClick，而不是「你忘了套 Provider」。
//
// `null` 的意思很明确：**没套 Provider**。配合下面两个 hook 的 `if (!context) throw`，
// 错误会立刻停在第一个用它的地方，报错信息还能直接写「必须放在 MCPConnectionManager 里面」。
// 默认值要选「能被发现的那一边」，不要选「看起来能用」的那一边。
// 【第 17-30 行】两个 hook 里有一段重复代码，为什么没抽出去
//
// `useMcpReconnect` 和 `useMcpToggleEnabled` 各自都写了：
// 取 context → 判空 → 抛错 → 返回其中一个字段。
//
// 把「取 context + 判空」抽成一个 `useMCPContext()` 会少 4 行，但会丢掉一样东西：
// **报错信息里的 hook 名**。抽出去之后错误信息只能写成
// 「必须在 MCPConnectionManager 内使用」，用户看不出自己用的是哪个 hook。
//
// 这里的重复是有意的：重复的 4 行换来「报错点名到具体 hook」，调试时省一次全局搜索。
// 判断标准不是「有没有重复」，而是「重复的部分会不会各自演化」——
// 这两段永远只会跟着同一个 Context 变，不会分叉，所以不算坏味道。
export function useMcpReconnect() {
  const context = useContext(MCPConnectionContext);
  if (!context) {
    throw new Error("useMcpReconnect must be used within MCPConnectionManager");
  }
  return context.reconnectMcpServer;
}
export function useMcpToggleEnabled() {
  const context = useContext(MCPConnectionContext);
  if (!context) {
    throw new Error("useMcpToggleEnabled must be used within MCPConnectionManager");
  }
  return context.toggleMcpServer;
}
interface MCPConnectionManagerProps {
// 【第 31-35 行】三个 props，只有一个是「配置」，另外两个是「模式」
//
// 逐个数：
//   · `dynamicMcpConfig` —— 运行时才确定的 MCP 配置（比如 `--mcp-config` 传进来的、
//     或 SDK 调用方动态注入的）。类型是 `Record<string, ScopedMcpServerConfig> | undefined`，
//     `undefined` 表示「没有动态配置」，不是「配置为空」。
//   · `isStrictMcpConfig` —— 布尔，语义是**严格模式**：只认动态配置里的 server，
//     不合并用户 `~/.claude.json` 里那些。这是安全相关开关，
//     典型场景是「被别的程序以子进程方式调用时，不让它悄悄继承用户本机的 MCP server」。
//   · `children` —— 标准 React 插槽。
//
// 把「模式」当成 props 而不是塞进 config 对象里，好处是它的类型是 `boolean`：
// 调用方传错会立刻是类型错误，而不是「config 里某个字段没被认出来」这种静默失败。
  children: ReactNode;
  dynamicMcpConfig: Record<string, ScopedMcpServerConfig> | undefined;
  isStrictMcpConfig: boolean;
}

// TODO (ollie): We may be able to get rid of this context by putting these function on app state
// 【第 37 行】这条 TODO 是该读的：作者自己说这层是多余的
//
// `// TODO (ollie): We may be able to get rid of this context by putting these function on app state`
//
// `(ollie)` 是提出者，方便以后追「为什么当时要这么做」。
// 内容翻译：*我们也许可以干掉这个 context，把这些函数挂到 app state 上。*
//
// ——这句话承认了本文档正在解释的这整层「Context + Provider + 两个 hook」
// 属于**可优化但不急**的结构。真正需要它的理由只有一个：
// `useManageMCPConnections` 这个 hook 必须在 Provider 内部调用（它自己要用其他 context），
// 而消费方（比如某个 `/mcp` 面板里的按钮）可能在树里很深的位置，
// 不想让中间每一层都往下传 `reconnectMcpServer` 这个函数。
//
// 也就是说，Context 在这里解决的是**跨层级传函数**，没有别的目的。
// 读懂这一点，就不会误以为这个文件里藏着 MCP 连接管理的核心逻辑——
// 核心全在下一行 import 的那个 hook 里。
// 【第 38 行】`MCPConnectionManager(t0)` —— 参数名为什么不是解构
//
// 原始代码大概率是这样写的：
//
// ```tsx
// export function MCPConnectionManager({ children, dynamicMcpConfig, isStrictMcpConfig }) {
// ```
//
// 编译之后变成「收一个整体 `t0`，然后在函数体里解构」。这不是作者偷懒，
// 是 React Compiler 为了统一处理「参数被缓存槽引用」而做的改写。
// 同理，函数签名里的类型注解也一并消失了（TS 类型在编译后本来就会被擦除，
// 所以你在 `source/` 里看到的 .tsx 其实已经是 JS + JSX 了）。
//
// 读这份源码时的实用技巧：**不要试图还原原文**，
// 直接看第 40-44 行的解构块，那就是原来的参数列表。
export function MCPConnectionManager(t0) {
  const $ = _c(6);
// 【第 39 行】`_c(6)` = 给这个组件分配 6 个缓存槽
//
// `$` 是一个长度 6 的数组，编译器用它模拟 useMemo：
//
// ```js
// if ($[0] !== reconnectMcpServer || $[1] !== toggleMcpServer) {
//   t1 = { reconnectMcpServer, toggleMcpServer }   // 依赖变了 → 重算
//   $[0] = reconnectMcpServer                      // 顺手把新依赖写回槽
//   $[1] = toggleMcpServer
//   $[2] = t1                                      // 结果也存一份（槽 2）
// } else {
//   t1 = $[2]                                        // 依赖没变 → 直接复用
// }
// ```
//
// **槽的编号是「依赖」和「结果」混着用的**，规律是靠 `$[k]` 的出现顺序推出来的，
// 没有文档能查。所以读的时候不用逐个槽记，只要认出这个 if/else 骨架
// = 「这里原来是一个 useMemo」，语义就到位了。
//
// 数字 6 从哪来：本组件有两个 memo（一个拼 value 对象，一个拼 Provider 元素），
// 每个 memo 占 2 个依赖槽 + 1 个结果槽，2 × 3 = 6。
  const {
    children,
    dynamicMcpConfig,
    isStrictMcpConfig
  } = t0;
// 【第 45-48 行】真正干活的是 `useManageMCPConnections`，这个组件只是搬运工
//
// 调用它拿到 `reconnectMcpServer` 和 `toggleMcpServer`，然后原样塞进 Context。
// 本文件**没有任何 MCP 协议代码**——没有连接、没有握手、没有工具发现。
//
// 所以：
//   · 想搞清楚「MCP server 是怎么连上的」→ 读 `useManageMCPConnections.ts`
//   · 想搞清楚「UI 怎么拿到重连能力」→ 就是这 48 行
//
// 顺带一个观察：这个 hook 被调用在 Provider 内部的最外层，
// 意味着**它是这个 Provider 子树里唯一持有连接状态的地方**，
// 下面所有组件只能通过 Context 拿到的两个函数去间接影响它。
// 状态单一持有 + 只暴露动作，这是这份代码在 MCP 这块的整体设计。
  const {
    reconnectMcpServer,
    toggleMcpServer
  } = useManageMCPConnections(dynamicMcpConfig, isStrictMcpConfig);
// 【第 49-61 行】注意 `useMemo` 只 import 了、没被调用
//
// 文件第 2 行 `import React, { createContext, type ReactNode, useContext, useMemo } from 'react'`，
// 但全文搜不到 `useMemo(`。这不是死代码疏漏，而是**编译器展开后的残留**：
// 原文写的是
//
// ```tsx
// const value = useMemo(() => ({ reconnectMcpServer, toggleMcpServer }), [reconnectMcpServer, toggleMcpServer])
// ```
//
// React Compiler 把它内联成了下面这段带缓存槽的 if/else，但没顺手把 import 删掉。
//
// 这类「import 了没用」在编译产物里是**正常现象**，不要当成 bug 去“修”。
// 反过来说，它也是一个好用的线索：
// 在 .tsx 里看到「import 了 useMemo / useCallback 但没调用」，
// 基本可以确定那附近有一段被展开了的 memo，读懂它就等于读懂了原文。
  let t1;
  if ($[0] !== reconnectMcpServer || $[1] !== toggleMcpServer) {
    t1 = {
      reconnectMcpServer,
      toggleMcpServer
    };
    $[0] = reconnectMcpServer;
    $[1] = toggleMcpServer;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  const value = t1;
  let t2;
// 【第 63-70 行】连 JSX 元素本身也被缓存了
//
// 大部分人以为 memo 只缓存对象和函数，这里缓存的是 **React 元素**：
// 如果 `children` 和 `value` 都没变，就直接返回上一次创建的 `<MCPConnectionContext.Provider>`。
//
// 这一步省下的是「创建元素对象 + 后续 reconciler 的 props 浅比较」。
// React 元素是不可变对象，只要 props 引用没变，复用同一个元素在语义上完全等价——
// 这是 React Compiler 的标准优化，手写很难做对（要在 useMemo 里返回 JSX，
// 还得保证依赖列表完整），所以交给编译器更靠谱。
//
// 读到这里可以收尾了。这个文件从头到尾只做三件事：
// **调 hook 拿两个函数 → 拼成 value → 用 Provider 包住 children**，
// 其余 60 行全是编译器为了「让上面这三件事不要重复执行」而生成的脚手架。
  if ($[3] !== children || $[4] !== value) {
    t2 = <MCPConnectionContext.Provider value={value}>{children}</MCPConnectionContext.Provider>;
    $[3] = children;
    $[4] = value;
    $[5] = t2;
  } else {
    t2 = $[5];
  }
  return t2;
}
// 原文件此处有一行 5932 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。