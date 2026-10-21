// ═══════════════════════════════════════════════════════════════
//  自研终端渲染器的第一层：让 React 认得一个「终端 DOM」
// ═══════════════════════════════════════════════════════════════
//
//   react-reconciler 是一个「调度 + 协调」内核，它不知道什么叫 div。
//   renderer 作者提供一组 host config 回调，React 就会在正确的时机调它们：
//   createInstance / appendChild / commitUpdate / resetAfterCommit ...
//
//   所以这个文件的本质是：**把 React 的 mutation 语义翻译成树操作**。
//   它不负责画，也不负责量 —— 画在 render-node-to-output.ts，量在 yoga。
//
// 【三份文件的职责切分】
//
//   reconciler.ts   React 与树之间的适配器（本文件）
//   dom.ts          极简 DOM + yoga 桥（节点、属性、脏标记）
//   ink.tsx         帧循环、终端模式、光标、diff、写屏幕
//
// 【读这个文件的两个技巧】
//
//   ① 大部分方法读一眼就知道在干什么（appendChild 就是 appendChild），
//      真正要细看的只有六个：resetAfterCommit / createInstance / commitUpdate /
//      hideInstance / removeChild* / 末尾那堆 React 19 空实现。
//   ② 每个回调都在 React 的特定阶段被调用，**顺序比内容重要**：
//      createInstance（render 阶段）→ appendChild（commit 阶段）
//      → resetAfterCommit（commit 末尾）→ useLayoutEffect
//      → scheduleRender（微任务）→ onRender（帧）
//      记住这条线，ink.tsx 里那些「为什么不能同步渲染」的注释才读得通。
/* eslint-disable custom-rules/no-top-level-side-effects */

import { appendFileSync } from 'fs'
import createReconciler from 'react-reconciler'
import { getYogaCounters } from 'src/native-ts/yoga-layout/index.js'
import { isEnvTruthy } from '../utils/envUtils.js'
import {
  appendChildNode,
  clearYogaNodeReferences,
  createNode,
  createTextNode,
  type DOMElement,
  type DOMNodeAttribute,
  type ElementNames,
  insertBeforeNode,
  markDirty,
  removeChildNode,
  setAttribute,
  setStyle,
  setTextNodeValue,
  setTextStyles,
  type TextNode,
} from './dom.js'
import { Dispatcher } from './events/dispatcher.js'
import { EVENT_HANDLER_PROPS } from './events/event-handlers.js'
import { getFocusManager, getRootNode } from './focus.js'
import { LayoutDisplay } from './layout/node.js'
import applyStyles, { type Styles, type TextStyles } from './styles.js'

// We need to conditionally perform devtools connection to avoid
// accidentally breaking other third-party code.
// See https://github.com/vadimdemedes/ink/issues/384
// 【devtools 只在开发期连，而且必须 try/catch】
//
//   NODE_ENV 判断是编译期常量，生产包里整块被删掉。
//   但即便如此也要 catch：环境变量 DEV=true 是很多第三方工具的习惯用法，
//   用户的项目里可能有，而 react-devtools-core 不一定装了。
//   硬 import 会让一个「和我无关的环境变量」把整个 CLI 搞崩（issue #384）。
//
//   catch 里只吞 ERR_MODULE_NOT_FOUND，其他错误照抛 —— 因为那是我们自己的 bug，
//   不该被伪装成「devtools 没装」。
if (process.env.NODE_ENV === 'development') {
  try {
    // eslint-disable-next-line custom-rules/no-top-level-dynamic-import -- dev-only; NODE_ENV check is DCE'd in production
    void import('./devtools.js')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    if (error.code === 'ERR_MODULE_NOT_FOUND') {
      // biome-ignore lint/suspicious/noConsole: intentional warning
      console.warn(
        `
The environment variable DEV is set to true, so Ink tried to import \`react-devtools-core\`,
but this failed as it was not installed. Debugging with React Devtools requires it.

To install use this command:

$ npm install --save-dev react-devtools-core
				`.trim() + '\n',
      )
    } else {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw error
    }
  }
}

// --

type AnyObject = Record<string, unknown>

