import chalk from 'chalk';
import { randomBytes } from 'crypto';
import { copyFile, mkdir, readFile, writeFile } from 'fs/promises';
import { homedir, platform } from 'os';
import { dirname, join } from 'path';
import type { ThemeName } from 'src/utils/theme.js';
import { pathToFileURL } from 'url';
import { supportsHyperlinks } from '../../ink/supports-hyperlinks.js';
import { color } from '../../ink.js';
import { maybeMarkProjectOnboardingComplete } from '../../projectOnboardingState.js';
import type { ToolUseContext } from '../../Tool.js';
import type { LocalJSXCommandContext, LocalJSXCommandOnDone } from '../../types/command.js';
import { backupTerminalPreferences, checkAndRestoreTerminalBackup, getTerminalPlistPath, markTerminalSetupComplete } from '../../utils/appleTerminalBackup.js';
import { setupShellCompletion } from '../../utils/completionCache.js';
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js';
import { env } from '../../utils/env.js';
import { isFsInaccessible } from '../../utils/errors.js';
import { execFileNoThrow } from '../../utils/execFileNoThrow.js';
import { addItemToJSONCArray, safeParseJSONC } from '../../utils/json.js';
import { logError } from '../../utils/log.js';
import { getPlatform } from '../../utils/platform.js';
import { jsonParse, jsonStringify } from '../../utils/slowOperations.js';
// 换行在这里统一成一个常量：拼装的多行提示文案里到处都要用
const EOL = '\n';

// Terminals that natively support CSI u / Kitty keyboard protocol
// 原生支持新式键盘协议的五个终端：它们不需要任何配置，换行组合键本就可用
const NATIVE_CSIU_TERMINALS: Record<string, string> = {
  ghostty: 'Ghostty',
  kitty: 'Kitty',
  'iTerm.app': 'iTerm2',
  WezTerm: 'WezTerm',
  WarpTerminal: 'Warp'
};

/**
 * Detect if we're running in a VSCode Remote SSH session.
 * In this case, keybindings need to be installed on the LOCAL machine,
 * not the remote server where Claude is running.
 */
// 远程会话判定：键位要装在本地机器上，装在远端服务器上没用
function isVSCodeRemoteSSH(): boolean {
  const askpassMain = process.env.VSCODE_GIT_ASKPASS_MAIN ?? '';
  const path = process.env.PATH ?? '';

  // Check both env vars - VSCODE_GIT_ASKPASS_MAIN is more reliable when git extension
  // is active, and PATH is a fallback. Omit path separator for Windows compatibility.
// 两个环境都看：ASKPASS 更可靠（Git 扩展启用时才有），路径变量是兜底。这里刻意不比较分隔符，Windows 上斜杠与反斜杠都能命中
  return askpassMain.includes('.vscode-server') || askpassMain.includes('.cursor-server') || askpassMain.includes('.windsurf-server') || path.includes('.vscode-server') || path.includes('.cursor-server') || path.includes('.windsurf-server');
}
// 查终端是否原生支持，返回可读的显示名给提示文案用
export function getNativeCSIuTerminalDisplayName(): string | null {
  if (!env.terminal || !(env.terminal in NATIVE_CSIU_TERMINALS)) {
    return null;
  }
  return NATIVE_CSIU_TERMINALS[env.terminal] ?? null;
}

/**
 * Format a file path as a clickable hyperlink.
 *
 * Paths containing spaces (e.g., "Application Support") are not clickable
 * in most terminals - they get split at the space. OSC 8 hyperlinks solve
 * this by embedding a file:// URL that the terminal can open on click,
 * while displaying the clean path to the user.
 *
 * Unlike createHyperlink(), this doesn't apply any color styling so the
 * path inherits the parent's styling (e.g., chalk.dim).
 */
