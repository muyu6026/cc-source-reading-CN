// ⚠️ 【两处 import 指向不存在的文件】
//
// 第 4、5 行引用 ./paste-event.js 与 ./resize-event.js，但
// src/ink/events/ 目录下**没有这两个文件**（目录里只有十个 .ts：
// click / dispatcher / emitter / event / event-handlers / focus /
// input / keyboard / terminal-event / terminal-focus-event）。
//
// 这不是笔误，是**还原过程丢东西**的证据：这份源码是从打包产物 +
// sourcemap 反推出来的，这两个模块要么被内联进了别的 chunk 而没被
// 单独还原，要么真的在某个构建步骤里被裁掉了。
//
// 后果：tsc 会报 "Cannot find module './paste-event.js'"。`import type`
// 在编译后被抹掉，所以**运行时不报错**，只有类型检查能发现 ——
// 这也是「类型 import 也能指向空气」的实例：JS 里它什么都不断言，
// 只有类型系统在意。
//
// 下游影响：onPaste / onPasteCapture / onResize 三个 prop 名保留在
// 下面两张表里，但对应的 Event 类不存在。而且 Dispatcher 实际只派发
// keydown / focus / blur（见 dispatcher.ts 的批注），所以哪怕把
// PasteEvent 补回来，也没有任何代码会构造它。
import type { ClickEvent } from './click-event.js'
import type { FocusEvent } from './focus-event.js'
import type { KeyboardEvent } from './keyboard-event.js'
import type { PasteEvent } from './paste-event.js'
import type { ResizeEvent } from './resize-event.js'

type KeyboardEventHandler = (event: KeyboardEvent) => void
type FocusEventHandler = (event: FocusEvent) => void
type PasteEventHandler = (event: PasteEvent) => void
type ResizeEventHandler = (event: ResizeEvent) => void
type ClickEventHandler = (event: ClickEvent) => void
type HoverEventHandler = () => void

/**
 * Props for event handlers on Box and other host components.
 *
 * Follows the React/DOM naming convention:
 * - onEventName: handler for bubble phase
 * - onEventNameCapture: handler for capture phase
 */
export type EventHandlerProps = {
  onKeyDown?: KeyboardEventHandler
  onKeyDownCapture?: KeyboardEventHandler

  onFocus?: FocusEventHandler
  onFocusCapture?: FocusEventHandler
  onBlur?: FocusEventHandler
  onBlurCapture?: FocusEventHandler

  onPaste?: PasteEventHandler
  onPasteCapture?: PasteEventHandler

  onResize?: ResizeEventHandler

  onClick?: ClickEventHandler
  onMouseEnter?: HoverEventHandler
  onMouseLeave?: HoverEventHandler
}
// 这里是一个**按类型的** props 形状，不是一个统一的基类 ——
// 每个 handler 收到的事件类型都不同（KeyboardEvent / FocusEvent /
// ClickEvent …），所以只能用交叉类型一个个列。
//
// onMouseEnter / onMouseLeave 用的是 HoverEventHandler：**不接收参数**。
// 不是省事：hover 没有坐标信息可言 —— 它由「命中集合的差值」触发
// （hit-test.ts 的 dispatchHover），触发时并不知道鼠标落在盒子里的哪一格。

/**
 * Reverse lookup: event type string → handler prop names.
 * Used by the dispatcher for O(1) handler lookup per node.
 */
// 反向表：事件类型字符串 → prop 名。为什么要反向：
// Dispatcher 从节点上拿 handler 时，手里有的是 event.type（'keydown'），
// 而节点上存的是 prop 名（onKeyDown）。没有这张表就得为每个类型写
// 一个 if 链，而且新增事件要改两个地方。
//
// 表里能看出两处「不对称」，都是真的：
//   · onResize 缺 capture —— 原因无法判断，因为 ResizeEvent 这个类
//     本身就不在源码里（见本文件顶部说明）。可能原本就没有，
//     也可能跟着那两个文件一起丢了
//   · onClick 缺 capture —— 这个能确认：点击不走 Dispatcher。
//     表里的 click 那一行**没有读者**，hit-test.ts 直接读
//     _eventHandlers.onClick（hit-test.ts:72）
export const HANDLER_FOR_EVENT: Record<
  string,
  { bubble?: keyof EventHandlerProps; capture?: keyof EventHandlerProps }
> = {
  keydown: { bubble: 'onKeyDown', capture: 'onKeyDownCapture' },
  focus: { bubble: 'onFocus', capture: 'onFocusCapture' },
  blur: { bubble: 'onBlur', capture: 'onBlurCapture' },
  paste: { bubble: 'onPaste', capture: 'onPasteCapture' },
  resize: { bubble: 'onResize' },
  click: { bubble: 'onClick' },
}

/**
 * Set of all event handler prop names, for the reconciler to detect
 * event props and store them in _eventHandlers instead of attributes.
 */
// 这张 Set 是给 reconciler 用的：它遍历 props 时要把「事件 handler」
// 和「样式属性」分开 —— 前者进 _eventHandlers（不参与样式 diff），
// 后者进 styles。
//
// 两处清单必须同步：HANDLER_FOR_EVENT 少了某个键，那个 prop 就
// 派发不到；EVENT_HANDLER_PROPS 少了，那个 prop 会被当成样式塞进
// StylePool（然后 diff 时会发现未知属性…或者更糟，静默忽略）。
// 也就是说这两个数据结构是**手工维护的双写**。
export const EVENT_HANDLER_PROPS = new Set<string>([
  'onKeyDown',
  'onKeyDownCapture',
  'onFocus',
  'onFocusCapture',
  'onBlur',
  'onBlurCapture',
  'onPaste',
  'onPasteCapture',
  'onResize',
  'onClick',
  'onMouseEnter',
  'onMouseLeave',
])