// 【自己写 diff，因为 React 19 不再给 updatePayload】
//
//   React 18 的 commitUpdate 会拿到一个由 prepareUpdate 算好的变更集；
//   React 19 改成直接给 oldProps / newProps，diff 责任回到 renderer。
//
//   返回 undefined 表示「没有任何变化」，不是返回空对象 ——
//   让调用方写成 `if (props) {...}`，比 `if (Object.keys(props).length)` 干净，
//   也顺手省掉一次分配（这个函数每次更新都会跑）。
//
//   style 被单独 diff 一次（433 行）：因为要给 yoga 的是**完整的新 style**，
//   而不是差异。两套消费者，两种数据形状。
const diff = (before: AnyObject, after: AnyObject): AnyObject | undefined => {
  if (before === after) {
    return
  }

  if (!before) {
    return after
  }

  const changed: AnyObject = {}
  let isChanged = false

  for (const key of Object.keys(before)) {
    const isDeleted = after ? !Object.hasOwn(after, key) : true

    if (isDeleted) {
      changed[key] = undefined
      isChanged = true
    }
  }

  if (after) {
    for (const key of Object.keys(after)) {
      if (after[key] !== before[key]) {
        changed[key] = after[key]
        isChanged = true
      }
    }
  }

  return isChanged ? changed : undefined
}

// 【释放顺序不是可选的：yoga 是 WASM，free 之后访问不报错】
//
//   三步的顺序：
//     1. unsetMeasureFunc —— 摘掉回调，避免 free 过程中被调用
//     2. clearYogaNodeReferences —— 递归把整棵子树的 yogaNode 置 undefined
//     3. freeRecursive —— 真正释放 WASM 内存
//
//   若省掉第 2 步：freeRecursive 会连带释放所有子节点，但子节点对象上的
//   yogaNode 引用还指着已释放的内存。之后任何一次 markDirty / calculateLayout
//   都会读到垃圾值 —— 而 WASM 不会抛「use after free」，它会安静地给出错误结果，
//   表现为界面随机错乱或进程段错误。
//
//   这就是为什么第 2 步的注释写着 BEFORE freeing：**顺序即正确性**。
const cleanupYogaNode = (node: DOMElement | TextNode): void => {
  const yogaNode = node.yogaNode
  if (yogaNode) {
    yogaNode.unsetMeasureFunc()
    // Clear all references BEFORE freeing to prevent other code from
    // accessing freed WASM memory during concurrent operations
    clearYogaNodeReferences(node)
    yogaNode.freeRecursive()
  }
}

// --

type Props = Record<string, unknown>

// host context 只携带一个布尔量：当前是否位于 <Text> 内部。
// 它决定两件事：<Box> 能不能创建（不能）、<Text> 要建成实体还是虚拟节点（见 342 行）。
type HostContext = {
  isInsideText: boolean
}

function setEventHandler(node: DOMElement, key: string, value: unknown): void {
  if (!node._eventHandlers) {
    node._eventHandlers = {}
  }
  node._eventHandlers[key] = value
}

// 【一个 prop 可能同时喂两个消费者】
//
//   style 要喂两份：
//     setStyle(node, style)      → 渲染层用（颜色、边框、背景）
//     applyStyles(yogaNode, style) → 布局层用（宽高、padding、flex）
//
//   yoga 只懂布局相关的那部分，渲染层不懂布局 —— 所以同一份 style
//   被切成两半用。这就是为什么 styles.ts 里那套 Styles 类型被两个模块读。
//
//   textStyles 单独一支：它是「文字样式」（粗体/下划线/颜色），只影响渲染，
//   不参与布局，所以不进 yoga。
function applyProp(node: DOMElement, key: string, value: unknown): void {
  if (key === 'children') return

  if (key === 'style') {
    setStyle(node, value as Styles)
    if (node.yogaNode) {
      applyStyles(node.yogaNode, value as Styles)
    }
    return
  }

  if (key === 'textStyles') {
    node.textStyles = value as TextStyles
    return
  }

  if (EVENT_HANDLER_PROPS.has(key)) {
    setEventHandler(node, key, value)
    return
  }

  setAttribute(node, key, value as DOMNodeAttribute)
}

// --

