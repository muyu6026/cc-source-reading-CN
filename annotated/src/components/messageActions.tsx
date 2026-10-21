// ═══════════════════════════════════════════════════════════════
//  messageActions：键盘驱动的消息操作
// ═══════════════════════════════════════════════════════════════
//
//  用户按 shift+↑ 进入「消息光标」，然后用 ↑↓ 在消息之间移动，按 enter
//  展开/编辑，按 c 复制，按 p 复制工具调用的主参数。
//
//  这个文件把这件事拆成四块：
//
//  1. **可导航性判定**（isNavigableMessage）—— 哪些行值得停下来
//  2. **动作表**（MESSAGE_ACTIONS）—— 每个键做什么，用数据描述
//  3. **键位注册**（useMessageActions + MessageActionsKeybindings）——
//     为什么必须拆成两个函数，见第 216 行
//  4. **状态条**（MessageActionsBar）—— 底部显示「现在能按什么」
//
//  第 1 块是重点：光标如果停在「渲染了但没内容」的行上，用户会觉得按键失灵。
//  所以可导航性判定的严格程度，直接决定了这个功能的可用性。
import { c as _c } from "react/compiler-runtime";
import figures from 'figures';
import type { RefObject } from 'react';
import React, { useCallback, useMemo, useRef } from 'react';
import { Box, Text } from '../ink.js';
import { useKeybindings } from '../keybindings/useKeybinding.js';
import { logEvent } from '../services/analytics/index.js';
import type { NormalizedUserMessage, RenderableMessage } from '../types/message.js';
import { isEmptyMessageText, SYNTHETIC_MESSAGES } from '../utils/messages.js';
const NAVIGABLE_TYPES = ['user', 'assistant', 'grouped_tool_use', 'collapsed_read_search', 'system', 'attachment'] as const;
export type NavigableType = (typeof NAVIGABLE_TYPES)[number];
export type NavigableOf<T extends NavigableType> = Extract<RenderableMessage, {
  type: T;
}>;
export type NavigableMessage = RenderableMessage;

