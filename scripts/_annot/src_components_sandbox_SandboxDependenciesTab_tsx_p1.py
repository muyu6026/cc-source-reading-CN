# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (6, 'before', 'Props 只有一个 depCheck：沙箱依赖体检结果，errors 是缺失依赖的报错文本数组，warnings 主要是 seccomp 相关警告。本组件把它翻译成按平台分组的安装指引。'),
    (9, 'before', '沙箱设置弹窗的依赖体检标签页。平台决定展示哪一组：macOS 只看 ripgrep（seatbelt 内建），Linux 要看 bwrap、socat、seccomp 三件套。'),
    (16, 'before', 'getPlatform 的结果进常量槽：进程生命周期内平台不会变。isMac 由此派生。'),
    (25, 'before', '三个缺失判定都从 errors 文本里做子串匹配（some 加 includes）——上游 adapter 没有结构化的缺失项字段，按报错文案匹配是务实选择。三个判定函数提取为文件尾 _temp 系列。'),
    (50, 'before', 'seccompMissing 的口径不同：它不进 errors 而进 warnings，因为 seccomp 可选——缺了只损失拦截 unix domain socket 的能力，沙箱仍可运行。'),
    (53, 'before', '主体重建块：五个缺失状态任一变化才重算。块内又分四段缓存（macOS seatbelt 行、ripgrep 组、Linux 三件套、容器）。'),
    (54, 'before', 'ripgrep 安装提示按平台选包管理器：macOS 用 brew，其余用 apt。ripgrep 全平台必需——用于扫描危险目录。'),
    (57, 'before', 'macOS 独占行：seatbelt 是系统内建，标 success 绿色。这一段与 isMac 无关的判断交给短路——isMac 为假时整段为 false 不渲染。'),
    (65, 'before', 'ripgrep 行：缺失标 error 红、在场标 success 绿，缺失时下一行给安装提示。t7 与 t8 一起进 rgMissing 单依赖的槽。'),
    (85, 'before', 'Linux 三件套（bwrap、socat、seccomp）整段短路于 isMac 为假。seccomp 的安装指引给两条路：npm 全局装 sandbox-runtime，或手动拷贝 vendor 下的 BPF 文件并在 settings.json 里配置路径——第二条是为离线或受限环境准备的。'),
    (93, 'before', '最终容器：seatbelt 行、ripgrep 组、Linux 组、其余未识别错误逐条列出。otherErrors 用 err 文本作 key——文本即身份，重复报错会撞 key，但 errors 由上游去重。'),
    (105, 'before', '文件尾的 _temp 系列按声明倒序对应正文引用顺序：_temp5 渲染错误行，_temp4 过滤已单独展示的三类，_temp2 到 _temp 是三个子串匹配器。'),
]
