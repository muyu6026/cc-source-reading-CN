// ═══════════════════════════════════════════════════════════════
//  第二层：一棵只有七个元素名的 DOM，外加一个 yoga 布局节点
// ═══════════════════════════════════════════════════════════════
//
//   这一层要解决的问题是：React 给的是「元素 + 属性 + 子节点」，
//   而绘制需要的是「每个节点的绝对坐标 + 每个格子的字符和样式」。
//   中间的桥就是 **yoga**（Facebook 的 flexbox 布局引擎，这里是 WASM 版）。
//
//   每个 DOMElement 通常挂一个 yogaNode，两者是**平行**的两棵树：
//     DOM 树   负责「谁是谁的孩子、谁有什么属性」
//     yoga 树  负责「每个节点多宽多高、放在哪」
//
//   平行树带来的最大成本：**两套下标要对齐**（155 行的 insertBeforeNode
//   就是在手工换算）。这是「不与 DOM 绑定」这个选择的固有代价。
//
// 【本文件里三个最值得看的点】
//   ① 110-132  createNode：哪三种元素故意不建 yoga 节点，为什么
//   ② 332-374  measureTextNode：yoga 不识字宽，文本高度得我们自己算
//   ③ 393-413  markDirty：脏标记为什么必须向上冒泡
import type { FocusManager } from './focus.js'
import { createLayoutNode } from './layout/engine.js'
import type { LayoutNode } from './layout/node.js'
import { LayoutDisplay, LayoutMeasureMode } from './layout/node.js'
import measureText from './measure-text.js'
import { addPendingClear, nodeCache } from './node-cache.js'
import squashTextNodes from './squash-text-nodes.js'
import type { Styles, TextStyles } from './styles.js'
import { expandTabs } from './tabstops.js'
import wrapText from './wrap-text.js'

// 每个节点都有的三件：父指针、布局节点、样式。
// 注意 style 只存一份，但被两个消费者读（渲染层读颜色、yoga 读尺寸）——
// 真正的切分在 styles.ts 的 applyStyles 里。
type InkNode = {
  parentNode: DOMElement | undefined
  yogaNode?: LayoutNode
  style: Styles
}

export type TextName = '#text'
export type ElementNames =
  | 'ink-root'
  | 'ink-box'
  | 'ink-text'
  | 'ink-virtual-text'
  | 'ink-link'
  | 'ink-progress'
  | 'ink-raw-ansi'

export type NodeNames = ElementNames | TextName

