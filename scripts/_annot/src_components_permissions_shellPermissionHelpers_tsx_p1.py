ANNOTATIONS = [
    (1, 'after', '''shellPermissionHelpers 专门给 Bash / PowerShell 的权限对话框生成「Yes, and apply suggestions」那一行建议文案，把规则、目录、命令三类信息拼成可读的句子。'''),
    (23, 'after', '''commandListDisplay 把命令数组渲染成文本：0 个为空、1 个加粗、2 个用 and 连接、3 个以上用「a, b, and N more」省略。'''),
    (31, 'after', '''commandListDisplayTruncated 先判断纯文本是否过长（大于 50），超长就返回 similar 做兜底，否则走正常列表渲染。'''),
    (57, 'after', '''formatPathList 把路径数组取 basename 后拼成「name<sep>」形式，多路径同样用 and N more 省略。'''),
    (59, 'after', '''generateShellSuggestionsLabel 的注释说明：它生成 shell 权限对话框里允许并应用建议选项的标签，按 shell 工具名和可选的命令变换函数参数化（比如 Bash 会剥掉输出重定向，使文件名不被当成命令）。'''),
    (65, 'after', '''generateShellSuggestionsLabel 先收集所有 addRules 规则，再拆成 Read 规则和 shell 规则两套；目录来自 addDirectories，路径从 Read 规则里抽出。'''),
    (84, 'after', '''shellCommands 用 permissionRuleExtractPrefix 抽出命令前缀（可选经 commandTransform 变换去重），形成最终要展示的命令清单。'''),
    (132, 'after', '''单一类型分支：只有 Read 规则时用 reading from、只有目录时用 access to、只有 shell 命令时用 don't ask again for <命令> commands；并分别处理单条与多条。'''),
    (161, 'after', '''混合类型分支：目录与读路径合并后用 access to，再视是否含命令拼出 access ... and <命令> commands；都不匹配才返回 null（不显示建议）。'''),
    (163, 'after', '''函数最终在没有可展示的建议时返回 null。'''),
]