// 把本地路径包成可点击的链接：路径里有空格时，多数终端会在空格处截断，只有文件协议的链接能整条点开
function formatPathLink(filePath: string): string {
// 终端不支持超链接就直接给原路径，用户还能自己复制
  if (!supportsHyperlinks()) {
    return filePath;
  }
  const fileUrl = pathToFileURL(filePath).href;
  // OSC 8 hyperlink: \e]8;;URL\a TEXT \e]8;;\a
// 这是标准的超链接转义序列：先给地址，再给显示文本，最后收尾。刻意不加颜色，让路径继承外层的暗淡样式
  return `\x1b]8;;${fileUrl}\x07${filePath}\x1b]8;;\x07`;
}
// 判断该不该提供配置：原生支持的终端与不认识的终端都不做
export function shouldOfferTerminalSetup(): boolean {
  // iTerm2, WezTerm, Ghostty, Kitty, and Warp natively support CSI u / Kitty
  // keyboard protocol, which Claude Code already parses. No setup needed for
  // these terminals.
// 这里的与或优先级就是逻辑：苹果终端只在 macOS 上算数，其余几个编辑器内置终端跨平台都认
  return platform() === 'darwin' && env.terminal === 'Apple_Terminal' || env.terminal === 'vscode' || env.terminal === 'cursor' || env.terminal === 'windsurf' || env.terminal === 'alacritty' || env.terminal === 'zed';
}
// 按终端分派到各自的安装函数，返回值是一段给用户看的说明文字
export async function setupTerminal(theme: ThemeName): Promise<string> {
  let result = '';
  switch (env.terminal) {
    case 'Apple_Terminal':
      result = await enableOptionAsMetaForTerminal(theme);
      break;
    case 'vscode':
      result = await installBindingsForVSCodeTerminal('VSCode', theme);
      break;
    case 'cursor':
      result = await installBindingsForVSCodeTerminal('Cursor', theme);
      break;
    case 'windsurf':
      result = await installBindingsForVSCodeTerminal('Windsurf', theme);
      break;
    case 'alacritty':
      result = await installBindingsForAlacritty(theme);
      break;
    case 'zed':
      result = await installBindingsForZed(theme);
      break;
// 识别不出终端就什么都不做，也不写配置
    case null:
      break;
  }
// 两个不同的完成标记：编辑器系记的是换行键位，苹果终端记的是选项键当元键
  saveGlobalConfig(current => {
    if (['vscode', 'cursor', 'windsurf', 'alacritty', 'zed'].includes(env.terminal ?? '')) {
      if (current.shiftEnterKeyBindingInstalled === true) return current;
      return {
        ...current,
        shiftEnterKeyBindingInstalled: true
      };
    } else if (env.terminal === 'Apple_Terminal') {
      if (current.optionAsMetaKeyInstalled === true) return current;
      return {
        ...current,
        optionAsMetaKeyInstalled: true
      };
    }
    return current;
  });
// 顺手把新手引导标记为完成：用户跑到这一步说明已经会用基础操作了
  maybeMarkProjectOnboardingComplete();

  // Install shell completions (ant-only, since the completion command is ant-only)
// 又是一次构建期替换：括号里的字面量让整段只在内部构建里保留，外部构建连函数引用都会被消掉
  if ("external" === 'ant') {
    result += await setupShellCompletion(theme);
  }
  return result;
}
// 配置里的完成标记是弱判据：用户可能自己删了键位，所以只用来决定是否再提示一次
export function isShiftEnterKeyBindingInstalled(): boolean {
  return getGlobalConfig().shiftEnterKeyBindingInstalled === true;
}
// 反斜杠回车是内置的换行方式，与要装的组合键是两条独立路径
export function hasUsedBackslashReturn(): boolean {
  return getGlobalConfig().hasUsedBackslashReturn === true;
}
export function markBackslashReturnUsed(): void {
  const config = getGlobalConfig();
  if (!config.hasUsedBackslashReturn) {
    saveGlobalConfig(current => ({
      ...current,
      hasUsedBackslashReturn: true
    }));
  }
}
// 命令入口：三种结局——原生支持、终端不支持、真的去装
export async function call(onDone: LocalJSXCommandOnDone, context: ToolUseContext & LocalJSXCommandContext, _args: string): Promise<null> {
// 原生支持就直接告诉用户不用配，一行都不用改
  if (env.terminal && env.terminal in NATIVE_CSIU_TERMINALS) {
    const message = `Shift+Enter is natively supported in ${NATIVE_CSIU_TERMINALS[env.terminal]}.

No configuration needed. Just use Shift+Enter to add newlines.`;
    onDone(message);
    return null;
  }

  // Check if terminal is supported
// 不支持的终端给一段手把手指引，包括退出终端复用器再回来
  if (!shouldOfferTerminalSetup()) {
    const terminalName = env.terminal || 'your current terminal';
    const currentPlatform = getPlatform();

    // Build platform-specific terminal suggestions
    let platformTerminals = '';
// 按平台给可用终端清单，其余平台不列——目前没有支持的原生终端
    if (currentPlatform === 'macos') {
      platformTerminals = '   • macOS: Apple Terminal\n';
    } else if (currentPlatform === 'windows') {
      platformTerminals = '   • Windows: Windows Terminal\n';
    }
    // For Linux and other platforms, we don't show native terminal options
    // since they're not currently supported

// 这段提示很重要：不装也能用，只是要打反斜杠，避免用户以为这是必需步骤
    const message = `Terminal setup cannot be run from ${terminalName}.

This command configures a convenient Shift+Enter shortcut for multi-line prompts.
${chalk.dim('Note: You can already use backslash (\\\\) + return to add newlines.')}

To set up the shortcut (optional):
1. Exit tmux/screen temporarily
2. Run /terminal-setup directly in one of these terminals:
${platformTerminals}   • IDE: VSCode, Cursor, Windsurf, Zed
   • Other: Alacritty
3. Return to tmux/screen - settings will persist

${chalk.dim('Note: iTerm2, WezTerm, Ghostty, Kitty, and Warp support Shift+Enter natively.')}`;
    onDone(message);
    return null;
  }
// 真正执行安装，主题从命令上下文取，用于给成功与警告文案上色
  const result = await setupTerminal(context.options.theme);
  onDone(result);
  return null;
}
type VSCodeKeybinding = {
  key: string;
  command: string;
  args: {
    text: string;
  };
  when: string;
};
// 编辑器系三种终端共用一套键位安装逻辑，只有目录名与文案不同
async function installBindingsForVSCodeTerminal(editor: 'VSCode' | 'Cursor' | 'Windsurf' = 'VSCode', theme: ThemeName): Promise<string> {
  // Check if we're running in a VSCode Remote SSH session
  // In this case, keybindings need to be installed on the LOCAL machine
// 远程会话直接放弃安装，改为给出在本地操作的步骤与要粘贴的配置片段
  if (isVSCodeRemoteSSH()) {
    return `${color('warning', theme)(`Cannot install keybindings from a remote ${editor} session.`)}${EOL}${EOL}${editor} keybindings must be installed on your local machine, not the remote server.${EOL}${EOL}To install the Shift+Enter keybinding:${EOL}1. Open ${editor} on your local machine (not connected to remote)${EOL}2. Open the Command Palette (Cmd/Ctrl+Shift+P) → "Preferences: Open Keyboard Shortcuts (JSON)"${EOL}3. Add this keybinding (the file must be a JSON array):${EOL}${EOL}${chalk.dim(`[
  {
    "key": "shift+enter",
    "command": "workbench.action.terminal.sendSequence",
    "args": { "text": "\\u001b\\r" },
    "when": "terminalFocus"
  }
]`)}${EOL}`;
  }
// 编辑器目录名与产品名不一致：代码编辑器的配置目录叫 Code
  const editorDir = editor === 'VSCode' ? 'Code' : editor;
// 三个平台三种用户目录：Windows 在漫游数据下，macOS 在应用支持下，其余走点配置
  const userDirPath = join(homedir(), platform() === 'win32' ? join('AppData', 'Roaming', editorDir, 'User') : platform() === 'darwin' ? join('Library', 'Application Support', editorDir, 'User') : join('.config', editorDir, 'User'));
  const keybindingsPath = join(userDirPath, 'keybindings.json');
  try {
    // Ensure user directory exists (idempotent with recursive)
// 递归创建目录，已存在也不报错，天然幂等
    await mkdir(userDirPath, {
      recursive: true
    });

    // Read existing keybindings file, or default to empty array if it doesn't exist
// 默认内容是一个空数组：没有配置文件时也要能追加出合法的数组
    let content = '[]';
    let keybindings: VSCodeKeybinding[] = [];
    let fileExists = false;
    try {
      content = await readFile(keybindingsPath, {
        encoding: 'utf-8'
      });
      fileExists = true;
// 用允许注释的解析器：这个文件常被人手写注释，标准 JSON 解析会直接失败
      keybindings = safeParseJSONC(content) as VSCodeKeybinding[] ?? [];
    } catch (e: unknown) {
      if (!isFsInaccessible(e)) throw e;
    }

    // Backup the existing file before modifying it
// 改之前先备份，而且备份失败就整体放弃——宁可不装，也不能把用户的键位弄坏
    if (fileExists) {
// 备份名带四字节随机后缀，多次运行不会互相覆盖
      const randomSha = randomBytes(4).toString('hex');
      const backupPath = `${keybindingsPath}.${randomSha}.bak`;
      try {
        await copyFile(keybindingsPath, backupPath);
      } catch {
        return `${color('warning', theme)(`Error backing up existing ${editor} terminal keybindings. Bailing out.`)}${EOL}${chalk.dim(`See ${formatPathLink(keybindingsPath)}`)}${EOL}${chalk.dim(`Backup path: ${formatPathLink(backupPath)}`)}${EOL}`;
      }
    }

    // Check if keybinding already exists
// 判重看三个字段的组合：键、命令、生效条件。少比一个就可能重复添加
    const existingBinding = keybindings.find(binding => binding.key === 'shift+enter' && binding.command === 'workbench.action.terminal.sendSequence' && binding.when === 'terminalFocus');
    if (existingBinding) {
      return `${color('warning', theme)(`Found existing ${editor} terminal Shift+Enter key binding. Remove it to continue.`)}${EOL}${chalk.dim(`See ${formatPathLink(keybindingsPath)}`)}${EOL}`;
    }

    // Create the new keybinding
// 要插入的键位把转义序列写成两个字符：ESC 加回车，终端收到即换行
    const newKeybinding: VSCodeKeybinding = {
      key: 'shift+enter',
      command: 'workbench.action.terminal.sendSequence',
      args: {
        text: '\u001b\r'
      },
      when: 'terminalFocus'
    };

    // Modify the content by adding the new keybinding while preserving comments and formatting
// 用专门的追加函数而不是整份重写：它能在保留注释与缩进的前提下往数组里塞一项
    const updatedContent = addItemToJSONCArray(content, newKeybinding);

    // Write the updated content back to the file
    await writeFile(keybindingsPath, updatedContent, {
      encoding: 'utf-8'
    });
    return `${color('success', theme)(`Installed ${editor} terminal Shift+Enter key binding`)}${EOL}${chalk.dim(`See ${formatPathLink(keybindingsPath)}`)}${EOL}`;
  } catch (error) {
    logError(error);
    throw new Error(`Failed to install ${editor} terminal Shift+Enter key binding`);
  }
}
// 苹果终端的配置在二进制属性列表里，只能用系统自带的属性列表工具改
async function enableOptionAsMetaForProfile(profileName: string): Promise<boolean> {
  // First try to add the property (in case it doesn't exist)
  // Quote the profile name to handle names with spaces (e.g., "Man Page", "Red Sands")
// 配置项名里带空格，所以键路径每一段都加了单引号；解构出来的只是退出码，输出不用
  const {
    code: addCode
  } = await execFileNoThrow('/usr/libexec/PlistBuddy', ['-c', `Add :'Window Settings':'${profileName}':useOptionAsMetaKey bool true`, getTerminalPlistPath()]);

  // If adding fails (likely because it already exists), try setting it instead
// 先尝试新增，失败通常意味着这一项已经存在，于是改为覆盖设置
  if (addCode !== 0) {
    const {
      code: setCode
    } = await execFileNoThrow('/usr/libexec/PlistBuddy', ['-c', `Set :'Window Settings':'${profileName}':useOptionAsMetaKey true`, getTerminalPlistPath()]);
    if (setCode !== 0) {
      logError(new Error(`Failed to enable Option as Meta key for Terminal.app profile: ${profileName}`));
      return false;
    }
  }
  return true;
}
// 同一条路径关闭提示音：换行键装上了但每按一次都响一声，体验反而更差
async function disableAudioBellForProfile(profileName: string): Promise<boolean> {
  // First try to add the property (in case it doesn't exist)
  // Quote the profile name to handle names with spaces (e.g., "Man Page", "Red Sands")
  const {
    code: addCode
  } = await execFileNoThrow('/usr/libexec/PlistBuddy', ['-c', `Add :'Window Settings':'${profileName}':Bell bool false`, getTerminalPlistPath()]);

  // If adding fails (likely because it already exists), try setting it instead
  if (addCode !== 0) {
    const {
      code: setCode
    } = await execFileNoThrow('/usr/libexec/PlistBuddy', ['-c', `Set :'Window Settings':'${profileName}':Bell false`, getTerminalPlistPath()]);
    if (setCode !== 0) {
      logError(new Error(`Failed to disable audio bell for Terminal.app profile: ${profileName}`));
      return false;
    }
  }
  return true;
}