// 【这个类型是整层的枢纽，字段可以分四组看】
//
//   ① React 侧：dirty（要不要重画）、isHidden（display:none）、
//      _eventHandlers（事件回调，单独存，理由见 48 行）
//   ② 渲染回调：onComputeLayout / onRender / onImmediateRender ——
//      只在 ink-root 上有值，其余节点是 undefined。
//      这是 dom 层能「反向上报」的唯一通道（419 行的 scheduleRenderFrom 就用它）
//   ③ 滚动状态：scrollTop / pendingScrollDelta / clamp / stickyScroll / anchor。
//      这些是**渲染期写、渲染期读**的中间量，不属于 React 状态，
//      放这里是因为「一帧内要保持一致」而 React 状态跨帧才一致。
//   ④ 排障：focusManager、debugOwnerChain
//
//   把滚动状态塞进 DOM 节点这件事本身值得注意：
//   它意味着「同一个节点在 React 看来没变，但在渲染层看来变了」——
//   于是需要 scheduleRenderFrom（419 行）这样绕过 React 直接触发一帧的出口。
// eslint-disable-next-line @typescript-eslint/naming-convention
export type DOMElement = {
  nodeName: ElementNames
  attributes: Record<string, DOMNodeAttribute>
  childNodes: DOMNode[]
  textStyles?: TextStyles

  // Internal properties
  onComputeLayout?: () => void
  onRender?: () => void
  onImmediateRender?: () => void
  // Used to skip empty renders during React 19's effect double-invoke in test mode
  hasRenderedContent?: boolean

  // When true, this node needs re-rendering
  dirty: boolean
  // Set by the reconciler's hideInstance/unhideInstance; survives style updates.
  isHidden?: boolean
// 事件回调不放进 attributes，理由是注释里那句「handler 身份变化不该 markDirty」。
//
//   具体点：每次渲染，组件都会传一个新的箭头函数作为 onClick。
//   如果它参与 attributes 的值比较，每次渲染都「不等」→ 每次都 markDirty
//   → 每次都重画这个子树。而实际上绑定的行为可能完全一样。
//
//   终端 UI 每帧都在重绘，这种「假脏」会直接把 blit 优化打掉
//   （blit = 上一个屏幕缓冲里这块没变，直接拷贝，不重画）。
  // Event handlers set by the reconciler for the capture/bubble dispatcher.
  // Stored separately from attributes so handler identity changes don't
  // mark dirty and defeat the blit optimization.
  _eventHandlers?: Record<string, unknown>

// 【滚动的三个中间量，每个都在解决一个具体的时序问题】
//
//   pendingScrollDelta  滚轮事件一次能来几十个，不能每个都直接改 scrollTop
//                       （否则一帧内跳很远，用户看不到中间过程）。
//                       于是先累加，渲染时每帧只消费 SCROLL_MAX_PER_FRAME 行。
//                       注意它是**纯累加器**，不记录「目标位置」——
//                       所以用户往上滚再往下滚会自然抵消，不需要任何状态机。
//
//   scrollClampMin/Max  虚拟滚动只挂了窗口内的一批子节点。scrollTo 直接写
//                       scrollTop 可能写到「还没挂载」的区域 → 白屏。
//                       这对边界由 useVirtualScroll 每帧写入，渲染时把
//                       scrollTop 夹在范围内 —— 宁可停在内容边缘，
//                       也不画一片空白，等 React 追上来自动放开。
//
//   scrollAnchor        「滚到某个元素」不能用 scrollTo(算出来的数字)：
//                       那个数字在 throttled 渲染真正发生时已经过期了
//                       （内容可能又长高了）。所以存元素引用 + 偏移，
//                       到**绘制那一刻**才读 yoga 的实时坐标。
  // Scroll state for overflow: 'scroll' boxes. scrollTop is the number of
  // rows the content is scrolled down by. scrollHeight/scrollViewportHeight
  // are computed at render time and stored for imperative access. stickyScroll
  // auto-pins scrollTop to the bottom when content grows.
  scrollTop?: number
  // Accumulated scroll delta not yet applied to scrollTop. The renderer
  // drains this at SCROLL_MAX_PER_FRAME rows/frame so fast flicks show
  // intermediate frames instead of one big jump. Direction reversal
  // naturally cancels (pure accumulator, no target tracking).
  pendingScrollDelta?: number
  // Render-time clamp bounds for virtual scroll. useVirtualScroll writes
  // the currently-mounted children's coverage span; render-node-to-output
  // clamps scrollTop to stay within it. Prevents blank screen when
  // scrollTo's direct write races past React's async re-render — instead
  // of painting spacer (blank), the renderer holds at the edge of mounted
  // content until React catches up (next commit updates these bounds and
  // the clamp releases). Undefined = no clamp (sticky-scroll, cold start).
  scrollClampMin?: number
  scrollClampMax?: number
  scrollHeight?: number
  scrollViewportHeight?: number
  scrollViewportTop?: number
  stickyScroll?: boolean
  // Set by ScrollBox.scrollToElement; render-node-to-output reads
  // el.yogaNode.getComputedTop() (FRESH — same Yoga pass as scrollHeight)
  // and sets scrollTop = top + offset, then clears this. Unlike an
  // imperative scrollTo(N) which bakes in a number that's stale by the
  // time the throttled render fires, the element ref defers the position
  // read to paint time. One-shot.
  scrollAnchor?: { el: DOMElement; offset: number }
  // Only set on ink-root. The document owns focus — any node can
  // reach it by walking parentNode, like browser getRootNode().
  focusManager?: FocusManager
  // React component stack captured at createInstance time (reconciler.ts),
  // e.g. ['ToolUseLoader', 'Messages', 'REPL']. Only populated when
  // CLAUDE_CODE_DEBUG_REPAINTS is set. Used by findOwnerChainAtRow to
  // attribute scrollback-diff full-resets to the component that caused them.
  debugOwnerChain?: string[]
} & InkNode

