import { parseFrontmatter } from '../../utils/frontmatterParser.js'
import { registerBundledSkill } from '../bundledSkills.js'
import { SKILL_FILES, SKILL_MD } from './verifyContent.js'

const { frontmatter, content: SKILL_BODY } = parseFrontmatter(SKILL_MD)
// 解析内置 verify 技能的 Markdown 模板（SKILL_MD），拆出 frontmatter 与正文 SKILL_BODY。

const DESCRIPTION =
  typeof frontmatter.description === 'string'
    ? frontmatter.description
    : 'Verify a code change does what it should by running the app.'
// DESCRIPTION 优先用 frontmatter.description；拿不到字符串时回退到一句兜底说明。

export function registerVerifySkill(): void {
// 注册「verify」内置技能的函数入口。
  if (process.env.USER_TYPE !== 'ant') {
// 只在内部构建（USER_TYPE 为 ant）注册——外部发行版不包含这个技能。
    return
  }

  registerBundledSkill({
// 正式注册：技能名为 verify，用户可主动调用（userInvocable），并带上 SKILL_FILES 文件清单。
    name: 'verify',
    description: DESCRIPTION,
    userInvocable: true,
    files: SKILL_FILES,
    async getPromptForCommand(args) {
// 拼装发给模型的提示词：正文去掉前导空白；若用户给了 args，再追加到 ## User Request 段落之后。
      const parts: string[] = [SKILL_BODY.trimStart()]
      if (args) {
        parts.push(`## User Request\n\n${args}`)
      }
      return [{ type: 'text', text: parts.join('\n\n') }]
    },
  })
}
