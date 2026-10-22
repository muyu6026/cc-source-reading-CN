# -*- coding: utf-8 -*-
# PowerShellTool/destructiveCommandWarning.ts 批注数据
ANNOTATIONS = [
    (5, 'after', '''纯信息层：只产出权限对话框里的警告文案，不参与权限判定与自动批准——「让用户多看一眼」与「拦下来」是两套独立系统。'''),
    (24, 'after', '''锚定到语句起始（行首、管道、分号、换行、花括号、圆括号）防止 git rm --force 里的 rm 误匹配。停止符只含花括号不含圆括号：花括号结束代码块、后面的参数属于别的语句；圆括号是路径分组闭合、后面的参数仍是本命令的——Remove-Item (Join-Path ...) -Recurse -Force 必须仍然告警。'''),
    (40, 'after', '''-Recurse 与 -Force 各自单独出现也告警（两条独立正则），加上两种顺序的组合共四条，覆盖参数排列的全部情况。'''),
    (71, 'after', '''git clean 用负向前瞻排除 -n 与 --dry-run——演练模式不删东西，不告警。'''),
    (81, 'after', '''DROP/TRUNCATE 数据库对象不分 SQL 方言统一告警。'''),
    (109, 'after', '''逐条顺序匹配、命中即返回第一条警告——一个命令只显示一条提示，不做权重排序。'''),
]
