// Meta yoga（flexbox 引擎）的纯 TypeScript 移植，替代上游 WASM 包——Ink 是终端 UI，一次布局要跑上千节点，跨 JS/WASM 边界的调用开销比算法本身还大，所以整份重写成 JS
/**
 * Pure-TypeScript port of yoga-layout (Meta's flexbox engine).
 *
 * This matches the `yoga-layout/load` API surface used by src/ink/layout/yoga.ts.
 * The upstream C++ source is ~2500 lines in CalculateLayout.cpp alone; this port
 * is a simplified single-pass flexbox implementation that covers the subset of
 * features Ink actually uses:
 *   - flex-direction (row/column + reverse)
 *   - flex-grow / flex-shrink / flex-basis
 *   - align-items / align-self (stretch, flex-start, center, flex-end)
 *   - justify-content (all six values)
 *   - margin / padding / border / gap
 *   - width / height / min / max (point, percent, auto)
 *   - position: relative / absolute
 *   - display: flex / none
 *   - measure functions (for text nodes)
 *
 * Also implemented for spec parity (not used by Ink):
 *   - margin: auto (main + cross axis, overrides justify/align)
 *   - multi-pass flex clamping when children hit min/max constraints
 *   - flex-grow/shrink against container min/max when size is indefinite
 *
 * Also implemented for spec parity (not used by Ink):
 *   - flex-wrap: wrap / wrap-reverse (multi-line flex)
 *   - align-content (positions wrapped lines on cross axis)
 *
 * Also implemented for spec parity (not used by Ink):
 *   - display: contents (children lifted to grandparent, box removed)
 *
 * Also implemented for spec parity (not used by Ink):
 *   - baseline alignment (align-items/align-self: baseline)
 *
 * Not implemented (not used by Ink):
 *   - aspect-ratio
 *   - box-sizing: content-box
 *   - RTL direction (Ink always passes Direction.LTR)
 *
 * Upstream: https://github.com/facebook/yoga
 */
// 上面三档特性分得很清楚：Ink 真正用到的、为规范一致性而实现但不用的、明确不实现的——把「为什么有这段死代码」写在文件头，是这类移植件最省事的维护手段

// 只从同目录 enums 取枚举，没有第三方依赖——移植件的价值就在于零依赖可内联打包
import {
  Align,
  BoxSizing,
  Dimension,
  Direction,
  Display,
  Edge,
  Errata,
  ExperimentalFeature,
  FlexDirection,
  Gutter,
  Justify,
  MeasureMode,
  Overflow,
  PositionType,
  Unit,
  Wrap,
} from './enums.js'

// 原样 re-export 全部枚举，让调用方只 import 这一个文件就能拿到 yoga-layout/load 的完整类型面
export {
  Align,
  BoxSizing,
  Dimension,
  Direction,
  Display,
  Edge,
  Errata,
  ExperimentalFeature,
  FlexDirection,
  Gutter,
  Justify,
  MeasureMode,
  Overflow,
  PositionType,
  Unit,
  Wrap,
}

// --
// Value types

// Value 是所有长度/边距/位置的统一表示：一个单位标记加一个数值，没有用 undefined 表示缺失，而是用 Unit.Undefined 这个枚举值
export type Value = {
  unit: Unit
  value: number
}

// 两个共享哨兵：未定义与 auto 的 value 都是 NaN——用单位标记区分语义，数值位永远是脏的，任何忘了先看 unit 就读 value 的代码都会拿到 NaN 并立刻暴露
const UNDEFINED_VALUE: Value = { unit: Unit.Undefined, value: NaN }
const AUTO_VALUE: Value = { unit: Unit.Auto, value: NaN }

// 裸对象每次返回新实例，但 Value 是不可变的语义值，共享是安全的；注意 UNDEFINED_VALUE 被 defaultStyle 里 new Array(9).fill() 共享了 9 次，所以任何地方都不能原地改 Value
function pointValue(v: number): Value {
  return { unit: Unit.Point, value: v }
}
function percentValue(v: number): Value {
  return { unit: Unit.Percent, value: v }
}

// resolveValue 是全文件唯一的「值到像素」求值点：Point 直接返回，Percent 乘 ownerSize，其余一律 NaN——NaN 在这里是「无法解析」的通用信号，靠 isDefined 判断
function resolveValue(v: Value, ownerSize: number): number {
  switch (v.unit) {
    case Unit.Point:
      return v.value
    case Unit.Percent:
      return isNaN(ownerSize) ? NaN : (v.value * ownerSize) / 100
    default:
      return NaN
  }
}

// isDefined 就是 !isNaN；全文件用 NaN 而不是 null/undefined 表示「尺寸不定」，因为 NaN 能穿过所有算术运算而不抛错，布局里到处都是加减法
function isDefined(n: number): boolean {
  return !isNaN(n)
}

// NaN-safe equality for layout-cache input comparison
// NaN 安全的相等：a === b 或两者都是 NaN。缓存比对必须用这个而不是 ===，否则未定义尺寸的节点永远缓存不命中，等于白做缓存
function sameFloat(a: number, b: number): boolean {
  return a === b || (a !== a && b !== b)
}

// --
// Layout result (computed values)

// Layout 是输出侧：物理边数组固定四元组顺序 left/top/right/bottom，不做 9 边模型——9 边只在输入 Style 里存在，一次解析后就塌缩掉
type Layout = {
  left: number
  top: number
  width: number
  height: number
  // Computed per-edge values (resolved to physical edges)
  border: [number, number, number, number] // left, top, right, bottom
  padding: [number, number, number, number]
  margin: [number, number, number, number]
}

// --
// Style (input values)

// Style 是输入侧：margin/padding/border/position 都是 9 槽数组按 Edge 枚举索引，gap 是 3 槽——保留 yoga 的原始形状，是为了让 setter 能直接写下标，不用翻译
type Style = {
  direction: Direction
  flexDirection: FlexDirection
  justifyContent: Justify
  alignItems: Align
  alignSelf: Align
  alignContent: Align
  flexWrap: Wrap
  overflow: Overflow
  display: Display
  positionType: PositionType

  flexGrow: number
  flexShrink: number
  flexBasis: Value

  // 9-edge arrays indexed by Edge enum
  margin: Value[]
  padding: Value[]
  border: Value[]
  position: Value[]

  // 3-gutter array indexed by Gutter enum
  gap: Value[]

  width: Value
  height: Value
  minWidth: Value
  minHeight: Value
  maxWidth: Value
  maxHeight: Value
}

// 默认值逐条对齐 CSS flexbox 与 yoga 初值：主轴 column（不是 CSS 的 row）、align-items stretch、flex-shrink 0（CSS 是 1，yoga 特别注明这是与 Web 默认的差异）
function defaultStyle(): Style {
  return {
    direction: Direction.Inherit,
    flexDirection: FlexDirection.Column,
    justifyContent: Justify.FlexStart,
    alignItems: Align.Stretch,
    alignSelf: Align.Auto,
    alignContent: Align.FlexStart,
    flexWrap: Wrap.NoWrap,
    overflow: Overflow.Visible,
    display: Display.Flex,
    positionType: PositionType.Relative,
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: AUTO_VALUE,
// 四组边数组各自 fill 同一个 UNDEFINED_VALUE 引用，gap 只有 3 槽；靠共享对象省掉 9×4 次分配，代价是 Value 必须当不可变值用
    margin: new Array(9).fill(UNDEFINED_VALUE),
    padding: new Array(9).fill(UNDEFINED_VALUE),
    border: new Array(9).fill(UNDEFINED_VALUE),
    position: new Array(9).fill(UNDEFINED_VALUE),
    gap: new Array(3).fill(UNDEFINED_VALUE),
    width: AUTO_VALUE,
    height: AUTO_VALUE,
    minWidth: UNDEFINED_VALUE,
    minHeight: UNDEFINED_VALUE,
    maxWidth: UNDEFINED_VALUE,
    maxHeight: UNDEFINED_VALUE,
  }
}

// --
// Edge resolution — yoga's 9-edge model collapsed to 4 physical edges

// 四个物理边常量用 0..3 编号，是为了能直接当 Layout 里四元组的下标；Edge 枚举的 9 个逻辑值在 setter 阶段写入，到这里全部翻译完
const EDGE_LEFT = 0
const EDGE_TOP = 1
const EDGE_RIGHT = 2
const EDGE_BOTTOM = 3

// resolveEdge 是 9 边塌缩到 1 个像素值的唯一正确实现，回退链有四层：具体边 → 水平/垂直 → all → start/end 映射。顺序错了就会让 marginHorizontal 盖掉 marginLeft
function resolveEdge(
  edges: Value[],
  physicalEdge: number,
  ownerSize: number,
  // For margin/position we allow auto; for padding/border auto resolves to 0
  allowAuto = false,
): number {
  // Precedence: specific edge > horizontal/vertical > all
  let v = edges[physicalEdge]!
  if (v.unit === Unit.Undefined) {
    if (physicalEdge === EDGE_LEFT || physicalEdge === EDGE_RIGHT) {
      v = edges[Edge.Horizontal]!
    } else {
      v = edges[Edge.Vertical]!
    }
  }
  if (v.unit === Unit.Undefined) {
    v = edges[Edge.All]!
  }
  // Start/End map to Left/Right for LTR (Ink is always LTR)
// start/end 在 LTR 下等价于 left/right；Ink 恒传 Direction.LTR，所以这里省掉了方向判断，注释里明写了这个前提
  if (v.unit === Unit.Undefined) {
    if (physicalEdge === EDGE_LEFT) v = edges[Edge.Start]!
    if (physicalEdge === EDGE_RIGHT) v = edges[Edge.End]!
  }
  if (v.unit === Unit.Undefined) return 0
  if (v.unit === Unit.Auto) return allowAuto ? NaN : 0
// auto 对 margin/position 返回 NaN（交给调用方做特殊分配），对 padding/border 返回 0——同一个 auto 在内边距上是无意义的，静默归零而不是报错
  return resolveValue(v, ownerSize)
}

// resolveEdgeRaw 只跑回退链不解析百分比，返回 Value 本身。它的唯一用途是判断「这条边是不是 auto」，因为 auto 一旦解析成 NaN 就丢了来源信息
function resolveEdgeRaw(edges: Value[], physicalEdge: number): Value {
  let v = edges[physicalEdge]!
  if (v.unit === Unit.Undefined) {
    if (physicalEdge === EDGE_LEFT || physicalEdge === EDGE_RIGHT) {
      v = edges[Edge.Horizontal]!
    } else {
      v = edges[Edge.Vertical]!
    }
  }
  if (v.unit === Unit.Undefined) v = edges[Edge.All]!
  if (v.unit === Unit.Undefined) {
    if (physicalEdge === EDGE_LEFT) v = edges[Edge.Start]!
    if (physicalEdge === EDGE_RIGHT) v = edges[Edge.End]!
  }
  return v
}

function isMarginAuto(edges: Value[], physicalEdge: number): boolean {
  return resolveEdgeRaw(edges, physicalEdge).unit === Unit.Auto
}

// Setter helpers for the _hasAutoMargin / _hasPosition fast-path flags.
// Unit.Undefined = 0, Unit.Auto = 3.
// 两个快速判定直接写字面量 3 和 0 而不是 Unit.Auto/Unit.Undefined——这是 CPU 剖析后确认的热点，枚举属性访问在 V8 里比数字比较慢
function hasAnyAutoEdge(edges: Value[]): boolean {
  for (let i = 0; i < 9; i++) if (edges[i]!.unit === 3) return true
  return false
}
function hasAnyDefinedEdge(edges: Value[]): boolean {
  for (let i = 0; i < 9; i++) if (edges[i]!.unit !== 0) return true
  return false
}

// Hot path: resolve all 4 physical edges in one pass, writing into `out`.
// Equivalent to calling resolveEdge() 4× with allowAuto=false, but hoists the
// shared fallback lookups (Horizontal/Vertical/All/Start/End) and avoids
// allocating a fresh 4-array on every layoutNode() call.
// resolveEdges4Into：把 resolveEdge 调 4 次的共享回退查表（Horizontal/Vertical/All/Start/End）提到循环外，并写进调用方预分配的数组——原版每次调用会新建一个 4 元组，1000 节点基准上就是 4000 次分配
function resolveEdges4Into(
  edges: Value[],
  ownerSize: number,
  out: [number, number, number, number],
): void {
  // Hoist fallbacks once — the 4 per-edge chains share these reads.
  const eH = edges[6]! // Edge.Horizontal
  const eV = edges[7]! // Edge.Vertical
  const eA = edges[8]! // Edge.All
  const eS = edges[4]! // Edge.Start
  const eE = edges[5]! // Edge.End
  const pctDenom = isNaN(ownerSize) ? NaN : ownerSize / 100

  // Left: edges[0] → Horizontal → All → Start
  let v = edges[0]!
  if (v.unit === 0) v = eH
  if (v.unit === 0) v = eA
  if (v.unit === 0) v = eS
  out[0] = v.unit === 1 ? v.value : v.unit === 2 ? v.value * pctDenom : 0
// 每个边都是同一串三目：Point 取值、Percent 乘百分比分母、其余归零。故意写成表达式而不是语句，让 V8 保持单态内联

  // Top: edges[1] → Vertical → All
  v = edges[1]!
  if (v.unit === 0) v = eV
  if (v.unit === 0) v = eA
  out[1] = v.unit === 1 ? v.value : v.unit === 2 ? v.value * pctDenom : 0

  // Right: edges[2] → Horizontal → All → End
  v = edges[2]!
  if (v.unit === 0) v = eH
  if (v.unit === 0) v = eA
  if (v.unit === 0) v = eE
  out[2] = v.unit === 1 ? v.value : v.unit === 2 ? v.value * pctDenom : 0

  // Bottom: edges[3] → Vertical → All
  v = edges[3]!
  if (v.unit === 0) v = eV
  if (v.unit === 0) v = eA
  out[3] = v.unit === 1 ? v.value : v.unit === 2 ? v.value * pctDenom : 0
}

// --
// Axis helpers

// 轴向助手：isRow 判主轴是否水平、isReverse 判是否反向、crossAxis 把 row 映射成 column。全文件从不直接比较 flexDirection 字面量，一律过这三个函数
function isRow(dir: FlexDirection): boolean {
  return dir === FlexDirection.Row || dir === FlexDirection.RowReverse
}
function isReverse(dir: FlexDirection): boolean {
  return dir === FlexDirection.RowReverse || dir === FlexDirection.ColumnReverse
}
function crossAxis(dir: FlexDirection): FlexDirection {
  return isRow(dir) ? FlexDirection.Column : FlexDirection.Row
}
// leadingEdge/trailingEdge 把逻辑主轴方向翻译成物理边编号；四个 case 全覆盖且没有 default，靠 TS 的穷尽性检查保证新增方向时编译报错
function leadingEdge(dir: FlexDirection): number {
  switch (dir) {
    case FlexDirection.Row:
      return EDGE_LEFT
    case FlexDirection.RowReverse:
      return EDGE_RIGHT
    case FlexDirection.Column:
      return EDGE_TOP
    case FlexDirection.ColumnReverse:
      return EDGE_BOTTOM
  }
}
function trailingEdge(dir: FlexDirection): number {
  switch (dir) {
    case FlexDirection.Row:
      return EDGE_RIGHT
    case FlexDirection.RowReverse:
      return EDGE_LEFT
    case FlexDirection.Column:
      return EDGE_BOTTOM
    case FlexDirection.ColumnReverse:
      return EDGE_TOP
  }
}

