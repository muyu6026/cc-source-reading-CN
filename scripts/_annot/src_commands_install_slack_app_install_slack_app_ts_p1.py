# 源文件: src/commands/install-slack-app/install-slack-app.ts
ANNOTATIONS = [
    (6, 'after', '''Slack 应用市场里 Claude 应用的固定安装链接，常量复用。'''),
    (9, 'after', '''先埋点：记录用户点击了「安装 Slack 应用」这个动作（tengu_ 前缀是内部事件名）。'''),
    (15, 'after', '''把全局配置里的 slackAppInstallCount 计数 +1，记录已触发安装意图（当前值缺省为 0）。'''),
    (17, 'after', '''拉起系统浏览器打开安装页，并拿到是否成功打开的标志。'''),
    (19, 'after', '''按打开结果返回：成功提示已在浏览器打开；失败则回退为「手动访问此链接」的文案。'''),
]
