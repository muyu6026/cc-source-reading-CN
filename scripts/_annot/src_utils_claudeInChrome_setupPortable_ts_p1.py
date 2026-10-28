# source: src/utils/claudeInChrome/setupPortable.ts
ANNOTATIONS = [
    (6, 'after', '''浏览器扩展在 Claude 官网的落地页地址，供 TUI 或 VS Code 侧做「已安装」跳转或展示用。'''),
    (12, 'after', '''三个扩展 ID：生产版加两个内部开发版（DEV 与 ANT），由环境变量 USER_TYPE 决定启用哪一组。'''),
    (18, 'after', '''按运行环境返回要探测的扩展 ID 列表：ant 内部环境额外带上 DEV 与 ANT 开发版，否则只探生产版。'''),
    (33, 'after', '''BrowserPath 描述「某浏览器加其用户数据目录绝对路径」，是探测函数的返回单元。'''),
    (46, 'after', '''浏览器探测顺序，必须与 common.ts 里的 BROWSER_DETECTION_ORDER 保持一致，否则 TUI 与扩展结果会不一致。'''),
    (52, 'after', '''BrowserDataConfig 把每种浏览器的数据目录按操作系统分开描述：macOS 与 Linux 是路径段数组，Windows 用 AppData 拼接且可选 Roaming。'''),
    (91, 'after', '''CHROMIUM_BROWSERS 汇总七大 Chromium 系浏览器的数据目录布局；这是便携版直接依赖的查表，避免读 common.ts 的运行时依赖。'''),
    (97, 'before', '''便携版入口：枚举所有受支持浏览器，按 process.platform 直接拼出用户数据目录绝对路径，不依赖 common.ts 的运行时初始化。'''),
    (135, 'after', '''返回收集到的全部浏览器数据路径；macOS 与 Linux 用 home 拼接，Windows 走 AppData 基址（Roaming 或 Local）。'''),
    (147, 'before', '''探测扩展是否安装：遍历各浏览器数据目录下的 Default 与 Profile N 文件夹，看是否存在目标扩展 ID 的子目录。'''),
    (213, 'after', '''未在任何浏览器或配置中命中扩展则返回未安装；单个目录读取失败（非权限问题）会跳过并继续下一个。'''),
    (224, 'after', '''只是把上面的探测结果收敛成一个布尔值，给只关心「装没装」的调用方用。'''),
    (233, 'after', '''最省事的入口：内部先算好浏览器路径再调探测函数，适合不需要自定义路径的调用方。'''),
]
