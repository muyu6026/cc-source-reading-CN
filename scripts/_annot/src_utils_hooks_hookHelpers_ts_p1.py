# -*- coding: utf-8 -*-
# src/utils/hooks/hookHelpers.ts
ANNOTATIONS = [
    (1, 'before', 'hook 辅助工具集：把「hook 返回值」统一收敛成结构化输出。核心是给 Stop 类 hook 装一个强制校验钩子，要求模型必须调用合成输出工具才算完成，避免只写纯文本就结束。'),

    (24, 'after', 'hookResponseSchema 是所有 hook 响应的统一形状：ok 表示条件是否满足，reason 只在失败时给出原因。用 lazySchema 包一层是延迟构造 zod schema，避免模块加载期就付出构造开销。'),

    (35, 'after', 'addArgumentsToPrompt 本身没有逻辑，只是把拼接工作转交给 substituteArguments。这样 hook 的入参注入规则（替换 $ARGUMENTS 占位符、支持 $0 这类简写下标）与技能命令共用同一份实现，不会两处语义漂移。'),

    (64, 'after', 'createStructuredOutputTool 复用 SyntheticOutputTool 的定义，只把输入 schema 换成 hook 响应形状。返回值被 agent hook 与后台校验共用，所以提示语写死了「必须且只能调用一次」，否则模型可能反复调用。'),

    (83, 'after', 'registerStructuredOutputEnforcement 注册的是一个 Stop 钩子：matcher 传空字符串表示对所有停止场景生效；判定函数检查消息里是否已有合成输出工具的成功调用，没有就以固定话术把模型拉回来，并给了 5 秒超时。'),
]