// --
// Public types

// MeasureFunction 是文本节点向布局引擎报尺寸的唯一通道：布局引擎给约束（宽/高与各自模式），回调返回实际内容尺寸。Ink 的 Text 组件就是挂这个函数
export type MeasureFunction = (
  width: number,
  widthMode: MeasureMode,
  height: number,
  heightMode: MeasureMode,
) => { width: number; height: number }

export type Size = { width: number; height: number }

// --
// Config

export type Config = {
  pointScaleFactor: number
  errata: Errata
  useWebDefaults: boolean
  free(): void
  isExperimentalFeatureEnabled(_: ExperimentalFeature): boolean
  setExperimentalFeatureEnabled(_: ExperimentalFeature, __: boolean): void
  setPointScaleFactor(factor: number): void
  getErrata(): Errata
  setErrata(errata: Errata): void
  setUseWebDefaults(v: boolean): void
}

// createConfig 里一半方法是空实现：实验特性恒 false、free 不做事——这些 API 存在只为让从 WASM 迁过来的代码不用改
function createConfig(): Config {
  const config: Config = {
    pointScaleFactor: 1,
    errata: Errata.None,
    useWebDefaults: false,
    free() {},
    isExperimentalFeatureEnabled() {
      return false
    },
    setExperimentalFeatureEnabled() {},
    setPointScaleFactor(f) {
      config.pointScaleFactor = f
    },
    getErrata() {
      return config.errata
    },
    setErrata(e) {
      config.errata = e
    },
    setUseWebDefaults(v) {
      config.useWebDefaults = v
    },
  }
  return config
}

// --
// Node implementation

// Node 是唯一的可变实体，yoga 的 C++ 版本背后是原生指针，这里就是一个普通对象；外部拿到的是这个对象本身而不是句柄，所以 free 只能做语义上的清理
export class Node {
  style: Style
  layout: Layout
  parent: Node | null
  children: Node[]
  measureFunc: MeasureFunction | null
  config: Config
  isDirty_: boolean
  isReferenceBaseline_: boolean

// 以下 _ 前缀字段全是布局过程的暂存，不属于公开 API：flex-basis、主轴/交叉尺寸、行号，加上一整套缓存
  // Per-layout scratch (not public API)
  _flexBasis = 0
  _mainSize = 0
  _crossSize = 0
  _lineIndex = 0
// 快速路径标志位：CPU 剖析显示定位循环对每个子节点每趟要调 isMarginAuto 6 次、resolveEdgeRaw(position) 4 次，1000 节点基准约 1.1 万次，而绝大多数节点既没有 auto margin 也没有 position 内缩值——用一个布尔的代价跳过这 10 次调用
  // Fast-path flags maintained by style setters. Per CPU profile, the
  // positioning loop calls isMarginAuto 6× and resolveEdgeRaw(position) 4×
  // per child per layout pass — ~11k calls for the 1000-node bench, nearly
  // all of which return false/undefined since most nodes have no auto
  // margins and no position insets. These flags let us skip straight to
  // the common case with a single branch.
  _hasAutoMargin = false
  _hasPosition = false
  // Same pattern for the 3× resolveEdges4Into calls at the top of every
  // layoutNode(). In the 1000-node bench ~67% of those calls operate on
  // all-undefined edge arrays (most nodes have no border; only cols have
  // padding; only leaf cells have margin) — a single-branch skip beats
  // ~20 property reads + ~15 compares + 4 writes of zeros.
// 同一套思路用在三个边数组上：1000 节点基准里约 67% 的 resolveEdges4Into 调用操作的是全 undefined 数组（只有列有 padding、只有叶子有 margin），单分支跳过胜过 20 次读属性加 15 次比较加 4 次写零
  _hasPadding = false
  _hasBorder = false
  _hasMargin = false
// 单槽布局缓存，镜像上游 CalculateLayout.cpp 的 layoutNodeInternal：子树干净且问的是同一个问题就直接返回。为什么是两个槽而不是一个——每个节点通常会先收到一次 measure 调用（performLayout=false，来自 computeFlexBasis）再收到一次 layout 调用，单槽会互相踩踏
  // -- Dirty-flag layout cache. Mirrors upstream CalculateLayout.cpp's
  // layoutNodeInternal: skip a subtree entirely when it's clean and we're
  // asking the same question we cached the answer to. Two slots since
  // each node typically sees a measure call (performLayout=false, from
  // computeFlexBasis) followed by a layout call (performLayout=true) with
  // different inputs per parent pass — a single slot thrashes. Re-layout
  // bench (dirty one leaf, recompute root) went 2.7x→1.1x with this:
  // clean siblings skip straight through, only the dirty chain recomputes.
  _lW = NaN
  _lH = NaN
  _lWM: MeasureMode = 0
  _lHM: MeasureMode = 0
  _lOW = NaN
  _lOH = NaN
  _lFW = false
  _lFH = false
// _hasL 在计算之前就写入输入，但 layout.width/height 会被多槽缓存和后续不同输入的调用改写；如果只存输入不存输出，命中时会返回上一次调用残留的尺寸——这就是 scrollbox 视口高度从 33 变成 2624、滚动条归零、屏幕全黑的那个 bug
  // _hasL stores INPUTS early (before compute) but layout.width/height are
  // mutated by the multi-entry cache and by subsequent compute calls with
  // different inputs. Without storing OUTPUTS, a _hasL hit returns whatever
  // layout.width/height happened to be left by the last call — the scrollbox
  // vpH=33→2624 bug. Store + restore outputs like the multi-entry cache does.
  _lOutW = NaN
  _lOutH = NaN
  _hasL = false
  _mW = NaN
  _mH = NaN
  _mWM: MeasureMode = 0
  _mHM: MeasureMode = 0
  _mOW = NaN
  _mOH = NaN
  _mOutW = NaN
  _mOutH = NaN
  _hasM = false
// flex-basis 缓存：干净子节点的 basis 只取决于容器的内框尺寸，没变就跳过整趟 layoutNode(performLayout=false) 递归。滚动场景的热路径是：500 条消息的容器脏了，499 个干净子节点会被脏链的测量/布局级联各测约 20 次，缓存直接在子节点边界短路
  // Cached computeFlexBasis result. For clean children, basis only depends
  // on the container's inner dimensions — if those haven't changed, skip the
  // layoutNode(performLayout=false) recursion entirely. This is the hot path
  // for scroll: 500-message content container is dirty, its 499 clean
  // children each get measured ~20× as the dirty chain's measure/layout
  // passes cascade. Basis cache short-circuits at the child boundary.
  _fbBasis = NaN
  _fbOwnerW = NaN
  _fbOwnerH = NaN
  _fbAvailMain = NaN
  _fbAvailCross = NaN
  _fbCrossMode: MeasureMode = 0
// _fbGen 用代际号而不是 isDirty_ 当闸门：脏节点的缓存是上一次布局留下的（子树已经变了）所以必须废掉，但同一个代际内缓存是新的——虚拟滚动新挂载的项第一趟就脏，脏链一次布局里会调它 2 的深度次方次，而子树在这期间根本没变
  // Generation at which _fbBasis was written. Dirty nodes from a PREVIOUS
  // generation have stale cache (subtree changed), but within the SAME
  // generation the cache is fresh — the dirty chain's measure→layout
  // cascade invokes computeFlexBasis ≥2^depth times per calculateLayout on
  // fresh-mounted items, and the subtree doesn't change between calls.
  // Gating on generation instead of isDirty_ lets fresh mounts (virtual
  // scroll) cache-hit after first compute: 105k visits → ~10k.
  _fbGen = -1
// 多槽缓存存「输入 → 算出的宽高」：上游 yoga 用 16 槽，这里 4 槽就覆盖 Ink 的脏链深度。用扁平 Float64Array 存，避免每条目一个对象；槽 i 在 _cIn 里占 [i*8, i*8+8)，在 _cOut 里占 [i*2, i*2+2)
  // Multi-entry layout cache — stores (inputs → computed w,h) so hits with
  // different inputs than _hasL can restore the right dimensions. Upstream
  // yoga uses 16; 4 covers Ink's dirty-chain depth. Packed as flat arrays
  // to avoid per-entry object allocs. Slot i uses indices [i*8, i*8+8) in
  // _cIn (aW,aH,wM,hM,oW,oH,fW,fH) and [i*2, i*2+2) in _cOut (w,h).
  _cIn: Float64Array | null = null
  _cOut: Float64Array | null = null
  _cGen = -1
  _cN = 0
  _cWr = 0

// 构造器只做初值填充，不触发任何布局；config 缺省时共用模块级 DEFAULT_CONFIG，所以「没传 config」的节点在配置上完全等价
  constructor(config?: Config) {
    this.style = defaultStyle()
    this.layout = {
      left: 0,
      top: 0,
      width: 0,
      height: 0,
      border: [0, 0, 0, 0],
      padding: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
    }
    this.parent = null
    this.children = []
    this.measureFunc = null
    this.config = config ?? DEFAULT_CONFIG
    this.isDirty_ = true
    this.isReferenceBaseline_ = false
// 存活计数在这里递增、在 free 里递减，供基准测试检测泄漏——移植件没有原生析构，只能靠这对计数加手工断引用
    _yogaLiveNodes++
  }

  // -- Tree

// insertChild 用 splice 支持任意位置插入，而不是只 append——Ink 的兄弟顺序就是渲染顺序，插到中间是常态
  insertChild(child: Node, index: number): void {
    child.parent = this
    this.children.splice(index, 0, child)
    this.markDirty()
  }
  removeChild(child: Node): void {
    const idx = this.children.indexOf(child)
    if (idx >= 0) {
      this.children.splice(idx, 1)
      child.parent = null
      this.markDirty()
    }
  }
  getChild(index: number): Node {
    return this.children[index]!
  }
  getChildCount(): number {
    return this.children.length
  }
  getParent(): Node | null {
    return this.parent
  }

  // -- Lifecycle

// free 做的是断引用加清缓存，没有真正释放内存；注释里那个 _yogaLiveNodes-- 在重复调用时会减两次，但调用方约定只 free 一次，所以没加防护
  free(): void {
    this.parent = null
    this.children = []
    this.measureFunc = null
    this._cIn = null
    this._cOut = null
    _yogaLiveNodes--
  }
  freeRecursive(): void {
    for (const c of this.children) c.freeRecursive()
    this.free()
  }
// reset 把节点还原成出厂状态并逐个清空全部缓存槽——新增缓存字段时最容易漏改这里，漏一个就会出现「复用节点带着上次的尺寸」
  reset(): void {
    this.style = defaultStyle()
    this.children = []
    this.parent = null
    this.measureFunc = null
    this.isDirty_ = true
    this._hasAutoMargin = false
    this._hasPosition = false
    this._hasPadding = false
    this._hasBorder = false
    this._hasMargin = false
    this._hasL = false
    this._hasM = false
    this._cN = 0
    this._cWr = 0
    this._fbBasis = NaN
  }

  // -- Dirty tracking

// markDirty 只在上行父节点尚未标记时才递归，所以脏链上溯是 O(链长) 而不是 O(树)；代价是重复标记同一子树是幂等的，不会重复上溯
  markDirty(): void {
    this.isDirty_ = true
    if (this.parent && !this.parent.isDirty_) this.parent.markDirty()
  }
  isDirty(): boolean {
    return this.isDirty_
  }
// hasNewLayout 恒 true、markLayoutSeen 空实现——这两个 API 是 yoga 给增量渲染用的，Ink 每帧全量读，直接退化掉
  hasNewLayout(): boolean {
    return true
  }
  markLayoutSeen(): void {}

  // -- Measure function

// 换 measure 函数必须标脏：文本内容变了但节点结构没变，唯一的变化信号就是这里
  setMeasureFunc(fn: MeasureFunction | null): void {
    this.measureFunc = fn
    this.markDirty()
  }
  unsetMeasureFunc(): void {
    this.measureFunc = null
    this.markDirty()
  }

  // -- Computed layout getters

  getComputedLeft(): number {
    return this.layout.left
  }
  getComputedTop(): number {
    return this.layout.top
  }
  getComputedWidth(): number {
    return this.layout.width
  }
  getComputedHeight(): number {
    return this.layout.height
  }
// ComputedRight/Bottom 不是存下来的，而是用父节点宽高减去自身 left 加 width 反推——所以父节点尺寸变了、子节点位置没变时，这两个值会自动跟着变，不需要重算
  getComputedRight(): number {
    const p = this.parent
    return p ? p.layout.width - this.layout.left - this.layout.width : 0
  }
  getComputedBottom(): number {
    const p = this.parent
    return p ? p.layout.height - this.layout.top - this.layout.height : 0
  }
  getComputedLayout(): {
    left: number
    top: number
    right: number
    bottom: number
    width: number
    height: number
  } {
    return {
      left: this.layout.left,
      top: this.layout.top,
      right: this.getComputedRight(),
      bottom: this.getComputedBottom(),
      width: this.layout.width,
      height: this.layout.height,
    }
  }
  getComputedBorder(edge: Edge): number {
    return this.layout.border[physicalEdge(edge)]!
  }
  getComputedPadding(edge: Edge): number {
    return this.layout.padding[physicalEdge(edge)]!
  }
  getComputedMargin(edge: Edge): number {
    return this.layout.margin[physicalEdge(edge)]!
  }

  // -- Style setters: dimensions

// 每个尺寸属性都有三态 setter：数值/字符串（含百分比）、单独的 Percent 版本、单独的 Auto 版本。这样调用方不用拼字符串，也免得每次都走 parseDimension 的正则分支
  setWidth(v: number | 'auto' | string | undefined): void {
    this.style.width = parseDimension(v)
    this.markDirty()
  }
  setWidthPercent(v: number): void {
    this.style.width = percentValue(v)
    this.markDirty()
  }
  setWidthAuto(): void {
    this.style.width = AUTO_VALUE
    this.markDirty()
  }
  setHeight(v: number | 'auto' | string | undefined): void {
    this.style.height = parseDimension(v)
    this.markDirty()
  }
  setHeightPercent(v: number): void {
    this.style.height = percentValue(v)
    this.markDirty()
  }
  setHeightAuto(): void {
    this.style.height = AUTO_VALUE
    this.markDirty()
  }
  setMinWidth(v: number | string | undefined): void {
    this.style.minWidth = parseDimension(v)
    this.markDirty()
  }
  setMinWidthPercent(v: number): void {
    this.style.minWidth = percentValue(v)
    this.markDirty()
  }
  setMinHeight(v: number | string | undefined): void {
    this.style.minHeight = parseDimension(v)
    this.markDirty()
  }
  setMinHeightPercent(v: number): void {
    this.style.minHeight = percentValue(v)
    this.markDirty()
  }
  setMaxWidth(v: number | string | undefined): void {
    this.style.maxWidth = parseDimension(v)
    this.markDirty()
  }
  setMaxWidthPercent(v: number): void {
    this.style.maxWidth = percentValue(v)
    this.markDirty()
  }
  setMaxHeight(v: number | string | undefined): void {
    this.style.maxHeight = parseDimension(v)
    this.markDirty()
  }
  setMaxHeightPercent(v: number): void {
    this.style.maxHeight = percentValue(v)
    this.markDirty()
  }

