# 数据文件：src/utils/execFileNoThrow.ts
SOURCE_PATH = 'src/utils/execFileNoThrow.ts'

ANNOTATIONS = [
    (1, 'after_block', '''本文件封装 node:child_process 的容错调用：用 execa 实现跨平台（含 Windows 的 .bat/.cmd）子进程执行，失败时解析为结果而非抛异常。'''),
    (24, 'after', '''ExecFileOptions：对外封装的参数类型，含超时、是否保留错误输出、是否使用 cwd、环境变量与标准输入等选项。'''),
    (26, 'before', '''execFileNoThrow：薄封装，套用默认超时（10 分钟）与 cwd，再委托给 execFileNoThrowWithCwd 执行。'''),
    (56, 'after', '''ExecFileWithCwdOptions：底层选项类型，额外支持 maxBuffer、shell 与 cwd 等更细控制。'''),
    (61, 'after', '''ExecaResultWithError：从 execa 结果里抽取的错误信息形状（shortMessage、signal）。'''),
    (84, 'after', '''getErrorMessage：按优先级取可读错误信息——execa 的 shortMessage 优先，其次终止信号名，最后退回数字退出码。'''),
    (89, 'before', '''execFileNoThrowWithCwd：核心实现；始终 resolve（reject:false），失败时按是否保留输出来返回错误明细或空串。'''),
    (150, 'after', '''模块收尾：核心 Promise 封装确保子进程无论成功、非零退出还是抛错都收敛为统一结果对象，调用方无需 try/catch。'''),
]