// 【两级判据：tier-1 是高度，tier-2 是这张表】
//
//  tier-1 在 VirtualMessageList 里：`getItemHeight(i) === 0 → 不可导航`。
//  它便宜，但不可靠 —— 虚拟列表里还没量过的 item 高度是 undefined，会被
//  当成「可能可见」放行。
//
//  所以需要 tier-2：这个函数，按消息内容判断「有没有值得停下来的东西」。
//
//  **两级是有意为之**：tier-1 挡住绝大多数（空白、零高度），tier-2 处理
//  剩下的边界。只用 tier-1 会漏，只用 tier-2 要为每个 item 做内容判断，
//  在 27k 消息时太贵。
// Tier-2 blocklist (tier-1 is height > 0) — things that render but aren't actionable.
export function isNavigableMessage(msg: NavigableMessage): boolean {
  switch (msg.type) {
    case 'assistant':
      {
        const b = msg.message.content[0];
        // Text responses (minus AssistantTextMessage's return-null cases — tier-1
        // misses unmeasured virtual items), or tool calls with extractable input.
// 【这里用 `in` 而不是 Object.hasOwn —— 一个真实存在的坑，但实际触不到】
//
//  `b.name in PRIMARY_INPUT` 会沿原型链查找，所以：
//
//    'constructor' in PRIMARY_INPUT  → true
//    'toString' in PRIMARY_INPUT     → true
//
//  如果某个工具真叫 'constructor'，下面第 178 行的
//  `PRIMARY_INPUT[s.toolName!]!.label` 会拿到 undefined（显示 "copy undefined"），
//  而 run 里的 `PRIMARY_INPUT[tc.name]?.extract(tc.input)` 会拿到
//  `Object.extract`（undefined）然后调用 → TypeError。
//
//  为什么实际不会发生：工具名都有来源约束 —— 内置工具名是硬编码的，
//  MCP 工具名带 `mcp__<server>__<tool>` 前缀。所以这里是一个**理论隐患，
//  不是活 bug**。
//
//  但它值得记下来，因为这是「用 in 检查表成员」的通病。写这类代码时应该
//  用 `Object.hasOwn(PRIMARY_INPUT, name)`，成本一样。
        return b?.type === 'text' && !isEmptyMessageText(b.text) && !SYNTHETIC_MESSAGES.has(b.text) || b?.type === 'tool_use' && b.name in PRIMARY_INPUT;
      }
    case 'user':
      {
        if (msg.isMeta || msg.isCompactSummary) return false;
        const b = msg.message.content[0];
        if (b?.type !== 'text') return false;
        // Interrupt etc. — synthetic, not user-authored.
        if (SYNTHETIC_MESSAGES.has(b.text)) return false;
        // Same filter as VirtualMessageList sticky-prompt: XML-wrapped (command
        // expansions, bash-stdout, etc.) aren't real prompts.
// 【用户消息可导航的两个条件：有内容、且不是 XML 包裹的】
//
//  `stripSystemReminders(t.text).startsWith('<')` 这一句排除的是所有
//  「系统塞进来的东西伪装成用户文本」：命令展开、bash 输出、工具结果摘要……
//
//  它们统一长这样：`<bash-stdout>...</bash-stdout>`。
//
//  判据选「以 < 开头」而不是「匹配某个具体标签」，是**故意放宽**：将来加了
//  新的包裹格式，它自动被排除，不需要改这里。代价是「用户真的以 < 开头
//  说话」时会被误判 —— 但那种情况极少，且误判的后果只是少一个可停的点。
//
//  先用 stripSystemReminders 剥掉前置的 system-reminder，是因为它可能在
//  真正的用户文本之前。
        return !stripSystemReminders(b.text).startsWith('<');
      }
    case 'system':
      // biome-ignore lint/nursery/useExhaustiveSwitchCases: blocklist — fallthrough return-true is the design
// 【system 的分支是 blocklist，不是 allowlist —— 注释里明说了这是设计】
//
//  `// biome-ignore lint/nursery/useExhaustiveSwitchCases: blocklist —
//   fallthrough return-true is the design`
//
//  意思是：列出来的七种不可导航，**其余全部可导航**。linter 会抱怨「switch
//  没有覆盖所有 subtype」，作者显式压掉了。
//
//  这个方向和 attachment 分支正好相反（那里是 allowlist，四种可导航，其余
//  false）。为什么：
//
//  · system 的 subtype 是**有限的、作者知道的**，新增的 subtype 大概率是想
//    让用户看到的（比如某种新的提示），默认显示更安全
//  · attachment 的类型在持续增加，新增的大多是内部的（诊断、hook 事件），
//    默认隐藏更安全
//
//  **两个分支用相反的默认值，是因为两边的未知方向不同。** 单纯看到「风格
//  不一致」就统一掉，会破坏这个判断。
      switch (msg.subtype) {
        case 'api_metrics':
        case 'stop_hook_summary':
        case 'turn_duration':
        case 'memory_saved':
        case 'agents_killed':
        case 'away_summary':
        case 'thinking':
          return false;
      }
      return true;
    case 'grouped_tool_use':
    case 'collapsed_read_search':
      return true;
    case 'attachment':
      switch (msg.attachment.type) {
        case 'queued_command':
        case 'diagnostics':
        case 'hook_blocking_error':
        case 'hook_error_during_execution':
          return true;
      }
      return false;
  }
}
type PrimaryInput = {
  label: string;
  extract: (input: Record<string, unknown>) => string | undefined;
};
const str = (k: string) => (i: Record<string, unknown>) => typeof i[k] === 'string' ? i[k] : undefined;
// 【PRIMARY_INPUT：每种工具「用户最可能想复制的那一个字段」】
//
//  这不是「所有字段」，是**挑一个**。理由很实际：复制一个工具的完整输入
//  （JSON）几乎没用；复制它的路径/命令/搜索词才有用。
//
//  注意 extract 的签名：`(input: Record<string, unknown>) => string | undefined`。
//  返回 undefined 表示「这个输入里没有该字段」，不是空字符串 —— 下游用
//  `if (val) c.copy(val)` 判断，所以空字符串也不会被复制。
//
//  Tmux 是唯一一个组合字段的：`tmux ` + args.join(' ')。因为 tmux 工具的
//  输入是 `{args: [...]}`，单个 args 元素没有意义。
const PRIMARY_INPUT: Record<string, PrimaryInput> = {
  Read: {
    label: 'path',
    extract: str('file_path')
  },
  Edit: {
    label: 'path',
    extract: str('file_path')
  },
  Write: {
    label: 'path',
    extract: str('file_path')
  },
  NotebookEdit: {
    label: 'path',
    extract: str('notebook_path')
  },
  Bash: {
    label: 'command',
    extract: str('command')
  },
  Grep: {
    label: 'pattern',
    extract: str('pattern')
  },
  Glob: {
    label: 'pattern',
    extract: str('pattern')
  },
  WebFetch: {
    label: 'url',
    extract: str('url')
  },
  WebSearch: {
    label: 'query',
    extract: str('query')
  },
  Task: {
    label: 'prompt',
    extract: str('prompt')
  },
  Agent: {
    label: 'prompt',
    extract: str('prompt')
  },
  Tmux: {
    label: 'command',
// 【label 是给人看的名字，extract 是真正的取值】
//
//  表里 label 有四种值：path / command / pattern / url / query / prompt。
//
//  它们对应 UI 上的文案 "copy path"、"copy command"。这个区分很细但有用：
//  用户在按 p 之前，需要知道**会复制什么**，而不是「会复制工具参数」。
    extract: i => Array.isArray(i.args) ? `tmux ${i.args.join(' ')}` : undefined
  }
};