export type TextNode = {
  nodeName: TextName
  nodeValue: string
} & InkNode

// 条件类型：nodeName 是 '#text' 就是 TextNode，否则 DOMElement。
// 作用不是严谨，是**让调用方的 if 能收窄类型**。
// 全代码库到处是 `if (node.nodeName === '#text') return`，靠的就是这个分发。
// eslint-disable-next-line @typescript-eslint/naming-convention
export type DOMNode<T = { nodeName: NodeNames }> = T extends {
  nodeName: infer U
}
  ? U extends '#text'
    ? TextNode
    : DOMElement
  : never

// eslint-disable-next-line @typescript-eslint/naming-convention
export type DOMNodeAttribute = boolean | string | number

// 【三种元素故意不建 yoga 节点】
//
//   ink-virtual-text   嵌套 <Text>，只合并文字与样式，不参与布局
//   ink-link           <Link> 是内联元素，宽度由其中文字决定，不吃自己的盒模型
//   ink-progress       进度条，尺寸由父级算（占满一行），不需要自己的布局
//
//   共同点：它们的尺寸完全由**内容或父级**决定，独立建节点只会让布局多一层
//   无意义的约束求解。
//
//   代价立刻出现在 155 行：DOM 子节点下标 ≠ yoga 子节点下标，得手工换算。
export const createNode = (nodeName: ElementNames): DOMElement => {
  const needsYogaNode =
    nodeName !== 'ink-virtual-text' &&
    nodeName !== 'ink-link' &&
    nodeName !== 'ink-progress'
  const node: DOMElement = {
    nodeName,
    style: {},
    attributes: {},
    childNodes: [],
    parentNode: undefined,
    yogaNode: needsYogaNode ? createLayoutNode() : undefined,
    dirty: false,
  }

// 【整个自研渲染器的根：文本尺寸必须由我们告诉 yoga】
//
//   浏览器里「这段文字多宽多高」是排版引擎的活。yoga 只管盒子，
//   它不知道字符宽度（等宽/全角/emoji/组合字符都不一样）。
//   所以给 ink-text 挂一个 measure 函数：yoga 在布局时回调它，
//   问「给你 width 这么宽，你要多高」。
//
//   这就是 332 行 measureTextNode 存在的全部理由。
//   也是为什么 <Text> 嵌套 <Box> 必须禁止（331 行的 throw）：
//   measure 函数要能把整棵子树**展平成一段字符串**（squashTextNodes）才能算宽度，
//   中间有盒子就展不平了。
  if (nodeName === 'ink-text') {
    node.yogaNode?.setMeasureFunc(measureTextNode.bind(null, node))
  } else if (nodeName === 'ink-raw-ansi') {
    node.yogaNode?.setMeasureFunc(measureRawAnsiNode.bind(null, node))
  }

  return node
}

// 先 removeChildNode 再插入：保证一个节点只有一个父亲。
// 这条不变式在 React 里由 reconciler 保证，但 dom 层不假设调用方守规矩 ——
// 因为这份 dom 也被非 React 路径使用（测试、调试脚本）。
export const appendChildNode = (
  node: DOMElement,
  childNode: DOMElement,
): void => {
  if (childNode.parentNode) {
    removeChildNode(childNode.parentNode, childNode)
  }

  childNode.parentNode = node
  node.childNodes.push(childNode)

  if (childNode.yogaNode) {
    node.yogaNode?.insertChild(
      childNode.yogaNode,
      node.yogaNode.getChildCount(),
    )
  }

  markDirty(node)
}

