# source: src/utils/hooks/execPromptHook.ts
ANNOTATIONS = [
    (30, 'after', '''execPromptHook：用 LLM（小快模型）而非外部脚本执行提示词式 hook，返回 ok / blocking / error 结果。'''),
    (32, 'after', '''优先用调用方传来的 toolUseID，否则现场生成一个 hook-<uuid>（用于把结果回贴到对应工具调用）。'''),
    (35, 'after', '''把 $ARGUMENTS 占位符替换为 JSON 输入，得到真正要问模型的提示词。'''),
    (42, 'after', '''直接构造用户消息（不走 processUserInput，避免触发 UserPromptSubmit hook 造成无限递归）。'''),
    (50, 'after', '''打印即将发给模型的消息条数，便于调试。'''),
    (54, 'after', '''hook 超时：未配置则 30 秒，配置则按秒换算成毫秒。'''),
    (60, 'after', '''组合信号：hook 自身信号或超时任一触发即中止（createCombinedAbortSignal 负责惰性清理）。'''),
    (100, 'after', '''用非流式调用模型，要求返回 {ok, reason?} 的 JSON（thinking 关闭、toolChoice 未定、querySource 为 hook_prompt）。'''),
    (105, 'after', '''抽取响应文本，并更新 spinner 的响应长度显示。'''),
    (113, 'after', '''解析失败（拿不到合法 JSON）→ 返回 non_blocking_error，stderr 记为 JSON validation failed。'''),
    (133, 'after', '''schema 校验失败 → 同样 non_blocking_error，stderr 带上 zod 错误信息。'''),
    (154, 'after', '''条件不满足（ok 为 false）→ 返回 blocking 并附带 reason，阻止后续继续（preventContinuation）。'''),
    (183, 'after', '''内层 catch：若组合信号已中止返回 cancelled，否则把错误向上抛（交由外层统一处理）。'''),
]
