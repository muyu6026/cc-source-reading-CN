# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''/init-verifiers 命令：为当前项目生成用于自动验证代码变更的 verifier 技能提示词。它不是代码，而是一份引导 Claude 检测项目、选择工具、与用户问答、最终写出 SKILL.md 的多阶段向导。'''),
    (11, 'after', '''command 对象：type 为 prompt，source 为 builtin，contentLength 动态（提示词在 getPromptForCommand 里现生成）。'''),
    (256, 'after', '''getPromptForCommand 返回的提示词主体：五阶段向导——自动检测项目栈、配置验证工具、交互问答、生成 verifier 技能、确认创建。强调不要为单测/类型检查建 verifier（那由标准构建流程覆盖），聚焦 Web UI（Playwright）、CLI（Tmux）、API（HTTP）的功能验证。'''),
    (260, 'after', '''} satisfies Command：用 Command 类型约束整个对象形状。'''),
    (262, 'after', '''默认导出该 command 对象。'''),
]
