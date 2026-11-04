// 统一出口：七个视觉件、字形工具与类型都从这里取，外部不应深入子路径
export { FlashingChar } from './FlashingChar.js'
export { GlimmerMessage } from './GlimmerMessage.js'
export { ShimmerChar } from './ShimmerChar.js'
export { SpinnerGlyph } from './SpinnerGlyph.js'
export type { SpinnerMode } from './types.js'
export { useShimmerAnimation } from './useShimmerAnimation.js'
export { useStalledAnimation } from './useStalledAnimation.js'
export { getDefaultCharacters, interpolateColor } from './utils.js'
// Teammate components are NOT exported here - use dynamic require() to enable dead code elimination
// See REPL.tsx and Spinner.tsx for the correct import pattern
// 队友相关组件故意不导出：要求调用方用动态 require 引入，未启用队友的构建才能把它们摇掉
