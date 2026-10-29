# -*- coding: utf-8 -*-
SOURCE_PATH = 'src/utils/plugins/parseMarketplaceInput.ts'
ANNOTATIONS = [
    (25, 'before', '''parseMarketplaceInput 是插件源字符串的总入口，把用户输入解析成 git/url/file/directory/github 五类源，无法识别返回 null，出错返回 error 对象。'''),
    (39, 'after', '''先处理 git SSH 地址（任意用户名 @ 主机 : 路径，支持 #ref 后缀），命中即返回 git 源。'''),
    (72, 'after', '''对 http(s) 地址用 new URL 解析；非法 URL 退化为普通 url 源而不是抛错。'''),
    (88, 'after', '''URL 分支结束：github.com 域名下且形如 owner/repo 的按 git 克隆，否则按 url 源拉取 JSON。'''),
    (124, 'after', '''本地路径分支里用 stat 判断文件还是目录，吞掉所有 stat 错误（ENOENT/EACCES 等）转成 error 结果，复刻旧 existsSync 不抛错的行为。'''),
    (141, 'after', '''本地路径分支结束：文件必须指向 .json，目录按 directory 源返回。'''),
    (156, 'after', '''GitHub 简写分支：owner/repo（支持 # 或 @ 作 ref 分隔符，因为展示格式化用 @，用户会自然照抄）解析为 github 源。'''),
    (162, 'after', '''NPM 包源尚未实现，无法识别的输入一律返回 null。'''),
]