  // -- Style setters: flex

  setFlexDirection(dir: FlexDirection): void {
    this.style.flexDirection = dir
    this.markDirty()
  }
  setFlexGrow(v: number | undefined): void {
    this.style.flexGrow = v ?? 0
    this.markDirty()
  }
  setFlexShrink(v: number | undefined): void {
    this.style.flexShrink = v ?? 0
    this.markDirty()
  }
// setFlex 是 CSS flex 简写的语义压缩：负数表示只设 shrink（grow 归零），正数表示 grow 加 shrink=1 加 basis=0（CSS 的 flex: N），未定义全归零。这段是 flexbox 规范里最容易被写错的一处
  setFlex(v: number | undefined): void {
    if (v === undefined || isNaN(v)) {
      this.style.flexGrow = 0
      this.style.flexShrink = 0
    } else if (v > 0) {
      this.style.flexGrow = v
      this.style.flexShrink = 1
      this.style.flexBasis = pointValue(0)
    } else if (v < 0) {
      this.style.flexGrow = 0
      this.style.flexShrink = -v
    } else {
      this.style.flexGrow = 0
      this.style.flexShrink = 0
    }
    this.markDirty()
  }
  setFlexBasis(v: number | 'auto' | string | undefined): void {
    this.style.flexBasis = parseDimension(v)
    this.markDirty()
  }
  setFlexBasisPercent(v: number): void {
    this.style.flexBasis = percentValue(v)
    this.markDirty()
  }
  setFlexBasisAuto(): void {
    this.style.flexBasis = AUTO_VALUE
    this.markDirty()
  }
  setFlexWrap(wrap: Wrap): void {
    this.style.flexWrap = wrap
    this.markDirty()
  }

  // -- Style setters: alignment

  setAlignItems(a: Align): void {
    this.style.alignItems = a
    this.markDirty()
  }
  setAlignSelf(a: Align): void {
    this.style.alignSelf = a
    this.markDirty()
  }
  setAlignContent(a: Align): void {
    this.style.alignContent = a
    this.markDirty()
  }
  setJustifyContent(j: Justify): void {
    this.style.justifyContent = j
    this.markDirty()
  }

  // -- Style setters: display / position / overflow

  setDisplay(d: Display): void {
    this.style.display = d
    this.markDirty()
  }
  getDisplay(): Display {
    return this.style.display
  }
  setPositionType(t: PositionType): void {
    this.style.positionType = t
    this.markDirty()
  }
// setPosition 每次重算 _hasPosition 而不是简单地置 true——因为可以把某条边设回 undefined，此时必须能重新变回 false，否则快速路径会一直走慢支
  setPosition(edge: Edge, v: number | string | undefined): void {
    this.style.position[edge] = parseDimension(v)
    this._hasPosition = hasAnyDefinedEdge(this.style.position)
    this.markDirty()
  }
  setPositionPercent(edge: Edge, v: number): void {
    this.style.position[edge] = percentValue(v)
    this._hasPosition = true
    this.markDirty()
  }
  setPositionAuto(edge: Edge): void {
    this.style.position[edge] = AUTO_VALUE
    this._hasPosition = true
    this.markDirty()
  }
  setOverflow(o: Overflow): void {
    this.style.overflow = o
    this.markDirty()
  }
  setDirection(d: Direction): void {
    this.style.direction = d
    this.markDirty()
  }
// 三个空实现：box-sizing 只支持 border-box、aspect-ratio 完全不支持、copyStyle 没人调用。写成空方法而不是删掉，是为了让 API 面与上游一致
  setBoxSizing(_: BoxSizing): void {
    // Not implemented — Ink doesn't use content-box
  }

  // -- Style setters: spacing

// setMargin 是三个 setter 里唯一要维护两个标志的：_hasAutoMargin（供 auto margin 分配用）与 _hasMargin（供边解析快速路径用），而且要处理「把 auto 改回普通值」的情况
  setMargin(edge: Edge, v: number | 'auto' | string | undefined): void {
    const val = parseDimension(v)
    this.style.margin[edge] = val
    if (val.unit === Unit.Auto) this._hasAutoMargin = true
    else this._hasAutoMargin = hasAnyAutoEdge(this.style.margin)
    this._hasMargin =
      this._hasAutoMargin || hasAnyDefinedEdge(this.style.margin)
    this.markDirty()
  }
  setMarginPercent(edge: Edge, v: number): void {
    this.style.margin[edge] = percentValue(v)
    this._hasAutoMargin = hasAnyAutoEdge(this.style.margin)
    this._hasMargin = true
    this.markDirty()
  }
  setMarginAuto(edge: Edge): void {
    this.style.margin[edge] = AUTO_VALUE
    this._hasAutoMargin = true
    this._hasMargin = true
    this.markDirty()
  }
  setPadding(edge: Edge, v: number | string | undefined): void {
    this.style.padding[edge] = parseDimension(v)
    this._hasPadding = hasAnyDefinedEdge(this.style.padding)
    this.markDirty()
  }
  setPaddingPercent(edge: Edge, v: number): void {
    this.style.padding[edge] = percentValue(v)
    this._hasPadding = true
    this.markDirty()
  }
  setBorder(edge: Edge, v: number | undefined): void {
    this.style.border[edge] = v === undefined ? UNDEFINED_VALUE : pointValue(v)
    this._hasBorder = hasAnyDefinedEdge(this.style.border)
    this.markDirty()
  }
// gap 只有 3 个槽：row、column、all。主轴方向取哪个槽由 flex-direction 决定，所以 resolveGap 的调用方要传 Gutter.Column 或 Gutter.Row
  setGap(gutter: Gutter, v: number | string | undefined): void {
    this.style.gap[gutter] = parseDimension(v)
    this.markDirty()
  }
  setGapPercent(gutter: Gutter, v: number): void {
    this.style.gap[gutter] = percentValue(v)
    this.markDirty()
  }

  // -- Style getters (partial — only what tests need)

  getFlexDirection(): FlexDirection {
    return this.style.flexDirection
  }
  getJustifyContent(): Justify {
    return this.style.justifyContent
  }
  getAlignItems(): Align {
    return this.style.alignItems
  }
  getAlignSelf(): Align {
    return this.style.alignSelf
  }
  getAlignContent(): Align {
    return this.style.alignContent
  }
  getFlexGrow(): number {
    return this.style.flexGrow
  }
  getFlexShrink(): number {
    return this.style.flexShrink
  }
  getFlexBasis(): Value {
    return this.style.flexBasis
  }
  getFlexWrap(): Wrap {
    return this.style.flexWrap
  }
  getWidth(): Value {
    return this.style.width
  }
  getHeight(): Value {
    return this.style.height
  }
  getOverflow(): Overflow {
    return this.style.overflow
  }
  getPositionType(): PositionType {
    return this.style.positionType
  }
  getDirection(): Direction {
    return this.style.direction
  }

// 这一整段 API 桩只为接口对齐存在：赋值函数体全空、取值函数返回 NaN 或恒定值——从 WASM 版本迁过来的调用方不会因为缺方法而崩
  // -- Unused API stubs (present for API parity)

  copyStyle(_: Node): void {}
  setDirtiedFunc(_: unknown): void {}
  unsetDirtiedFunc(): void {}
  setIsReferenceBaseline(v: boolean): void {
    this.isReferenceBaseline_ = v
    this.markDirty()
  }
  isReferenceBaseline(): boolean {
    return this.isReferenceBaseline_
  }
  setAspectRatio(_: number | undefined): void {}
  getAspectRatio(): number {
    return NaN
  }
  setAlwaysFormsContainingBlock(_: boolean): void {}

  // -- Layout entry point

// calculateLayout 是唯一入口：重置计数器并递增代际号，然后用「根节点没有被谁约束」的语义（Undefined 模式、可用尺寸等于自身）启动递归
  calculateLayout(
    ownerWidth: number | undefined,
    ownerHeight: number | undefined,
    _direction?: Direction,
  ): void {
    _yogaNodesVisited = 0
    _yogaMeasureCalls = 0
    _yogaCacheHits = 0
    _generation++
    const w = ownerWidth === undefined ? NaN : ownerWidth
    const h = ownerHeight === undefined ? NaN : ownerHeight
    layoutNode(
      this,
      w,
      h,
      isDefined(w) ? MeasureMode.Exactly : MeasureMode.Undefined,
      isDefined(h) ? MeasureMode.Exactly : MeasureMode.Undefined,
      w,
      h,
      true,
    )
    // Root's own position = margin + position insets (yoga applies position
    // to the root even without a parent container; this matters for rounding
    // since the root's abs top/left seeds the pixel-grid walk).
// 根节点即使没有父容器也要吃自己的 margin 与 position 内缩值——yoga 在根上也应用定位，因为根节点的绝对 left/top 是像素网格遍历的起点，漏掉会让整棵树差半个像素
    const mar = this.layout.margin
    const posL = resolveValue(
      resolveEdgeRaw(this.style.position, EDGE_LEFT),
      isDefined(w) ? w : 0,
    )
    const posT = resolveValue(
      resolveEdgeRaw(this.style.position, EDGE_TOP),
      isDefined(w) ? w : 0,
    )
    this.layout.left = mar[EDGE_LEFT] + (isDefined(posL) ? posL : 0)
    this.layout.top = mar[EDGE_TOP] + (isDefined(posT) ? posT : 0)
// 递归算完后统一做像素网格舍入：pointScaleFactor 为 0 时直接返回（表示不做舍入）。这一步必须在整棵树的尺寸都定下来之后做，否则会累积误差
    roundLayout(this, this.config.pointScaleFactor, 0, 0)
  }
}

const DEFAULT_CONFIG = createConfig()

// 多槽缓存的槽数。取 4 而不是上游的 16：Ink 的脏链深度很少超过 4，槽多了反而抬高每次扫描比较的成本
const CACHE_SLOTS = 4
// cacheWrite 把这次调用的输入与实际算出的宽高存进环形槽位；输入共 8 个字段（可用宽高、两个模式、owner 宽高、两个 force 标志），输出 2 个
function cacheWrite(
  node: Node,
  aW: number,
  aH: number,
  wM: MeasureMode,
  hM: MeasureMode,
  oW: number,
  oH: number,
  fW: boolean,
  fH: boolean,
  wasDirty: boolean,
): void {
  if (!node._cIn) {
    node._cIn = new Float64Array(CACHE_SLOTS * 8)
    node._cOut = new Float64Array(CACHE_SLOTS * 2)
  }
// 脏节点跨代首次写入时先清空旧槽：上一代留下的条目对应的是改动前的子树，尺寸已经失效。干净节点的旧条目则保留——子树没变，同样输入必得同样结果，这正是滚动热路径能跨代命中的原因
  // First write after a dirty clears stale entries from before the dirty.
  // _cGen < _generation means entries are from a previous calculateLayout;
  // if wasDirty, the subtree changed since then → old dimensions invalid.
  // Clean nodes' old entries stay — same subtree → same result for same
  // inputs, so cross-generation caching works (the scroll hot path where
  // 499 clean messages cache-hit while one dirty leaf recomputes).
  if (wasDirty && node._cGen !== _generation) {
    node._cN = 0
    node._cWr = 0
  }
// 写指针环绕但 _cN 保持在满值：读的时候总要扫全部已填充的槽，不能只扫本轮写过的几个，否则环绕之后老条目永远读不到
  // LRU write index wraps; _cN stays at CACHE_SLOTS so the read scan always
  // checks all populated slots (not just those since last wrap).
  const i = node._cWr++ % CACHE_SLOTS
  if (node._cN < CACHE_SLOTS) node._cN = node._cWr
  const o = i * 8
  const cIn = node._cIn
  cIn[o] = aW
  cIn[o + 1] = aH
  cIn[o + 2] = wM
  cIn[o + 3] = hM
  cIn[o + 4] = oW
  cIn[o + 5] = oH
  cIn[o + 6] = fW ? 1 : 0
  cIn[o + 7] = fH ? 1 : 0
  node._cOut![i * 2] = node.layout.width
  node._cOut![i * 2 + 1] = node.layout.height
  node._cGen = _generation
}

// Store computed layout.width/height into the single-slot cache output fields.
// _hasL/_hasM inputs are committed at the TOP of layoutNode (before compute);
// outputs must be committed HERE (after compute) so a cache hit can restore
// the correct dimensions. Without this, a _hasL hit returns whatever
// layout.width/height was left by the last call — which may be the intrinsic
// content height from a heightMode=Undefined measure pass rather than the
// constrained viewport height from the layout pass. That's the scrollbox
// vpH=33→2624 bug: scrollTop clamps to 0, viewport goes blank.
// commitCacheOutputs 把算完的宽高写进单槽缓存的输出字段。输入在 layoutNode 开头就提交了（那时还没算），输出必须在这里才提交——这个先后顺序错了就会出现读回上一次残留尺寸的问题
function commitCacheOutputs(node: Node, performLayout: boolean): void {
  if (performLayout) {
    node._lOutW = node.layout.width
    node._lOutH = node.layout.height
  } else {
    node._mOutW = node.layout.width
    node._mOutH = node.layout.height
  }
}

// --
// Core flexbox algorithm

// 四个模块级计数器，每次 calculateLayout 开头清零，供基准测试与调试读取。它们让「这个文件到底快了多少」变成可测量的，而不是靠感觉
// Profiling counters — reset per calculateLayout, read via getYogaCounters.
// Incremented on each calculateLayout(). Nodes stamp _fbGen/_cGen when
// their cache is written; a cache entry with gen === _generation was
// computed THIS pass and is fresh regardless of isDirty_ state.
let _generation = 0
let _yogaNodesVisited = 0
let _yogaMeasureCalls = 0
let _yogaCacheHits = 0
let _yogaLiveNodes = 0
// getYogaCounters 是这组计数器唯一的出口；live 不是本趟的统计量而是全局存活节点数，语义上和其他三个不同，放在同一个返回值里是为了少一次导出
export function getYogaCounters(): {
  visited: number
  measured: number
  cacheHits: number
  live: number
} {
  return {
    visited: _yogaNodesVisited,
    measured: _yogaMeasureCalls,
    cacheHits: _yogaCacheHits,
    live: _yogaLiveNodes,
  }
}