// Only AgentTool has renderGroupedToolUse — Edit/Bash/etc. stay as assistant tool_use blocks.
// 【只有 AgentTool 有 renderGroupedToolUse，所以 grouped 分支只可能是它】
//
//  但这里没写死工具名，而是取 `msg.messages[0]` 的 input、用 `msg.toolName`
//  当名字。这样将来别的工具实现了分组渲染，这里自动支持。
//
//  注意 grouped 的 input 取的是**第一个成员**的 —— 分组里的工具输入可能
//  各不相同（并行读 3 个文件），这里只取第一个作为代表。这是有损的，但
//  复制场景下「第一个」通常够用。
export function toolCallOf(msg: NavigableMessage): {
  name: string;
  input: Record<string, unknown>;
} | undefined {
  if (msg.type === 'assistant') {
    const b = msg.message.content[0];
    if (b?.type === 'tool_use') return {
      name: b.name,
      input: b.input as Record<string, unknown>
    };
  }
  if (msg.type === 'grouped_tool_use') {
    const b = msg.messages[0]?.message.content[0];
    if (b?.type === 'tool_use') return {
      name: msg.toolName,
      input: b.input as Record<string, unknown>
    };
  }
  return undefined;
}
export type MessageActionCaps = {
  copy: (text: string) => void;
  edit: (msg: NormalizedUserMessage) => Promise<void>;
};

