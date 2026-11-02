// 文件级。定义一个「品牌类型」`SystemPrompt`，本质是不可变字符串数组，靠 `__brand` 字段在类型层面和普通 `string[]` 区分开，避免误传。
/**
 * Branded type for system prompt arrays.
 *
 * This module is intentionally dependency-free so it can be imported
 * from anywhere without risking circular initialization issues.
 */

export type SystemPrompt = readonly string[] & {
  readonly __brand: 'SystemPrompt'
}
// 交叉类型在此收尾：`readonly string[] & { __brand }`，既保留数组能力又带上编译期身份标记。

export function asSystemPrompt(value: readonly string[]): SystemPrompt {
  return value as SystemPrompt
}
// 工厂函数：把普通只读数组断言成 `SystemPrompt`，故意不在这里复制数据，保证零成本转换。