// layoutNode 是整个引擎的心脏：给定可用尺寸与两个测量模式，算出这个节点的宽高、可选地把子节点逐个定位，并维护三层缓存。参数里 forceWidth/forceHeight 表示「忽略自身样式尺寸」——父容器做主轴的伸缩分配后已经定了尺寸，不能再让子节点的 width 覆盖
function layoutNode(
  node: Node,
  availableWidth: number,
  availableHeight: number,
  widthMode: MeasureMode,
  heightMode: MeasureMode,
  ownerWidth: number,
  ownerHeight: number,
  performLayout: boolean,
  // When true, ignore style dimension on this axis — the flex container
  // has already determined the main size (flex-basis + grow/shrink result).
  forceWidth = false,
  forceHeight = false,
): void {
  _yogaNodesVisited++
// 访问计数每进一次就加一，不管后面是否命中缓存；它和 cacheHits 一起看才能判断缓存是否真的减少了递归
  const style = node.style
  const layout = node.layout

// 三级缓存查找，优先级从高到低：单槽 layout 缓存、多槽缓存、单槽 measure 缓存。整体跳过条件是「节点干净」或「同代际的 measure 调用」
  // Dirty-flag skip: clean subtree + matching inputs → layout object already
  // holds the answer. A cached layout result also satisfies a measure request
  // (positions are a superset of dimensions); the reverse does not hold.
  // Same-generation entries are fresh regardless of isDirty_ — they were
  // computed THIS calculateLayout, the subtree hasn't changed since.
  // Previous-generation entries need !isDirty_ (a dirty node's cache from
  // before the dirty is stale).
  // sameGen bypass only for MEASURE calls — a layout-pass cache hit would
  // skip the child-positioning recursion (STEP 5), leaving children at
  // stale positions. Measure calls only need w/h which the cache stores.
// sameGen 只在 measure 调用时成立：布局趟如果命中缓存就会跳过子节点定位（STEP 5），把子节点留在上一次的位置上；measure 调用只关心宽高，缓存里正好有
  const sameGen = node._cGen === _generation && !performLayout
  if (!node.isDirty_ || sameGen) {
    if (
      !node.isDirty_ &&
      node._hasL &&
      node._lWM === widthMode &&
      node._lHM === heightMode &&
      node._lFW === forceWidth &&
      node._lFH === forceHeight &&
      sameFloat(node._lW, availableWidth) &&
      sameFloat(node._lH, availableHeight) &&
      sameFloat(node._lOW, ownerWidth) &&
      sameFloat(node._lOH, ownerHeight)
    ) {
      _yogaCacheHits++
      layout.width = node._lOutW
      layout.height = node._lOutH
      return
    }
// 多槽缓存扫描逐个比对 8 个输入字段，命中就恢复该槽存下的宽高。这一段是滚动性能的关键：500 条消息加一个脏叶子，脏叶重排从 7.6 万次 layoutNode 调用（21.7 倍节点数）降到 4 千次（1.2 倍），6.86ms 降到 550µs
    // Multi-entry cache: scan for matching inputs, restore cached w/h on hit.
    // Covers the scroll case where a dirty ancestor's measure→layout cascade
    // produces N>1 distinct input combos per clean child — the single _hasL
    // slot thrashed, forcing full subtree recursion. With 500-message
    // scrollbox and one dirty leaf, this took dirty-leaf relayout from
    // 76k layoutNode calls (21.7×nodes) to 4k (1.2×nodes), 6.86ms → 550µs.
    // Same-generation check covers fresh-mounted (dirty) nodes during
    // virtual scroll — the dirty chain invokes them ≥2^depth times, first
    // call writes cache, rest hit: 105k visits → ~10k for 1593-node tree.
    if (node._cN > 0 && (sameGen || !node.isDirty_)) {
      const cIn = node._cIn!
      for (let i = 0; i < node._cN; i++) {
        const o = i * 8
        if (
          cIn[o + 2] === widthMode &&
          cIn[o + 3] === heightMode &&
          cIn[o + 6] === (forceWidth ? 1 : 0) &&
          cIn[o + 7] === (forceHeight ? 1 : 0) &&
          sameFloat(cIn[o]!, availableWidth) &&
// 用 sameFloat 而不是 === 比对四个尺寸，是为了让 NaN 与 NaN 视为相等——未定义尺寸的节点也能命中
          sameFloat(cIn[o + 1]!, availableHeight) &&
          sameFloat(cIn[o + 4]!, ownerWidth) &&
          sameFloat(cIn[o + 5]!, ownerHeight)
        ) {
          layout.width = node._cOut![i * 2]!
          layout.height = node._cOut![i * 2 + 1]!
          _yogaCacheHits++
          return
        }
      }
    }
    if (
      !node.isDirty_ &&
      !performLayout &&
      node._hasM &&
      node._mWM === widthMode &&
      node._mHM === heightMode &&
      sameFloat(node._mW, availableWidth) &&
      sameFloat(node._mH, availableHeight) &&
      sameFloat(node._mOW, ownerWidth) &&
      sameFloat(node._mOH, ownerHeight)
    ) {
      layout.width = node._mOutW
      layout.height = node._mOutH
      _yogaCacheHits++
      return
    }
  }
// 缓存输入必须提前提交，让每一个 return 路径都留下合法条目。更关键的是 isDirty_ 只在布局趟清除，原因见下一条
  // Commit cache inputs up front so every return path leaves a valid entry.
  // Only clear isDirty_ on the LAYOUT pass — the measure pass (computeFlexBasis
  // → layoutNode(performLayout=false)) runs before the layout pass in the same
  // calculateLayout call. Clearing dirty during measure lets the subsequent
  // layout pass hit the STALE _hasL cache from the previous calculateLayout
  // (before children were inserted), so ScrollBox content height never grows
  // and sticky-scroll never follows new content. A dirty node's _hasL entry is
  // stale by definition — invalidate it so the layout pass recomputes.
// wasDirty 决定后续的缓存失效策略：布局趟清 isDirty_ 并作废 measure 槽；measure 趟不清 isDirty_ 但要作废脏节点的 layout 槽
  const wasDirty = node.isDirty_
  if (performLayout) {
    node._lW = availableWidth
    node._lH = availableHeight
    node._lWM = widthMode
    node._lHM = heightMode
    node._lOW = ownerWidth
    node._lOH = ownerHeight
    node._lFW = forceWidth
    node._lFH = forceHeight
    node._hasL = true
    node.isDirty_ = false
    // Previous approach cleared _cN here to prevent stale pre-dirty entries
    // from hitting (long-continuous blank-screen bug). Now replaced by
    // generation stamping: the cache check requires sameGen || !isDirty_, so
    // previous-generation entries from a dirty node can't hit. Clearing here
    // would wipe fresh same-generation entries from an earlier measure call,
    // forcing recompute on the layout call.
// 以前这里会清空 _cN 来防止改动前的旧条目命中（曾导致长时间连续黑屏），后来改成代际戳：缓存检查要求「同代际或节点干净」，所以脏节点上一代的条目本来就进不来；继续清空反而会抹掉本轮 measure 调用刚写进去的新条目
    if (wasDirty) node._hasM = false
  } else {
    node._mW = availableWidth
    node._mH = availableHeight
    node._mWM = widthMode
    node._mHM = heightMode
    node._mOW = ownerWidth
    node._mOH = ownerHeight
    node._hasM = true
    // Don't clear isDirty_. For DIRTY nodes, invalidate _hasL so the upcoming
    // performLayout=true call recomputes with the new child set (otherwise
    // sticky-scroll never follows new content — the bug from 4557bc9f9c).
    // Clean nodes keep _hasL: their layout from the previous generation is
    // still valid, they're only here because an ancestor is dirty and called
    // with different inputs than cached.
// measure 趟不能清 isDirty_ 的原因：同一趟 calculateLayout 里，measure 在前、layout 在后，如果在 measure 阶段就清了脏，后面的 layout 趟会命中上一次布局留下的旧缓存（那时子节点还没插入），于是 ScrollBox 的内容高度永远不增长、粘性滚动永远跟不上新内容
    if (wasDirty) node._hasL = false
  }

  // Resolve padding/border/margin against ownerWidth (yoga uses ownerWidth for %)
  // Write directly into the pre-allocated layout arrays — avoids 3 allocs per
  // layoutNode call and 12 resolveEdge calls (was the #1 hotspot per CPU profile).
  // Skip entirely when no edges are set — the 4-write zero is cheaper than
  // the ~20 reads + ~15 compares resolveEdges4Into does to produce zeros.
// 三个边数组都是原地解析，直接写进预分配的 layout 数组——省掉每次 layoutNode 三次数组分配与十二次 resolveEdge 调用（这曾是 CPU 剖析的第一热点）。没设置过任何边时直接写四个零，比走解析函数更便宜
  const pad = layout.padding
  const bor = layout.border
  const mar = layout.margin
  if (node._hasPadding) resolveEdges4Into(style.padding, ownerWidth, pad)
  else pad[0] = pad[1] = pad[2] = pad[3] = 0
  if (node._hasBorder) resolveEdges4Into(style.border, ownerWidth, bor)
  else bor[0] = bor[1] = bor[2] = bor[3] = 0
  if (node._hasMargin) resolveEdges4Into(style.margin, ownerWidth, mar)
  else mar[0] = mar[1] = mar[2] = mar[3] = 0

// padding 与 border 合起来算内框偏移：主轴/交叉轴各一个。这两个数字后面反复出现，所以提前算好
  const paddingBorderWidth = pad[0] + pad[2] + bor[0] + bor[2]
  const paddingBorderHeight = pad[1] + pad[3] + bor[1] + bor[3]

  // Resolve style dimensions
// 样式里显式写了尺寸就覆盖传入的可用尺寸，并把模式强制成 Exactly——这就是「父容器的建议不如子节点自己的声明」
  const styleWidth = forceWidth ? NaN : resolveValue(style.width, ownerWidth)
  const styleHeight = forceHeight
    ? NaN
    : resolveValue(style.height, ownerHeight)

  // If style dimension is defined, it overrides the available size
  let width = availableWidth
  let height = availableHeight
  let wMode = widthMode
  let hMode = heightMode
  if (isDefined(styleWidth)) {
    width = styleWidth
    wMode = MeasureMode.Exactly
  }
  if (isDefined(styleHeight)) {
    height = styleHeight
    hMode = MeasureMode.Exactly
  }

  // Apply min/max constraints to the node's own dimensions
// min/max 约束在这里统一施加，包括百分比形式；boundAxis 内部有「未设置 min/max」的快速路径，因为这是绝大多数情况
  width = boundAxis(style, true, width, ownerWidth, ownerHeight)
  height = boundAxis(style, false, height, ownerWidth, ownerHeight)

  // Measure-func leaf node
// measure-func 叶子：有测量函数且没有子节点。这是文本节点的分支，它不跑 flexbox，直接把约束交给回调
  if (node.measureFunc && node.children.length === 0) {
    const innerW =
      wMode === MeasureMode.Undefined
        ? NaN
        : Math.max(0, width - paddingBorderWidth)
    const innerH =
      hMode === MeasureMode.Undefined
        ? NaN
        : Math.max(0, height - paddingBorderHeight)
// 传给测量函数的是扣除内边距与边框后的内框尺寸；模式为 Undefined 时对应轴传 NaN，表示「没有约束，按内容来」
    _yogaMeasureCalls++
    const measured = node.measureFunc(innerW, wMode, innerH, hMode)
// Exactly 模式直接用给定尺寸（不采信回调结果），否则把回调测出的内容尺寸加回内边距，再过一次 min/max 夹紧——加回内边距这一步很容易漏，漏了就会让带 padding 的文本节点每次少算两个 padding
    node.layout.width =
      wMode === MeasureMode.Exactly
        ? width
        : boundAxis(
            style,
            true,
            (measured.width ?? 0) + paddingBorderWidth,
            ownerWidth,
            ownerHeight,
          )
    node.layout.height =
      hMode === MeasureMode.Exactly
        ? height
        : boundAxis(
            style,
            false,
            (measured.height ?? 0) + paddingBorderHeight,
            ownerWidth,
            ownerHeight,
          )
    commitCacheOutputs(node, performLayout)
// 脏节点也写缓存：虚拟滚动新挂载的项第一次布局是脏的，但脏链的测量/布局级联会在同一趟里调它很多次，写着缓存让第 2 次起就能命中（布局趟已经把 isDirty_ 清了）。实测 1593 个节点的全新挂载树从 10.5 万次访问降到 1 万次
    // Write cache even for dirty nodes — fresh-mounted items during virtual
    // scroll are dirty on first layout, but the dirty chain's measure→layout
    // cascade invokes them ≥2^depth times per calculateLayout. Writing here
    // lets the 2nd+ calls hit cache (isDirty_ was cleared in the layout pass
    // above). Measured: 105k visits → 10k for a 1593-node fresh-mount tree.
    cacheWrite(
      node,
      availableWidth,
      availableHeight,
      widthMode,
      heightMode,
      ownerWidth,
      ownerHeight,
      forceWidth,
      forceHeight,
      wasDirty,
    )
    return
  }

  // Leaf node with no children and no measure func
// 无子节点也没有测量函数的叶子：尺寸就是内边距加边框（内容为空），除非有 Exactly 约束或样式尺寸
  if (node.children.length === 0) {
    node.layout.width =
      wMode === MeasureMode.Exactly
        ? width
        : boundAxis(style, true, paddingBorderWidth, ownerWidth, ownerHeight)
    node.layout.height =
      hMode === MeasureMode.Exactly
        ? height
        : boundAxis(style, false, paddingBorderHeight, ownerWidth, ownerHeight)
    commitCacheOutputs(node, performLayout)
    // Write cache even for dirty nodes — fresh-mounted items during virtual
    // scroll are dirty on first layout, but the dirty chain's measure→layout
    // cascade invokes them ≥2^depth times per calculateLayout. Writing here
    // lets the 2nd+ calls hit cache (isDirty_ was cleared in the layout pass
    // above). Measured: 105k visits → 10k for a 1593-node fresh-mount tree.
    cacheWrite(
      node,
      availableWidth,
      availableHeight,
      widthMode,
      heightMode,
      ownerWidth,
      ownerHeight,
      forceWidth,
      forceHeight,
      wasDirty,
    )
    return
  }

// 进入容器分支：先按 flex-direction 拆出主轴与交叉轴，把「宽高」这套物理概念换成「主轴尺寸/交叉轴尺寸」，后面整段算法就与方向无关了
  // Container with children — run flexbox algorithm
  const mainAxis = style.flexDirection
  const crossAx = crossAxis(mainAxis)
  const isMainRow = isRow(mainAxis)

  const mainSize = isMainRow ? width : height
  const crossSize = isMainRow ? height : width
  const mainMode = isMainRow ? wMode : hMode
  const crossMode = isMainRow ? hMode : wMode
  const mainPadBorder = isMainRow ? paddingBorderWidth : paddingBorderHeight
  const crossPadBorder = isMainRow ? paddingBorderHeight : paddingBorderWidth

// 内框主轴/交叉尺寸要扣掉对应的内边距边框；尺寸不定时保持 NaN，让下游一路用 isDefined 判断，而不是塞一个假值
  const innerMainSize = isDefined(mainSize)
    ? Math.max(0, mainSize - mainPadBorder)
    : NaN
  const innerCrossSize = isDefined(crossSize)
    ? Math.max(0, crossSize - crossPadBorder)
    : NaN

  // Resolve gap
// 主轴方向的 gap 取哪个槽取决于主轴是否水平：水平主轴用 column-gap（列与列之间），垂直主轴用 row-gap。这里最容易写反
  const gapMain = resolveGap(
    style,
    isMainRow ? Gutter.Column : Gutter.Row,
    innerMainSize,
  )

// 子节点分两类：参与流式布局的与绝对定位的。display:contents 的节点在这一步就被拍平——它自己的盒子被移除，子节点递归提升到祖父的列表里
  // Partition children into flow vs absolute. display:contents nodes are
  // transparent — their children are lifted into the grandparent's child list
  // (recursively), and the contents node itself gets zero layout.
  const flowChildren: Node[] = []
  const absChildren: Node[] = []
  collectLayoutChildren(node, flowChildren, absChildren)

// 子节点百分比以本节点的内容盒为准：本节点宽度不定时，子节点的百分比宽度也不定，绝不能退到祖父的尺寸上——这是 CSS 里一条常被实现错的规则
  // ownerW/H are the reference sizes for resolving children's percentage
  // values. Per CSS, a % width resolves against the parent's content-box
  // width. If this node's width is indefinite, children's % widths are also
  // indefinite — do NOT fall through to the grandparent's size.
  const ownerW = isDefined(width) ? width : NaN
  const ownerH = isDefined(height) ? height : NaN
  const isWrap = style.flexWrap !== Wrap.NoWrap
  const gapCross = resolveGap(
    style,
    isMainRow ? Gutter.Row : Gutter.Column,
    innerCrossSize,
  )

// STEP 1：先给每个流式子节点算 flex-basis（它在主轴上的理想尺寸），再决定怎么换行。basis 的算法单独一个函数，因为有四级回退：显式 basis → 主轴样式尺寸 → 实测 → 0
  // STEP 1: Compute flex-basis for each flow child and break into lines.
  // Single-line (NoWrap) containers always get one line; multi-line containers
  // break when accumulated basis+margin+gap exceeds innerMainSize.
  for (const c of flowChildren) {
    c._flexBasis = computeFlexBasis(
      c,
      mainAxis,
      innerMainSize,
      innerCrossSize,
      crossMode,
      ownerW,
      ownerH,
    )
  }
  const lines: Node[][] = []
// 不换行容器、或者主轴尺寸不定（无法判断何时该换）、或者没有子节点时，恒为一行——尺寸不定时按一排无限长处理
  if (!isWrap || !isDefined(innerMainSize) || flowChildren.length === 0) {
    for (const c of flowChildren) c._lineIndex = 0
    lines.push(flowChildren)
  } else {
// 换行判定用的是「假设主轴尺寸」而不是原始 basis：规范第 9.3.5 节要求先按 min/max 夹紧再判是否超出行宽，直接用 basis 会让带 max-width 的项提前换行
    // Line-break decisions use the min/max-clamped basis (flexbox spec §9.3.5:
    // "hypothetical main size"), not the raw flex-basis.
    let lineStart = 0
    let lineLen = 0
    for (let i = 0; i < flowChildren.length; i++) {
      const c = flowChildren[i]!
      const hypo = boundAxis(c.style, isMainRow, c._flexBasis, ownerW, ownerH)
      const outer = Math.max(0, hypo) + childMarginForAxis(c, mainAxis, ownerW)
      const withGap = i > lineStart ? gapMain : 0
      if (i > lineStart && lineLen + withGap + outer > innerMainSize) {
        lines.push(flowChildren.slice(lineStart, i))
        lineStart = i
        lineLen = outer
      } else {
        lineLen += withGap + outer
      }
      c._lineIndex = lines.length
    }
    lines.push(flowChildren.slice(lineStart))
  }
  const lineCount = lines.length
// 基线布局只在 row 方向成立（垂直排布谈基线没有意义），且需要容器 align-items 为 baseline 或任一子节点 align-self 为 baseline；提前算一次，避免在两层循环里反复判断
  const isBaseline = isBaselineLayout(node, flowChildren)

  // STEP 2+3: For each line, resolve flexible lengths and lay out children to
  // measure cross sizes. Track per-line consumed main and max cross.
// 三张每行账本：主轴消耗量、交叉尺寸、基线布局时还要记最大 ascent。都用普通数组，行数通常小于 10，不值得上 TypedArray
  const lineConsumedMain: number[] = new Array(lineCount)
  const lineCrossSizes: number[] = new Array(lineCount)
  // Baseline layout tracks max ascent (baseline + leading margin) per line so
  // baseline-aligned items can be positioned at maxAscent - childBaseline.
  const lineMaxAscent: number[] = isBaseline ? new Array(lineCount).fill(0) : []
  let maxLineMain = 0
  let totalLinesCross = 0
// 逐行处理：先算出这一行所有 basis 加 margin 加 gap 的总和，作为弹性分配的起点
  for (let li = 0; li < lineCount; li++) {
    const line = lines[li]!
    const lineGap = line.length > 1 ? gapMain * (line.length - 1) : 0
    let lineBasis = lineGap
    for (const c of line) {
      lineBasis += c._flexBasis + childMarginForAxis(c, mainAxis, ownerW)
    }
// 容器主轴尺寸不定但有 min/max 时，先按「内容自然长度」与 min/max 的关系推一个可用主轴——内容超上限就用上限，不到下限就用下限，否则保持不定
    // Resolve flexible lengths against available inner main. For indefinite
    // containers with min/max, flex against the clamped size.
    let availMain = innerMainSize
    if (!isDefined(availMain)) {
      const mainOwner = isMainRow ? ownerWidth : ownerHeight
      const minM = resolveValue(
        isMainRow ? style.minWidth : style.minHeight,
        mainOwner,
      )
      const maxM = resolveValue(
        isMainRow ? style.maxWidth : style.maxHeight,
        mainOwner,
      )
      if (isDefined(maxM) && lineBasis > maxM - mainPadBorder) {
        availMain = Math.max(0, maxM - mainPadBorder)
      } else if (isDefined(minM) && lineBasis < minM - mainPadBorder) {
        availMain = Math.max(0, minM - mainPadBorder)
      }
    }
    resolveFlexibleLengths(
      line,
      availMain,
      lineBasis,
      isMainRow,
      ownerW,
      ownerH,
    )

// 本行内逐个测交叉尺寸：先看样式有没有显式交叉尺寸，再看是否单行 stretch，最后退到「不超过内框交叉尺寸」。三种情形的模式分别是 Exactly、Exactly、AtMost，差一个都会让子节点算错
    // Lay out each child in this line to measure cross
    let lineCross = 0
    for (const c of line) {
      const cStyle = c.style
      const childAlign =
        cStyle.alignSelf === Align.Auto ? style.alignItems : cStyle.alignSelf
      const cMarginCross = childMarginForAxis(c, crossAx, ownerW)
      let childCrossSize = NaN
      let childCrossMode: MeasureMode = MeasureMode.Undefined
      const resolvedCrossStyle = resolveValue(
        isMainRow ? cStyle.height : cStyle.width,
        isMainRow ? ownerH : ownerW,
      )
      const crossLeadE = isMainRow ? EDGE_TOP : EDGE_LEFT
      const crossTrailE = isMainRow ? EDGE_BOTTOM : EDGE_RIGHT
      const hasCrossAutoMargin =
        c._hasAutoMargin &&
        (isMarginAuto(cStyle.margin, crossLeadE) ||
          isMarginAuto(cStyle.margin, crossTrailE))
      // Single-line stretch goes directly to the container cross size.
      // Multi-line wrap measures intrinsic cross (Undefined mode) so
      // flex-grow grandchildren don't expand to the container — the line
      // cross size is determined first, then items are re-stretched.
// 多行换行时刻意用 Undefined 模式测内在交叉尺寸，而不是直接拉伸到容器：行高必须先由内容定下来，再让行内各项重新拉伸——否则行内带 flex-grow 的孙节点会先把行撑满整个容器，行高失去意义
      if (isDefined(resolvedCrossStyle)) {
        childCrossSize = resolvedCrossStyle
        childCrossMode = MeasureMode.Exactly
      } else if (
        childAlign === Align.Stretch &&
        !hasCrossAutoMargin &&
        !isWrap &&
        isDefined(innerCrossSize) &&
        crossMode === MeasureMode.Exactly
      ) {
        childCrossSize = Math.max(0, innerCrossSize - cMarginCross)
        childCrossMode = MeasureMode.Exactly
      } else if (!isWrap && isDefined(innerCrossSize)) {
        childCrossSize = Math.max(0, innerCrossSize - cMarginCross)
        childCrossMode = MeasureMode.AtMost
      }
      const cw = isMainRow ? c._mainSize : childCrossSize
      const ch = isMainRow ? childCrossSize : c._mainSize
      layoutNode(
        c,
        cw,
        ch,
        isMainRow ? MeasureMode.Exactly : childCrossMode,
        isMainRow ? childCrossMode : MeasureMode.Exactly,
        ownerW,
        ownerH,
        performLayout,
        isMainRow,
        !isMainRow,
      )
// 记下子节点实际拿到的交叉尺寸，行高取本行所有子节点（含交叉边距）的最大值
      c._crossSize = isMainRow ? c.layout.height : c.layout.width
      lineCross = Math.max(lineCross, c._crossSize + cMarginCross)
    }
    // Baseline layout: line cross size must fit maxAscent + maxDescent of
    // baseline-aligned children (yoga STEP 8). Only applies to row direction.
// 基线布局的行高还要单独抬一次：必须容纳本行内基线对齐项的最大 ascent + descent。这一步只对 row 方向有意义
    if (isBaseline) {
      let maxAscent = 0
      let maxDescent = 0
      for (const c of line) {
        if (resolveChildAlign(node, c) !== Align.Baseline) continue
        const mTop = resolveEdge(c.style.margin, EDGE_TOP, ownerW)
        const mBot = resolveEdge(c.style.margin, EDGE_BOTTOM, ownerW)
        const ascent = calculateBaseline(c) + mTop
        const descent = c.layout.height + mTop + mBot - ascent
        if (ascent > maxAscent) maxAscent = ascent
        if (descent > maxDescent) maxDescent = descent
      }
      lineMaxAscent[li] = maxAscent
      if (maxAscent + maxDescent > lineCross) {
        lineCross = maxAscent + maxDescent
      }
    }
// 直接读子节点算好的 layout.margin 而不再走 childMarginForAxis 重新解析——同一个 ownerW 下结果必然相同，重复解析纯粹浪费（每个子节点省两次 resolveEdge）
    // layoutNode(c) at line ~1117 above already resolved c.layout.margin[] via
    // resolveEdges4Into with the same ownerW — read directly instead of
    // re-resolving through childMarginForAxis → 2× resolveEdge.
    const mainLead = leadingEdge(mainAxis)
    const mainTrail = trailingEdge(mainAxis)
    let consumed = lineGap
    for (const c of line) {
      const cm = c.layout.margin
      consumed += c._mainSize + cm[mainLead]! + cm[mainTrail]!
    }
    lineConsumedMain[li] = consumed
    lineCrossSizes[li] = lineCross
    maxLineMain = Math.max(maxLineMain, consumed)
    totalLinesCross += lineCross
  }
  const totalCrossGap = lineCount > 1 ? gapCross * (lineCount - 1) : 0
  totalLinesCross += totalCrossGap

// STEP 4 定容器自身尺寸。这里有三种输入模式与两种溢出策略的组合，写成分层三目而不是 if 链，是为了让「Exactly 优先、Scroll 才钳制、否则按内容」这条优先级一眼可见
  // STEP 4: Determine container dimensions. Per yoga's STEP 9, for both
  // AtMost (FitContent) and Undefined (MaxContent) the node sizes to its
  // content — AtMost is NOT a hard clamp, items may overflow the available
  // space (CSS "fit-content" behavior). Only Scroll overflow clamps to the
  // available size. Wrap containers that broke into multiple lines under
  // AtMost fill the available main size since they wrapped at that boundary.
// 关键语义：AtMost（fit-content）不是硬上限，内容可以溢出；只有 overflow:scroll 才把尺寸钳到可用范围内。这一条区分了「建议尺寸」与「必须尺寸」
  const isScroll = style.overflow === Overflow.Scroll
  const contentMain = maxLineMain + mainPadBorder
  const finalMainSize =
    mainMode === MeasureMode.Exactly
      ? mainSize
      : mainMode === MeasureMode.AtMost && isScroll
        ? Math.max(Math.min(mainSize, contentMain), mainPadBorder)
        : isWrap && lineCount > 1 && mainMode === MeasureMode.AtMost
// 多行换行且模式为 AtMost 时直接采用可用主轴——因为换行就是在这个边界上发生的，此时内容总长必然超过可用值，按内容算会算出比可用值还大的容器
          ? mainSize
          : contentMain
  const contentCross = totalLinesCross + crossPadBorder
  const finalCrossSize =
    crossMode === MeasureMode.Exactly
      ? crossSize
      : crossMode === MeasureMode.AtMost && isScroll
        ? Math.max(Math.min(crossSize, contentCross), crossPadBorder)
        : contentCross
// 最终尺寸仍要过一遍 min/max 夹紧：内容算出来的尺寸可能违反自身声明的约束，这一步是兜底
  node.layout.width = boundAxis(
    style,
    true,
    isMainRow ? finalMainSize : finalCrossSize,
    ownerWidth,
    ownerHeight,
  )
  node.layout.height = boundAxis(
    style,
    false,
    isMainRow ? finalCrossSize : finalMainSize,
    ownerWidth,
    ownerHeight,
  )
  commitCacheOutputs(node, performLayout)
  // Write cache even for dirty nodes — fresh-mounted items during virtual scroll
  cacheWrite(
    node,
    availableWidth,
    availableHeight,
    widthMode,
    heightMode,
    ownerWidth,
    ownerHeight,
    forceWidth,
    forceHeight,
    wasDirty,
  )

// measure 趟到此为止：尺寸已定并写入缓存，但不再往下走定位。这是「测量」与「布局」两趟分离的分界点，也是缓存能分两套的原因
  if (!performLayout) return

// STEP 5 定位：先用最终尺寸倒推实际内框（可能与计算过程中用的内框不同，因为 min/max 夹紧改变了尺寸），再逐行摆子节点
  // STEP 5: Position lines (align-content) and children (justify-content +
  // align-items + auto margins).
  const actualInnerMain =
    (isMainRow ? node.layout.width : node.layout.height) - mainPadBorder
  const actualInnerCross =
    (isMainRow ? node.layout.height : node.layout.width) - crossPadBorder
  const mainLeadEdgePhys = leadingEdge(mainAxis)
  const mainTrailEdgePhys = trailingEdge(mainAxis)
  const crossLeadEdgePhys = isMainRow ? EDGE_TOP : EDGE_LEFT
  const crossTrailEdgePhys = isMainRow ? EDGE_BOTTOM : EDGE_RIGHT
  const reversed = isReverse(mainAxis)
  const mainContainerSize = isMainRow ? node.layout.width : node.layout.height
  const crossLead = pad[crossLeadEdgePhys]! + bor[crossLeadEdgePhys]!

  // Align-content: distribute free cross space among lines. Single-line
  // containers use the full cross size for the one line (align-items handles
  // positioning within it).
  let lineCrossOffset = crossLead
  let betweenLines = gapCross
// align-content 的剩余交叉空间：单行不换行且非基线时直接让那一行占满整个内框交叉尺寸（行内对齐交给 align-items），否则按六种取值分配
  const freeCross = actualInnerCross - totalLinesCross
  if (lineCount === 1 && !isWrap && !isBaseline) {
    lineCrossSizes[0] = actualInnerCross
  } else {
    const remCross = Math.max(0, freeCross)
    switch (style.alignContent) {
      case Align.FlexStart:
        break
      case Align.Center:
        lineCrossOffset += freeCross / 2
        break
      case Align.FlexEnd:
        lineCrossOffset += freeCross
        break
      case Align.Stretch:
        if (lineCount > 0 && remCross > 0) {
          const add = remCross / lineCount
          for (let i = 0; i < lineCount; i++) lineCrossSizes[i]! += add
        }
        break
      case Align.SpaceBetween:
        if (lineCount > 1) betweenLines += remCross / (lineCount - 1)
        break
      case Align.SpaceAround:
        if (lineCount > 0) {
          betweenLines += remCross / lineCount
          lineCrossOffset += remCross / lineCount / 2
        }
        break
      case Align.SpaceEvenly:
        if (lineCount > 0) {
          betweenLines += remCross / (lineCount + 1)
          lineCrossOffset += remCross / (lineCount + 1)
        }
        break
      default:
        break
    }
  }

// wrap-reverse 不改变行的生成顺序，而是在算交叉坐标时翻转：行的逻辑位置从交叉轴尾部开始堆叠。这样换行算法本身不用关心方向
  // For wrap-reverse, lines stack from the trailing cross edge. Walk lines in
  // order but flip the cross position within the container.
  const wrapReverse = style.flexWrap === Wrap.WrapReverse
  const crossContainerSize = isMainRow ? node.layout.height : node.layout.width
  let lineCrossPos = lineCrossOffset
  for (let li = 0; li < lineCount; li++) {
    const line = lines[li]!
    const lineCross = lineCrossSizes[li]!
    const consumedMain = lineConsumedMain[li]!
    const n = line.length

// 行高确定后重新拉伸一次：多行换行时初始测量不知道行高，单行且容器交叉尺寸不是 Exactly 时初始拉伸也被跳过了。两处都必须在这里补上
    // Re-stretch children whose cross is auto and align is stretch, now that
    // the line cross size is known. Needed for multi-line wrap (line cross
    // wasn't known during initial measure) AND single-line when the container
    // cross was not Exactly (initial stretch at ~line 1250 was skipped because
    // innerCrossSize wasn't defined — the container sized to max child cross).
    if (isWrap || crossMode !== MeasureMode.Exactly) {
      for (const c of line) {
        const cStyle = c.style
        const childAlign =
          cStyle.alignSelf === Align.Auto ? style.alignItems : cStyle.alignSelf
        const crossStyleDef = isDefined(
          resolveValue(
            isMainRow ? cStyle.height : cStyle.width,
            isMainRow ? ownerH : ownerW,
          ),
        )
        const hasCrossAutoMargin =
          c._hasAutoMargin &&
          (isMarginAuto(cStyle.margin, crossLeadEdgePhys) ||
            isMarginAuto(cStyle.margin, crossTrailEdgePhys))
// 重新拉伸的三个前提：对齐方式是 stretch、子节点没有显式交叉尺寸、没有交叉方向的 auto margin。任一不满足就不能动——尤其 auto margin 会把剩余空间吃掉，拉伸就没有意义
        if (
          childAlign === Align.Stretch &&
          !crossStyleDef &&
          !hasCrossAutoMargin
        ) {
          const cMarginCross = childMarginForAxis(c, crossAx, ownerW)
          const target = Math.max(0, lineCross - cMarginCross)
          if (c._crossSize !== target) {
            const cw = isMainRow ? c._mainSize : target
            const ch = isMainRow ? target : c._mainSize
            layoutNode(
              c,
              cw,
              ch,
              MeasureMode.Exactly,
              MeasureMode.Exactly,
              ownerW,
              ownerH,
              performLayout,
              isMainRow,
              !isMainRow,
            )
            c._crossSize = target
          }
        }
      }
    }

// justify-content 与 auto margin 是同一条主轴分配逻辑的两条分支：数出本行有多少个 auto margin，有就由它们瓜分剩余空间，没有才走 justify-content
    // Justify-content + auto margins for this line
    let mainOffset = pad[mainLeadEdgePhys]! + bor[mainLeadEdgePhys]!
    let betweenMain = gapMain
    let numAutoMarginsMain = 0
    for (const c of line) {
      if (!c._hasAutoMargin) continue
      if (isMarginAuto(c.style.margin, mainLeadEdgePhys)) numAutoMarginsMain++
      if (isMarginAuto(c.style.margin, mainTrailEdgePhys)) numAutoMarginsMain++
    }
    const freeMain = actualInnerMain - consumedMain
    const remainingMain = Math.max(0, freeMain)
// auto margin 优先于 justify-content——这是 CSS 的明确规定。每个 auto margin 分到的空间必须在所有 auto margin 之间均分，而不是每项均分
    const autoMarginMainSize =
      numAutoMarginsMain > 0 && remainingMain > 0
        ? remainingMain / numAutoMarginsMain
        : 0
    if (numAutoMarginsMain === 0) {
      switch (style.justifyContent) {
        case Justify.FlexStart:
          break
        case Justify.Center:
          mainOffset += freeMain / 2
          break
        case Justify.FlexEnd:
          mainOffset += freeMain
          break
        case Justify.SpaceBetween:
          if (n > 1) betweenMain += remainingMain / (n - 1)
          break
        case Justify.SpaceAround:
          if (n > 0) {
            betweenMain += remainingMain / n
            mainOffset += remainingMain / n / 2
          }
          break
        case Justify.SpaceEvenly:
          if (n > 0) {
            betweenMain += remainingMain / (n + 1)
            mainOffset += remainingMain / (n + 1)
          }
          break
      }
    }

// 计算实际交叉位置：wrap-reverse 时用「容器交叉尺寸减逻辑位置减本行尺寸」翻转，其余情况直接用逻辑位置
    const effectiveLineCrossPos = wrapReverse
      ? crossContainerSize - lineCrossPos - lineCross
      : lineCrossPos

    let pos = mainOffset
    for (const c of line) {
      const cMargin = c.style.margin
      // c.layout.margin[] was populated by resolveEdges4Into inside the
      // layoutNode(c) call above (same ownerW). Read resolved values directly
      // instead of re-running the edge fallback chain 4× via resolveEdge.
      // Auto margins resolve to 0 in layout.margin, so autoMarginMainSize
      // substitution still uses the isMarginAuto check against style.
      const cLayoutMargin = c.layout.margin
      let autoMainLead = false
      let autoMainTrail = false
      let autoCrossLead = false
      let autoCrossTrail = false
      let mMainLead: number
      let mMainTrail: number
      let mCrossLead: number
      let mCrossTrail: number
      if (c._hasAutoMargin) {
        autoMainLead = isMarginAuto(cMargin, mainLeadEdgePhys)
        autoMainTrail = isMarginAuto(cMargin, mainTrailEdgePhys)
        autoCrossLead = isMarginAuto(cMargin, crossLeadEdgePhys)
        autoCrossTrail = isMarginAuto(cMargin, crossTrailEdgePhys)
        mMainLead = autoMainLead
          ? autoMarginMainSize
          : cLayoutMargin[mainLeadEdgePhys]!
        mMainTrail = autoMainTrail
          ? autoMarginMainSize
          : cLayoutMargin[mainTrailEdgePhys]!
        mCrossLead = autoCrossLead ? 0 : cLayoutMargin[crossLeadEdgePhys]!
        mCrossTrail = autoCrossTrail ? 0 : cLayoutMargin[crossTrailEdgePhys]!
      } else {
        // Fast path: no auto margins — read resolved values directly.
        mMainLead = cLayoutMargin[mainLeadEdgePhys]!
        mMainTrail = cLayoutMargin[mainTrailEdgePhys]!
        mCrossLead = cLayoutMargin[crossLeadEdgePhys]!
        mCrossTrail = cLayoutMargin[crossTrailEdgePhys]!
      }

// 反向主轴从容器尾部倒推：位置从主轴起点累加，但落位时用「容器尺寸减起点位置减自身尺寸」。累加方向不变，只是落位镜像
      const mainPos = reversed
        ? mainContainerSize - (pos + mMainLead) - c._mainSize
        : pos + mMainLead

      const childAlign =
        c.style.alignSelf === Align.Auto ? style.alignItems : c.style.alignSelf
// 交叉对齐先算剩余空间，再按四种情形处理：两侧都 auto 则居中、仅前 auto 则靠后、仅后 auto 则保持靠前（注释里写「stays at leading」）、都没有才看 align
      let crossPos = effectiveLineCrossPos + mCrossLead
      const crossFree = lineCross - c._crossSize - mCrossLead - mCrossTrail
      if (autoCrossLead && autoCrossTrail) {
        crossPos += Math.max(0, crossFree) / 2
      } else if (autoCrossLead) {
        crossPos += Math.max(0, crossFree)
      } else if (autoCrossTrail) {
        // stays at leading
      } else {
        switch (childAlign) {
          case Align.FlexStart:
          case Align.Stretch:
            if (wrapReverse) crossPos += crossFree
            break
          case Align.Center:
            crossPos += crossFree / 2
            break
          case Align.FlexEnd:
            if (!wrapReverse) crossPos += crossFree
            break
// 基线对齐：子节点的 baseline 要对齐到本行的最大 ascent，所以它的顶部位置等于行起点加最大 ascent 减自身 baseline。只有 row 方向会进来
          case Align.Baseline:
            // Row direction only (isBaselineLayout checked this). Position so
            // the child's baseline aligns with the line's max ascent. Per
            // yoga: top = currentLead + maxAscent - childBaseline + leadingPosition.
            if (isBaseline) {
              crossPos =
                effectiveLineCrossPos +
                lineMaxAscent[li]! -
                calculateBaseline(c)
            }
            break
          default:
            break
        }
      }

      // Relative position offsets. Fast path: no position insets set →
      // skip 4× resolveEdgeRaw + 4× resolveValue + 4× isDefined.
// 相对定位偏移：同时给了 left 和 right 时以 left 为准，只给 right 时取负值。整段被 _hasPosition 包裹，没设过内缩值的节点不付这四次解析的代价
      let relX = 0
      let relY = 0
      if (c._hasPosition) {
        const relLeft = resolveValue(
          resolveEdgeRaw(c.style.position, EDGE_LEFT),
          ownerW,
        )
        const relRight = resolveValue(
          resolveEdgeRaw(c.style.position, EDGE_RIGHT),
          ownerW,
        )
        const relTop = resolveValue(
          resolveEdgeRaw(c.style.position, EDGE_TOP),
          ownerW,
        )
        const relBottom = resolveValue(
          resolveEdgeRaw(c.style.position, EDGE_BOTTOM),
          ownerW,
        )
        relX = isDefined(relLeft)
          ? relLeft
          : isDefined(relRight)
            ? -relRight
            : 0
        relY = isDefined(relTop)
          ? relTop
          : isDefined(relBottom)
            ? -relBottom
            : 0
      }

// 主轴与交叉轴的结果按方向落回物理 left/top：水平主轴时主轴结果进 left、交叉结果进 top，垂直主轴时反过来。整段算法与方向无关的关键就在这一次交换
      if (isMainRow) {
        c.layout.left = mainPos + relX
        c.layout.top = crossPos + relY
      } else {
        c.layout.left = crossPos + relX
        c.layout.top = mainPos + relY
      }
// 推进主轴游标：加上自身主轴尺寸、两端外边距、以及项间距。betweenMain 在 justify-content 分配后已经含了额外间距
      pos += c._mainSize + mMainLead + mMainTrail + betweenMain
    }
    lineCrossPos += lineCross + betweenLines
  }

// STEP 6 绝对定位子节点：它们不参与流式布局，所以在所有流式子节点定位完之后单独处理
  // STEP 6: Absolute-positioned children
  for (const c of absChildren) {
    layoutAbsoluteChild(
      node,
      c,
      node.layout.width,
      node.layout.height,
      pad,
      bor,
    )
  }
}

