# 布尔 context 三件套之二：让子组件知道该不该展开 shell 输出
ANNOTATIONS = [
    (5, 'before', '与 MessageResponseContext、SubAgentContext 同型：一个布尔 context，子组件只问「要不要展开」，不关心是谁要求的'),
    (12, 'after', '默认 false：任何没被包住的调用方都保持截断这一默认行为，包一层才变'),
    (13, 'before', 'Provider 不暴露 value 参数：包上即生效，避免出现「包了但传了 false」这种自相矛盾的用法'),
    (20, 'after', '只在 children 变化时重建 Provider：value 是常量 true，本身无需记忆'),
    (33, 'before', '消费端只导出 hook，不导出 context 本体——防止有人绕过默认值直接塞 value'),
]
