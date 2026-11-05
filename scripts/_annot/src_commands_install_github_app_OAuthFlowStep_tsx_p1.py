# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''OAuthFlowStep 组件：GitHub Actions 安装流程里引导用户走浏览器授权、拿回访问令牌的步骤。它创建的是仅供 GitHub Actions 使用的推理专用令牌，不是替代登录。'''),
    (34, 'after', '''OAuthStatus 联合类型：从 starting 到 about_to_retry 的完整状态机，每态携带该阶段需要的字段（url / token / toRetry 等）。'''),
    (35, 'after', '''PASTE_HERE_MSG：提示用户在授权后把代码粘贴到此处的前缀串，用于计算输入框可用宽度。'''),
    (40, 'after', '''各 useState：状态、服务实例、粘贴码、光标偏移、URL 复制提示、是否已显示粘贴提示、URL 是否已复制。'''),
    (52, 'after', '''textInputColumns：根据终端宽度与提示前缀算出输入框列数，至少 50 列。'''),
    (66, 'after', '''handleKeyDown：错误态下回车进入重试、其余键取消；非错误态忽略按键。'''),
    (100, 'after', '''handleSubmitCode：解析 authorizationCode#state，手动输入路径会记 tengu_oauth_manual_entry 事件；解析失败或异常都回到 waiting_for_login 允许重试。'''),
    (155, 'after', '''startOAuth：启动授权流、处理成功/错误、缓存令牌并自动续传。成功后再延时自动调用 onSuccess，错误态保留 starting 以便重试。'''),
    (160, 'after', '''启动即触发：状态为 starting 时立即调用 startOAuth 拉起授权。'''),
    (172, 'after', '''重试逻辑：进入 about_to_retry 后定时切回 waiting_for_login，并恢复粘贴提示。'''),
    (183, 'after', '''剪贴板魔法：输入字母 c 时把登录 URL 写入剪贴板，2 秒后清除「已复制」提示（仅限等待登录且未复制时）。'''),
    (195, 'after', '''卸载清理：组件卸下时释放 OAuth 服务并清掉所有定时器，包括 URL 复制定时器，避免泄漏。'''),
    (245, 'after', '''renderStatusMessage：按状态机渲染不同提示文案与 Spinner，成功/错误态给出重试或取消指引。'''),
    (275, 'after', '''主渲染：根据状态条件展示头部、URL 复制区与状态区；starting 态用内联头部，其余态用独立头部避免重复。'''),
]