// layoutAbsoluteChild 处理绝对定位：先解析四个方向的内缩值（百分比以父的尺寸为基准），再解尺寸，然后布局子节点，最后按「有内缩用内缩、没内缩用对齐」定位
function layoutAbsoluteChild(
  parent: Node,
  child: Node,
  parentWidth: number,
  parentHeight: number,
  pad: [number, number, number, number],
  bor: [number, number, number, number],
): void {
  const cs = child.style
  const posLeft = resolveEdgeRaw(cs.position, EDGE_LEFT)
  const posRight = resolveEdgeRaw(cs.position, EDGE_RIGHT)
  const posTop = resolveEdgeRaw(cs.position, EDGE_TOP)
  const posBottom = resolveEdgeRaw(cs.position, EDGE_BOTTOM)

  const rLeft = resolveValue(posLeft, parentWidth)
  const rRight = resolveValue(posRight, parentWidth)
  const rTop = resolveValue(posTop, parentHeight)
  const rBottom = resolveValue(posBottom, parentHeight)

// 绝对定位子节点的百分比尺寸以父的 padding-box 为基准（父尺寸减边框），这是 CSS 第 10.1 节的规定；用父的 content-box 会差一个 padding
  // Absolute children's percentage dimensions resolve against the containing
  // block's padding-box (parent size minus border), per CSS §10.1.
  const paddingBoxW = parentWidth - bor[0] - bor[2]
  const paddingBoxH = parentHeight - bor[1] - bor[3]
  let cw = resolveValue(cs.width, paddingBoxW)
  let ch = resolveValue(cs.height, paddingBoxH)

// 左右内缩都给了但没给宽度时反推宽度：可用宽度减左右内缩。这是绝对定位的经典用法「撑满两侧」
  // If both left+right defined and width not, derive width
  if (!isDefined(cw) && isDefined(rLeft) && isDefined(rRight)) {
    cw = paddingBoxW - rLeft - rRight
  }
  if (!isDefined(ch) && isDefined(rTop) && isDefined(rBottom)) {
    ch = paddingBoxH - rTop - rBottom
  }

  layoutNode(
    child,
    cw,
    ch,
    isDefined(cw) ? MeasureMode.Exactly : MeasureMode.Undefined,
    isDefined(ch) ? MeasureMode.Exactly : MeasureMode.Undefined,
    paddingBoxW,
    paddingBoxH,
    true,
  )

// 外边距在定位之后还要再叠加一次：内缩值决定的是盒子的边缘位置，外边距把盒子往里推。两者是相加关系
  // Margin of absolute child (applied in addition to insets)
  const mL = resolveEdge(cs.margin, EDGE_LEFT, parentWidth)
  const mT = resolveEdge(cs.margin, EDGE_TOP, parentWidth)
  const mR = resolveEdge(cs.margin, EDGE_RIGHT, parentWidth)
  const mB = resolveEdge(cs.margin, EDGE_BOTTOM, parentWidth)

  const mainAxis = parent.style.flexDirection
  const reversed = isReverse(mainAxis)
  const mainRow = isRow(mainAxis)
  const wrapReverse = parent.style.flexWrap === Wrap.WrapReverse
  // alignSelf overrides alignItems for absolute children (same as flow items)
  const alignment =
    cs.alignSelf === Align.Auto ? parent.style.alignItems : cs.alignSelf

// left 的五个分支按优先级：有左内缩用左内缩、有右内缩从右边倒推、主轴水平时走 justify-content、主轴垂直时走交叉对齐。方向不同走的是完全不同的分配函数
  // Position
  let left: number
  if (isDefined(rLeft)) {
    left = bor[0] + rLeft + mL
  } else if (isDefined(rRight)) {
    left = parentWidth - bor[2] - rRight - child.layout.width - mR
  } else if (mainRow) {
    // Main axis — justify-content, flipped for reversed
    const lead = pad[0] + bor[0]
    const trail = parentWidth - pad[2] - bor[2]
    left = reversed
      ? trail - child.layout.width - mR
      : justifyAbsolute(
          parent.style.justifyContent,
          lead,
          trail,
          child.layout.width,
        ) + mL
  } else {
    left =
      alignAbsolute(
        alignment,
        pad[0] + bor[0],
        parentWidth - pad[2] - bor[2],
        child.layout.width,
        wrapReverse,
      ) + mL
  }

// top 的五个分支与 left 完全镜像：主轴垂直时走 justify-content，主轴水平时走交叉对齐。两段代码几乎对称，但合并会引入方向判断，反而更慢
  let top: number
  if (isDefined(rTop)) {
    top = bor[1] + rTop + mT
  } else if (isDefined(rBottom)) {
    top = parentHeight - bor[3] - rBottom - child.layout.height - mB
  } else if (mainRow) {
    top =
      alignAbsolute(
        alignment,
        pad[1] + bor[1],
        parentHeight - pad[3] - bor[3],
        child.layout.height,
        wrapReverse,
      ) + mT
  } else {
    const lead = pad[1] + bor[1]
    const trail = parentHeight - pad[3] - bor[3]
    top = reversed
      ? trail - child.layout.height - mB
      : justifyAbsolute(
          parent.style.justifyContent,
          lead,
          trail,
          child.layout.height,
        ) + mT
  }

  child.layout.left = left
  child.layout.top = top
}