// 【两棵树，两套下标】
//
//   165 行拿到的是 **DOM 下标**，但要插进 yoga 的是 **yoga 下标**。
//   由于 ink-link / ink-progress / ink-virtual-text 没有 yoga 节点，
//   两者在同一个父级下可能完全不同。
//
//   173-180 行就是换算：从头数到目标位置，只数有 yogaNode 的兄弟。
//   O(n) 一次，对终端 UI 的子节点数量（几十）完全够用。
//
//   容易写错的地方：换算必须在 `splice` **之前**做。
//   splice 之后再数，被插进去的那个会被算进去（或者索引整体偏移一格）。
export const insertBeforeNode = (
  node: DOMElement,
  newChildNode: DOMNode,
  beforeChildNode: DOMNode,
): void => {
  if (newChildNode.parentNode) {
    removeChildNode(newChildNode.parentNode, newChildNode)
  }

  newChildNode.parentNode = node

  const index = node.childNodes.indexOf(beforeChildNode)

  if (index >= 0) {
    // Calculate yoga index BEFORE modifying childNodes.
    // We can't use DOM index directly because some children (like ink-progress,
    // ink-link, ink-virtual-text) don't have yogaNodes, so DOM indices don't
    // match yoga indices.
    let yogaIndex = 0
    if (newChildNode.yogaNode && node.yogaNode) {
      for (let i = 0; i < index; i++) {
        if (node.childNodes[i]?.yogaNode) {
          yogaIndex++
        }
      }
    }

    node.childNodes.splice(index, 0, newChildNode)

    if (newChildNode.yogaNode && node.yogaNode) {
      node.yogaNode.insertChild(newChildNode.yogaNode, yogaIndex)
    }

    markDirty(node)
    return
  }

  node.childNodes.push(newChildNode)

  if (newChildNode.yogaNode) {
    node.yogaNode?.insertChild(
      newChildNode.yogaNode,
      node.yogaNode.getChildCount(),
    )
  }

  markDirty(node)
}

// 【删除 = 摘节点 + 释放 yoga + 登记待清除的像素】
//
//   第三件事最容易忘：nodeCache 里存着这棵子树每个元素的屏幕矩形，
//   用于 hit-test（点击命中）和 blit（局部拷贝）。节点没了，矩形还在，
//   下一次 blit 就会把已经不存在的元素的像素拷到屏上。
//
//   collectRemovedRects 遍历被删子树，把每个缓存矩形登记为 pendingClear。
//   isAbsolute 的传播（236 行）是个精确判断：
//     普通流里的元素，删掉只影响相邻兄弟，局部清除够用；
//     绝对定位的元素可能压在非兄弟内容上，必须全局禁用 blit 一帧。
//
//   **这是一个「删除也要产生副作用」的例子** —— 不止是树结构调整。
export const removeChildNode = (
  node: DOMElement,
  removeNode: DOMNode,
): void => {
  if (removeNode.yogaNode) {
    removeNode.parentNode?.yogaNode?.removeChild(removeNode.yogaNode)
  }

  // Collect cached rects from the removed subtree so they can be cleared
  collectRemovedRects(node, removeNode)

  removeNode.parentNode = undefined

  const index = node.childNodes.indexOf(removeNode)
  if (index >= 0) {
    node.childNodes.splice(index, 1)
  }

  markDirty(node)
}

function collectRemovedRects(
  parent: DOMElement,
  removed: DOMNode,
  underAbsolute = false,
): void {
  if (removed.nodeName === '#text') return
  const elem = removed as DOMElement
  // If this node or any ancestor in the removed subtree was absolute,
  // its painted pixels may overlap non-siblings — flag for global blit
  // disable. Normal-flow removals only affect direct siblings, which
  // hasRemovedChild already handles.
  const isAbsolute = underAbsolute || elem.style.position === 'absolute'
  const cached = nodeCache.get(elem)
  if (cached) {
    addPendingClear(parent, cached, isAbsolute)
    nodeCache.delete(elem)
  }
  for (const child of elem.childNodes) {
    collectRemovedRects(parent, child, isAbsolute)
  }
}

// children 必须先跳过：React 每次都传一个新的 children 引用，
// 把它当属性比较等于「每次都变了」，全树永久脏。
//
// 260 行的值比较同理：属性没变就不标脏。
// 这两行合起来是这个 renderer 能做到「稳定 60 帧」的前提。
export const setAttribute = (
  node: DOMElement,
  key: string,
  value: DOMNodeAttribute,
): void => {
  // Skip 'children' - React handles children via appendChild/removeChild,
  // not attributes. React always passes a new children reference, so
  // tracking it as an attribute would mark everything dirty every render.
  if (key === 'children') {
    return
  }
  // Skip if unchanged
  if (node.attributes[key] === value) {
    return
  }
  node.attributes[key] = value
  markDirty(node)
}

