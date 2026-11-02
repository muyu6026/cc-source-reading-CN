ANNOTATIONS = [
    (1, 'before', '''文件级批注：`bundledMode.ts` 提供两个 Bun 运行时探测函数，判断当前是否用 Bun 启动或是否跑在 Bun 编译出的独立可执行文件里。'''),
    (7, 'before', '''探测 Bun 启动：检查 `process.versions.bun` 是否存在来确定运行时。'''),
    (10, 'after', '''收尾：非 Bun 运行时直接返回 `false`。'''),
    (16, 'before', '''探测打包模式：检查 Bun 全局是否存在且含内嵌文件列表，识别编译产物。'''),
    (22, 'after', '''收尾：三项条件齐备才认定处于打包独立可执行模式。'''),
]
