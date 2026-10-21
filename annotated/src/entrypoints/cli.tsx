// ═══════════════════════════════════════════════════════════════════════════
// src/entrypoints/cli.tsx —— 整个程序的真正入口（启动第 0 棒）
//
// 【这个文件干什么】
//   用户敲 `claude` 之后，第一个被执行的文件就是它。它做的事非常单纯：
//   先看用户输的是什么参数，能用「快速路径」直接办掉的就办掉、立刻退出；
//   只有确实要看完整界面时，才去加载 main.js（那是 789 KB 的大块头）。
//
// 【为什么这么设计】
//   Node 启动一个几百 KB 的模块很慢（要解析、要执行顶层代码）。
//   `claude --version` 这种请求本可以 50ms 返回，没必要拖 1 秒。
//   所以这里满屏都是 `await import(...)` —— 动态导入只在真需要时才加载。
//
// 【阅读约定】
//   · 英文注释原样保留（一个字没删）
//   · 紧跟一行的 `// 译：` 是对应中文
//   · `// 注：` 是我补充的解释（原文没有这句）
//   · `// ── N. xxx ──` 是我加的段落分隔，方便定位
//
// 【和第 03 篇的对应关系】
//   03-启动流程.md 讲的是「三棒接力」：cli.tsx → main() → setup()。本文件是第 1 棒。
//   原文位置：source/src/entrypoints/cli.tsx（302 行）
// ═══════════════════════════════════════════════════════════════════════════

import { feature } from 'bun:bundle';
// 译：从 bun 的打包接口导入 feature()。它是一个「构建期开关」，不是运行时判断：
//     打包时 'XXX' 开着 → 那段代码留下；没开 → 整段被删掉，最终产物里根本不存在。
// 注：这就是为什么读源码时会看到 feature('KAIROS') 之类的分支，但你手上的版本里可能压根没有实现。

// ── 1. 启动前的环境变量预处理（模块顶层，先于一切）──────────────────────────

// Bugfix for corepack auto-pinning, which adds yarnpkg to peoples' package.jsons
// 译：修掉 corepack 自动 pin 的 bug —— 它会把 yarnpkg 写进用户自己的 package.json

// eslint-disable-next-line custom-rules/no-top-level-side-effects
// 译：让下一行豁免「禁止顶层副作用」这条自定义 lint 规则

process.env.COREPACK_ENABLE_AUTO_PIN = '0';

// 注：COREPACK_ENABLE_AUTO_PIN=0 的意思是「别自动往 package.json 里写 packageManager 字段」。
//     这件事必须在模块顶部做完——必须早于任何人读到这个变量，放函数里就晚了。

// Set max heap size for child processes in CCR environments (containers have 16GB)
// 译：给 CCR 环境（云端容器，容器内存 16GB）里的子进程调大堆内存上限
// eslint-disable-next-line custom-rules/no-top-level-side-effects, custom-rules/no-process-env-top-level, custom-rules/safe-env-boolean-check
// 译：这一行同时豁免三条 lint 规则（顶层副作用 / 顶层读 env / 布尔 env 未做安全检查）
if (process.env.CLAUDE_CODE_REMOTE === 'true') {
  // 注：只有「远程/云端模式」才加，本机运行不加——不去动用户自己 node 的内存设置。
  // eslint-disable-next-line custom-rules/no-top-level-side-effects, custom-rules/no-process-env-top-level
  // 译：同上，豁免两条 lint 规则
  const existing = process.env.NODE_OPTIONS || '';
  // 注：先取出已有的 NODE_OPTIONS；没有就给空串，避免拼出 "undefined --max-..."。
  // eslint-disable-next-line custom-rules/no-top-level-side-effects, custom-rules/no-process-env-top-level
  // 译：同上
  process.env.NODE_OPTIONS = existing ? `${existing} --max-old-space-size=8192` : '--max-old-space-size=8192';
  // 注：8192 MB = 8 GB。有旧值就在后面追加，没有就直接设——保留用户原有选项是关键。
}

