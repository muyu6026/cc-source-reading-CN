# 数据文件：src/utils/preflightChecks.tsx
SOURCE_PATH = 'src/utils/preflightChecks.tsx'

ANNOTATIONS = [
    (1, 'before', '''本组件在登录/鉴权前做连通性闸门：探测 Anthropic 服务的两个端点，失败则展示错误与排障链接；经 React Compiler 编译为记忆化形式。'''),
    (12, 'before', '''PreflightCheckResult 接口：连通性检查结果，含成功标志、错误信息与可选的 SSL 提示。'''),
    (17, 'before', '''checkEndpoints：并发探测两个端点（BASE_API_URL/hello 与 OAuth hello），任一失败则上报 Statsig 事件并返回失败详情。'''),
    (49, 'after', '''用 Promise.all 并行探测所有端点，取第一个失败结果作为整体失败原因。'''),
    (78, 'before', '''PreflightStep：React 组件（经 React Compiler 编译为记忆化形式），挂载即跑连通性检查，约一秒后显示加载动画，失败则展示错误与排障链接。'''),
    (148, 'before', '''_temp：检查失败时的兜底回调，直接退出进程（退出码 1）。'''),
    (150, 'after', '''模块收尾：本组件在登录/鉴权前做连通性闸门，确保能访问 Anthropic 服务后再继续。'''),
]