// Identity builder — preserves tuple type so `run`'s param narrows (array literal widens without this).
// 【`const T extends NavigableType` 里的 const 是必须的】
//
//  TypeScript 的类型推断规则：数组字面量 `['user']` 默认推断成
//  `string[]`（宽化）。宽化之后 `NavigableOf<T>` 变成 `NavigateOf<string>`
//  → `Extract<RenderableMessage, {type: string}>` → 整个联合类型，
//  于是 `run` 的 `m` 参数不再收窄，`m.message` 之类的访问全部报错。
//
//  加 `const T` 让 T 推断成 `'user'`（字面量类型）而不是 `string`。
//
//  注释里那句 "array literal widens without this" 说的就是这个。这是 TS 里
//  「泛型从数组字面量推断」的常见陷阱，不是这个文件特有的。
function action<const T extends NavigableType, const K extends string>(a: {
  key: K;
  label: string | ((s: MessageActionsState) => string);
  types: readonly T[];
  applies?: (s: MessageActionsState) => boolean;
  stays?: true;
  run: (m: NavigableOf<T>, caps: MessageActionCaps) => void;
}) {
  return a;
}
// 【两条 key 都叫 'enter'，是有意的】
//
//  第一条作用于 grouped / collapsed / attachment / system：翻转 expanded。
//  第二条作用于 user：进入编辑。
//
//  同一个键，按消息类型走不同逻辑。分发靠 `isApplicable`（类型匹配），
//  而 `MESSAGE_ACTIONS.find(a => a.key === key && isApplicable(a, c))` 会取
//  **第一条适用的** —— 两条的 types 没有交集，所以永远只有一个能匹配。
//
//  第一条的 `run` 是空函数，注释写 "`stays` handled inline by dispatch"。
//  意思是「翻转 expanded」不在这里做，而在 useMessageActions 里（第 248 行
//  那个 `if (a_0.stays)` 分支）。因为翻转需要 setCursor，而 run 的签名里
//  只有 caps（copy / edit），没有 setCursor。
//
//  这是一个**为了保持 run 签名统一而付出的代价**：一个动作的执行逻辑被拆到
//  两个地方。
export const MESSAGE_ACTIONS = [action({
  key: 'enter',
  label: s => s.expanded ? 'collapse' : 'expand',
  types: ['grouped_tool_use', 'collapsed_read_search', 'attachment', 'system'],
  stays: true,
  // Empty — `stays` handled inline by dispatch.
  run: () => {}
}), action({
  key: 'enter',
  label: 'edit',
  types: ['user'],
  run: (m, c) => void c.edit(m)
}), action({
  key: 'c',
  label: 'copy',
  types: NAVIGABLE_TYPES,
  run: (m, c) => c.copy(copyTextOf(m))
}), action({
  key: 'p',
  // `!` safe: applies() guarantees toolName ∈ PRIMARY_INPUT.
  label: s => `copy ${PRIMARY_INPUT[s.toolName!]!.label}`,
  types: ['grouped_tool_use', 'assistant'],
  applies: s => s.toolName != null && s.toolName in PRIMARY_INPUT,
  run: (m, c) => {
    const tc = toolCallOf(m);
    if (!tc) return;
    const val = PRIMARY_INPUT[tc.name]?.extract(tc.input);
    if (val) c.copy(val);
  }
})] as const;
// 【isApplicable 的两道判据：类型 + 附加条件】
//
//  `(a.types as readonly string[]).includes(c.msgType)` —— 那个 as 断言是
//  因为 `types` 是 readonly tuple，includes 的参数类型被收窄成元素类型的
//  联合，而 msgType 是更宽的 NavigableType。断言绕过，语义没问题。
//
//  第二道 `!a.applies || a.applies(c)` —— 没写 applies 就是「总是适用」。
//
//  applies 只有一条用了：`p`（copy primary input），条件是
//  `s.toolName != null && s.toolName in PRIMARY_INPUT`。
//
//  所以第 177 行注释说 "`!` safe: applies() guarantees toolName ∈ PRIMARY_INPUT"
//  —— 那里的 `!` 断言依赖 applies 的执行，是**跨语句的隐式契约**。如果有人
//  改 applies 的逻辑而忘了 label，这里会在运行时崩。
function isApplicable(a: (typeof MESSAGE_ACTIONS)[number], c: MessageActionsState): boolean {
  if (!(a.types as readonly string[]).includes(c.msgType)) return false;
  return !a.applies || a.applies(c);
}
export type MessageActionsState = {
  uuid: string;
  msgType: NavigableType;
  expanded: boolean;
  toolName?: string;
};
export type MessageActionsNav = {
  enterCursor: () => void;
  navigatePrev: () => void;
  navigateNext: () => void;
  navigatePrevUser: () => void;
  navigateNextUser: () => void;
  navigateTop: () => void;
  navigateBottom: () => void;
  getSelected: () => NavigableMessage | null;
};
export const MessageActionsSelectedContext = React.createContext(false);
export const InVirtualListContext = React.createContext(false);

// bg must go on the Box that HAS marginTop (margin stays outside paint) — that's inside each consumer.
// 【背景色放在「有 marginTop 的那个 Box」上，是有原因的】
//
//  注释写 "margin stays outside paint" —— 意思是 margin 区域不涂色。
//
//  如果给外层（有 margin 的）Box 设背景，margin 部分不会染色（yoga 的
//  margin 是布局属性，不属于 border-box）。所以要染色的 Box 必须是**内层**
//  那个真正包住内容的。
//
//  这条约束导致 useSelectedMessageBg 的返回值必须被带到各个组件的**内层**
//  Box，而不是统一包在行外面。所以有六个组件各自调这个 hook（tool_use /
//  attachment 的三处 / collapsed 内容等）。
export function useSelectedMessageBg() {
  return React.useContext(MessageActionsSelectedContext) ? "messageActionsBackground" : undefined;
}

