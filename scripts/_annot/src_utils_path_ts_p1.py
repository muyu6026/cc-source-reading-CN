# -*- coding: utf-8 -*-
SOURCE_PATH = 'src/utils/path.ts'
ANNOTATIONS = [
    (6, 'after', '''路径工具集：展开 ~ 与相对/绝对路径、绝对转相对、目录探测、目录穿越检测、配置键归一化，统一在本机原生格式下处理。'''),
    (32, 'before', '''expandPath 把各种写法（~、~/x、绝对、相对、Windows 上的 POSIX 风格路径）规范化成当前平台的绝对路径，全程做类型与空字节校验。'''),
    (85, 'after', '''expandPath 结束：相对路径按基准目录解析，Windows 上的 POSIX 路径先转本地格式。'''),
    (95, 'before', '''toRelativePath 把绝对路径转成相对 cwd 的写法以省 token；一旦超出 cwd（以 .. 开头）就保留绝对路径保证无歧义。'''),
    (99, 'after', '''toRelativePath 结束。'''),
    (109, 'before', '''getDirectoryForPath 返回某路径所在目录：本身是目录原样返回，是文件或不存在则返回父目录；UNC 路径跳过文件系统访问以防 NTLM 凭据泄露。'''),
    (125, 'after', '''getDirectoryForPath 结束。'''),
    (133, 'before', '''containsPathTraversal 用正则检测路径里是否含 .. 形式的向上级目录穿越片段。'''),
    (135, 'after', '''containsPathTraversal 结束。'''),
    (138, 'after', '''sanitizePath 从零依赖的共享源 re-export，保持单一实现。'''),
    (149, 'before', '''normalizePathForConfigKey 把路径归一化成统一的正斜杠，作为 JSON 配置键时跨 git/Node/用户输入的斜杠写法都能稳定匹配。'''),
    (155, 'after', '''normalizePathForConfigKey 结束。'''),
]