// justifyAbsolute 只处理三种情形：居中、靠尾、其余（含 space-* 全部退化为靠头）。绝对定位的单项没有「之间」的概念，空间分布类取值全部无意义
function justifyAbsolute(
  justify: Justify,
  leadEdge: number,
  trailEdge: number,
  childSize: number,
): number {
  switch (justify) {
    case Justify.Center:
      return leadEdge + (trailEdge - leadEdge - childSize) / 2
    case Justify.FlexEnd:
      return trailEdge - childSize
    default:
      return leadEdge
  }
}

// alignAbsolute 在 wrap-reverse 下把 flex-start 与 flex-end 互换：反转换行改变了交叉轴的物理方向，但绝对定位的子节点不该跟着换，所以这里主动抵消
function alignAbsolute(
  align: Align,
  leadEdge: number,
  trailEdge: number,
  childSize: number,
  wrapReverse: boolean,
): number {
  // Wrap-reverse flips the cross axis: flex-start/stretch go to trailing,
  // flex-end goes to leading (yoga's absoluteLayoutChild flips the align value
  // when the containing block has wrap-reverse).
  switch (align) {
    case Align.Center:
      return leadEdge + (trailEdge - leadEdge - childSize) / 2
    case Align.FlexEnd:
      return wrapReverse ? leadEdge : trailEdge - childSize
    default:
      return wrapReverse ? trailEdge - childSize : leadEdge
  }
}

