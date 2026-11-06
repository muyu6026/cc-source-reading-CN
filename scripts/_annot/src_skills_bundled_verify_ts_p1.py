# 源文件: src/skills/bundled/verify.ts
ANNOTATIONS = [
    (5, 'after', '''解析内置 verify 技能的 Markdown 模板（SKILL_MD），拆出 frontmatter 与正文 SKILL_BODY。'''),
    (10, 'after', '''DESCRIPTION 优先用 frontmatter.description；拿不到字符串时回退到一句兜底说明。'''),
    (12, 'after', '''注册「verify」内置技能的函数入口。'''),
    (13, 'after', '''只在内部构建（USER_TYPE 为 ant）注册——外部发行版不包含这个技能。'''),
    (17, 'after', '''正式注册：技能名为 verify，用户可主动调用（userInvocable），并带上 SKILL_FILES 文件清单。'''),
    (22, 'after', '''拼装发给模型的提示词：正文去掉前导空白；若用户给了 args，再追加到 ## User Request 段落之后。'''),
]
