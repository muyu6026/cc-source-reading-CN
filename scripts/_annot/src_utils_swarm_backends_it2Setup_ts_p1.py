# iTerm2 的 it2 工具安装与校验：检测 Python 包管理器、安装 it2、验证能否连上 iTerm2 的 Python API
ANNOTATIONS = [
    (14, 'before', '''支持的 Python 包管理器按优先级排列：uvx > pipx > pip'''),
    (40, 'before', '''依次探测 uvx/pipx/pip/pip3，返回第一个存在的包管理器，都没有就 null'''),
    (79, 'before', '''用 which it2 判断 it2 命令行是否已经可用'''),
    (90, 'before', '''用检测到的包管理器把 it2 装到用户目录，pip 失败再试 pip3'''),
    (152, 'before', '''校验 it2 是否就绪：先查 CLI，再跑 session list 测 Python API 连通性'''),
    (176, 'after', '''stderr 里出现 api/python/connection refused/not enabled 就判定为 Python API 未开启'''),
    (200, 'before', '''返回在 iTerm2 里开启 Python API 的操作步骤文案'''),
    (214, 'before', '''标记 it2 安装已完成，避免以后再弹设置引导'''),
    (229, 'before', '''记录用户更想用 tmux 而不是 iTerm2 分屏的偏好'''),
    (243, 'before', '''读取用户是否偏好 tmux 而非 iTerm2 分屏'''),
]
