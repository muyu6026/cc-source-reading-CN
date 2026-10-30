# 批注数据：src/utils/settings/mdm/rawRead.ts
# slug: src_utils_settings_mdm_rawRead_ts
ANNOTATIONS = [
    (1, 'after', '''模块用途：在不阻塞事件循环的前提下触发 MDM（移动设备管理）子进程读取。导入极简，仅依赖 child_process、fs 与 mdmConstants（后者只引 os），保证能在 main.tsx 模块求值阶段尽早调用。'''),
    (24, 'after', '''声明原始读取结果结构：plistStdouts 为 macOS 的 plist 输出数组（找不到时为 null），hklmStdout/hkcuStdout 为 Windows 注册表两项输出（找不到时为 null）。'''),
    (30, 'after', '''缓存启动期的 MDM 原始读取 Promise，避免重复触发子进程。'''),
    (32, 'after', '''封装 execFile 为 Promise：以 utf-8 编码执行命令，超时由 MDM_SUBPROCESS_TIMEOUT_MS 控制；出错时返回 code 1、stdout 空串，绝不抛异常。'''),
    (49, 'after', '''按需触发一次全新的 MDM 子进程读取。macOS 并行跑各 plist 路径的 plutil、Windows 并行跑 reg query（HKLM 与 HKCU）、Linux 直接返回空——因为 Linux 没有对应的 MDM 机制。'''),
    (79, 'after', '''取第一个命中的 plist 来源（数组按优先级排序），其余丢弃。'''),
    (112, 'after', '''非 macOS 也非 Windows（即 Linux）时直接返回全空结果。'''),
    (116, 'after', '''启动期只触发一次原始读取，在 main.tsx 模块求值阶段调用；结果通过 getMdmRawReadPromise 取用。'''),
    (125, 'after', '''取出启动期的 MDM 读取 Promise；若 startMdmRawRead 从未调用则返回 null。'''),
]