// 【摸 React 内部字段，只为一件事：出问题时能说出是谁干的】
//
//   Fiber 不是公开 API。这里读的 _debugOwner / return 都是 react-reconciler
//   的内部字段，随时可能改名。所以：
//     · 只在 CLAUDE_CODE_DEBUG_REPAINTS 打开时才记录（354 行）
//     · 有 50 层上限 + seen 集合防环（Fiber 的 return 链理论上不该成环，
//       但 alternate/current 双树在 debug 构建下真的踩过）
//
//   为什么要这个：终端 UI 最难查的 bug 是「整屏突然重绘」——
//   现象是闪烁，但你不知道是哪段内容变了导致 diff 放弃增量。
//   有了 owner chain，日志能直接写「culprit: ToolUseLoader < Messages < REPL」。
//
//   代价是这个信息只在 debug 构建里有（生产构建的 _debugOwner 是 null）。
// react-reconciler's Fiber shape — only the fields we walk. The 5th arg to
// createInstance is the Fiber (`workInProgress` in react-reconciler.dev.js).
// _debugOwner is the component that rendered this element (dev builds only);
// return is the parent fiber (always present). We prefer _debugOwner since it
// skips past Box/Text wrappers to the actual named component.
type FiberLike = {
  elementType?: { displayName?: string; name?: string } | string | null
  _debugOwner?: FiberLike | null
  return?: FiberLike | null
}

export function getOwnerChain(fiber: unknown): string[] {
  const chain: string[] = []
  const seen = new Set<unknown>()
  let cur = fiber as FiberLike | null | undefined
  for (let i = 0; cur && i < 50; i++) {
    if (seen.has(cur)) break
    seen.add(cur)
    const t = cur.elementType
    const name =
      typeof t === 'function'
        ? (t as { displayName?: string; name?: string }).displayName ||
          (t as { displayName?: string; name?: string }).name
        : typeof t === 'string'
          ? undefined // host element (ink-box etc) — skip
          : t?.displayName || t?.name
    if (name && name !== chain[chain.length - 1]) chain.push(name)
    cur = cur._debugOwner ?? cur.return
  }
  return chain
}

// env 读取缓存成模块级变量：isDebugRepaintsEnabled 在热路径上被调用
// （createInstance 每建一个节点问一次），process.env 访问是哈希查找，不值得反复做。
let debugRepaints: boolean | undefined
export function isDebugRepaintsEnabled(): boolean {
  if (debugRepaints === undefined) {
    debugRepaints = isEnvTruthy(process.env.CLAUDE_CODE_DEBUG_REPAINTS)
  }
  return debugRepaints
}

export const dispatcher = new Dispatcher()

// 【这些计数器是模块级的，不是实例级的】
//
//   因为它们是「临时排障埋点」，不是运行时状态：
//   一个人同时只跑一个 CLI，一份计数器够用。做成实例字段要多传一路参数，
//   而这个文件里的埋点本来就是要被删掉的。
//
//   真正值得注意的是写入条件：只在 gap > 30ms / reconcile > 20ms /
//   creates > 50 / layout > 20ms 时才 appendFileSync。
//   **埋点本身不能成为性能问题** —— 每帧同步写文件会让被测对象更慢，
//   测出来的数据就不可信了。
// --- COMMIT INSTRUMENTATION (temp debugging) ---
// eslint-disable-next-line custom-rules/no-process-env-top-level -- debug instrumentation, read-once is fine
const COMMIT_LOG = process.env.CLAUDE_CODE_COMMIT_LOG
let _commits = 0
let _lastLog = 0
let _lastCommitAt = 0
let _maxGapMs = 0
let _createCount = 0
let _prepareAt = 0
// --- END ---

// --- SCROLL PROFILING (bench/scroll-e2e.sh reads via getLastYogaMs) ---
// Set by onComputeLayout wrapper in ink.tsx; read by onRender for phases.
let _lastYogaMs = 0
let _lastCommitMs = 0
let _commitStart = 0
export function recordYogaMs(ms: number): void {
  _lastYogaMs = ms
}
export function getLastYogaMs(): number {
  return _lastYogaMs
}
export function markCommitStart(): void {
  _commitStart = performance.now()
}
export function getLastCommitMs(): number {
  return _lastCommitMs
}
export function resetProfileCounters(): void {
  _lastYogaMs = 0
  _lastCommitMs = 0
  _commitStart = 0
}
// --- END ---

