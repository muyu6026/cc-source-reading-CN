# source: src/utils/gitSettings.ts
ANNOTATIONS = [
    (1, 'before', '''这文件把「依赖用户设置的 Git 行为」从 git.ts 拆出来，目的是避免把 settings.ts 的依赖图（进而 @opentelemetry/api 与 undici，vscode 扩展禁用它们）带进 vscode 扩展，同时打破 settings → git/gitignore → git → settings 的循环依赖。'''),
    (18, 'after', '''函数逻辑：先看环境变量 CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS——显式真值则不含 Git 指令、显式假值（已定义但为假）则含，否则回退到初始设置里的 includeGitInstructions，默认是 true。'''),
]
