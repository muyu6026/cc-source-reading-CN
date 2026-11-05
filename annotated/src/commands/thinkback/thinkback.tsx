// 编译器产物：下面两个组件的记忆槽与临时变量都是生成出来的
import { c as _c } from "react/compiler-runtime";
import { execa } from 'execa';
import { readFile } from 'fs/promises';
import { join } from 'path';
import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import type { CommandResultDisplay } from '../../commands.js';
import { Select } from '../../components/CustomSelect/select.js';
import { Dialog } from '../../components/design-system/Dialog.js';
import { Spinner } from '../../components/Spinner.js';
import instances from '../../ink/instances.js';
import { Box, Text } from '../../ink.js';
import { enablePluginOp } from '../../services/plugins/pluginOperations.js';
import { logForDebugging } from '../../utils/debug.js';
import { isENOENT, toError } from '../../utils/errors.js';
import { execFileNoThrow } from '../../utils/execFileNoThrow.js';
import { pathExists } from '../../utils/file.js';
import { logError } from '../../utils/log.js';
import { getPlatform } from '../../utils/platform.js';
import { clearAllCaches } from '../../utils/plugins/cacheUtils.js';
import { isPluginInstalled } from '../../utils/plugins/installedPluginsManager.js';
import { addMarketplaceSource, clearMarketplacesCache, loadKnownMarketplacesConfig, refreshMarketplace } from '../../utils/plugins/marketplaceManager.js';
import { OFFICIAL_MARKETPLACE_NAME } from '../../utils/plugins/officialMarketplace.js';
import { loadAllPlugins } from '../../utils/plugins/pluginLoader.js';
import { installSelectedPlugins } from '../../utils/plugins/pluginStartupCheck.js';

// 市场与插件标识按用户类型分两套：内部构建用自建市场，外部构建用公开市场
// Marketplace and plugin identifiers - varies by user type
const INTERNAL_MARKETPLACE_NAME = 'claude-code-marketplace';
const INTERNAL_MARKETPLACE_REPO = 'anthropics/claude-code-marketplace';
const OFFICIAL_MARKETPLACE_REPO = 'anthropics/claude-plugins-official';
function getMarketplaceName(): string {
// 这里是一次构建期替换的结果：源码原本比较用户类型常量，打包时被替换成了字面量 external，所以这个三元永远走后面一支
  return "external" === 'ant' ? INTERNAL_MARKETPLACE_NAME : OFFICIAL_MARKETPLACE_NAME;
}
function getMarketplaceRepo(): string {
  return "external" === 'ant' ? INTERNAL_MARKETPLACE_REPO : OFFICIAL_MARKETPLACE_REPO;
}
function getPluginId(): string {
// 插件标识由名字加市场名拼成，市场名不同则标识不同，后面所有安装与启用都靠它
  return `thinkback@${getMarketplaceName()}`;
}
const SKILL_NAME = 'thinkback';

/**
 * Get the thinkback skill directory from the installed plugin's cache path
 */
