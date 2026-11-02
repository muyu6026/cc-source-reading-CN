ANNOTATIONS = [
    (1, 'before', """Computer Use 宿主适配器：构造并缓存一个进程级单例，把本机原生能力（日志、执行器、权限、像素校验等）适配成 MCP 宿主接口。"""),
    (12, 'before', """DebugLogger：把 MCP 宿主要求的各级日志（silly/debug/info/warn/error）转接到内部调试日志，统一带级别。"""),
    (30, 'after', """进程级缓存：首个 CU 工具调用时构建一次，之后复用，避免重复加载原生模块。"""),
    (32, 'after', """模块文档：单例在首个 CU 工具调用时构建；原生模块（@ant/computer-use-input 与 @ant/computer-use-swift）经由执行器工厂在此加载，加载失败会抛错，没有降级模式。"""),
    (38, 'before', """获取单例：命中缓存直接返回；否则现场装配 serverName、logger、executor、权限检查、子门控与像素裁剪等字段后缓存。"""),
    (54, 'after', """ensureOsPermissions：调原生 tcc 检查辅助功能与屏幕录制权限，二者皆通过才算授予，否则返回具体缺失项。"""),
    (66, 'after', """cropRawPatch：像素校验的 JPEG 解码加裁剪；本实现必须同步，而我们用的库只异步，故返回 null 走「跳过校验、照常点击」的设计降级。"""),
    (69, 'after', """单例收尾：返回装配好的宿主适配器，之后所有 CU 工具复用同一实例，原生模块只加载一次。"""),
]
