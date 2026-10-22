# -*- coding: utf-8 -*-
# PowerShellTool/clmTypes.ts 批注数据
ANNOTATIONS = [
    (17, 'after', '''借微软的 CLM 白名单反向使用：类型字面量不在集合就 ask。一个检查替代枚举所有危险类型（命名管道、反射、进程创建、P/Invoke 编组）——名单由微软维护，我们只做减法。'''),
    (26, 'after', '''adsi 与 adsisearcher 被刻意从微软名单移除：类型转型即网络绑定（LDAP 连接远程服务器）。微软允许是因为 CLM 的目标用户是可信域内管理员；这里目标未经验证，必须封。'''),
    (118, 'after', '''同理移除 wmi/wmiclass/wmisearcher/cimsession：类型转型即远程 WMI 查询或 CIM 会话（可打 Win32_Process 等危险类）。注释强调连全限定名（FQ）形式也一并移除——AST 发哪种形式都得堵上。'''),
    (187, 'after', '''数组统一小写存储后构造 Set。'''),
    (203, 'after', '''剥数组后缀（允许类型的数组也允许）与泛型参数——泛型外壳可能不安全，只查最外层类型，保守处理。'''),
    (211, 'after', '''短名与全名都存：PS 运行时把 [int] 解析成 System.Int32，但校验匹配的是 AST 发出的字面文本，两种形式都得能对上。'''),
]