// 【为什么不能在这里调 useKeybindings —— 这是 hook 的环境依赖问题】
//
//  注释："Can't call useKeybindings here — hook runs outside
//  <KeybindingSetup> provider."
//
//  也就是说 useMessageActions 这个 hook 的调用点（REPL.tsx）**不在**
//  KeybindingSetup 的子树里，所以在这里调 useKeybindings 会拿到一个空
//  context → 静默失效（不报错，只是键不响应）。
//
//  解法是拆成两半：
//  · useMessageActions（在 Provider 外，算 handlers）
//  · MessageActionsKeybindings（一个空组件，在 Provider 内，注册 handlers）
//
//  这个模式值得记：**当 hook 需要某个 context 但调用点没有时，把「算」和
//  「注册」拆开，让调用方决定在哪里挂注册组件。**
//
//  代价：调用方必须记得挂那个组件，否则功能静默失效。这是靠约定维持的。
// Can't call useKeybindings here — hook runs outside <KeybindingSetup> provider. Returns handlers instead.
export function useMessageActions(cursor: MessageActionsState | null, setCursor: React.Dispatch<React.SetStateAction<MessageActionsState | null>>, navRef: RefObject<MessageActionsNav | null>, caps: MessageActionCaps): {
  enter: () => void;
  handlers: Record<string, () => void>;
} {
  // Refs keep handlers stable — no useKeybindings re-register per message append.
// 【两个 ref 让 handlers 的依赖数组只有两个稳定值】
//
//  handlers 用 useMemo 算，依赖 `[setCursor, navRef]` —— 都是稳定的
//  （setCursor 来自 useState，navRef 是 ref 对象）。
//
//  而 cursor / caps 是每次都变的（cursor 每次移动都换对象，caps 里含
//  useCallback 的回调）。如果放进依赖，handlers 每次都重建 → useKeybindings
//  每次重新注册 → 每次按键都要重新绑一批监听器。
//
//  在终端里这个代价比浏览器大：注册/注销会触发 keybinding 上下文的 diff。
//
//  这是「ref 打破依赖链」的标准用法，和 MessageRow 的 lookupsRef、
//  VirtualMessageList 的 jumpState 是同一个手法 —— 本仓库里出现了十几次。
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const capsRef = useRef(caps);
  capsRef.current = caps;
  const handlers = useMemo(() => {
    const h: Record<string, () => void> = {
      'messageActions:prev': () => navRef.current?.navigatePrev(),
      'messageActions:next': () => navRef.current?.navigateNext(),
      'messageActions:prevUser': () => navRef.current?.navigatePrevUser(),
      'messageActions:nextUser': () => navRef.current?.navigateNextUser(),
      'messageActions:top': () => navRef.current?.navigateTop(),
      'messageActions:bottom': () => navRef.current?.navigateBottom(),
      'messageActions:escape': () => setCursor(c => c?.expanded ? {
        ...c,
        expanded: false
      } : null),
      // ctrl+c skips the collapse step — from expanded-during-streaming, two-stage
      // would mean 3 presses to interrupt (collapse→null→cancel).
      'messageActions:ctrlc': () => setCursor(null)
    };
// 【`new Set(...)` 去重是必须的，因为 'enter' 出现两次】
//
//  MESSAGE_ACTIONS 里有两条 key 为 'enter' 的动作。不去重的话，
//  `h['messageActions:enter']` 会被赋值两次 —— 后一次覆盖前一次。
//
//  这里覆盖**恰好无害**，因为两条的 handler 体完全一样（都是
//  `MESSAGE_ACTIONS.find(a => a.key === key && isApplicable(a, c_0))`，
//  按顺序找第一条适用的）。
//
//  但这是运气好，不是设计。如果有人给某条动作写了特殊 handler，去重就从
//  「省一次赋值」变成「保命的」。
    for (const key of new Set(MESSAGE_ACTIONS.map(a_1 => a_1.key))) {
      h[`messageActions:${key}`] = () => {
        const c_0 = cursorRef.current;
        if (!c_0) return;
        const a_0 = MESSAGE_ACTIONS.find(a => a.key === key && isApplicable(a, c_0));
        if (!a_0) return;
// 【`stays` 的语义就是「不退出光标模式」】
//
//  普通动作执行完 `setCursor(null)` 退出光标（比如复制完就回去了）。
//  `stays: true` 的动作只翻转 expanded，保持光标不动。
//
//  为什么展开要留在光标里：用户展开一条消息是为了读它，读完通常还想继续
//  ↑↓ 移动。退出光标会让每次展开都要重新按 shift+↑ 找回来。
//
//  注意这里用的是函数式 setCursor（`c_1 => c_1 ? {...c_1, expanded} : null`），
//  而不是读 cursorRef。因为这个更新依赖**上一次的值**，必须走 updater 形式
//  才不会在批量更新时丢帧。
        if (a_0.stays) {
          setCursor(c_1 => c_1 ? {
            ...c_1,
            expanded: !c_1.expanded
          } : null);
          return;
        }
        const m = navRef.current?.getSelected();
        if (!m) return;
        (a_0.run as (m: NavigableMessage, c_0: MessageActionCaps) => void)(m, capsRef.current);
        setCursor(null);
      };
    }
    return h;
  }, [setCursor, navRef]);
// 【enter 打点，其他动作不打点】
//
//  `logEvent('tengu_message_actions_enter', {})` —— 只记「进入光标模式」，
//  不记具体做了什么动作。
//
//  这是产品分析的最小集：知道有多少人用过这个功能就够了，具体按了哪个键
//  属于过度采集。而且打点本身有成本（网络/磁盘），高频动作不适合每次都记。
//
//  注意这个函数是 useCallback，依赖 [navRef] —— navRef 是 ref 对象，稳定，
//  所以 enter 的身份也稳定。这很重要：它会作为 prop 传下去（第 267 行返回
//  的 enter 被调用方用于 shift+↑ 的绑定）。
  const enter = useCallback(() => {
    logEvent('tengu_message_actions_enter', {});
    navRef.current?.enterCursor();
  }, [navRef]);
  return {
    enter,
    handlers
  };
}

