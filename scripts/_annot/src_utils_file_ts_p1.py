# -*- coding: utf-8 -*-
# src/utils/file.ts  L584
ANNOTATIONS = [

(29, 'after', r'''文件总览：文件读写与路径展示的工具箱。围绕一个可替换的文件系统实现（getFsImplementation）展开，提供存在性判断、读写、编码与换行探测、行号前缀、符号链接安全写入、桌面路径解析等底层能力。'''),

(34, 'after', r'''File 类型：文件名 + 内容的极简结构，是很多读写函数的内部传值形态。'''),

(45, 'after', r'''pathExists：异步判路径存在，stat 抛错即返回 false（吞掉所有错误，含权限不足）。'''),

(48, 'after', r'''MAX_OUTPUT_SIZE：读文件输出上限 0.25MB（262144 字节），多处读截断都引用它。'''),

(58, 'after', r'''readFileSafe：同步读文件，失败记日志并返回 null 而非抛——给「读不到就当没有」的场景用。'''),

(69, 'after', r'''getFileModificationTime：取 mtime 并向下取整到毫秒，消除 IDE 文件监听造成的亚毫秒抖动带来的误判。'''),

(82, 'after', r'''getFileModificationTimeAsync：异步版，同样 floor 语义；用在每轮每个文件状态检查的热路径上，避免同步 stat 触发慢盘告警。'''),

(98, 'after', r'''writeTextContent：按指定编码与换行符写文本。CRLF 模式先把已有的回车换行归一化，避免重复转义变成双回车。'''),

(118, 'after', r'''detectFileEncoding：读文件探测编码；拿不到权限的错静默降级（debug 级），其余记 error，默认回退 utf8。'''),

(135, 'after', r'''detectLineEndings：只读前 4096 字节探测换行符（LF/CRLF），读不出就默认 LF。'''),

(142, 'after', r'''convertLeadingTabsToSpaces：把行首制表符按宽度换成空格；无 tab 直接短路返回，避免无谓的正则全文件扫描。'''),

(153, 'after', r'''getAbsoluteAndRelativePaths：把输入路径展开成绝对路径，并相对 cwd 算出相对路径。'''),

(170, 'after', r'''getDisplayPath：给用户看路径的展示规则——cwd 内用相对路径、home 下用波浪号简写、其余给绝对路径。'''),

(207, 'after', r'''findSimilarFile：在同级目录找「同名异扩展名」的文件，给「文件不存在」错误做纠偏建议。'''),

(213, 'after', r'''FILE_NOT_FOUND_CWD_NOTE：文件未找到错误里的固定标记串，UI 用它识别是否带了 cwd 提示。'''),

(267, 'after', r'''suggestPathUnderCwd：纠偏「漏了仓库目录」的路径——当请求路径在 cwd 父目录下但不在 cwd 内时，把相对段拼回 cwd 并返回真实存在的那个。'''),

(285, 'after', r'''isCompactLinePrefixEnabled：行号前缀是否用紧凑格式（N 加制表符，省每行 9 字节）。默认开，由增长实验开关可远程关闭。'''),

(319, 'after', r'''addLineNumbers：给内容加 cat -n 风格行号。紧凑模式用制表符分隔，旧模式用六位补空格加箭头。'''),

(328, 'after', r'''stripLineNumberPrefix：addLineNumbers 的逆操作，单行走掉行号前缀；与前者同地维护以保证格式同步。'''),

(343, 'after', r'''isDirEmpty：判目录空；不存在按空算，其它错误（如 macOS 受保护目录）按非空算。'''),

(352, 'after', r'''readFileSyncCached：走 fileReadCache 的同步读，是 FileEditTool 推荐的读文件入口。'''),

(478, 'after', r'''writeFileSyncAndFlush_DEPRECATED：同步写文件并刷盘（已废弃，因阻塞事件循环）。先尝试「写临时文件 + 改名」的原子写并保留原权限与符号链接，失败再回退非原子写。'''),

(537, 'after', r'''getDesktopPath：跨平台找桌面目录。macOS 直接用 ~/Desktop；Windows/WSL 要拼 /mnt/c/用户/Desktop 并枚举用户目录；找不到回退 home。'''),

(558, 'after', r'''isFileWithinReadSizeLimit：判文件是否超过读取大小上限（默认 0.25MB）；stat 不到直接算不通过。'''),

(577, 'after', r'''normalizePathForComparison：路径归一化用于比较。Windows 上把斜杠统一成反斜杠并转小写（大小写不敏感）。'''),

(584, 'after', r'''pathsEqual：两个路径是否相等，内部走 normalizePathForComparison，自动处理 Windows 大小写不敏感。'''),

]
