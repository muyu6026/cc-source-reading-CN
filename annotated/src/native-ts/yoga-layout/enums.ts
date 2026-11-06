/**
 * Yoga enums — ported from yoga-layout/src/generated/YGEnums.ts
 * Kept as `const` objects (not TS enums) per repo convention.
 * Values match upstream exactly so callers don't change.
 */

// 用 const 对象而不是 TS 枚举：枚举会生成运行时代码，而这里只要一组数字常量加一个同名类型
export const Align = {
  Auto: 0,
  FlexStart: 1,
  Center: 2,
  FlexEnd: 3,
  Stretch: 4,
  Baseline: 5,
  SpaceBetween: 6,
  SpaceAround: 7,
  SpaceEvenly: 8,
} as const
// 值与类型同名：值供运行时取数，类型供调用方标注，靠同一份字面量推导，加成员不会漏改类型
export type Align = (typeof Align)[keyof typeof Align]

export const BoxSizing = {
  BorderBox: 0,
  ContentBox: 1,
} as const
export type BoxSizing = (typeof BoxSizing)[keyof typeof BoxSizing]

// 只有两个值看着单薄，但它是尺寸接口的入参，不能省
export const Dimension = {
  Width: 0,
  Height: 1,
} as const
export type Dimension = (typeof Dimension)[keyof typeof Dimension]

export const Direction = {
  Inherit: 0,
  LTR: 1,
  RTL: 2,
} as const
export type Direction = (typeof Direction)[keyof typeof Direction]

export const Display = {
  Flex: 0,
  None: 1,
  Contents: 2,
} as const
export type Display = (typeof Display)[keyof typeof Display]

export const Edge = {
  Left: 0,
  Top: 1,
  Right: 2,
  Bottom: 3,
  Start: 4,
  End: 5,
  Horizontal: 6,
  Vertical: 7,
  All: 8,
} as const
export type Edge = (typeof Edge)[keyof typeof Edge]

// 这是位标志而不是序号：0、1、2、4 是位的组合，末尾两个是「全开」与「经典组合」的哨兵，不能按顺序理解
export const Errata = {
  None: 0,
  StretchFlexBasis: 1,
  AbsolutePositionWithoutInsetsExcludesPadding: 2,
  AbsolutePercentAgainstInnerSize: 4,
  All: 2147483647,
  Classic: 2147483646,
} as const
export type Errata = (typeof Errata)[keyof typeof Errata]

// 实验特性目前只有一个：留个空位比事后加参数省事
export const ExperimentalFeature = {
  WebFlexBasis: 0,
} as const
export type ExperimentalFeature =
  (typeof ExperimentalFeature)[keyof typeof ExperimentalFeature]

export const FlexDirection = {
  Column: 0,
  ColumnReverse: 1,
  Row: 2,
  RowReverse: 3,
} as const
export type FlexDirection = (typeof FlexDirection)[keyof typeof FlexDirection]

// 取值与方位那套故意不一致：这里是行列两轴，那边是九宫格方位，不是同一套编号
export const Gutter = {
  Column: 0,
  Row: 1,
  All: 2,
} as const
export type Gutter = (typeof Gutter)[keyof typeof Gutter]

export const Justify = {
  FlexStart: 0,
  Center: 1,
  FlexEnd: 2,
  SpaceBetween: 3,
  SpaceAround: 4,
  SpaceEvenly: 5,
} as const
export type Justify = (typeof Justify)[keyof typeof Justify]

// 三态贯穿整个布局算法：未定义、精确、至多——决定父容器给的是上限还是定值
export const MeasureMode = {
  Undefined: 0,
  Exactly: 1,
  AtMost: 2,
} as const
export type MeasureMode = (typeof MeasureMode)[keyof typeof MeasureMode]

export const Overflow = {
  Visible: 0,
  Hidden: 1,
  Scroll: 2,
} as const
export type Overflow = (typeof Overflow)[keyof typeof Overflow]

export const PositionType = {
  Static: 0,
  Relative: 1,
  Absolute: 2,
} as const
export type PositionType = (typeof PositionType)[keyof typeof PositionType]

// 单位是布局值的前缀标记：同一个数字配不同单位含义完全不同
export const Unit = {
  Undefined: 0,
  Point: 1,
  Percent: 2,
  Auto: 3,
} as const
export type Unit = (typeof Unit)[keyof typeof Unit]

export const Wrap = {
  NoWrap: 0,
  Wrap: 1,
  WrapReverse: 2,
} as const
export type Wrap = (typeof Wrap)[keyof typeof Wrap]
