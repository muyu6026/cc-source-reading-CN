# -*- coding: utf-8 -*-
# 第 167 批：src/commands/install-github-app/ErrorStep.tsx 批注数据（编译器产物）
ANNOTATIONS = [
    (1, 'after', '''依赖：React Compiler 运行时、React、GitHub Action 文档链接常量、ink 的 Box 与 Text。'''),
    (4, 'after', '''ErrorStepProps 接口：三个字段都可选，错误可能只有 message 没有原因或步骤。'''),
    (10, 'after', '''ErrorStep 组件：编译器把每个条件渲染缓存到 dollar 槽，命中就复用否则重建。'''),
    (56, 'after', '''组装层：把标题、错误、原因、步骤、文档链接逐层拼进圆角边框盒子。'''),
    (72, 'after', '''收尾层：把组装好的盒子与「按任意键退出」提示合并返回。'''),
    (81, 'after', '''ErrorStep 收尾：组件闭合并交付给安装向导的失败展示页。'''),
    (84, 'after', '''临时函数 _temp：把每条修复指令渲染成带圆点前缀的行。'''),
    (85, 'after', '''文件收尾：ErrorStep 配合其它 Step 组成完整的安装 GitHub App 向导失败流程。'''),
]
