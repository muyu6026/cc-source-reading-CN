# -*- coding: utf-8 -*-
# PowerShellTool/gitSafety.ts 批注数据
ANNOTATIONS = [
    (8, 'after', '''git 的两条武器化路径：裸仓库攻击（cwd 里有 HEAD、objects、refs 就被当成 bare 仓库、执行 cwd 里的 hooks）与「先写 git 内部文件再跑 git」的复合命令——本模块专门识别「参数指向 git 内部路径」的写操作。'''),
    (38, 'after', '''「绕经父目录再回到 cwd」的归一：以 ../ 加 cwd 目录名开头的路径先剥掉这层。posix.normalize 不带 cwd 上下文会保留前导 ..，导致校验器看到的路径与 PowerShell 运行时解析的不一致（检查/使用分歧）——../project/hooks 在 cwd=/x/project 时运行时就是 hooks。'''),
    (87, 'after', '''归一化顺序有讲究：先结构性剥离（冒号绑定参数值、引号、反引号转义、provider 前缀、盘符相对前缀），再按 NTFS 规则逐组件剥尾部空格与点（两点变一点、hooks. 变 hooks），最后 posix.normalize 加小写。每一步都对应一种真实的绕过尝试（bug #28、#22、#6 都在这修过）。'''),
    (89, 'after', '''git 内部前缀名单：head、objects、refs、hooks 四个裸仓库目录，外加 .git 与 git~N 短名——裸仓库与标准仓库两种形态都覆盖。'''),
    (105, 'after', '''这是裸仓库 HEAD 攻击的唯一防线：pathValidation 层刻意不把裸 HEAD 列入危险文件（合法同名文件误报太多）、危险目录也只按段匹配 .git——所以逃出 cwd 又落回 cwd 的路径必须在这里用真实 cwd 解析兜底。注释明说 load-bearing：删掉必须先补替代防线。'''),
    (132, 'after', '''head 与 .git 精确匹配；objects/refs/hooks 按目录段匹配（hooks/ 命中、hooksaw/ 不命中）；git~N 正则覆盖 NTFS 8.3 短文件名——多个 git 开头的点文件时 .git 可能注册成 GIT~1 甚至 GIT~2。'''),
    (151, 'after', '''两段判定：先归一化直接匹配；仍带前导 .. 或绝对路径的，用真实 cwd 解析后若落回 cwd 内的 git 内部位置，防线照样触发——..\\<cwd 名>\\HEAD 与 C:\\全路径\\HEAD 这类 posix.normalize 处理不了的形态都在这收口。'''),
    (168, 'after', '''isDotGitPathPS 与上者的差异：不匹配根级 hooks、refs 等裸仓库形态——那些是常见的项目目录名，只认 .git 内部，减少误伤。'''),
    (176, 'after', '''8.3 短名的完整处理：.git 变 GIT~1、第二个 git 开头的点文件变 GIT~2——归一化已小写，正则用数字兜住任意序号。'''),
]
