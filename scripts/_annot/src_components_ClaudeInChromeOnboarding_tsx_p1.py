# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (9, 'before', '两个链接常量：扩展安装页与权限说明页。权限页用短链 clau.de——终端里手动输入的 URL 越短越好。'),
    (14, 'before', 'Claude in Chrome 集成的引导弹窗：介绍浏览器控制能力，检测扩展是否已装，完成后写全局配置标记。Beta 阶段功能，标题里注明。'),
    (22, 'before', '挂载 effect（依赖空数组，编译器连依赖数组本身也进了记忆槽）：三件事——打点上报弹窗展示、异步探测扩展安装状态、写配置标记引导已完成。'),
    (26, 'before', 'isChromeExtensionInstalled 返回 Promise，then 后 setState。组件可能在 Promise 结算前卸载，React 18 对已卸载组件的 setState 是静默无害的。'),
    (27, 'before', 'saveGlobalConfig 的更新器被提取为文件尾 _temp：把 hasCompletedClaudeInChromeOnboarding 置真，下次不再弹此引导。'),
    (38, 'before', 'useInput 直接监听回车结束引导。第 4 行 eslint-disable 注明故意绕过 keybindings 体系——引导弹窗是临时交互面，不值得注册全局键位。'),
    (51, 'before', '未安装扩展时追加下载入口：两个 Newline 隔开、附带链接。isExtensionInstalled 变化时这一段整体重建。'),
    (59, 'before', '介绍文案：浏览器导航、填表、截图、录 GIF、控制台与网络调试。文案末尾拼接第 51 行的安装提示段（未安装时非空）。'),
    (75, 'before', '权限说明：站点级权限继承自 Chrome 扩展本体，Claude Code 侧不单独管理。已安装时附权限管理页链接（第 67 行 t6）。'),
    (90, 'before', '更多信息的静态段：/chrome 命令加文档链接，整体进常量槽。'),
    (106, 'before', 'Dialog color 为 chromeYellow：品牌专属色。onCancel 即 onDone——弹窗没有失败路径，关闭就是完成。'),
]
