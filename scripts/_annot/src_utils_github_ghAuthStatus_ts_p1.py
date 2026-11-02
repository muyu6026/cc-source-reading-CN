ANNOTATIONS = [
    (1, 'before', '''文件级批注：`ghAuthStatus.ts` 探测本地 `gh` CLI 的安装与鉴权状态，用于遥测上报，不直接参与鉴权流程。'''),
    (8, 'after', '''类型定义收尾：`GhAuthStatus` 三态——已鉴权、未鉴权、未安装。'''),
    (17, 'before', '''异步函数签名：先用 `which('gh')` 检测安装（Bun 原生、无子进程），再用 `gh auth token` 的退出码判断鉴权状态。'''),
    (29, 'after', '''函数收尾：退出码为 0 即已鉴权，否则判未鉴权；刻意用 `auth token` 而非 `auth status` 以避免触发 GitHub API 网络请求，`stdout:'ignore'` 保证令牌不进入本进程内存。'''),
]