// Must mount inside <KeybindingSetup>.
// 【这个组件只做一件事：注册键位，然后返回 null】
//
//  它是「渲染空但产生副作用」的组件 —— React 里合法的模式，但要注意它必须
//  渲染在正确的子树里（KeybindingSetup 内），否则 useKeybindings 拿不到
//  context。
//
//  它的 memo 缓存只有 2 个槽：$[0] 存 `{context, isActive}` 对象，$[1] 存
//  这个对象。也就是说它唯一的缓存就是「isActive 没变就不重建 options 对象」。
//
//  为什么这里需要缓存：useKeybindings 很可能对 options 做引用比较来决定
//  要不要重新注册。每次传新对象 = 每次重注册。
export function MessageActionsKeybindings(t0) {
  const $ = _c(2);
  const {
    handlers,
    isActive
  } = t0;
  let t1;
  if ($[0] !== isActive) {
    t1 = {
      context: "MessageActions",
      isActive
    };
    $[0] = isActive;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  useKeybindings(handlers, t1);
  return null;
}

// borderTop-only Box matches PromptInput's ─── line for stable footer height.
// 【状态条的 memo 缓存形态很怪：它把「组件类型」也存了】
//
//  `T0 = Box; t1 = 2; t2 = 1;` —— 注意这里存的是 `Box`（一个组件引用）和
//  两个数字。后面用 `<T0 paddingX={t1} paddingY={t2}>` 渲染。
//
//  这是 React Compiler 对 JSX 的标准处理：它把每个 prop 值单独存槽，然后
//  用变量当标签名渲染。所以读这种代码要反过来还原：
//
//    <Box flexDirection="column" flexShrink={0} paddingY={1}>
//      <Box borderStyle="single" borderTop ... />   ← t7
//      <Box paddingX={2} paddingY={1}>...</Box>      ← t13
//    </Box>
//
//  直接看 `T0/T1/t1..t7` 会晕，因为它把「静态 prop（从不变化）」也当变量存。
//  这些槽（比如 $[10]、$[11..15]）用的是 `Symbol.for("react.memo_cache_sentinel")`
//  作初值 —— 这是「永久缓存」的标记，永远不会失效。
export function MessageActionsBar(t0) {
  const $ = _c(28);
  const {
    cursor
  } = t0;
  let T0;
  let T1;
  let t1;
  let t2;
  let t3;
  let t4;
  let t5;
  let t6;
  let t7;
  if ($[0] !== cursor) {
    const applicable = MESSAGE_ACTIONS.filter(a => isApplicable(a, cursor));
    T1 = Box;
    t4 = "column";
    t5 = 0;
    t6 = 1;
    if ($[10] === Symbol.for("react.memo_cache_sentinel")) {
// 【只有上边框的 Box，是为了和 PromptInput 那条 ─── 对齐】
//
//  注释："borderTop-only Box matches PromptInput's ─── line for stable footer
//  height."
//
//  关键词是 **stable footer height**：底部区域的高度必须稳定，否则每次
//  显隐状态条都会让整个列表重新布局。
//
//  用 `borderStyle="single"` + 只开上边，得到一条 ─── 横线，高度 1，和输入框
//  顶部那条线在视觉上连续。
//
//  这是一个「用边框冒充分隔线」的技巧：比 Divider 组件少一层 Box，而且
//  边框的高度是布局阶段确定的（Divider 的内容高度要测量）。
      t7 = <Box borderStyle="single" borderTop={true} borderBottom={false} borderLeft={false} borderRight={false} borderDimColor={true} />;
      $[10] = t7;
    } else {
      t7 = $[10];
    }
    T0 = Box;
    t1 = 2;
    t2 = 1;
// 【`key={a_0.key}` 有一个潜在问题：两条 enter 的 key 相同】
//
//  当前不会冲突，因为 `applicable` 已经按消息类型过滤过，两条 enter 永远
//  不会同时出现在同一个列表里（types 无交集）。
//
//  但如果将来加了两条同 key 且 types 有交集的动作，React 会报「duplicate
//  key」警告，而症状是**其中一个的动作不显示**（React 会丢弃重复 key 的
//  后一个元素）。
//
//  更稳的写法是用 index 或者 `key + i`，但当前写法在「同一时刻只有一条
//  生效」的前提下是对的 —— 这是依赖不变量的代码。
    t3 = applicable.map((a_0, i) => {
      const label = typeof a_0.label === "function" ? a_0.label(cursor) : a_0.label;
      return <React.Fragment key={a_0.key}>{i > 0 && <Text dimColor={true}> · </Text>}<Text bold={true} dimColor={false}>{a_0.key}</Text><Text dimColor={true}> {label}</Text></React.Fragment>;
    });
    $[0] = cursor;
    $[1] = T0;
    $[2] = T1;
    $[3] = t1;
    $[4] = t2;
    $[5] = t3;
    $[6] = t4;
    $[7] = t5;
    $[8] = t6;
    $[9] = t7;
  } else {
    T0 = $[1];
    T1 = $[2];
    t1 = $[3];
    t2 = $[4];
    t3 = $[5];
    t4 = $[6];
    t5 = $[7];
    t6 = $[8];
    t7 = $[9];
  }
  let t10;
  let t11;
  let t12;
  let t8;
  let t9;
  if ($[11] === Symbol.for("react.memo_cache_sentinel")) {
    t8 = <Text dimColor={true}> · </Text>;
    t9 = <Text bold={true} dimColor={false}>{figures.arrowUp}{figures.arrowDown}</Text>;
    t10 = <Text dimColor={true}> navigate · </Text>;
    t11 = <Text bold={true} dimColor={false}>esc</Text>;
    t12 = <Text dimColor={true}> back</Text>;
    $[11] = t10;
    $[12] = t11;
    $[13] = t12;
    $[14] = t8;
    $[15] = t9;
  } else {
    t10 = $[11];
    t11 = $[12];
    t12 = $[13];
    t8 = $[14];
    t9 = $[15];
  }
  let t13;
  if ($[16] !== T0 || $[17] !== t1 || $[18] !== t2 || $[19] !== t3) {
    t13 = <T0 paddingX={t1} paddingY={t2}>{t3}{t8}{t9}{t10}{t11}{t12}</T0>;
    $[16] = T0;
    $[17] = t1;
    $[18] = t2;
    $[19] = t3;
    $[20] = t13;
  } else {
    t13 = $[20];
  }
  let t14;
  if ($[21] !== T1 || $[22] !== t13 || $[23] !== t4 || $[24] !== t5 || $[25] !== t6 || $[26] !== t7) {
    t14 = <T1 flexDirection={t4} flexShrink={t5} paddingY={t6}>{t7}{t13}</T1>;
    $[21] = T1;
    $[22] = t13;
    $[23] = t4;
    $[24] = t5;
    $[25] = t6;
    $[26] = t7;
    $[27] = t14;
  } else {
    t14 = $[27];
  }
  return t14;
}
// 【用循环而不是正则，是因为要处理「连续多个」】
//
//  `while (t.startsWith('<system-reminder>'))` —— 剥掉一个之后可能还有一个。
//  换成一条带加号量词的正则（「一个或多个 system-reminder 段」）也能做，
//  但那是回溯型匹配，长文本下有性能风险。
//
//  另一个细节：`if (end < 0) break;` —— 遇到不闭合的开标签就停，而不是
//  继续往前找。这样畸形输入不会把整段文本吃掉。
//
//  trimStart 而不是 trim：只剥前导空白，因为尾部空白是用户内容的一部分。
export function stripSystemReminders(text: string): string {
  const CLOSE = '</system-reminder>';
  let t = text.trimStart();
  while (t.startsWith('<system-reminder>')) {
    const end = t.indexOf(CLOSE);
    if (end < 0) break;
    t = t.slice(end + CLOSE.length).trimStart();
  }
  return t;
}
// 【六个 case，每个都在回答「这条消息的文本是什么」】
//
//  · user       → 剥掉 system-reminder 后的正文
//  · assistant  → 文本块；没有文本就取工具的主参数
//  · grouped    → 所有成员的结果拼起来
//  · collapsed  → 成员里的工具结果拼起来（跳过非结果消息）
//  · system     → content / error / subtype 三个来源依次尝试
//  · attachment → queued_command 取 prompt，其余只给一个类型名占位
//
//  注意后两类都是**尽力而为**：system 可能三个字段都没有，只返回 subtype
//  （一个内部标识符）；attachment 大部分类型返回 `[type]`。
//
//  这些都是「复制出来的东西没用但不至于崩」的选择。在「宁缺勿滥」和
//  「绝不返回空」之间，这里选了后者 —— 因为复制到空字符串时用户会以为
//  功能坏了。`[diagnostics]` 至少告诉他「这里有一条诊断信息」。
export function copyTextOf(msg: NavigableMessage): string {
  switch (msg.type) {
    case 'user':
      {
        const b = msg.message.content[0];
        return b?.type === 'text' ? stripSystemReminders(b.text) : '';
      }
    case 'assistant':
      {
        const b = msg.message.content[0];
        if (b?.type === 'text') return b.text;
        const tc = toolCallOf(msg);
        return tc ? PRIMARY_INPUT[tc.name]?.extract(tc.input) ?? '' : '';
      }
    case 'grouped_tool_use':
      return msg.results.map(toolResultText).filter(Boolean).join('\n\n');
    case 'collapsed_read_search':
      return msg.messages.flatMap(m => m.type === 'user' ? [toolResultText(m)] : m.type === 'grouped_tool_use' ? m.results.map(toolResultText) : []).filter(Boolean).join('\n\n');
    case 'system':
      if ('content' in msg) return msg.content;
      if ('error' in msg) return String(msg.error);
      return msg.subtype;
    case 'attachment':
      {
        const a = msg.attachment;
        if (a.type === 'queued_command') {
          const p = a.prompt;
          return typeof p === 'string' ? p : p.flatMap(b => b.type === 'text' ? [b.text] : []).join('\n');
        }
        return `[${a.type}]`;
      }
  }
}
function toolResultText(r: NormalizedUserMessage): string {
  const b = r.message.content[0];
  if (b?.type !== 'tool_result') return '';
  const c = b.content;
  if (typeof c === 'string') return c;
  if (!c) return '';
  return c.flatMap(x => x.type === 'text' ? [x.text] : []).join('\n');
}
// 原文件此处有一行 40984 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。