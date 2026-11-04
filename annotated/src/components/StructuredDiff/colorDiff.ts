import {
  ColorDiff,
  ColorFile,
  getSyntaxTheme as nativeGetSyntaxTheme,
  type SyntaxTheme,
} from 'color-diff-napi'
import { isEnvDefinedFalsy } from '../../utils/envUtils.js'

export type ColorModuleUnavailableReason = 'env'

// 不可用原因只做静态判定：TS 版实现在所有构建模式下都能跑，唯一关闭途径就是环境变量
/**
 * Returns a static reason why the color-diff module is unavailable, or null if available.
 * 'env' = disabled via CLAUDE_CODE_SYNTAX_HIGHLIGHT
 *
 * The TS port of color-diff works in all build modes, so the only way to
 * disable it is via the env var.
 */
// 单一判定函数：三个 getter 都先问它，保证开关语义只有一处定义
export function getColorModuleUnavailableReason(): ColorModuleUnavailableReason | null {
  if (isEnvDefinedFalsy(process.env.CLAUDE_CODE_SYNTAX_HIGHLIGHT)) {
// 用「定义为假值」而不是直接取反：0、false、no 等写法都算关，与其它开关口径保持一致
    return 'env'
  }
  return null
}

// expect 前缀提示调用方：返回值可能是 null，必须显式写出降级路径，不能假定存在
export function expectColorDiff(): typeof ColorDiff | null {
  return getColorModuleUnavailableReason() === null ? ColorDiff : null
}

export function expectColorFile(): typeof ColorFile | null {
  return getColorModuleUnavailableReason() === null ? ColorFile : null
}

// 主题名原样透传给原生模块：主题表在原生侧，TS 层不做任何映射或兜底
export function getSyntaxTheme(themeName: string): SyntaxTheme | null {
  return getColorModuleUnavailableReason() === null
    ? nativeGetSyntaxTheme(themeName)
    : null
}