// Harness-science L0 ablation baseline. Inlined here (not init.ts) because
// BashTool/AgentTool/PowerShellTool capture DISABLE_BACKGROUND_TASKS into
// module-level consts at import time — init() runs too late. feature() gate
// DCEs this entire block from external builds.
// 译：这是「脚手架科学」实验用的 L0 消融基线（把各种能力全关掉，看模型退化多少）。
//     之所以写在这里而不是 init.ts，是因为 BashTool / AgentTool / PowerShellTool
//     在 import 的瞬间就把 DISABLE_BACKGROUND_TASKS 读进了模块级常量 ——
//     等 init() 跑就太晚了。外面那层 feature() 让外部构建把整块代码删掉。
// eslint-disable-next-line custom-rules/no-top-level-side-effects, custom-rules/no-process-env-top-level
// 译：同上，豁免两条 lint 规则
if (feature('ABLATION_BASELINE') && process.env.CLAUDE_CODE_ABLATION_BASELINE) {
  // 注：两个条件都要满足——构建期开关打开，且运行时环境变量存在。
  for (const k of ['CLAUDE_CODE_SIMPLE', 'CLAUDE_CODE_DISABLE_THINKING', 'DISABLE_INTERLEAVED_THINKING', 'DISABLE_COMPACT', 'DISABLE_AUTO_COMPACT', 'CLAUDE_CODE_DISABLE_AUTO_MEMORY', 'CLAUDE_CODE_DISABLE_BACKGROUND_TASKS']) {
    // 注：这一串环境变量就是「要关掉的能力清单」：简化模式 / 思考 / 交错思考 /
    //     压缩 / 自动压缩 / 自动记忆 / 后台任务。全关 = 最朴素的基线。
    // eslint-disable-next-line custom-rules/no-top-level-side-effects, custom-rules/no-process-env-top-level
    // 译：同上
    process.env[k] ??= '1';
    // 注：`??=` 是「只有当前值为 null/undefined 时才赋值」。
    //     用 ??= 而不是 =，是为了不覆盖用户自己显式设置的值（比如他手动设成 '0'）。
  }
}

// ── 2. 主函数：先分流，再决定要不要加载完整 CLI ──────────────────────────────

/**
 * Bootstrap entrypoint - checks for special flags before loading the full CLI.
 * All imports are dynamic to minimize module evaluation for fast paths.
 * Fast-path for --version has zero imports beyond this file.
 */
