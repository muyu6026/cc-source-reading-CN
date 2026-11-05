ANNOTATIONS = [
    (1, 'before', '''文件级批注：`hooks.ts` 定义钩子（hook）系统的类型与 Zod 校验 schema，覆盖同步/异步响应、各类 hook 事件的专有输出、回调钩子上下文与聚合结果。'''),
    (21, 'after', '''依赖引入：zod、lazySchema 与 SDK、权限相关类型。'''),
    (24, 'after', '''`isHookEvent`：判断字符串是否属于合法 hook 事件名。'''),
    (47, 'after', '''提示征询协议类型：`promptRequestSchema` 与 `PromptRequest`/`PromptResponse`，以 `prompt` 字段作判别键。'''),
    (166, 'after', '''`syncHookResponseSchema`：定义同步钩子响应 schema，含 continue、suppressOutput、decision 以及按事件名区分的 `hookSpecificOutput` 联合。'''),
    (176, 'after', '''`hookJSONOutputSchema`：把异步与同步响应 schema 合成为钩子 JSON 输出的统一校验器。'''),
    (193, 'after', '''`isSyncHookJSONOutput` 与 `isAsyncHookJSONOutput`：两个类型守卫，按是否含 `async:true` 区分同步与异步钩子响应。'''),
    (200, 'after', '''`_assertSDKTypesMatch`：编译期断言，确保 Zod 推导类型与 SDK 类型完全一致。'''),
    (226, 'after', '''`HookCallback` 与 `HookCallbackMatcher`：回调钩子的类型定义与匹配器（按 matcher 字符串分组，可标注插件名）。'''),
    (232, 'after', '''`HookProgress` 与 `HookBlockingError`：进度上报与阻塞错误类型。'''),
    (258, 'after', '''`PermissionRequestResult`：权限请求结果，分 allow（带更新输入/权限）与 deny（带消息/中断）两种分支。'''),
    (290, 'after', '''`HookResult` 与 `AggregatedHookResult`：单次钩子与聚合钩子的完整结果类型，涵盖消息、系统消息、阻塞错误与各类行为标志。'''),
]
