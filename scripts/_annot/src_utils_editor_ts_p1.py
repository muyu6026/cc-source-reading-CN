# 批注数据：src/utils/editor.ts
# 锚点规则：after 落在 /** 开头行会自动外移到块后；绝不落在 */ 结尾行或块注释内部。

ANNOTATIONS = [
    (11, 'after', '''引入外部编辑器启动所需的依赖：child_process 的 spawn 与 spawnSync、lodash 的 memoize、
path.basename 取文件名、Ink 实例用于终端接管，以及调试日志与 which 探测命令是否可用。'''),
    (30, 'after', '''GUI_EDITORS 列出可在独立窗口打开、适合 detached 启动的图形编辑器；
PLUS_N_EDITORS 匹配支持加号行号跳转的终端编辑器；VSCODE_FAMILY 是需用减 g 传文件行号的家族。'''),
    (34, 'after', '''用正则匹配 vi、vim、nvim、nano、emacs 等支持加号行号参数的终端编辑器，
Windows 记事本不在其列，因为它会把加号加数字当成文件名。'''),
    (37, 'after', '''VSCODE_FAMILY 集合用于决定 GUI 编辑器跳转行号时传参形式：
VS Code 系列用减 g 加文件冒号行号，subl 直接传文件冒号行号。'''),
    (39, 'after', '''classifyGuiEditor 仅做分类：根据编辑器名匹配 GUI 家族并返回家族名供后续选参；
它不负责真正启动，因此 code-insiders 或绝对路径都能原样保留。'''),
    (67, 'after', '''guiGotoArgv 为 GUI 编辑器拼装跳转行号参数：无行号只传文件路径，
VS Code 家族用减 g、subl 用裸文件冒号行号，其余不支持则只给路径。'''),
    (69, 'after', '''openFileInExternalEditor 是启动外部编辑器的主函数：优先从环境或默认列表拿到编辑器，
GUI 类用 detached 子进程不抢终端，终端类则用 Ink 的 alt-screen 接管直到退出。'''),
    (120, 'after', '''GUI 分支在此闭合：Windows 上用 shell 拼命令让点 cmd 解析，POSIX 上直接传 argv 数组避免命令注入。'''),
    (162, 'after', '''openFileInExternalEditor 收尾：终端编辑器通过 Ink 进入与退出 alt-screen，
spawnSync 的错误统一记录到调试日志而不抛异常，保证主流程不被打断。'''),
    (164, 'before', '''getExternalEditor 用 memoize 缓存结果：优先读 VISUAL 与 EDITOR 环境变量，
Windows 上跳过可用性探测直接回退到 start 等待记事本，其余平台按优先级查找可用编辑器。'''),
    (183, 'after', '''本文件只解决「把文件交给用户编辑器打开」这一件事，GUI 与终端两条路径分别处理，
所有实际启动都调用用户配置的二进制，避免把 code-insiders 或绝对路径这类信息丢失。'''),
]
