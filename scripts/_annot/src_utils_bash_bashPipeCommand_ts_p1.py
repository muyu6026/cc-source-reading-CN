ANNOTATIONS = [
    (14, 'before', """rearrangePipeCommand：重排带管道的命令，把 stdin 重定向放到第一条命令之后，避免 eval 把整个管道当整体导致重定向作用到 eval 自身。"""),
    (16, 'after', """命令含反引号时直接走 eval 兜底，因为 shell-quote 处理反引号不可靠。"""),
    (30, 'after', """命令引用 shell 变量时走兜底，因为 shell-quote 不带 env 时会把变量展开成空串，quote 又会转义美元符。"""),
    (44, 'after', """先合并续行符，否则 shell-quote 会为每处反斜杠续行产生空 token。"""),
    (60, 'after', """命中 shell-quote 单引号缺陷时走兜底，避免合并后的 token 在 bash 重解析时暴露注入运算符。"""),
    (93, 'after', """重建命令为首命令 < /dev/null | 其余管道 的结构，把 stdin 重定向到空设备。"""),
    (119, 'before', """buildCommandParts：把解析后的 token 还原成字符串片段，特殊处理文件描述符重定向与 glob 模式。"""),
    (247, 'before', """containsControlStructure：判断命令是否含 shell 控制结构（for/while/until/if/case/select），这类 shell-quote 无法正确解析。"""),
    (262, 'before', """quoteWithEvalStdinRedirect：用单引号包裹命令再追加 < /dev/null，作为 eval 参数而非 eval 内部重定向。"""),
    (273, 'before', """singleQuoteForEval：为 eval 参数做单引号包裹，用 关闭单引号加双引号内单引号加重开单引号 的方式转义内嵌单引号。"""),
    (283, 'before', """joinContinuationLines：合并反斜杠续行，仅当换行前反斜杠为奇数个（最后一个转义换行）才视为续行。"""),
]
