# 批注数据：src/utils/queryContext.ts

ANNOTATIONS = [
    (1, 'after', '''本文件提供构建 query 调用缓存键前缀（系统提示、用户上下文、系统上下文）的共享辅助函数，
单独成文件是为了避免与 commands 层形成循环依赖。'''),
    (30, 'after', '''fetchSystemPromptParts 取三段上下文：默认系统提示、用户上下文、系统上下文；
设置了 customSystemPrompt 时跳过默认构建，避免把自定义提示拼到不被使用的默认上下文上。'''),
    (60, 'after', '''用 Promise.all 并行取三段上下文，自定义提示场景下替换为空数组或空对象。'''),
    (74, 'after', '''fetchSystemPromptParts 收尾：把三段结果一并返回给调用方自行装配。'''),
    (76, 'after', '''buildSideQuestionFallbackParams 在恢复会话、尚无 stopHooks 快照时重建缓存安全参数，
镜像 QueryEngine 的系统提示装配，使重建出的前缀与主循环一致、尽量命中缓存。'''),
    (125, 'after', '''复用 fetchSystemPromptParts 取三段上下文，附加工作目录集合由 AppState 派生。'''),
    (142, 'after', '''组装 toolUseContext：填命令、模型、thinking、MCP 等选项，并挂上空的回调与中止控制器。'''),
    (172, 'after', '''返回最终缓存安全参数：系统提示、用户上下文、系统上下文、工具上下文与裁剪后的消息。'''),
    (179, 'after', '''buildSideQuestionFallbackParams 收尾：即便可能漏掉协调器或记忆机制提示这类额外项，
也优于返回空导致整次追问失败。'''),
]