// computeFlexBasis 决定子节点在主轴上想要多大。四级回退的顺序就是规范规定的顺序：显式 basis → 主轴样式尺寸 → 交给子节点自己测 → 0
function computeFlexBasis(
  child: Node,
  mainAxis: FlexDirection,
  availableMain: number,
  availableCross: number,
  crossMode: MeasureMode,
  ownerWidth: number,
  ownerHeight: number,
): number {
  // Same-generation cache hit: basis was computed THIS calculateLayout, so
  // it's fresh regardless of isDirty_. Covers both clean children (scrolling
  // past unchanged messages) AND fresh-mounted dirty children (virtual
  // scroll mounts new items — the dirty chain's measure→layout cascade
  // invokes this ≥2^depth times, but the child's subtree doesn't change
  // between calls within one calculateLayout). For clean children with
  // cache from a PREVIOUS generation, also hit if inputs match — isDirty_
  // gates since a dirty child's previous-gen cache is stale.
  const sameGen = child._fbGen === _generation
  if (
    (sameGen || !child.isDirty_) &&
    child._fbCrossMode === crossMode &&
    sameFloat(child._fbOwnerW, ownerWidth) &&
    sameFloat(child._fbOwnerH, ownerHeight) &&
    sameFloat(child._fbAvailMain, availableMain) &&
    sameFloat(child._fbAvailCross, availableCross)
  ) {
    return child._fbBasis
  }
  const cs = child.style
  const isMainRow = isRow(mainAxis)

// 显式 flex-basis 权重最高，负值按零处理；算完立刻写六字段缓存并盖代际戳，后续同一趟内的重复调用直接命中
  // Explicit flex-basis
  const basis = resolveValue(cs.flexBasis, availableMain)
  if (isDefined(basis)) {
    const b = Math.max(0, basis)
    child._fbBasis = b
    child._fbOwnerW = ownerWidth
    child._fbOwnerH = ownerHeight
    child._fbAvailMain = availableMain
    child._fbAvailCross = availableCross
    child._fbCrossMode = crossMode
    child._fbGen = _generation
    return b
  }

// 没有显式 basis 就看主轴方向的样式尺寸（row 看 width、column 看 height），这一层不需要递归
  // Style dimension on main axis
  const mainStyleDim = isMainRow ? cs.width : cs.height
  const mainOwner = isMainRow ? ownerWidth : ownerHeight
  const resolved = resolveValue(mainStyleDim, mainOwner)
  if (isDefined(resolved)) {
    const b = Math.max(0, resolved)
    child._fbBasis = b
    child._fbOwnerW = ownerWidth
    child._fbOwnerH = ownerHeight
    child._fbAvailMain = availableMain
    child._fbAvailCross = availableCross
    child._fbCrossMode = crossMode
    child._fbGen = _generation
    return b
  }

// 两层都没有就必须实测：把交叉轴方向的约束准备好，再递归调一次 layoutNode（performLayout=false，纯测量）
  // Need to measure the child to get its natural size
  const crossStyleDim = isMainRow ? cs.height : cs.width
  const crossOwner = isMainRow ? ownerHeight : ownerWidth
  let crossConstraint = resolveValue(crossStyleDim, crossOwner)
  let crossConstraintMode: MeasureMode = isDefined(crossConstraint)
    ? MeasureMode.Exactly
    : MeasureMode.Undefined
  if (!isDefined(crossConstraint) && isDefined(availableCross)) {
    crossConstraint = availableCross
    crossConstraintMode =
      crossMode === MeasureMode.Exactly && isStretchAlign(child)
        ? MeasureMode.Exactly
        : MeasureMode.AtMost
  }

// 上游 YGNodeComputeFlexBasisForChild 在子树里有测量函数时，会把可用主轴以 AtMost 传下去——否则文本节点会报出不受约束的自然宽度作为 basis，把兄弟节点挤扁、并在错误的宽度处换行。Ink 曾经就是这里的 <Text> 在 flexGrow 容器里宽度取成内在宽度，换行边界掉字符
  // Upstream yoga (YGNodeComputeFlexBasisForChild) passes the available inner
  // width with mode AtMost when the subtree will call a measure-func — so text
  // nodes don't report unconstrained intrinsic width as flex-basis, which
  // would force siblings to shrink and the text to wrap at the wrong width.
  // Passing Undefined here made Ink's <Text> inside <Box flexGrow={1}> get
  // width = intrinsic instead of available, dropping chars at wrap boundaries.
  //
  // Two constraints on when this applies:
  //   - Width only. Height is never constrained during basis measurement —
  //     column containers must measure children at natural height so
  //     scrollable content can overflow (constraining height clips ScrollBox).
  //   - Subtree has a measure-func. Pure layout subtrees (no measure-func)
  //     with flex-grow children would grow into the AtMost constraint,
  //     inflating the basis (breaks YGMinMaxDimensionTest flex_grow_in_at_most
  //     where a flexGrow:1 child should stay at basis 0, not grow to 100).
// 这个约束有两个限制条件：只管宽度（高度一旦被约束，可滚动内容就溢不出来，ScrollBox 会被裁掉），且只对含测量函数的子树生效（纯布局子树的 flexGrow 子节点会顺着 AtMost 长满，把 basis 撑大，破坏 flex_grow_in_at_most 这类规范的测试）
  let mainConstraint = NaN
  let mainConstraintMode: MeasureMode = MeasureMode.Undefined
  if (isMainRow && isDefined(availableMain) && hasMeasureFuncInSubtree(child)) {
    mainConstraint = availableMain
    mainConstraintMode = MeasureMode.AtMost
  }

  const mw = isMainRow ? mainConstraint : crossConstraint
  const mh = isMainRow ? crossConstraint : mainConstraint
  const mwMode = isMainRow ? mainConstraintMode : crossConstraintMode
  const mhMode = isMainRow ? crossConstraintMode : mainConstraintMode

// 注意这次递归传的是 performLayout=false：只测尺寸、不做定位。basis 计算阶段反正是要重排的，这里定位纯属浪费
  layoutNode(child, mw, mh, mwMode, mhMode, ownerWidth, ownerHeight, false)
  const b = isMainRow ? child.layout.width : child.layout.height
  child._fbBasis = b
  child._fbOwnerW = ownerWidth
  child._fbOwnerH = ownerHeight
  child._fbAvailMain = availableMain
  child._fbAvailCross = availableCross
  child._fbCrossMode = crossMode
  child._fbGen = _generation
  return b
}

// hasMeasureFuncInSubtree 是上面那条规则的判据：子树里只要有一个测量函数就要按文本容器的规则处理。递归没做记忆化，因为子树深度通常很小
function hasMeasureFuncInSubtree(node: Node): boolean {
  if (node.measureFunc) return true
  for (const c of node.children) {
    if (hasMeasureFuncInSubtree(c)) return true
  }
  return false
}

// resolveFlexibleLengths 实现规范第 9.7 节「解析弹性长度」：分配剩余空间、检测 min/max 违例、冻结所有违例项、在未冻结项之间重新分配，反复直到稳定
function resolveFlexibleLengths(
  children: Node[],
  availableInnerMain: number,
  totalFlexBasis: number,
  isMainRow: boolean,
  ownerW: number,
  ownerH: number,
): void {
  // Multi-pass flex distribution per CSS flexbox spec §9.7 "Resolving Flexible
  // Lengths": distribute free space, detect min/max violations, freeze all
  // violators, redistribute among unfrozen children. Repeat until stable.
  const n = children.length
  const frozen: boolean[] = new Array(n).fill(false)
  const initialFree = isDefined(availableInnerMain)
    ? availableInnerMain - totalFlexBasis
    : 0
// 第一轮先冻结不参与伸缩的项：主轴尺寸不定（没得分配）、或者剩余空间为正但 flexGrow 为 0、或者剩余为负但 flexShrink 为 0。冻结项直接取夹紧后的 basis
  // Freeze inflexible items at their clamped basis
  for (let i = 0; i < n; i++) {
    const c = children[i]!
    const clamped = boundAxis(c.style, isMainRow, c._flexBasis, ownerW, ownerH)
    const inflexible =
      !isDefined(availableInnerMain) ||
      (initialFree >= 0 ? c.style.flexGrow === 0 : c.style.flexShrink === 0)
    if (inflexible) {
      c._mainSize = Math.max(0, clamped)
      frozen[i] = true
    } else {
      c._mainSize = c._flexBasis
    }
  }
// 迭代分配，最多 n+1 轮（每轮至少冻结一个，必然收敛）：每轮重算「初始剩余空间减去已冻结项相对 basis 的增量」，这才是规范要求的做法——静态地减一次会在多轮冻结后算错
  // Iteratively distribute until no violations. Free space is recomputed each
  // pass: initial free space minus the delta frozen children consumed beyond
  // (or below) their basis.
  const unclamped: number[] = new Array(n)
  for (let iter = 0; iter <= n; iter++) {
    let frozenDelta = 0
    let totalGrow = 0
    let totalShrinkScaled = 0
    let unfrozenCount = 0
    for (let i = 0; i < n; i++) {
      const c = children[i]!
      if (frozen[i]) {
        frozenDelta += c._mainSize - c._flexBasis
      } else {
        totalGrow += c.style.flexGrow
        totalShrinkScaled += c.style.flexShrink * c._flexBasis
        unfrozenCount++
      }
    }
    if (unfrozenCount === 0) break
    let remaining = initialFree - frozenDelta
// 规范第 9.7 节第 4c 步：flex 因子之和小于 1 时只分配「初始剩余空间乘以因子和」而不是全部剩余空间，这样 flex:0.5 的项真的只吃一半空间
    // Spec §9.7 step 4c: if sum of flex factors < 1, only distribute
    // initialFree × sum, not the full remaining space (partial flex).
    if (remaining > 0 && totalGrow > 0 && totalGrow < 1) {
      const scaled = initialFree * totalGrow
      if (scaled < remaining) remaining = scaled
    } else if (remaining < 0 && totalShrinkScaled > 0) {
      let totalShrink = 0
      for (let i = 0; i < n; i++) {
        if (!frozen[i]) totalShrink += children[i]!.style.flexShrink
      }
      if (totalShrink < 1) {
        const scaled = initialFree * totalShrink
        if (scaled > remaining) remaining = scaled
      }
    }
    // Compute targets + violations for all unfrozen children
    let totalViolation = 0
    for (let i = 0; i < n; i++) {
      if (frozen[i]) continue
      const c = children[i]!
      let t = c._flexBasis
      if (remaining > 0 && totalGrow > 0) {
        t += (remaining * c.style.flexGrow) / totalGrow
      } else if (remaining < 0 && totalShrinkScaled > 0) {
        t +=
          (remaining * (c.style.flexShrink * c._flexBasis)) / totalShrinkScaled
      }
      unclamped[i] = t
      const clamped = Math.max(
        0,
        boundAxis(c.style, isMainRow, t, ownerW, ownerH),
      )
      c._mainSize = clamped
      totalViolation += clamped - t
    }
// 按违例符号冻结：总违例为正（有项撞了下限）就冻结所有撞下限的，为负（撞上限）就冻结撞上限的。冻结后进入下一轮重新分配——这就是多趟夹紧的实质
    // Freeze per spec §9.7 step 5: if totalViolation is zero freeze all; if
    // positive freeze min-violators; if negative freeze max-violators.
    if (totalViolation === 0) break
    let anyFrozen = false
    for (let i = 0; i < n; i++) {
      if (frozen[i]) continue
      const v = children[i]!._mainSize - unclamped[i]!
      if ((totalViolation > 0 && v > 0) || (totalViolation < 0 && v < 0)) {
        frozen[i] = true
        anyFrozen = true
      }
    }
    if (!anyFrozen) break
  }
}

