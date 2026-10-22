# -*- coding: utf-8 -*-
"""WebFetchTool/preapproved.ts 第 1 部分"""

ANNOTATIONS = [
    (13, 'after', '''preapproved.ts：免审批白名单。原则上 WebFetch 只准抓用户以某种形式
提供过的域；这里为代码相关文档站开例外。SECURITY 警告：本清单只用于 WebFetch
（纯 GET），沙箱网络限制故意不继承它——对 huggingface/kaggle/nuget 这类
可上传文件的域放开任意网络访问等于开数据外带通道。
配套测试：utils/sandbox/webfetch-preapproved-separation.test.ts。'''),
    (131, 'after', '''130+ 条按类别分组：Anthropic 官方、各语言官方文档、前端/Python/PHP/Java/.NET
框架、移动端、ML、数据库、云与 DevOps、测试、游戏引擎、基础工具。'''),
    (152, 'after', '''模块加载时拆一次：绝大多数条目只有主机名 → 进 Set（O(1) 查询）；
少数带路径的（如 github.com/anthropics）进 Map<host, 前缀列表> 做前缀匹配。'''),
    (166, 'after', '''路径前缀必须按段边界匹配：/anthropics 不能匹配到 /anthropics-evil/malware
——只接受完全相等或「前缀后紧跟 /」。'''),
]