// 译：引导入口 —— 在加载完整 CLI 之前先检查特殊参数。
//     所有 import 都写成动态导入，目的是让「快速路径」尽量少求值模块。
//     --version 这条快速路径，除了本文件之外不加载任何东西（零依赖）。
async function main(): Promise<void> {
  // 注：下面这一整串都是「if (某个特殊参数) { 干活; return; }」的骨架。
  //     读的时候只要抓住一件事：每个分支都在抢在 `import('../main.js')` 之前返回。
  const args = process.argv.slice(2);
  // 注：process.argv = [node 路径, 本脚本路径, ...用户真正输的参数]，所以 slice(2) 砍掉前两个。

  // Fast-path for --version/-v: zero module loading needed
  // 译：--version / -v 的快速路径：不需要加载任何模块
  if (args.length === 1 && (args[0] === '--version' || args[0] === '-v' || args[0] === '-V')) {
    // 注：注意 args.length === 1 这个限制——只有「就一个参数」才算快速路径，
    //     `claude --version --foo` 不会被这里接住，会走完整流程。
    // MACRO.VERSION is inlined at build time
    // 译：MACRO.VERSION 是构建时被替换进来的字面量（打包那一刻写死的版本号）
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    // 译：让下一行的 console.log 豁免 biome 的 lint 规则——这里是故意要输出的
    console.log(`${MACRO.VERSION} (Claude Code)`);
    return;
  }

  // For all other paths, load the startup profiler
  // 译：其余所有路径都会加载「启动耗时打点器」
  const {
    profileCheckpoint
  } = await import('../utils/startupProfiler.js');
  // 注：这是动态导入 + 解构赋值。之所以写成两行（而不是 import { x } from ...），
  //     就是为了让这个模块只在「非 --version」时才被加载。
  profileCheckpoint('cli_entry');
  // 注：打一个时间戳，名字叫 cli_entry。启动慢的时候，靠这些打点就能看出卡在哪一段。

  // Fast-path for --dump-system-prompt: output the rendered system prompt and exit.
  // Used by prompt sensitivity evals to extract the system prompt at a specific commit.
  // Ant-only: eliminated from external builds via feature flag.
  // 译：--dump-system-prompt 的快速路径：把「渲染好的系统提示词」打印出来然后退出。
  //     用途是提示词敏感度评测——需要在某个特定 commit 上把系统提示词抓出来。
  //     这是 Anthropic 内部专用的，靠 feature 开关从外部构建里删掉。
  if (feature('DUMP_SYSTEM_PROMPT') && args[0] === '--dump-system-prompt') {
    profileCheckpoint('cli_dump_system_prompt_path');
    const {
      enableConfigs
    } = await import('../utils/config.js');
    enableConfigs();
    // 注：先「启用配置」。很多模块的顶层读不到配置，必须等这个函数跑过之后才有效。
    const {
      getMainLoopModel
    } = await import('../utils/model/model.js');
    const modelIdx = args.indexOf('--model');
    // 注：找 --model 这个参数的位置，-1 表示用户没指定。
    const model = modelIdx !== -1 && args[modelIdx + 1] || getMainLoopModel();
    // 注：这个写法要小心读：优先级是
    //     (modelIdx !== -1 && args[modelIdx + 1]) || getMainLoopModel()
    //     即「用户给了 --model 就用后面那个值，否则用默认模型」。
    const {
      getSystemPrompt
    } = await import('../constants/prompts.js');
    const prompt = await getSystemPrompt([], model);
    // 注：传空数组 [] 表示「没有任何上下文消息」，也就是要一份最纯净的系统提示词。
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    // 译：同上，故意输出
    console.log(prompt.join('\n'));
    // 注：getSystemPrompt 返回的是「分段数组」，这里用换行拼成一大段文本打印。
    return;
  }
  if (process.argv[2] === '--claude-in-chrome-mcp') {
    // 注：注意这里用的是 process.argv[2]，和上面的 args[0] 是同一个东西——
    //     同一个文件里两种写法混用，读的时候别以为是两个变量。
    profileCheckpoint('cli_claude_in_chrome_mcp_path');
    const {
      runClaudeInChromeMcpServer
    } = await import('../utils/claudeInChrome/mcpServer.js');
    await runClaudeInChromeMcpServer();
    return;
  } else if (process.argv[2] === '--chrome-native-host') {
    // 注：Chrome 扩展的「原生消息宿主」模式——浏览器通过本地进程和 Claude 通信。
    profileCheckpoint('cli_chrome_native_host_path');
    const {
      runChromeNativeHost
    } = await import('../utils/claudeInChrome/chromeNativeHost.js');
    await runChromeNativeHost();
    return;
  } else if (feature('CHICAGO_MCP') && process.argv[2] === '--computer-use-mcp') {
    // 注：'CHICAGO_MCP' 这个代号对应「computer use」——让模型操作鼠标键盘的那个能力。
    profileCheckpoint('cli_computer_use_mcp_path');
    const {
      runComputerUseMcpServer
    } = await import('../utils/computerUse/mcpServer.js');
    await runComputerUseMcpServer();
    return;
  }

  // Fast-path for `--daemon-worker=<kind>` (internal — supervisor spawns this).
  // Must come before the daemon subcommand check: spawned per-worker, so
  // perf-sensitive. No enableConfigs(), no analytics sinks at this layer —
  // workers are lean. If a worker kind needs configs/auth (assistant will),
  // it calls them inside its run() fn.
  // 译：--daemon-worker=<kind> 的快速路径（内部用——由 supervisor 进程拉起来的）。
  //     必须排在 `daemon` 子命令之前判断：它是「每个 worker 拉一次」，对性能很敏感。
  //     这一层故意不调 enableConfigs()、不初始化埋点——worker 要保持精简。
  //     如果某类 worker 确实需要配置或登录态（比如 assistant 那种），
  //     由它自己在 run() 函数里按需加载。
  if (feature('DAEMON') && args[0] === '--daemon-worker') {
    const {
      runDaemonWorker
    } = await import('../daemon/workerRegistry.js');
    await runDaemonWorker(args[1]);
    // 注：args[1] 就是 `--daemon-worker` 后面那个值，即 worker 的种类名。
    return;
  }

  // Fast-path for `claude remote-control` (also accepts legacy `claude remote` / `claude sync` / `claude bridge`):
  // serve local machine as bridge environment.
  // feature() must stay inline for build-time dead code elimination;
  // isBridgeEnabled() checks the runtime GrowthBook gate.
  // 译：`claude remote-control` 的快速路径（同时兼容老写法 remote / sync / bridge）：
  //     把本机变成一台「可被远程操控的 bridge 环境」。
  //     feature() 必须写在这一行里（不能提到外面），否则构建期删代码就失效了；
  //     而「功能到底开不开」则由 isBridgeEnabled() 在运行时查 GrowthBook 决定。
  // 注：这里体现了双层开关的设计——构建期开关决定「代码在不在」，
  //     运行时开关（GrowthBook）决定「功能开不开」。两个是不同维度。
  if (feature('BRIDGE_MODE') && (args[0] === 'remote-control' || args[0] === 'rc' || args[0] === 'remote' || args[0] === 'sync' || args[0] === 'bridge')) {
    profileCheckpoint('cli_bridge_path');
    const {
      enableConfigs
    } = await import('../utils/config.js');
    enableConfigs();
    const {
      getBridgeDisabledReason,
      checkBridgeMinVersion
    } = await import('../bridge/bridgeEnabled.js');
    const {
      BRIDGE_LOGIN_ERROR
    } = await import('../bridge/types.js');
    const {
      bridgeMain
    } = await import('../bridge/bridgeMain.js');
    const {
      exitWithError
    } = await import('../utils/process.js');

    // Auth check must come before the GrowthBook gate check — without auth,
    // GrowthBook has no user context and would return a stale/default false.
    // getBridgeDisabledReason awaits GB init, so the returned value is fresh
    // (not the stale disk cache), but init still needs auth headers to work.
    // 译：登录检查必须排在 GrowthBook 开关检查之前 —— 没有登录态的话，
    //     GrowthBook 拿不到用户上下文，只会返回一个过期的 / 默认的 false。
    //     getBridgeDisabledReason 内部会等 GB 初始化完成，所以返回值是新鲜的
    //     （不是磁盘上那份过期缓存），但初始化过程本身仍然需要带上鉴权头。
    // 注：这是一个很典型的「顺序即正确性」的例子：两个检查单独看都对，
    //     顺序反了就会静默给出错误结论。
    const {
      getClaudeAIOAuthTokens
    } = await import('../utils/auth.js');
    if (!getClaudeAIOAuthTokens()?.accessToken) {
      // 注：`?.` 是可选链——没登录时函数可能返回 undefined，直接取 .accessToken 会崩。
      exitWithError(BRIDGE_LOGIN_ERROR);
    }
    const disabledReason = await getBridgeDisabledReason();
    if (disabledReason) {
      exitWithError(`Error: ${disabledReason}`);
    }
    const versionError = checkBridgeMinVersion();
    if (versionError) {
      exitWithError(versionError);
      // 注：三道闸依次过——登录了吗？功能被关了吗？版本够新吗？任何一道不过就退出。
    }

    // Bridge is a remote control feature - check policy limits
    // 译：Bridge 属于「远程控制」能力，还要过企业策略这一关
    const {
      waitForPolicyLimitsToLoad,
      isPolicyAllowed
    } = await import('../services/policyLimits/index.js');
    await waitForPolicyLimitsToLoad();
    // 注：策略是异步从服务端拉的，必须先 await 等它加载完，否则下面查到的是空策略。
    if (!isPolicyAllowed('allow_remote_control')) {
      exitWithError("Error: Remote Control is disabled by your organization's policy.");
    }
    await bridgeMain(args.slice(1));
    // 注：args.slice(1) 把子命令 'remote-control' 本身砍掉，剩下的才是真正参数。
    return;
  }

  // Fast-path for `claude daemon [subcommand]`: long-running supervisor.
  // 译：`claude daemon [子命令]` 的快速路径：常驻的「监督进程」
  if (feature('DAEMON') && args[0] === 'daemon') {
    profileCheckpoint('cli_daemon_path');
    const {
      enableConfigs
    } = await import('../utils/config.js');
    enableConfigs();
    const {
      initSinks
    } = await import('../utils/sinks.js');
    initSinks();
    // 注：daemon 要长期跑，所以这里反而要初始化埋点（sinks = 数据落点），
    //     和上面 --daemon-worker 那种「保持精简」的 worker 正好相反。
    const {
      daemonMain
    } = await import('../daemon/main.js');
    await daemonMain(args.slice(1));
    return;
  }

  // Fast-path for `claude ps|logs|attach|kill` and `--bg`/`--background`.
  // Session management against the ~/.claude/sessions/ registry. Flag
  // literals are inlined so bg.js only loads when actually dispatching.
  // 译：`claude ps|logs|attach|kill` 以及 `--bg` / `--background` 的快速路径。
  //     这是「后台会话管理」，数据来自 ~/.claude/sessions/ 这个注册表目录。
  //     参数名故意写成字面量内联在这里，好让 bg.js 只在真的要派发时才被加载。
  if (feature('BG_SESSIONS') && (args[0] === 'ps' || args[0] === 'logs' || args[0] === 'attach' || args[0] === 'kill' || args.includes('--bg') || args.includes('--background'))) {
    profileCheckpoint('cli_bg_path');
    const {
      enableConfigs
    } = await import('../utils/config.js');
    enableConfigs();
    const bg = await import('../cli/bg.js');
    // 注：这里用 `import * as bg` 的效果（整个模块取成对象），因为下面要按需调多个 handler。
    switch (args[0]) {
      case 'ps':
        await bg.psHandler(args.slice(1));
        // 注：ps = process status，列出当前有哪些后台会话（类似 Linux 的 ps）。
        break;
      case 'logs':
        await bg.logsHandler(args[1]);
        // 注：看某个会话的日志，只取一个参数（会话 id）。
        break;
      case 'attach':
        await bg.attachHandler(args[1]);
        // 注：attach = 接上某个正在后台跑的会话，把终端接管过去。
        break;
      case 'kill':
        await bg.killHandler(args[1]);
        // 注：杀掉指定会话。
        break;
      default:
        await bg.handleBgFlag(args);
        // 注：走到 default 说明是 `--bg` / `--background` 这种「带标志启动」的用法。
    }
    return;
  }

  // Fast-path for template job commands.
  // 译：模板任务命令（new / list / reply）的快速路径
  if (feature('TEMPLATES') && (args[0] === 'new' || args[0] === 'list' || args[0] === 'reply')) {
    profileCheckpoint('cli_templates_path');
    const {
      templatesMain
    } = await import('../cli/handlers/templateJobs.js');
    await templatesMain(args);
    // process.exit (not return) — mountFleetView's Ink TUI can leave event
    // loop handles that prevent natural exit.
    // 译：这里必须用 process.exit(0) 而不是 return ——
    //     mountFleetView 那套 Ink 终端界面会留下一些事件循环句柄，
    //     导致进程「该结束了却退不出去」。
    // 注：这是整个文件里唯一一个用 exit 而不是 return 的分支，原因就写在注释里。
    // eslint-disable-next-line custom-rules/no-process-exit
    // 译：豁免「禁止调用 process.exit」的 lint 规则（这里是有意为之）
    process.exit(0);
  }

  // Fast-path for `claude environment-runner`: headless BYOC runner.
  // feature() must stay inline for build-time dead code elimination.
  // 译：`claude environment-runner` 的快速路径：无界面的 BYOC（自带云）执行器
  if (feature('BYOC_ENVIRONMENT_RUNNER') && args[0] === 'environment-runner') {
    profileCheckpoint('cli_environment_runner_path');
    const {
      environmentRunnerMain
    } = await import('../environment-runner/main.js');
    await environmentRunnerMain(args.slice(1));
    return;
  }

  // Fast-path for `claude self-hosted-runner`: headless self-hosted-runner
  // targeting the SelfHostedRunnerWorkerService API (register + poll; poll IS
  // heartbeat). feature() must stay inline for build-time dead code elimination.
  // 译：`claude self-hosted-runner` 的快速路径：无界面的自托管执行器，
  //     对接 SelfHostedRunnerWorkerService 这套 API（注册 + 轮询；轮询本身即心跳）。
  if (feature('SELF_HOSTED_RUNNER') && args[0] === 'self-hosted-runner') {
    profileCheckpoint('cli_self_hosted_runner_path');
    const {
      selfHostedRunnerMain
    } = await import('../self-hosted-runner/main.js');
    await selfHostedRunnerMain(args.slice(1));
    return;
  }

  // Fast-path for --worktree --tmux: exec into tmux before loading full CLI
  // 译：--worktree + --tmux 的快速路径：在加载完整 CLI 之前就直接 exec 进 tmux
  const hasTmuxFlag = args.includes('--tmux') || args.includes('--tmux=classic');
  // 注：两个都接受——`--tmux` 和 `--tmux=classic`（经典模式）。
  if (hasTmuxFlag && (args.includes('-w') || args.includes('--worktree') || args.some(a => a.startsWith('--worktree=')))) {
    // 注：worktree 有三种写法：-w 简写、--worktree、--worktree=<分支名>。
    //     最后一种必须用 some + startsWith 才匹配得到。
    profileCheckpoint('cli_tmux_worktree_fast_path');
    const {
      enableConfigs
    } = await import('../utils/config.js');
    enableConfigs();
    const {
      isWorktreeModeEnabled
    } = await import('../utils/worktreeModeEnabled.js');
    if (isWorktreeModeEnabled()) {
      // 注：又一个「运行时开关」——参数给了不代表功能开了，还得这里再查一次。
      const {
        execIntoTmuxWorktree
      } = await import('../utils/worktree.js');
      const result = await execIntoTmuxWorktree(args);
      if (result.handled) {
        return;
        // 注：handled = 已经成功接管（进了 tmux），直接返回，不再走完整 CLI。
      }
      // If not handled (e.g., error), fall through to normal CLI
      // 译：如果没接管成功（比如出错了），那就继续往下走，回到正常的 CLI 流程
      if (result.error) {
        const {
          exitWithError
        } = await import('../utils/process.js');
        exitWithError(result.error);
      }
      // 注：注意顺序——先判断 handled 再判断 error。
      //     如果写成「有 error 就退出」，那些「handled 且有 warning」的情况就回不了正常流程了。
    }
  }

  // ── 3. 兜底处理：参数改写，然后加载完整 CLI ────────────────────────────────

  // Redirect common update flag mistakes to the update subcommand
  // 译：把用户常见的「更新」参数误用，重定向到 update 子命令
  if (args.length === 1 && (args[0] === '--update' || args[0] === '--upgrade')) {
    process.argv = [process.argv[0]!, process.argv[1]!, 'update'];
    // 注：直接把 process.argv 改了——后面的代码读到的就是 `claude update`。
    //     行尾的 `!` 是 TypeScript 的非空断言，告诉编译器「这两个元素一定存在」。
  }

  // --bare: set SIMPLE early so gates fire during module eval / commander
  // option building (not just inside the action handler).
  // 译：--bare 要尽早设成 SIMPLE 模式，这样各种开关在「模块求值 / commander 构建参数」
  //     阶段就能生效，而不是等到 action 处理函数里才生效。
  if (args.includes('--bare')) {
    process.env.CLAUDE_CODE_SIMPLE = '1';
  }

  // No special flags detected, load and run the full CLI
  // 译：没命中任何特殊参数 —— 现在才加载并运行完整的 CLI
  const {
    startCapturingEarlyInput
  } = await import('../utils/earlyInput.js');
  startCapturingEarlyInput();
  // 注：先开始「抢占式捕获输入」。因为加载 main.js 要几百毫秒，
  //     用户可能已经开始打字了；先挂上监听，保证一个字符都不丢。
  profileCheckpoint('cli_before_main_import');
  const {
    main: cliMain
  } = await import('../main.js');
  // 注：把 main.js 导出的 main 重命名成 cliMain，避免和本文件的 main 重名。
  profileCheckpoint('cli_after_main_import');
  await cliMain();
  profileCheckpoint('cli_after_main_complete');
}

// eslint-disable-next-line custom-rules/no-top-level-side-effects
// 译：豁免「禁止顶层副作用」的 lint 规则——入口文件当然要在顶层启动
void main();
// 注：`void` 的作用是明确表示「我知道这是 Promise，但我不关心它的返回值」。
//     不加 void 的话，某些 lint 规则会报「promise 没有被 await 或 catch」。
//     这里故意不 await：main() 内部已经处理了自己的错误，外面不需要再接。

// ── 附：原文件第 303 行 ───────────────────────────────────────────────────
// 原文件最后还有一行 `//# sourceMappingURL=data:application/json;...`，
// 那是一大段 base64 的 source map（把编译后的代码映射回 TypeScript 源码），
// 有几万字符，对理解逻辑没有任何帮助，这里省略不抄。
