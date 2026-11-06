# -*- coding: utf-8 -*-
"""src/entrypoints/mcp.ts 批注数据（第 161 批）。"""

ANNOTATIONS = [
    (33, 'before', '''MCP 先把 review 命令挂进来，其余工具由 getTools 在运行时按需取出'''),
    (35, 'before', '''启动入口：建 MCP 服务、注册两个处理器（列工具、调工具），再连上 stdio 传输'''),
    (41, 'after', '''读文件状态用带容量上限的 LRU 缓存：一百个文件、二十五兆，防止内存无界增长'''),
    (47, 'before', '''建服务：名字填 claude/tengu，版本取构建宏，能力只声明 tools'''),
    (59, 'before', '''列工具处理器：取出全部工具、把 zod schema 转成 JSON schema 再返回'''),
    (68, 'before', '''输出 schema 只收根节点是 object 的：anyOf/oneOf 在根的要跳过（SDK 不支持）'''),
    (99, 'before', '''调工具处理器：按名字找到工具、组装一个非交互式的工具调用上下文'''),
    (112, 'before', '''工具调用上下文是一次性构造：命令只放 review、消息为空、非交互、无 mcp 客户端'''),
    (137, 'before', '''先判是否启用、再校验入参、最后真正调用，三层都失败就抛错'''),
    (150, 'before', '''调用工具：把参数、权限上下文与一条空助手消息一起交给 tool.call'''),
    (170, 'before', '''出错时把错误拆成可读文本：区分 Error 实例与其它类型，过滤空串后再拼接'''),
    (190, 'before', '''runServer 只是把服务连上 stdio 传输，连接建立后函数即返回'''),
    (195, 'before', '''最后 await 连接：stdio 模式下服务就绪后才算启动完成'''),
]
