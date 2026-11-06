# 源文件: src/cli/exit.ts
ANNOTATIONS = [
    (9, 'after', '''用 eslint-disable 关掉 no-process-exit 规则——本文件是全仓唯一的集中退出点，必须调用 process.exit。'''),
    (11, 'after_block', '''文件定位：把分散在 claude mcp / plugin 子命令里约 60 处「打印 + 关 lint + 退出」的退出块收拢成两个统一函数。返回类型用 never 让 TypeScript 在调用处收窄控制流，不必再写 trailing return。'''),
    (19, 'after', '''cliError：把错误信息写到 stderr（若有）并以退出码 1 退出。'''),
    (23, 'after', '''return undefined as never 让控制流收窄到 never，调用处不用补 return；测试会 spy process.exit 让它返回而非真的退出。'''),
    (27, 'after', '''cliOk：cliError 的「成功」对应版——信息写到 stdout（若有）并以退出码 0 退出。'''),
    (31, 'after', '''与 cliError 同理用 as never 收窄控制流；cliOk 走 process.stdout.write，因为 Bun 的 console.log 不经过被 spy 的 process.stdout.write。'''),
]