// 【14 个类型参数，只需要看懂 6 个】
//
//   HostElement        DOMElement        宿主元素类型
//   HostText           TextNode          文本节点类型
//   HostContext        { isInsideText }  跨层级传递的上下文
//   UpdatePayload      null              React 19 不再用，所以是 null；
//                                         留着位置是为了对上签名
//   TimeoutHandle      NodeJS.Timeout    调度用的定时器类型
//   NoTimeout          -1                表示「没有超时」的哨兵值
//
//   剩下的是 React 内部的 Suspense / Transition 相关槽位，这个 renderer 全部
//   声明为「不支持」（472-505 行那一片空实现就是对它们的回答）。
const reconciler = createReconciler<
  ElementNames,
  Props,
  DOMElement,
  DOMElement,
  TextNode,
  DOMElement,
  unknown,
  unknown,
  DOMElement,
  HostContext,
  null, // UpdatePayload - not used in React 19
  NodeJS.Timeout,
  -1,
  null
>({
  getRootHostContext: () => ({ isInsideText: false }),
  prepareForCommit: () => {
    if (COMMIT_LOG) _prepareAt = performance.now()
    return null
  },
  preparePortalMount: () => null,
  clearContainer: () => false,
// 【resetAfterCommit 是一帧的起点，做两件事：算布局、渲染】
//
//   为什么布局必须在这里（commit 阶段）算，而不是等微任务：
//   紧接着 React 会跑 useLayoutEffect，而那些 hook 要读「当前布局结果」
//   （比如 useDeclaredCursor 要把光标放到输入框的 caret 上）。
//   布局晚一步，光标就慢一帧 —— 打字时肉眼可见。
//
//   渲染则相反，必须推到微任务（ink.tsx 的 scheduleRender）：
//   因为 layout effect 里可能改状态（光标声明），同步渲染会画出旧值。
//
//   **同一个 commit 里，量要早、画要晚。**
  resetAfterCommit(rootNode) {
    _lastCommitMs = _commitStart > 0 ? performance.now() - _commitStart : 0
    _commitStart = 0
    if (COMMIT_LOG) {
      const now = performance.now()
      _commits++
      const gap = _lastCommitAt > 0 ? now - _lastCommitAt : 0
      if (gap > _maxGapMs) _maxGapMs = gap
      _lastCommitAt = now
      const reconcileMs = _prepareAt > 0 ? now - _prepareAt : 0
      if (gap > 30 || reconcileMs > 20 || _createCount > 50) {
        // eslint-disable-next-line custom-rules/no-sync-fs -- debug instrumentation
        appendFileSync(
          COMMIT_LOG,
          `${now.toFixed(1)} gap=${gap.toFixed(1)}ms reconcile=${reconcileMs.toFixed(1)}ms creates=${_createCount}\n`,
        )
      }
      _createCount = 0
      if (now - _lastLog > 1000) {
        // eslint-disable-next-line custom-rules/no-sync-fs -- debug instrumentation
        appendFileSync(
          COMMIT_LOG,
          `${now.toFixed(1)} commits=${_commits}/s maxGap=${_maxGapMs.toFixed(1)}ms\n`,
        )
        _commits = 0
        _maxGapMs = 0
        _lastLog = now
      }
    }
    const _t0 = COMMIT_LOG ? performance.now() : 0
    if (typeof rootNode.onComputeLayout === 'function') {
      rootNode.onComputeLayout()
    }
    if (COMMIT_LOG) {
      const layoutMs = performance.now() - _t0
      if (layoutMs > 20) {
        const c = getYogaCounters()
        // eslint-disable-next-line custom-rules/no-sync-fs -- debug instrumentation
        appendFileSync(
          COMMIT_LOG,
          `${_t0.toFixed(1)} SLOW_YOGA ${layoutMs.toFixed(1)}ms visited=${c.visited} measured=${c.measured} hits=${c.cacheHits} live=${c.live}\n`,
        )
      }
    }

// 测试环境的特殊路径：直接同步渲染，跳过 throttle。
//
//   node NODE_ENV=test 时 React 19 会把 effect 双调用一遍，
//   导致某一刻树是空的 —— 如果用 hasRenderedContent 挡一下，
//   测试里 lastFrame() 就能稳定读到非空结果。
//
//   生产环境不会走这里。所以读这个分支的作用不是理解主流程，
//   而是理解「为什么测试里的行为和生产不一样」。
    if (process.env.NODE_ENV === 'test') {
      if (rootNode.childNodes.length === 0 && rootNode.hasRenderedContent) {
        return
      }
      if (rootNode.childNodes.length > 0) {
        rootNode.hasRenderedContent = true
      }
      rootNode.onImmediateRender?.()
      return
    }

    const _tr = COMMIT_LOG ? performance.now() : 0
    rootNode.onRender?.()
    if (COMMIT_LOG) {
      const renderMs = performance.now() - _tr
      if (renderMs > 10) {
        // eslint-disable-next-line custom-rules/no-sync-fs -- debug instrumentation
        appendFileSync(
          COMMIT_LOG,
          `${_tr.toFixed(1)} SLOW_PAINT ${renderMs.toFixed(1)}ms\n`,
        )
      }
    }
  },
// 【注意 324 行：值相等时返回父对象本身，而不是新建对象】
//
//   React 用 === 比较 host context 决定要不要重渲染子树。
//   每次新建对象的话，任何一次父级更新都会被判定成「context 变了」，
//   整棵子树全部重渲染 —— 对一个每帧都在更新的终端 UI 是灾难。
//
//   所以只有 isInsideText 真的翻转时才新建对象。
//   这类「值语义的对象要手工做引用复用」的写法，在 React renderer 里是硬性要求。
  getChildHostContext(
    parentHostContext: HostContext,
    type: ElementNames,
  ): HostContext {
    const previousIsInsideText = parentHostContext.isInsideText
    const isInsideText =
      type === 'ink-text' || type === 'ink-virtual-text' || type === 'ink-link'

    if (previousIsInsideText === isInsideText) {
      return parentHostContext
    }

    return { isInsideText }
  },
  shouldSetTextContent: () => false,
// 【createInstance 里的两个决定，都是「终端语义」决定的】
//
//   ① Box 不能在 Text 里 —— 直接抛错。
//      DOM 里 div 套在 span 里是合法的（虽然不推荐），但终端里
//      Text 的内容要被展平成一段字符串去测量宽度，中间插一个 Block
//      就再也算不出「这段文字多宽」了。所以这不是风格检查，是能力边界。
//
//   ② Text 套 Text → 建成 ink-virtual-text（342 行）。
//      嵌套的 Text 不创建 yoga 节点、不参与布局，只把文字和样式合并进父级。
//      这样 <Text>前<Text color="red">中</Text>后</Text> 能拼成一行三段样式，
//      而不是三个独立的盒子。
//
//   ③ debugOwnerChain 只在 debug 开关下记录（354 行），理由见 147 行。
  createInstance(
    originalType: ElementNames,
    newProps: Props,
    _root: DOMElement,
    hostContext: HostContext,
    internalHandle?: unknown,
  ): DOMElement {
    if (hostContext.isInsideText && originalType === 'ink-box') {
      throw new Error(`<Box> can't be nested inside <Text> component`)
    }

    const type =
      originalType === 'ink-text' && hostContext.isInsideText
        ? 'ink-virtual-text'
        : originalType

    const node = createNode(type)
    if (COMMIT_LOG) _createCount++

    for (const [key, value] of Object.entries(newProps)) {
      applyProp(node, key, value)
    }

    if (isDebugRepaintsEnabled()) {
      node.debugOwnerChain = getOwnerChain(internalHandle)
    }

    return node
  },
// 【裸字符串必须包在 <Text> 里，否则抛错 —— 这是 Ink 与 DOM 最大的差异】
//
//   DOM 里 <div>hello</div> 完全合法，文本节点是匿名的。
//   终端里不行：文字必须有样式（至少要是「默认样式」）才能被测量和绘制，
//   而「无父级的裸文本」不知道自己该继承什么，也不知道该放在哪一行。
//
//   所以这条错误信息不是防御性检查，是在告诉使用者「Ink 的文本模型是显式的」。
//   实际体验上，这是新手写 Ink 最常撞的一堵墙。
  createTextInstance(
    text: string,
    _root: DOMElement,
    hostContext: HostContext,
  ): TextNode {
    if (!hostContext.isInsideText) {
      throw new Error(
        `Text string "${text}" must be rendered inside <Text> component`,
      )
    }

    return createTextNode(text)
  },
  resetTextContent() {},
  hideTextInstance(node) {
    setTextNodeValue(node, '')
  },
  unhideTextInstance(node, text) {
    setTextNodeValue(node, text)
  },
  getPublicInstance: (instance): DOMElement => instance as DOMElement,
// 【隐藏用 display:none，不从树里摘掉】
//
//   React 的 Offscreen/Activity 语义要求「隐藏但保留状态」：
//   组件不卸载，useState 还在，只是不画。
//   如果在这里真的 removeChild，隐藏再显示就等于重新挂载 ——
//   输入框内容、滚动位置、动画进度全部丢失。
//
//   用 yoga 的 display:none 实现，既能省掉绘制，又能让布局跳过它。
  hideInstance(node) {
    node.isHidden = true
    node.yogaNode?.setDisplay(LayoutDisplay.None)
    markDirty(node)
  },
  unhideInstance(node) {
    node.isHidden = false
    node.yogaNode?.setDisplay(LayoutDisplay.Flex)
    markDirty(node)
  },
  appendInitialChild: appendChildNode,
  appendChild: appendChildNode,
  insertBefore: insertBeforeNode,
// finalizeInitialChildren 的返回值决定 React 要不要给这个节点调 commitMount。
// 整个 renderer 里只有 autoFocus 需要「挂载后立刻做一件事」——
// 这也是唯一需要 commitMount 的场景（见 401 行）。
  finalizeInitialChildren(
    _node: DOMElement,
    _type: ElementNames,
    props: Props,
  ): boolean {
    return props['autoFocus'] === true
  },
  commitMount(node: DOMElement): void {
    getFocusManager(node).handleAutoFocus(node)
  },
  isPrimaryRenderer: true,
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,
  noTimeout: -1,
  getCurrentUpdatePriority: () => dispatcher.currentUpdatePriority,
  beforeActiveInstanceBlur() {},
  afterActiveInstanceBlur() {},
  detachDeletedInstance() {},
  getInstanceFromNode: () => null,
  prepareScopeUpdate() {},
  getInstanceFromScope: () => null,
  appendChildToContainer: appendChildNode,
  insertInContainerBefore: insertBeforeNode,
// 【容器级移除比普通移除多两件事】
//
//   removeChildFromContainer 除了摘节点、释放 yoga，还要通知 focusManager：
//   被删的子树里可能有当前焦点元素，焦点必须转移到别处（否则键盘事件打给空气）。
//
//   普通 removeChild（463 行）用的是反查 root 的写法（getRootNode(node)），
//   因为那时手上只有父节点，而 focusManager 只挂在 ink-root 上。
  removeChildFromContainer(node: DOMElement, removeNode: DOMElement): void {
    removeChildNode(node, removeNode)
    cleanupYogaNode(removeNode)
    getFocusManager(node).handleNodeRemoved(removeNode, node)
  },
// 【commitUpdate 是每次更新都会走的热路径】
//
//   两步：
//     1. diff 出变化的 prop，逐个应用（style / textStyles / 事件 / 普通属性）
//     2. 若 style 变了，把**完整新 style** 交给 yoga 重算布局
//
//   为什么不把 yoga 的更新也做成差量：yoga 自己是增量引擎，
//   applyStyles 写进去的每个属性都会标脏对应节点，重算是它自己的事。
//   我们只负责「告诉它新值」，不负责「告诉它变化」。
//
//   这也是整个 renderer 的分工哲学：**我们管数据，库管计算。**
  // React 19 commitUpdate receives old and new props directly instead of an updatePayload
  commitUpdate(
    node: DOMElement,
    _type: ElementNames,
    oldProps: Props,
    newProps: Props,
  ): void {
    const props = diff(oldProps, newProps)
    const style = diff(oldProps['style'] as Styles, newProps['style'] as Styles)

    if (props) {
      for (const [key, value] of Object.entries(props)) {
        if (key === 'style') {
          setStyle(node, value as Styles)
          continue
        }

        if (key === 'textStyles') {
          setTextStyles(node, value as TextStyles)
          continue
        }

        if (EVENT_HANDLER_PROPS.has(key)) {
          setEventHandler(node, key, value)
          continue
        }

        setAttribute(node, key, value as DOMNodeAttribute)
      }
    }

    if (style && node.yogaNode) {
      applyStyles(node.yogaNode, style, newProps['style'] as Styles)
    }
  },
  commitTextUpdate(node: TextNode, _oldText: string, newText: string): void {
    setTextNodeValue(node, newText)
  },
// 普通移除：摘节点 → 释放 yoga → 通知焦点。
// 注意 466 行的 `!== '#text'`：文本节点没有 nodeName 也没有焦点，
// 而 focusManager 的 handleNodeRemoved 会按 DOMElement 处理，传进去会炸。
  removeChild(node, removeNode) {
    removeChildNode(node, removeNode)
    cleanupYogaNode(removeNode)
    if (removeNode.nodeName !== '#text') {
      const root = getRootNode(node)
      root.focusManager!.handleNodeRemoved(removeNode, root)
    }
  },
  // React 19 required methods
// 【这一大片空实现不是占位符，是明确回答「不支持」】
//
//   React 19 的 host config 要求实现 Suspense / Transition / 表单 / 事件优先级
//   等一整套接口。终端 UI 一个都不用：
//     maySuspendCommit / suspendInstance  → 不支持 Suspense 的渐进提交
//     trackSchedulerEvent / resolveEventType → 没有浏览器事件模型
//     resetFormInstance                    → 没有表单
//
//   所以返回 false / null / 空函数。**返回 false 是有语义的**：
//   它告诉 React「不要走延迟提交这条路」，而不是「我还没实现」。
//
//   484 行的 HostTransitionContext 是硬凑的：React 要求这里有一个 context 对象，
//   于是手搓了一个 Symbol.for('react.context') 的最小结构。
//   这段代码的存在只说明一件事 —— 我们在和一个不打算对外开放的接口打交道。
  maySuspendCommit(): boolean {
    return false
  },
  preloadInstance(): boolean {
    return true
  },
  startSuspendingCommit(): void {},
  suspendInstance(): void {},
  waitForCommitToBeReady(): null {
    return null
  },
  NotPendingTransition: null,
  HostTransitionContext: {
    $$typeof: Symbol.for('react.context'),
    _currentValue: null,
  } as never,
  setCurrentUpdatePriority(newPriority: number): void {
    dispatcher.currentUpdatePriority = newPriority
  },
  resolveUpdatePriority(): number {
    return dispatcher.resolveEventPriority()
  },
  resetFormInstance(): void {},
  requestPostPaintCallback(): void {},
  shouldAttemptEagerTransition(): boolean {
    return false
  },
  trackSchedulerEvent(): void {},
  resolveEventType(): string | null {
    return dispatcher.currentEvent?.type ?? null
  },
  resolveEventTimeStamp(): number {
    return dispatcher.currentEvent?.timeStamp ?? -1.1
  },
})

// 【用一行赋值打破循环依赖】
//
//   dispatcher.ts 需要在处理事件时调用 reconciler.discreteUpdates（高优先级更新），
//   但它不能 import reconciler —— 因为 reconciler 已经 import 了 dispatcher（187 行）。
//
//   解法：dispatcher 里留一个可写的字段，reconciler 在模块加载完成后把方法塞进去。
//   这叫「装配期注入」，本质是把静态依赖变成一个运行时可变的洞。
//
//   代价：dispatcher 在 reconciler 模块加载完成之前，那个字段是 undefined。
//   读代码时如果看到 dispatcher.discreteUpdates 被调用，要知道它依赖「reconciler 已加载」
//   这个隐含前提。
// Wire the reconciler's discreteUpdates into the dispatcher.
// This breaks the import cycle: dispatcher.ts doesn't import reconciler.ts.
dispatcher.discreteUpdates = reconciler.discreteUpdates.bind(reconciler)

export default reconciler