// 【这一处是整个性能模型的关键】
//
//   React 的哲学是不可变：每次渲染都新建 style 对象。
//   而这里用的是脏标记 + 全树重算布局。
//   两套模型一接触，就会变成「每帧全树重算」—— 也就是每次按键、每个 spinner
//   转动都让 yoga 把几百个节点重新量一遍。
//
//   解法就是 269 行：**按值比较**，相等就不标脏。
//   这是把 React 的不可变数据「翻译」成可变世界的脏标记的标准做法。
//
//   代价：比较是浅的（291 行 → shallowEqual）。
//   style 里如果嵌了对象（borderStyle: { ... }），每次新建都会被判成「变了」。
//   不是 bug，但是一个必须知道的边界。
export const setStyle = (node: DOMNode, style: Styles): void => {
  // Compare style properties to avoid marking dirty unnecessarily.
  // React creates new style objects on every render even when unchanged.
  if (stylesEqual(node.style, style)) {
    return
  }
  node.style = style
  markDirty(node)
}

export const setTextStyles = (
  node: DOMElement,
  textStyles: TextStyles,
): void => {
  // Same dirty-check guard as setStyle: React (and buildTextStyles in Text.tsx)
  // allocate a new textStyles object on every render even when values are
  // unchanged, so compare by value to avoid markDirty -> yoga re-measurement
  // on every Text re-render.
  if (shallowEqual(node.textStyles, textStyles)) {
    return
  }
  node.textStyles = textStyles
  markDirty(node)
}

function stylesEqual(a: Styles, b: Styles): boolean {
  return shallowEqual(a, b)
}

function shallowEqual<T extends object>(
  a: T | undefined,
  b: T | undefined,
): boolean {
  // Fast path: same object reference (or both undefined)
  if (a === b) return true
  if (a === undefined || b === undefined) return false

  // Get all keys from both objects
  const aKeys = Object.keys(a) as (keyof T)[]
  const bKeys = Object.keys(b) as (keyof T)[]

  // Different number of properties
  if (aKeys.length !== bKeys.length) return false

  // Compare each property
  for (const key of aKeys) {
    if (a[key] !== b[key]) return false
  }

  return true
}

// 文本节点没有 yoga 节点 —— 它的尺寸由父级 ink-text 的 measure 函数统一算。
// 这一点很重要：一行文字里 3 个 <Text> 片段只对应 1 个 yoga 节点，
// 布局上它们是「一个整体」。
export const createTextNode = (text: string): TextNode => {
  const node: TextNode = {
    nodeName: '#text',
    nodeValue: text,
    yogaNode: undefined,
    parentNode: undefined,
    style: {},
  }

  setTextNodeValue(node, text)

  return node
}

