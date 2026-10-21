/**
 * Shared utilities for expanding environment variables in MCP server configurations
 */

/**
 * Expand environment variables in a string value
 * Handles ${VAR} and ${VAR:-default} syntax
 * @returns Object with expanded string and list of missing variables
 */
export function expandEnvVarsInString(value: string): {
  expanded: string
  missingVars: string[]
} {
  const missingVars: string[] = []

  const expanded = value.replace(/\$\{([^}]+)\}/g, (match, varContent) => {
// `[^}]+` 这个字符类顺手定义了三件没写进文档的行为：
//   · 空名不匹配 —— `${}` 原样留下，也不记进 missingVars
//   · `$` 不是转义符 —— 想写一个字面 `$` 后面跟花括号，没有写法可绕
//   · 不支持嵌套 —— `${FOO_${BAR}}` 会在第一个 `}` 处截断
// 对一个只用来填 MCP 配置里 command / args / env 的展开器，这些边界够用了。
    // Split on :- to support default values (limit to 2 parts to preserve :- in defaults)
    const [varName, defaultValue] = varContent.split(':-', 2)
// split 的第二个参数 2 是有意的：默认值里自己也可能带 `:-`。
// JS 的 split 在给了 limit 时会**截掉**后面的部分 —— 所以 `${PATH:-/usr/bin:/bin}`
// 能正确拿到默认值，但 `${A:-${B:-x}}` 这种嵌套默认值会被切坏。
//
// 另一处值得注意：`${VAR:-}` 的默认值是空串而不是「没给」，所以它会返回空串，
// 不会记进 missingVars —— 这正是 shell 里 `:-` 的语义。
    const envValue = process.env[varName]

    if (envValue !== undefined) {
// 用 `!== undefined` 而不是真值判断：环境变量被显式设成空串（`FOO=`）是
// 一个合法的值「我要空」，不能当成没设。设成空串却回落到默认值，是这类
// 展开器最常见的 bug。
      return envValue
    }
    if (defaultValue !== undefined) {
      return defaultValue
    }

    // Track missing variable for error reporting
    missingVars.push(varName)
    // Return original if not found (allows debugging but will be reported as error)
    return match
// 找不到时返回原文（`${VAR}` 保持原样）并记账，这是两件事而不是一件：
//   · 返回原文 → 用户能在报错信息里一眼看出是哪个变量没设
//   · 记账 → 调用方（config.ts 的 expandEnvVars）决定是警告还是拒绝
// 展开器自己不做决定，只把「发生了什么事」如实带上去。
  })

  return {
    expanded,
    missingVars,
  }
}
