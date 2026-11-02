ANNOTATIONS = [
    (1, 'after', '''文件级：把 agent 类型与 REPL 输出风格映射成 QuerySource 字符串，供埋点统计不同 agent / 输出风格的使用情况。'''),
    (16, 'before', '''getQuerySourceForAgent：内置 agent 按类型返回「agent:builtin:类型」，未指定类型回退「agent:default」；自定义 agent 一律「agent:custom」。'''),
    (28, 'after', '''第一个函数收尾：内置 / 自定义两类 agent 的 QuerySource 在此分流完毕。'''),
    (36, 'before', '''getQuerySourceForREPL：读输出风格设置，默认风格返回「repl_main_thread」，内置风格返回「repl_main_thread:outputStyle:风格名」，否则「…:custom」。'''),
    (49, 'after', '''第二个函数收尾：REPL 主线程的 QuerySource 依输出风格派生，自定义风格同样带 :custom 后缀。'''),
]
