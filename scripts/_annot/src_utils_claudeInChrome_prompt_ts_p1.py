# -*- coding: utf-8 -*-
# src/utils/claudeInChrome/prompt.ts
ANNOTATIONS = [
    (1, 'before', '浏览器自动化相关的系统提示词常量集合。本文件只有文本常量与一个取值函数，没有运行期逻辑，所有内容最终拼进系统提示；分块拆开是为了按「工具搜索是否开启」「是否同时有内置 WebBrowser 工具」等条件做选择性注入。'),

    (52, 'before', '上面 BASE_CHROME_PROMPT 是一整段模板字符串，涵盖截图录制、控制台日志排查、避免触发浏览器弹窗、防止陷入循环、标签页上下文这几类约束。它刻意不含工具搜索说明——那部分要根据运行期状态单独注入。'),

    (70, 'after', 'getChromeSystemPrompt 只返回基础提示，不拼工具搜索说明。注释点明了原因：工具搜索指令在 claude.ts 发请求时按真实开关状态注入，如果在这里也拼一份就会出现重复或误判「乐观可用」。'),

    (72, 'before', 'CLAUDE_IN_CHROME_SKILL_HINT 是启动期注入的简短提示：扩展已安装时告诉模型先用 Skill 工具加载 claude-in-chrome 技能，再由技能解锁具体 MCP 工具。关键约束是「调 MCP 工具之前必须先加载技能」。'),

    (78, 'before', 'WITH_WEBBROWSER 变体用于内置 WebBrowser 工具也可用的场景，做职责切分：开发联调（启服务、跑 JS、看控制台、截图）走 WebBrowser；只有需要用户的登录态、OAuth 或电脑操作时才动用真实 Chrome 扩展。'),
]