// Enable Option as Meta key for Terminal.app
// 苹果终端的完整安装流程：备份、读两个配置、逐项改、刷缓存
async function enableOptionAsMetaForTerminal(theme: ThemeName): Promise<string> {
  try {
    // Create a backup of the current plist file
// 第一步就是备份，后面的任何一步失败都靠它回滚
    const backupPath = await backupTerminalPreferences();
    if (!backupPath) {
      throw new Error('Failed to create backup of Terminal.app preferences, bailing out');
    }

    // Read the current default profile from the plist
// 读默认窗口配置名；读不到就整体放弃，因为不知道要改哪一项
    const {
      stdout: defaultProfile,
      code: readCode
    } = await execFileNoThrow('defaults', ['read', 'com.apple.Terminal', 'Default Window Settings']);
    if (readCode !== 0 || !defaultProfile.trim()) {
      throw new Error('Failed to read default Terminal.app profile');
    }
    const {
      stdout: startupProfile,
      code: startupCode
    } = await execFileNoThrow('defaults', ['read', 'com.apple.Terminal', 'Startup Window Settings']);
    if (startupCode !== 0 || !startupProfile.trim()) {
      throw new Error('Failed to read startup Terminal.app profile');
    }
    let wasAnyProfileUpdated = false;
    const defaultProfileName = defaultProfile.trim();
    const optionAsMetaEnabled = await enableOptionAsMetaForProfile(defaultProfileName);
    const audioBellDisabled = await disableAudioBellForProfile(defaultProfileName);
    if (optionAsMetaEnabled || audioBellDisabled) {
      wasAnyProfileUpdated = true;
    }
    const startupProfileName = startupProfile.trim();

    // Only proceed if the startup profile is different from the default profile
// 启动配置可能和默认配置不是同一个，两个都要改，否则新开窗口还是旧行为
    if (startupProfileName !== defaultProfileName) {
      const startupOptionAsMetaEnabled = await enableOptionAsMetaForProfile(startupProfileName);
      const startupAudioBellDisabled = await disableAudioBellForProfile(startupProfileName);
      if (startupOptionAsMetaEnabled || startupAudioBellDisabled) {
        wasAnyProfileUpdated = true;
      }
    }
// 一项都没改成说明整个流程无效，抛错让外层走回滚
    if (!wasAnyProfileUpdated) {
      throw new Error('Failed to enable Option as Meta key or disable audio bell for any Terminal.app profile');
    }

    // Flush the preferences cache
// 改完要杀掉偏好缓存进程，否则终端重启后读到的还是旧值
    await execFileNoThrow('killall', ['cfprefsd']);
    markTerminalSetupComplete();
    return `${color('success', theme)(`Configured Terminal.app settings:`)}${EOL}${color('success', theme)('- Enabled "Use Option as Meta key"')}${EOL}${color('success', theme)('- Switched to visual bell')}${EOL}${chalk.dim('Option+Enter will now enter a newline.')}${EOL}${chalk.dim('You must restart Terminal.app for changes to take effect.', theme)}${EOL}`;
  } catch (error) {
    logError(error);

    // Attempt to restore from backup
// 失败时按备份恢复，并把三种恢复结果翻译成三句不同的话：已恢复、恢复失败给手动命令、没有备份可恢复
    const restoreResult = await checkAndRestoreTerminalBackup();
    const errorMessage = 'Failed to enable Option as Meta key for Terminal.app.';
    if (restoreResult.status === 'restored') {
      throw new Error(`${errorMessage} Your settings have been restored from backup.`);
    } else if (restoreResult.status === 'failed') {
      throw new Error(`${errorMessage} Restoring from backup failed, try manually with: defaults import com.apple.Terminal ${restoreResult.backupPath}`);
    } else {
      throw new Error(`${errorMessage} No backup was available to restore from.`);
    }
  }
}
// 第三个终端：配置文件是 TOML，只能靠追加片段而不能像 JSON 那样解析后改写
async function installBindingsForAlacritty(theme: ThemeName): Promise<string> {
// 要追加的片段本身是多行字符串，转义序列在 TOML 里要再转义一层
  const ALACRITTY_KEYBINDING = `[[keyboard.bindings]]
key = "Return"
mods = "Shift"
chars = "\\u001B\\r"`;

  // Get Alacritty config file paths in order of preference
  const configPaths: string[] = [];

  // XDG config path (Linux and macOS)
// 配置路径按优先级排：环境变量优先，其次家目录下的点配置
  const xdgConfigHome = process.env.XDG_CONFIG_HOME;
  if (xdgConfigHome) {
    configPaths.push(join(xdgConfigHome, 'alacritty', 'alacritty.toml'));
  } else {
    configPaths.push(join(homedir(), '.config', 'alacritty', 'alacritty.toml'));
  }

  // Windows-specific path
// Windows 上多一个候选：漫游应用数据目录
  if (platform() === 'win32') {
    const appData = process.env.APPDATA;
    if (appData) {
      configPaths.push(join(appData, 'alacritty', 'alacritty.toml'));
    }
  }

  // Find existing config file by attempting to read it, or use first preferred path
  let configPath: string | null = null;
  let configContent = '';
  let configExists = false;
// 逐个试读，第一个读成功的就用它——这比猜文件是否存在更可靠，顺带验证了可读性
  for (const path of configPaths) {
    try {
      configContent = await readFile(path, {
        encoding: 'utf-8'
      });
      configPath = path;
      configExists = true;
      break;
    } catch (e: unknown) {
      if (!isFsInaccessible(e)) throw e;
      // File missing or inaccessible — try next config path
    }
  }

  // If no config exists, use the first path (XDG/default location)
// 一个都不存在就用首选路径新建，不报错
  if (!configPath) {
    configPath = configPaths[0] ?? null;
  }
  if (!configPath) {
    throw new Error('No valid config path found for Alacritty');
  }
  try {
    if (configExists) {
      // Check if keybinding already exists (look for Shift+Return binding)
// 判重用两个子串同时命中：只看键名会误判别的组合，只看修饰键也一样
      if (configContent.includes('mods = "Shift"') && configContent.includes('key = "Return"')) {
        return `${color('warning', theme)('Found existing Alacritty Shift+Enter key binding. Remove it to continue.')}${EOL}${chalk.dim(`See ${formatPathLink(configPath)}`)}${EOL}`;
      }

      // Create backup
      const randomSha = randomBytes(4).toString('hex');
      const backupPath = `${configPath}.${randomSha}.bak`;
      try {
        await copyFile(configPath, backupPath);
      } catch {
        return `${color('warning', theme)('Error backing up existing Alacritty config. Bailing out.')}${EOL}${chalk.dim(`See ${formatPathLink(configPath)}`)}${EOL}${chalk.dim(`Backup path: ${formatPathLink(backupPath)}`)}${EOL}`;
      }
    } else {
      // Ensure config directory exists (idempotent with recursive)
      await mkdir(dirname(configPath), {
        recursive: true
      });
    }

    // Add the keybinding to the config
    let updatedContent = configContent;
    if (configContent && !configContent.endsWith('\n')) {
      updatedContent += '\n';
    }
// 追加前先补一个空行，避免和前一段配置粘在一起
    updatedContent += '\n' + ALACRITTY_KEYBINDING + '\n';

    // Write the updated config
    await writeFile(configPath, updatedContent, {
      encoding: 'utf-8'
    });
    return `${color('success', theme)('Installed Alacritty Shift+Enter key binding')}${EOL}${color('success', theme)('You may need to restart Alacritty for changes to take effect')}${EOL}${chalk.dim(`See ${formatPathLink(configPath)}`)}${EOL}`;
  } catch (error) {
    logError(error);
    throw new Error('Failed to install Alacritty Shift+Enter key binding');
  }
}
// 第四个终端：键位文件是 JSON 数组，结构与编辑器系类似但字段不同
async function installBindingsForZed(theme: ThemeName): Promise<string> {
  // Zed uses JSON keybindings similar to VSCode
// 配置目录固定在点配置下，跨平台一致
  const zedDir = join(homedir(), '.config', 'zed');
  const keymapPath = join(zedDir, 'keymap.json');
  try {
    // Ensure zed directory exists (idempotent with recursive)
    await mkdir(zedDir, {
      recursive: true
    });

    // Read existing keymap file, or default to empty array if it doesn't exist
    let keymapContent = '[]';
    let fileExists = false;
    try {
      keymapContent = await readFile(keymapPath, {
        encoding: 'utf-8'
      });
      fileExists = true;
    } catch (e: unknown) {
      if (!isFsInaccessible(e)) throw e;
    }
    if (fileExists) {
      // Check if keybinding already exists
// 判重只能靠子串：这个文件没有统一结构，解析后再比反而容易漏
      if (keymapContent.includes('shift-enter')) {
        return `${color('warning', theme)('Found existing Zed Shift+Enter key binding. Remove it to continue.')}${EOL}${chalk.dim(`See ${formatPathLink(keymapPath)}`)}${EOL}`;
      }

      // Create backup
      const randomSha = randomBytes(4).toString('hex');
      const backupPath = `${keymapPath}.${randomSha}.bak`;
      try {
        await copyFile(keymapPath, backupPath);
      } catch {
        return `${color('warning', theme)('Error backing up existing Zed keymap. Bailing out.')}${EOL}${chalk.dim(`See ${formatPathLink(keymapPath)}`)}${EOL}${chalk.dim(`Backup path: ${formatPathLink(backupPath)}`)}${EOL}`;
      }
    }

    // Parse and modify the keymap
    let keymap: Array<{
      context?: string;
      bindings: Record<string, string | string[]>;
    }>;
    try {
// 解析失败或不是数组都当空数组处理：宁可从空开始，也不要因为文件脏就整个失败
      keymap = jsonParse(keymapContent);
      if (!Array.isArray(keymap)) {
        keymap = [];
      }
    } catch {
      keymap = [];
    }

    // Add the new keybinding for terminal context
// 键位按上下文分组，只作用于终端；值是命令加参数的形式
    keymap.push({
      context: 'Terminal',
      bindings: {
        'shift-enter': ['terminal::SendText', '\u001b\r']
      }
    });

    // Write the updated keymap
// 写回时统一两空格缩进并补尾换行，保持文件可读
    await writeFile(keymapPath, jsonStringify(keymap, null, 2) + '\n', {
      encoding: 'utf-8'
    });
    return `${color('success', theme)('Installed Zed Shift+Enter key binding')}${EOL}${chalk.dim(`See ${formatPathLink(keymapPath)}`)}${EOL}`;
  } catch (error) {
    logError(error);
    throw new Error('Failed to install Zed Shift+Enter key binding');
  }
}
// 原文件此处有一行 55676 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。