// 【measureTextNode：yoga 回调我们，问「给这么宽，你多高」】
//
//   四个分支，前两个是正常情况，后两个是补丁：
//
//   ① 347 装得下 → 直接返回自然尺寸（最常见的快路径）
//   ② 353 宽度在 0~1 之间（父级在收缩试探）→ 返回自然宽度，等于说「装不下」
//   ③ 365 **文本自带换行 + 布局在问「内在尺寸」** → 不重新折行
//      为什么：预折好的内容（比如已经按 80 列排好的 diff）如果按测量宽度
//      再折一次，行数会翻倍，高度虚高，父级算出来的盒子就不对。
//      但只有 Undefined 模式能这么做；Exactly/AtMost 说明布局给了真实约束，
//      必须尊重它，否则实际渲染宽度小于自然宽度 → 折出更多行 → 内容被截。
//   ④ 正常折行后重新测量
//
//   第 ③ 分支是本文件里最微妙的十行：它的正确性依赖「yoga 的测量模式」
//   这个外部语义，光看代码看不出为什么要有它。
const measureTextNode = function (
  node: DOMNode,
  width: number,
  widthMode: LayoutMeasureMode,
): { width: number; height: number } {
  const rawText =
    node.nodeName === '#text' ? node.nodeValue : squashTextNodes(node)

  // Expand tabs for measurement (worst case: 8 spaces each).
  // Actual tab expansion happens in output.ts based on screen position.
  const text = expandTabs(rawText)

  const dimensions = measureText(text, width)

  // Text fits into container, no need to wrap
  if (dimensions.width <= width) {
    return dimensions
  }

  // This is happening when <Box> is shrinking child nodes and layout asks
  // if we can fit this text node in a <1px space, so we just say "no"
  if (dimensions.width >= 1 && width > 0 && width < 1) {
    return dimensions
  }

  // For text with embedded newlines (pre-wrapped content), avoid re-wrapping
  // at measurement width when layout is asking for intrinsic size (Undefined mode).
  // This prevents height inflation during min/max size checks.
  //
  // However, when layout provides an actual constraint (Exactly or AtMost mode),
  // we must respect it and measure at that width. Otherwise, if the actual
  // rendering width is smaller than the natural width, the text will wrap to
  // more lines than layout expects, causing content to be truncated.
  if (text.includes('\n') && widthMode === LayoutMeasureMode.Undefined) {
    const effectiveWidth = Math.max(width, dimensions.width)
    return measureText(text, effectiveWidth)
  }

  const textWrap = node.style?.textWrap ?? 'wrap'
  const wrappedText = wrapText(text, width, textWrap)

  return measureText(wrappedText, width)
}

// 【ink-raw-ansi 的信任边界】
//
//   这个元素直接读调用方传进来的 rawWidth / rawHeight，不做任何测量：
//   不量字符宽度、不折行、不展开 tab。
//
//   它只给「已经自己渲染好、并且确切知道尺寸」的生产者用
//   （注释里的例子是 ColorDiff：已经按目标宽度排好版，每行正好一屏行）。
//
//   这是一次明确的信任交换：换来「几百行 ANSI 一次性塞进去不重排」的性能，
//   代价是**尺寸给错就会错位**，而且没有任何检查会告诉你。
// ink-raw-ansi nodes hold pre-rendered ANSI strings with known dimensions.
// No stringWidth, no wrapping, no tab expansion — the producer (e.g. ColorDiff)
// already wrapped to the target width and each line is exactly one terminal row.
const measureRawAnsiNode = function (node: DOMElement): {
  width: number
  height: number
} {
  return {
    width: node.attributes['rawWidth'] as number,
    height: node.attributes['rawHeight'] as number,
  }
}

// 【markDirty 为什么要往上冒泡】
//
//   因为绘制是从 root 开始 DFS 的：要画某个子树，必须从根走到它。
//   只把当前节点标脏是不够的 —— 父节点不知道「下面有脏东西」，
//   遍历到父节点时就可能直接整块 blit 跳过。
//
//   另一个细节：markedYoga 只让**最靠下的那个文本节点**标 yoga 脏。
//   因为只有 ink-text / ink-raw-ansi 有 measure 函数，也只有它们的变化
//   会改变测量结果。往上冒泡时路过一堆 Box，标它们的 yoga 脏没有意义
//   （yoga 的布局脏是另外一套传播机制）。
/**
 * Mark a node and all its ancestors as dirty for re-rendering.
 * Also marks yoga dirty for text remeasurement if this is a text node.
 */
export const markDirty = (node?: DOMNode): void => {
  let current: DOMNode | undefined = node
  let markedYoga = false

  while (current) {
    if (current.nodeName !== '#text') {
      ;(current as DOMElement).dirty = true
      // Only mark yoga dirty on leaf nodes that have measure functions
      if (
        !markedYoga &&
        (current.nodeName === 'ink-text' ||
          current.nodeName === 'ink-raw-ansi') &&
        current.yogaNode
      ) {
        current.yogaNode.markDirty()
        markedYoga = true
      }
    }
    current = current.parentNode
  }
}