// isStretchAlign 只用于判断「basis 测量时交叉轴该用 Exactly 还是 AtMost」：拉伸对齐的项可以按容器尺寸硬测，其余只能给上限
function isStretchAlign(child: Node): boolean {
  const p = child.parent
  if (!p) return false
  const align =
    child.style.alignSelf === Align.Auto
      ? p.style.alignItems
      : child.style.alignSelf
  return align === Align.Stretch
}

// resolveChildAlign 把 align-self 为 Auto 的节点回退到父的 align-items。全文件有多处需要这条回退，抽出来避免每处各写一遍三目
function resolveChildAlign(parent: Node, child: Node): Align {
  return child.style.alignSelf === Align.Auto
    ? parent.style.alignItems
    : child.style.alignSelf
}

// calculateBaseline 按 CSS 第 8.5 节实现：叶子节点用自己的高度当基线；容器递归进第一个基线对齐的子节点（没有基线对齐项就取第一个流式子节点），返回它的基线加上它的 top 偏移
// Baseline of a node per CSS Flexbox §8.5 / yoga's YGBaseline. Leaf nodes
// (no children) use their own height. Containers recurse into the first
// baseline-aligned child on the first line (or the first flow child if none
// are baseline-aligned), returning that child's baseline + its top offset.
function calculateBaseline(node: Node): number {
  let baselineChild: Node | null = null
  for (const c of node.children) {
    if (c._lineIndex > 0) break
// 只看第一行的子节点：`c._lineIndex > 0` 就 break，因为多行容器的基线由第一行决定，后面的行不参与
    if (c.style.positionType === PositionType.Absolute) continue
    if (c.style.display === Display.None) continue
    if (
      resolveChildAlign(node, c) === Align.Baseline ||
      c.isReferenceBaseline_
    ) {
      baselineChild = c
      break
    }
    if (baselineChild === null) baselineChild = c
  }
  if (baselineChild === null) return node.layout.height
  return calculateBaseline(baselineChild) + baselineChild.layout.top
}

// A container uses baseline layout only for row direction, when either
// align-items is baseline or any flow child has align-self: baseline.
// isBaselineLayout 提前判定整个容器是否需要基线布局：必须 row 方向，且容器或某个流式子节点声明了 baseline。提前算一次避免在逐行循环里重复判断
function isBaselineLayout(node: Node, flowChildren: Node[]): boolean {
  if (!isRow(node.style.flexDirection)) return false
  if (node.style.alignItems === Align.Baseline) return true
  for (const c of flowChildren) {
    if (c.style.alignSelf === Align.Baseline) return true
  }
  return false
}

// childMarginForAxis 返回子节点在某轴两端的边距之和；没有设置过任何 margin（_hasMargin 为 false）时直接返回 0，省掉两次边解析
function childMarginForAxis(
  child: Node,
  axis: FlexDirection,
  ownerWidth: number,
): number {
  if (!child._hasMargin) return 0
  const lead = resolveEdge(child.style.margin, leadingEdge(axis), ownerWidth)
  const trail = resolveEdge(child.style.margin, trailingEdge(axis), ownerWidth)
  return lead + trail
}

// resolveGap 先看具体方向的槽，未定义再回退到 all 槽；负值夹到零——gap 为负在 CSS 里无效
function resolveGap(style: Style, gutter: Gutter, ownerSize: number): number {
  let v = style.gap[gutter]!
  if (v.unit === Unit.Undefined) v = style.gap[Gutter.All]!
  const r = resolveValue(v, ownerSize)
  return isDefined(r) ? Math.max(0, r) : 0
}

// boundAxis 施加 min/max 约束。注意 max 先于 min 施加：当 min 大于 max 时以 min 为准，这是 CSS 的规定
function boundAxis(
  style: Style,
  isWidth: boolean,
  value: number,
  ownerWidth: number,
  ownerHeight: number,
): number {
  const minV = isWidth ? style.minWidth : style.minHeight
  const maxV = isWidth ? style.maxWidth : style.maxHeight
  const minU = minV.unit
  const maxU = maxV.unit
// 快速路径：两个约束都没设置时原样返回。1000 节点基准上每趟约 3.2 万次调用，几乎全部走这条路径，省掉的是两次 resolveValue 加两次 isNaN
  // Fast path: no min/max constraints set. Per CPU profile this is the
  // overwhelmingly common case (~32k calls/layout on the 1000-node bench,
  // nearly all with undefined min/max) — skipping 2× resolveValue + 2× isNaN
  // that always no-op. Unit.Undefined = 0.
  if (minU === 0 && maxU === 0) return value
  const owner = isWidth ? ownerWidth : ownerHeight
  let v = value
  // Inlined resolveValue: Unit.Point=1, Unit.Percent=2. `m === m` is !isNaN.
// 内联了 resolveValue 的两个分支并用 `m === m` 代替 !isNaN：这段是纯热点优化，语义与调用函数完全等价
  if (maxU === 1) {
    if (v > maxV.value) v = maxV.value
  } else if (maxU === 2) {
    const m = (maxV.value * owner) / 100
    if (m === m && v > m) v = m
  }
  if (minU === 1) {
    if (v < minV.value) v = minV.value
  } else if (minU === 2) {
    const m = (minV.value * owner) / 100
    if (m === m && v < m) v = m
  }
  return v
}

// zeroLayoutRecursive 把子树全部尺寸与位置清零，用于 display:none 的隐藏节点与 display:contents 的盒子
function zeroLayoutRecursive(node: Node): void {
  for (const c of node.children) {
    c.layout.left = 0
    c.layout.top = 0
    c.layout.width = 0
    c.layout.height = 0
// 清零的同时必须标脏并作废单槽缓存：否则从隐藏改回可见时，calculateLayout 会发现这个子节点是干净的、_hasL 完好，于是在缓存处提前返回，跳过子节点定位递归——孙节点还停在上面的全零状态，渲染出来是隐形的。标脏同时也让 _cN 与 _fbBasis 因为「同代际或干净」的条件而不命中
    // Invalidate layout cache — without this, unhide → calculateLayout finds
    // the child clean (!isDirty_) with _hasL intact, hits the cache at line
    // ~1086, restores stale _lOutW/_lOutH, and returns early — skipping the
    // child-positioning recursion. Grandchildren stay at (0,0,0,0) from the
    // zeroing above and render invisible. isDirty_=true also gates _cN and
    // _fbBasis via their (sameGen || !isDirty_) checks — _cGen/_fbGen freeze
    // during hide so sameGen is false on unhide.
    c.isDirty_ = true
    c._hasL = false
    c._hasM = false
    zeroLayoutRecursive(c)
  }
}

// collectLayoutChildren 把子节点分成流式与绝对定位两类，并把 display:contents 的子树拍平：这种节点的盒子被移除，但它的子节点保留并提升到祖父的列表里，递归处理多层嵌套
function collectLayoutChildren(node: Node, flow: Node[], abs: Node[]): void {
  // Partition a node's children into flow and absolute lists, flattening
  // display:contents subtrees so their children are laid out as direct
  // children of this node (per CSS display:contents spec — the box is removed
  // from the layout tree but its children remain, lifted to the grandparent).
  for (const c of node.children) {
    const disp = c.style.display
    if (disp === Display.None) {
      c.layout.left = 0
      c.layout.top = 0
      c.layout.width = 0
      c.layout.height = 0
      zeroLayoutRecursive(c)
    } else if (disp === Display.Contents) {
      c.layout.left = 0
      c.layout.top = 0
      c.layout.width = 0
      c.layout.height = 0
      // Recurse — nested display:contents lifts all the way up. The contents
      // node's own margin/padding/position/dimensions are ignored.
      collectLayoutChildren(c, flow, abs)
// 注意三类判定有先后顺序：先判 display（none 与 contents 都优先），再判定位方式。一个 display:contents 且绝对定位的节点会被当作 contents 拍平，而不是当绝对定位项——这个优先级与 CSS 一致
    } else if (c.style.positionType === PositionType.Absolute) {
      abs.push(c)
    } else {
      flow.push(c)
    }
  }
}

// roundLayout 做像素网格舍入：scale 为 0 表示关闭舍入。整棵树自顶向下传绝对坐标，原因是宽高要用「绝对右下角减绝对左上角」算，避免逐层舍入累积漂移
function roundLayout(
  node: Node,
  scale: number,
  absLeft: number,
  absTop: number,
): void {
  if (scale === 0) return
  const l = node.layout
  const nodeLeft = l.left
  const nodeTop = l.top
  const nodeWidth = l.width
  const nodeHeight = l.height

  const absNodeLeft = absLeft + nodeLeft
  const absNodeTop = absTop + nodeTop

// 文本节点与非文本节点舍入方式不同（对齐上游 PixelGrid.cpp）：文本的位置向下取整，保证换行的文字绝不会从分配到的列之后再开始；宽度用「有小数就向上取整」，避免裁掉最后一个字形。其余节点走标准四舍五入——不加这个区分的话，justify 居中与 space-evenly 的位置会与 WASM 版差一个字符格，flex-shrink 溢出时兄弟节点会落到错误的列
  // Upstream YGRoundValueToPixelGrid: text nodes (has measureFunc) floor their
  // positions so wrapped text never starts past its allocated column. Width
  // uses ceil-if-fractional to avoid clipping the last glyph. Non-text nodes
  // use standard round. Matches yoga's PixelGrid.cpp — without this, justify
  // center/space-evenly positions are off-by-one vs WASM and flex-shrink
  // overflow places siblings at the wrong column.
  const isText = node.measureFunc !== null
  l.left = roundValue(nodeLeft, scale, false, isText)
  l.top = roundValue(nodeTop, scale, false, isText)

// 宽高不是直接舍入，而是先算绝对右下角、舍入后再减去舍入后的左上角。这样同一行相邻两个盒子共享一条边时不会出现一像素缝隙或重叠
  // Width/height rounded via absolute edges to avoid cumulative drift
  const absRight = absNodeLeft + nodeWidth
  const absBottom = absNodeTop + nodeHeight
  const hasFracW = !isWholeNumber(nodeWidth * scale)
  const hasFracH = !isWholeNumber(nodeHeight * scale)
  l.width =
    roundValue(absRight, scale, isText && hasFracW, isText && !hasFracW) -
    roundValue(absNodeLeft, scale, false, isText)
  l.height =
    roundValue(absBottom, scale, isText && hasFracH, isText && !hasFracH) -
    roundValue(absNodeTop, scale, false, isText)

  for (const c of node.children) {
    roundLayout(c, scale, absNodeLeft, absNodeTop)
  }
}

// isWholeNumber 用 1e-4 的容差判断是否「已经是整数」，而不是严格比较——浮点乘法后 3 会变成 2.9999999996，严格比较会把整数误判成小数
function isWholeNumber(v: number): boolean {
  const frac = v - Math.floor(v)
  return frac < 0.0001 || frac > 0.9999
}

// roundValue 是像素舍入的原子操作：先乘 scale，取小数部分，再用 1e-4 容差对齐上游的 YGDoubleEqual；命中容差就当整数处理，否则才看是否需要强制向上或向下
function roundValue(
  v: number,
  scale: number,
  forceCeil: boolean,
  forceFloor: boolean,
): number {
  let scaled = v * scale
  let frac = scaled - Math.floor(scaled)
  if (frac < 0) frac += 1
  // Float-epsilon tolerance matches upstream YGDoubleEqual (1e-4)
  if (frac < 0.0001) {
    scaled = Math.floor(scaled)
  } else if (frac > 0.9999) {
    scaled = Math.ceil(scaled)
  } else if (forceCeil) {
    scaled = Math.ceil(scaled)
  } else if (forceFloor) {
    scaled = Math.floor(scaled)
  } else {
    // Round half-up (>= 0.5 goes up), per upstream
// 默认分支用的是「大于等于 0.4999 就进位」而不是 0.5：这是为了吃掉浮点误差，让 0.4999999 这种本该进位的情况不至于掉下去
    scaled = Math.floor(scaled) + (frac >= 0.4999 ? 1 : 0)
  }
  return scaled / scale
}

// --
// Helpers

// parseDimension 是字符串/数字到 Value 的唯一转换点：undefined 给未定义、字符串 auto 给 auto、数字给点值、百分号结尾给百分比、其余按数字解析，失败则未定义
function parseDimension(v: number | string | undefined): Value {
  if (v === undefined) return UNDEFINED_VALUE
  if (v === 'auto') return AUTO_VALUE
  if (typeof v === 'number') {
// NaN 与正负无穷都当未定义。这一条不是防御性代码而是实际需求：Ink 会传 height={Infinity} 表示不限制（LogSelector 的 maxHeight 默认值就是这样），存成字面点值会让节点高度变成无穷并摧毁下游所有布局
    // WASM yoga's YGFloatIsUndefined treats NaN and ±Infinity as undefined.
    // Ink passes height={Infinity} (e.g. LogSelector maxHeight default) and
    // expects it to mean "unconstrained" — storing it as a literal point value
    // makes the node height Infinity and breaks all downstream layout.
    return Number.isFinite(v) ? pointValue(v) : UNDEFINED_VALUE
  }
  if (typeof v === 'string' && v.endsWith('%')) {
    return percentValue(parseFloat(v))
  }
  const n = parseFloat(v)
  return isNaN(n) ? UNDEFINED_VALUE : pointValue(n)
}

// physicalEdge 把 9 个逻辑边映射到 4 个物理边：Start 归 Left、End 归 Right（LTR 前提），default 也归 Left——getComputedBorder 这类读取 API 传进奇怪值时不会崩，只是取到左边的值
function physicalEdge(edge: Edge): number {
  switch (edge) {
    case Edge.Left:
    case Edge.Start:
      return EDGE_LEFT
    case Edge.Top:
      return EDGE_TOP
    case Edge.Right:
    case Edge.End:
      return EDGE_RIGHT
    case Edge.Bottom:
      return EDGE_BOTTOM
    default:
      return EDGE_LEFT
  }
}

// --
// Module API matching yoga-layout/load

// Yoga 类型就是上游 yoga-layout/load 的模块形状：Config 与 Node 各带 create/destroy。三个 create 变体（无参、默认、带 config）都要有，因为上游历史上换过推荐写法
export type Yoga = {
  Config: {
    create(): Config
    destroy(config: Config): void
  }
  Node: {
    create(config?: Config): Node
    createDefault(): Node
    createWithConfig(config: Config): Node
    destroy(node: Node): void
  }
}

// 单例对象把上面所有工厂函数挂上去；destroy 全为空实现——JS 有 GC，这里只需要语义上的释放
const YOGA_INSTANCE: Yoga = {
  Config: {
    create: createConfig,
    destroy() {},
  },
  Node: {
    create: (config?: Config) => new Node(config),
    createDefault: () => new Node(),
    createWithConfig: (config: Config) => new Node(config),
    destroy() {},
  },
}

// loadYoga 返回已解析的 Promise 而不是真正的异步加载：上游 WASM 版需要 await 初始化，改成纯 TS 后为了不改调用方代码，保留这个签名直接 resolve
export function loadYoga(): Promise<Yoga> {
  return Promise.resolve(YOGA_INSTANCE)
}

export default YOGA_INSTANCE
