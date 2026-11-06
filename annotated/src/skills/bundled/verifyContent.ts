// Content for the verify bundled skill.
// Each .md file is inlined as a string at build time via Bun's text loader.
// 说明：验证型内置技能的文案在构建期由 Bun 文本加载器内联为字符串常量。

import cliMd from './verify/examples/cli.md'
// 三个 `.md` 文件经 Bun 文本加载器在构建时读入，成为可直接引用的字符串。
import serverMd from './verify/examples/server.md'
import skillMd from './verify/SKILL.md'

export const SKILL_MD: string = skillMd
// 导出技能主文档 `SKILL.md` 的内容字符串。

export const SKILL_FILES: Record<string, string> = {
// 导出示例文件映射表，键为相对路径、值为内联文本内容。
  'examples/cli.md': cliMd,
  'examples/server.md': serverMd,
}