// 从已加载的插件里反查技能目录：先按名字命中，再退化到来源里含插件标识
async function getThinkbackSkillDir(): Promise<string | null> {
  const {
    enabled
  } = await loadAllPlugins();
  const thinkbackPlugin = enabled.find(p => p.name === 'thinkback' || p.source && p.source.includes(getPluginId()));
  if (!thinkbackPlugin) {
    return null;
  }
// 技能目录固定是插件路径下的 skills 加技能名，存在才返回
  const skillDir = join(thinkbackPlugin.path, 'skills', SKILL_NAME);
  if (await pathExists(skillDir)) {
    return skillDir;
  }
  return null;
}
// 播放动画：整个函数的返回值是成功标志与一句给用户看的话，不抛异常
export async function playAnimation(skillDir: string): Promise<{
  success: boolean;
  message: string;
}> {
// 两个文件都是子进程的前置条件，所以在这里统一校验，而不是让每个调用方各查一遍
  const dataPath = join(skillDir, 'year_in_review.js');
  const playerPath = join(skillDir, 'player.js');

// 关键点：子进程带 reject 关掉，文件缺失时不会抛错，会静默返回成功——所以必须自己先读一遍
  // Both files are prerequisites for the node subprocess. Read them here
  // (not at call sites) so all callers get consistent error messaging. The
  // subprocess runs with reject: false, so a missing file would otherwise
  // silently return success. Using readFile (not access) per CLAUDE.md.
  //
  // Non-ENOENT errors (EACCES etc) are logged and returned as failures rather
  // than thrown — the old pathExists-based code never threw, and one caller
  // (handleSelect) uses `void playAnimation().then(...)` without a .catch().
// 用读文件而不是存在性检查：读失败能区分不存在与无权限，也顺手验证了可读性
  try {
    await readFile(dataPath);
  } catch (e: unknown) {
// 文件不存在是预期内的（还没生成过），给一句指引让用户先跑生成命令
    if (isENOENT(e)) {
      return {
        success: false,
        message: 'No animation found. Run /think-back first to generate one.'
      };
    }
// 其余错误记日志后同样返回失败而不是抛出：有个调用方用的是不带 catch 的链式调用，抛出去会变成未处理拒绝
    logError(e);
    return {
      success: false,
      message: `Could not access animation data: ${toError(e).message}`
    };
  }
  try {
    await readFile(playerPath);
  } catch (e: unknown) {
    if (isENOENT(e)) {
      return {
        success: false,
        message: 'Player script not found. The player.js file is missing from the thinkback skill.'
      };
    }
    logError(e);
    return {
      success: false,
      message: `Could not access player script: ${toError(e).message}`
    };
  }

  // Get ink instance for terminal takeover
// 拿终端实例是为了接管屏幕：动画要在备用屏里放，退出后再回到原来的界面
  const inkInstance = instances.get(process.stdout);
  if (!inkInstance) {
    return {
      success: false,
      message: 'Failed to access terminal instance'
    };
  }
// 进备用屏，之后无论子进程怎么结束都要退出
  inkInstance.enterAlternateScreen();
  try {
// 子进程用继承的标准流，工作目录设为技能目录——播放器脚本按相对路径读数据
    await execa('node', [playerPath], {
      stdio: 'inherit',
      cwd: skillDir,
      reject: false
    });
// 中断（比如用户按中断键）也会走到这里，不当错误处理
  } catch {
    // Animation may have been interrupted (e.g., Ctrl+C)
// 收尾放在 finally 里，保证备用屏一定退出，否则终端会卡在黑屏
  } finally {
    inkInstance.exitAlternateScreen();
  }

  // Open the HTML file in browser for video download
// 顺带把同目录的网页打开：那里提供视频下载入口
  const htmlPath = join(skillDir, 'year_in_review.html');
  if (await pathExists(htmlPath)) {
    const platform = getPlatform();
// 三个平台三种打开方式
    const openCmd = platform === 'macos' ? 'open' : platform === 'windows' ? 'start' : 'xdg-open';
    void execFileNoThrow(openCmd, [htmlPath]);
  }
  return {
    success: true,
    message: 'Year in review animation complete!'
  };
}
// 安装状态是六段判别联合：检查、装市场、装插件、启用插件、就绪、失败
type InstallState = {
  phase: 'checking';
} | {
  phase: 'installing-marketplace';
} | {
  phase: 'installing-plugin';
} | {
  phase: 'enabling-plugin';
} | {
  phase: 'ready';
} | {
  phase: 'error';
  message: string;
};
function ThinkbackInstaller({
  onReady,
  onError
}: {
  onReady: () => void;
  onError: (message: string) => void;
}): React.ReactNode {
// 只有一个状态对象加一句进度文案：进度由安装 API 的回调推进来
  const [state, setState] = useState<InstallState>({
    phase: 'checking'
  });
  const [progressMessage, setProgressMessage] = useState('');
// 整个安装流程放在一个效果里跑一次，依赖是父级传下来的两个回调
  useEffect(() => {
    async function checkAndInstall(): Promise<void> {
      try {
        // Check if marketplace is installed
        const knownMarketplaces = await loadKnownMarketplacesConfig();
        const marketplaceName = getMarketplaceName();
        const marketplaceRepo = getMarketplaceRepo();
        const pluginId = getPluginId();
// 市场配置是个以名字为键的对象，用 in 判断有没有装过
        const marketplaceInstalled = marketplaceName in knownMarketplaces;

        // Check if plugin is already installed first
// 插件的安装判断是同步的，直接读本地记录
        const pluginAlreadyInstalled = isPluginInstalled(pluginId);
// 市场没装就先装市场：这一步会把仓库克隆下来并注册，回调用于刷新进度提示
        if (!marketplaceInstalled) {
          // Install the marketplace
          setState({
            phase: 'installing-marketplace'
          });
          logForDebugging(`Installing marketplace ${marketplaceRepo}`);
          await addMarketplaceSource({
            source: 'github',
            repo: marketplaceRepo
          }, message => {
            setProgressMessage(message);
          });
// 每一步改动之后都清一次缓存：插件与市场的装载结果在进程内有多层缓存，不清会读到旧值
          clearAllCaches();
          logForDebugging(`Marketplace ${marketplaceName} installed`);
// 市场在但插件不在时只刷新市场而不是重装：刷新可能触发 git 操作，能省则省
        } else if (!pluginAlreadyInstalled) {
          // Marketplace installed but plugin not installed - refresh to get latest plugins
          // Only refresh when needed to avoid potentially destructive git operations
          setState({
            phase: 'installing-marketplace'
          });
          setProgressMessage('Updating marketplace…');
          logForDebugging(`Refreshing marketplace ${marketplaceName}`);
          await refreshMarketplace(marketplaceName, message_0 => {
            setProgressMessage(message_0);
          });
          clearMarketplacesCache();
          clearAllCaches();
          logForDebugging(`Marketplace ${marketplaceName} refreshed`);
        }
// 插件未装则装之，失败清单非空就当作整步失败抛出
        if (!pluginAlreadyInstalled) {
          // Install the plugin
          setState({
            phase: 'installing-plugin'
          });
          logForDebugging(`Installing plugin ${pluginId}`);
          const result = await installSelectedPlugins([pluginId]);
          if (result.failed.length > 0) {
            const errorMsg = result.failed.map(f => `${f.name}: ${f.error}`).join(', ');
            throw new Error(`Failed to install plugin: ${errorMsg}`);
          }
          clearAllCaches();
          logForDebugging(`Plugin ${pluginId} installed`);
// 已装的情况还要确认是否被禁用，禁用则启用
        } else {
          // Plugin is installed, check if it's enabled
          const {
            disabled
          } = await loadAllPlugins();
          const isDisabled = disabled.some(p => p.name === 'thinkback' || p.source?.includes(pluginId));
          if (isDisabled) {
            // Enable the plugin
            setState({
              phase: 'enabling-plugin'
            });
            logForDebugging(`Enabling plugin ${pluginId}`);
            const enableResult = await enablePluginOp(pluginId);
            if (!enableResult.success) {
              throw new Error(`Failed to enable plugin: ${enableResult.message}`);
            }
            clearAllCaches();
            logForDebugging(`Plugin ${pluginId} enabled`);
          }
        }
// 全部完成才置就绪并回调，出错统一落到 catch 里转成失败状态
        setState({
          phase: 'ready'
        });
        onReady();
      } catch (error) {
        const err = toError(error);
        logError(err);
        setState({
          phase: 'error',
          message: err.message
        });
        onError(err.message);
      }
    }
    void checkAndInstall();
  }, [onReady, onError]);
// 失败态只显示一行错误，不再重试——重试交给用户重新执行命令
  if (state.phase === 'error') {
    return <Box flexDirection="column">
        <Text color="error">Error: {state.message}</Text>
      </Box>;
  }
// 就绪态返回空：父组件据此切到下一步
  if (state.phase === 'ready') {
    return null;
  }
// 四段文案链，注意没有单独的装插件分支，它落到最后的默认文案上
  const statusMessage = state.phase === 'checking' ? 'Checking thinkback installation…' : state.phase === 'installing-marketplace' ? 'Installing marketplace…' : state.phase === 'enabling-plugin' ? 'Enabling thinkback plugin…' : 'Installing thinkback plugin…';
  return <Box flexDirection="column">
      <Box>
        <Spinner />
        <Text>{progressMessage || statusMessage}</Text>
      </Box>
    </Box>;
}
// 菜单动作四种，其中播放是唯一不进模型的
type MenuAction = 'play' | 'edit' | 'fix' | 'regenerate';
// 其余三种都要交给模型执行，所以用排除法定义成另一种类型
type GenerativeAction = Exclude<MenuAction, 'play'>;
function ThinkbackMenu(t0) {
  const $ = _c(19);
  const {
    onDone,
    onAction,
    skillDir,
    hasGenerated
  } = t0;
  const [hasSelected, setHasSelected] = useState(false);
  let t1;
  if ($[0] !== hasGenerated) {
// 已生成过就给四个选项，没生成过只给一个开始按钮——空菜单没有意义
    t1 = hasGenerated ? [{
      label: "Play animation",
      value: "play" as const,
      description: "Watch your year in review"
    }, {
      label: "Edit content",
      value: "edit" as const,
      description: "Modify the animation"
    }, {
      label: "Fix errors",
      value: "fix" as const,
      description: "Fix validation or rendering issues"
    }, {
      label: "Regenerate",
      value: "regenerate" as const,
      description: "Create a new animation from scratch"
    }] : [{
      label: "Let's go!",
      value: "regenerate" as const,
      description: "Generate your personalized animation"
    }];
    $[0] = hasGenerated;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const options = t1;
  let t2;
  if ($[2] !== onAction || $[3] !== onDone || $[4] !== skillDir) {
// 播放走本地，其余动作上抛给父级转成提示词
    t2 = function handleSelect(value) {
      setHasSelected(true);
// 播放结束就关闭界面，显示方式设为跳过，避免把整段输出贴回对话
      if (value === "play") {
        playAnimation(skillDir).then(() => {
          onDone(undefined, {
            display: "skip"
          });
        });
      } else {
        onAction(value);
      }
    };
    $[2] = onAction;
    $[3] = onDone;
    $[4] = skillDir;
    $[5] = t2;
  } else {
    t2 = $[5];
  }
  const handleSelect = t2;
  let t3;
  if ($[6] !== onDone) {
    t3 = function handleCancel() {
      onDone(undefined, {
        display: "skip"
      });
    };
    $[6] = onDone;
    $[7] = t3;
  } else {
    t3 = $[7];
  }
  const handleCancel = t3;
// 选中之后立刻返回空，把界面让出来给播放器
  if (hasSelected) {
    return null;
  }
  let t4;
  if ($[8] !== hasGenerated) {
// 只有首次进入才显示引导文案，已生成过就不再重复
    t4 = !hasGenerated && <Box flexDirection="column"><Text>Relive your year of coding with Claude.</Text><Text dimColor={true}>{"We'll create a personalized ASCII animation celebrating your journey."}</Text></Box>;
    $[8] = hasGenerated;
    $[9] = t4;
  } else {
    t4 = $[9];
  }
  let t5;
  if ($[10] !== handleSelect || $[11] !== options) {
// 可见项数固定五，正好容纳四个动作加一支留白
    t5 = <Select options={options} onChange={handleSelect} visibleOptionCount={5} />;
    $[10] = handleSelect;
    $[11] = options;
    $[12] = t5;
  } else {
    t5 = $[12];
  }
  let t6;
  if ($[13] !== t4 || $[14] !== t5) {
    t6 = <Box flexDirection="column" gap={1}>{t4}{t5}</Box>;
    $[13] = t4;
    $[14] = t5;
    $[15] = t6;
  } else {
    t6 = $[15];
  }
  let t7;
  if ($[16] !== handleCancel || $[17] !== t6) {
    t7 = <Dialog title="Think Back on 2025 with Claude Code" subtitle="Generate your 2025 Claude Code Think Back (takes a few minutes to run)" onCancel={handleCancel} color="claude">{t6}</Dialog>;
    $[16] = handleCancel;
    $[17] = t6;
    $[18] = t7;
  } else {
    t7 = $[18];
  }
  return t7;
}
// 三条提示词都是让模型调用同一个技能，只差模式参数：改、修、重做
const EDIT_PROMPT = 'Use the Skill tool to invoke the "thinkback" skill with mode=edit to modify my existing Claude Code year in review animation. Ask me what I want to change. When the animation is ready, tell the user to run /think-back again to play it.';
const FIX_PROMPT = 'Use the Skill tool to invoke the "thinkback" skill with mode=fix to fix validation or rendering errors in my existing Claude Code year in review animation. Run the validator, identify errors, and fix them. When the animation is ready, tell the user to run /think-back again to play it.';
const REGENERATE_PROMPT = 'Use the Skill tool to invoke the "thinkback" skill with mode=regenerate to create a completely new Claude Code year in review animation from scratch. Delete the existing animation and start fresh. When the animation is ready, tell the user to run /think-back again to play it.';
function ThinkbackFlow(t0) {
  const $ = _c(27);
  const {
    onDone
  } = t0;
  const [installComplete, setInstallComplete] = useState(false);
  const [installError, setInstallError] = useState(null);
  const [skillDir, setSkillDir] = useState(null);
  const [hasGenerated, setHasGenerated] = useState(null);
  let t1;
// 这个回调没有依赖，用哨兵缓存成常量，全生命周期只创建一次
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = function handleReady() {
      setInstallComplete(true);
    };
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  const handleReady = t1;
  let t2;
  if ($[1] !== onDone) {
// 失败回调同时设置本地错误并结束命令，文案里直接给出补救路径
    t2 = message => {
      setInstallError(message);
      onDone(`Error with thinkback: ${message}. Try running /plugin to manually install the think-back plugin.`, {
        display: "system"
      });
    };
    $[1] = onDone;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  const handleError = t2;
  let t3;
  let t4;
// 安装完成后才去解析技能目录：三个条件缺一不可，且只在还没解析成功时执行
  if ($[3] !== handleError || $[4] !== installComplete || $[5] !== installError || $[6] !== skillDir) {
    t3 = () => {
      if (installComplete && !skillDir && !installError) {
        getThinkbackSkillDir().then(dir => {
          if (dir) {
            logForDebugging(`Thinkback skill directory: ${dir}`);
            setSkillDir(dir);
          } else {
            handleError("Could not find thinkback skill directory");
          }
        });
      }
    };
    t4 = [installComplete, skillDir, installError, handleError];
    $[3] = handleError;
    $[4] = installComplete;
    $[5] = installError;
    $[6] = skillDir;
    $[7] = t3;
    $[8] = t4;
  } else {
    t3 = $[7];
    t4 = $[8];
  }
  useEffect(t3, t4);
  let t5;
  let t6;
// 技能目录就绪后检查动画数据文件是否存在，结果决定菜单给四项还是一项
  if ($[9] !== skillDir) {
    t5 = () => {
      if (!skillDir) {
        return;
      }
      const dataPath = join(skillDir, "year_in_review.js");
      pathExists(dataPath).then(exists => {
        logForDebugging(`Checking for ${dataPath}: ${exists ? "found" : "not found"}`);
        setHasGenerated(exists);
      });
    };
    t6 = [skillDir];
    $[9] = skillDir;
    $[10] = t5;
    $[11] = t6;
  } else {
    t5 = $[10];
    t6 = $[11];
  }
  useEffect(t5, t6);
  let t7;
  if ($[12] !== onDone) {
// 动作到提示词的映射在这里完成，结束回调带上触发查询的标记，让模型接着跑
    t7 = function handleAction(action) {
      const prompts = {
        edit: EDIT_PROMPT,
        fix: FIX_PROMPT,
        regenerate: REGENERATE_PROMPT
      };
      onDone(prompts[action], {
        display: "user",
        shouldQuery: true
      });
    };
    $[12] = onDone;
    $[13] = t7;
  } else {
    t7 = $[13];
  }
  const handleAction = t7;
// 错误优先渲染：即使安装已完成，只要有错误就停在错误页
  if (installError) {
    let t8;
    if ($[14] !== installError) {
      t8 = <Text color="error">Error: {installError}</Text>;
      $[14] = installError;
      $[15] = t8;
    } else {
      t8 = $[15];
    }
    let t9;
    if ($[16] === Symbol.for("react.memo_cache_sentinel")) {
      t9 = <Text dimColor={true}>Try running /plugin to manually install the think-back plugin.</Text>;
      $[16] = t9;
    } else {
      t9 = $[16];
    }
    let t10;
    if ($[17] !== t8) {
      t10 = <Box flexDirection="column">{t8}{t9}</Box>;
      $[17] = t8;
      $[18] = t10;
    } else {
      t10 = $[18];
    }
    return t10;
  }
// 还没装完就挂安装器，安装器自己负责显示进度
  if (!installComplete) {
    let t8;
    if ($[19] !== handleError) {
      t8 = <ThinkbackInstaller onReady={handleReady} onError={handleError} />;
      $[19] = handleError;
      $[20] = t8;
    } else {
      t8 = $[20];
    }
    return t8;
  }
// 装完但目录或存在性还没回来时显示加载中：这两个值都是异步填的
  if (!skillDir || hasGenerated === null) {
    let t8;
    if ($[21] === Symbol.for("react.memo_cache_sentinel")) {
      t8 = <Box><Spinner /><Text>Loading thinkback skill…</Text></Box>;
      $[21] = t8;
    } else {
      t8 = $[21];
    }
    return t8;
  }
  let t8;
  if ($[22] !== handleAction || $[23] !== hasGenerated || $[24] !== onDone || $[25] !== skillDir) {
    t8 = <ThinkbackMenu onDone={onDone} onAction={handleAction} skillDir={skillDir} hasGenerated={hasGenerated} />;
    $[22] = handleAction;
    $[23] = hasGenerated;
    $[24] = onDone;
    $[25] = skillDir;
    $[26] = t8;
  } else {
    t8 = $[26];
  }
  return t8;
}
// 命令入口只做一件事：把流程组件挂上去，所有状态都在组件内部
export async function call(onDone: (result?: string, options?: {
  display?: CommandResultDisplay;
  shouldQuery?: boolean;
}) => void): Promise<React.ReactNode> {
  return <ThinkbackFlow onDone={onDone} />;
}
// 原文件此处有一行 44272 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。