// Walk to root and call its onRender (the throttled scheduleRender). Use for
// DOM-level mutations (scrollTop changes) that should trigger an Ink frame
// without going through React's reconciler. Pair with markDirty() so the
// renderer knows which subtree to re-evaluate.
// 【绕过 React 直接触发一帧】
//
//   用途：改 scrollTop 这种「不在 React 状态里的东西」。
//   改完调用它，走到根节点调 onRender（= ink.tsx 的 throttled scheduleRender）。
//
//   为什么必须配 markDirty 一起用：onRender 只是「该画一帧了」，
//   而画谁、画到什么程度由 dirty 标记决定。
//   只调这一个 → 渲染器认为没有脏节点 → 画出来的还是旧内容。
export const scheduleRenderFrom = (node?: DOMNode): void => {
  let cur: DOMNode | undefined = node
  while (cur?.parentNode) cur = cur.parentNode
  if (cur && cur.nodeName !== '#text') (cur as DOMElement).onRender?.()
}

// 类型强制（426 行）不是防御：React 允许 children 是数字，
// 而下游全部按 string 处理（字符宽度、折行、diff）。
// 在这里统一转，比在十个下游各转一次好。
//
// 431 行的值比较同样是为了避免「内容没变但标脏了」。
export const setTextNodeValue = (node: TextNode, text: string): void => {
  if (typeof text !== 'string') {
    text = String(text)
  }

  // Skip if unchanged
  if (node.nodeValue === text) {
    return
  }

  node.nodeValue = text
  markDirty(node)
}

function isDOMElement(node: DOMElement | TextNode): node is DOMElement {
  return node.nodeName !== '#text'
}

// Clear yogaNode references recursively before freeing.
// freeRecursive() frees the node and ALL its children, so we must clear
// all yogaNode references to prevent dangling pointers.
// 【freeRecursive 会连子节点一起释放，所以必须先把所有引用清成 undefined】
//
//   和 reconciler.ts 95 行那处是同一件事的两个视角：
//   那边讲「顺序」，这边讲「递归清零」。
//
//   不清的后果不是崩溃，是**读到已释放的 WASM 内存**：
//   表现为布局数字乱跳、节点位置漂移，而且只在删除/重挂载之后偶发。
//   这类 bug 极难归因，所以这十行值得单独一个函数名。
export const clearYogaNodeReferences = (node: DOMElement | TextNode): void => {
  if ('childNodes' in node) {
    for (const child of node.childNodes) {
      clearYogaNodeReferences(child)
    }
  }
  node.yogaNode = undefined
}

/**
 * Find the React component stack responsible for content at screen row `y`.
 *
 * DFS the DOM tree accumulating yoga offsets. Returns the debugOwnerChain of
 * the deepest node whose bounding box contains `y`. Called from ink.tsx when
 * log-update triggers a full reset, to attribute the flicker to its source.
 *
 * Only useful when CLAUDE_CODE_DEBUG_REPAINTS is set (otherwise chains are
 * undefined and this returns []).
 */
// 【把一个屏幕行号反查成「是哪个组件画的」】
//
//   DFS 整棵树，累加 yoga 的 computedTop（因为 yoga 给的是相对父级的坐标），
//   找到包含第 y 行的最深节点，返回它的 debugOwnerChain。
//
//   只在 CLAUDE_CODE_DEBUG_REPAINTS 打开时有用（否则 chain 是 undefined，
//   函数返回空数组）。用途写在注释里：log-update 触发整屏重绘时，
//   把「闪烁」归因到具体的组件。
//
//   注意 472 行跳过了 display:none 的节点 —— 它们不占行，
//   如果参与命中，会把「本该属于下一个节点的行」错误归属。
export function findOwnerChainAtRow(root: DOMElement, y: number): string[] {
  let best: string[] = []
  walk(root, 0)
  return best

  function walk(node: DOMElement, offsetY: number): void {
    const yoga = node.yogaNode
    if (!yoga || yoga.getDisplay() === LayoutDisplay.None) return

    const top = offsetY + yoga.getComputedTop()
    const height = yoga.getComputedHeight()
    if (y < top || y >= top + height) return

    if (node.debugOwnerChain) best = node.debugOwnerChain

    for (const child of node.childNodes) {
      if (isDOMElement(child)) walk(child, top)
    }
  }
}
