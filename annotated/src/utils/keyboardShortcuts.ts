// 文件级。macOS 终端下「Option+字母」会产出特殊字符，本文件把这些字符映射到对应的按键绑定（例如 Option+T 触发思考开关），用于识别没有开启「Option 作为 Meta」的终端里的组合键。
// Special characters that macOS Option+key produces, mapped to their
// keybinding equivalents. Used to detect Option+key shortcuts on macOS
// terminals that don't have "Option as Meta" enabled.
export const MACOS_OPTION_SPECIAL_CHARS = {
  '†': 'alt+t', // Option+T -> thinking toggle
  π: 'alt+p', // Option+P -> model picker
  ø: 'alt+o', // Option+O -> fast mode
} as const satisfies Record<string, string>
// 这张常量表用 `satisfies Record<string,string>` 锁死「特殊字符 → 绑定名」的映射，三项是 Option+T/P/O 分别对应思考开关、模型选择、快速模式。

export function isMacosOptionChar(
  char: string,
): char is keyof typeof MACOS_OPTION_SPECIAL_CHARS {
  return char in MACOS_OPTION_SPECIAL_CHARS
}
// 类型守卫：判断某字符是否属于上表，返回带 `keyof` 收窄的类型，调用方拿到字符即可直接当作键名使用。
