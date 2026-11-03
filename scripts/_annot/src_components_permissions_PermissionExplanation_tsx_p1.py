ANNOTATIONS = [
    (1, 'before', '''React Compiler 运行时，提供 `$` 记忆化缓存数组。'''),
    (8, 'before', '''引入权限解释器（生成自然语言解释）、闪烁动画与风险等级相关的工具与类型。'''),
    (10, 'before', '''加载中占位文案常量。'''),
    (11, 'before', '''ShimmerLoadingText：在解释加载时显示带闪烁光标的「Loading explanation…」动画文本。'''),
    (41, 'before', '''getRiskColor：把风险等级映射成终端颜色——LOW 绿、MEDIUM 黄、HIGH 红。'''),
    (51, 'before', '''getRiskLabel：把风险等级映射成简短标签——Low risk、Med risk、High risk。'''),
    (73, 'after', '''createExplanationPromise：创建一个永不会 reject 的解释 Promise；出错时 catch 成 null，避免中断 UI。'''),
    (87, 'after', '''usePermissionExplainerUI：管理解释器状态。仅当用户按 Ctrl+E 才惰性创建拉取 Promise，避免为从不查看的解释消耗 token。'''),
    (149, 'after', '''ExplanationResult：用 React 19 的 use 读取 Promise，加载时挂起，出错时返回 null。'''),
    (153, 'before', '''_temp：把 visible 取反的助手（用于 setVisible(!v)）。'''),
    (156, 'before', '''ExplanationResult 组件：读取解释结果后渲染「解释 / 推理 / 风险」三部分；无结果时显示 Explanation unavailable。'''),
    (246, 'before', '''PermissionExplainerContent：可见且有 Promise 时才渲染内容；加载态用 Suspense 配合 ShimmerLoadingText 兜底。'''),
]
