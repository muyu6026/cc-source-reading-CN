// Voice service: audio recording for push-to-talk voice input.
//
// Recording uses native audio capture (cpal) on macOS, Linux, and Windows
// for in-process mic access. Falls back to SoX `rec` or arecord (ALSA)
// on Linux if the native module is unavailable.
// 模块定位：按住说话（push-to-talk）的录音层。优先用原生音频模块（cpal，覆盖 macOS / Linux / Windows，进程内直接抓麦）；原生模块不可用时在 Linux 上退到 SoX `rec` 或 ALSA 的 `arecord`。注意这是**录音**，转写在 voiceStreamSTT.ts。

import { type ChildProcess, spawn, spawnSync } from 'child_process'
import { readFile } from 'fs/promises'
import { logForDebugging } from '../utils/debug.js'
import { isEnvTruthy, isRunningOnHomespace } from '../utils/envUtils.js'
import { logError } from '../utils/log.js'
import { getPlatform } from '../utils/platform.js'

// Lazy-loaded native audio module. audio-capture.node links against
// CoreAudio.framework + AudioUnit.framework; dlopen is synchronous and
// blocks the event loop for ~1s warm, up to ~8s on cold coreaudiod
// (post-wake, post-boot). Load happens on first voice keypress — no
// preload, because there's no way to make dlopen non-blocking and a
// startup freeze is worse than a first-press delay.
type AudioNapi = typeof import('audio-capture-napi')
let audioNapi: AudioNapi | null = null
let audioNapiPromise: Promise<AudioNapi> | null = null
// 原生模块懒加载的两个句柄：`audioNapi` 存加载结果，`audioNapiPromise` 存进行中的 promise。为什么懒加载而不是启动预载——注释写得很直白：audio-capture.node 链接 CoreAudio/AudioUnit，dlopen 是**同步**调用，热态阻塞事件循环约 1 秒，冷态（刚唤醒/刚开机时的 coreaudiod）最长约 8 秒；没法把 dlopen 变非阻塞，而「启动卡住」比「第一次按键慢一下」更糟，所以推迟到首次语音按键。

function loadAudioNapi(): Promise<AudioNapi> {
  audioNapiPromise ??= (async () => {
    const t0 = Date.now()
    const mod = await import('audio-capture-napi')
    // vendor/audio-capture-src/index.ts defers require(...node) until the
    // first function call — trigger it here so timing reflects real cost.
    mod.isNativeAudioAvailable()
    audioNapi = mod
    logForDebugging(`[voice] audio-capture-napi loaded in ${Date.now() - t0}ms`)
    return mod
  })()
  return audioNapiPromise
}
// loadAudioNapi 用 `??=` 做记忆化：并发调用共享同一个 promise。里面调用一次 `isNativeAudioAvailable()` 是**故意**的——vendor/audio-capture-src/index.ts 把 `require(...node)` 推迟到第一次函数调用，这里先触发一次，日志里的耗时才是真实加载成本。

// ─── Constants ───────────────────────────────────────────────────────

const RECORDING_SAMPLE_RATE = 16000
const RECORDING_CHANNELS = 1

// SoX silence detection: stop after this duration of silence
const SILENCE_DURATION_SECS = '2.0'
const SILENCE_THRESHOLD = '3%'
// 录音参数：16 kHz 单声道（STT 的通用输入规格，voice_stream 的 URL 里也写死 16000/1）。SoX 的静音检测：连续 2 秒低于 3% 阈值就自动停止——阈值和时长都以字符串形式拼进命令行。

// ─── Dependency check ────────────────────────────────────────────────

function hasCommand(cmd: string): boolean {
  // Spawn the target directly instead of `which cmd`. On Termux/Android
  // `which` is a shell builtin — the external binary is absent or
  // kernel-blocked (EPERM) when spawned from Node. Only reached on
  // non-Windows (win32 returns early from all callers), no PATHEXT issue.
  // result.error is set iff the spawn itself fails (ENOENT/EACCES); exit
  // code is irrelevant — an unrecognized --version still means cmd exists.
  const result = spawnSync(cmd, ['--version'], {
    stdio: 'ignore',
    timeout: 3000,
  })
  return result.error === undefined
}
// hasCommand 的探测姿势值得学：**直接 spawn 目标命令**而不是 `which cmd`。注释给了具体理由——Termux/Android 上 `which` 是 shell 内建，从 Node spawn 时外部二进制不存在或被内核拦（EPERM）。判据是 `result.error === undefined`（spawn 本身失败才会有 error），**退出码无关**：命令不认识 `--version` 也说明它存在。

// Probe whether arecord can actually open a capture device. hasCommand()
// only checks PATH; on WSL1/Win10-WSL2/headless Linux the binary exists
// but fails at open() because there is no ALSA card and no PulseAudio
// server. On WSL2+WSLg (Win11), PulseAudio works via RDP pipes and arecord
// succeeds. We spawn with the same args as startArecordRecording() and race
// a short timer: if the process is still alive after 150ms it opened the
// device; if it exits early the stderr tells us why. Memoized — audio
// device availability does not change mid-session, and this is called on
// every voice keypress via checkRecordingAvailability().
type ArecordProbeResult = { ok: boolean; stderr: string }
let arecordProbe: Promise<ArecordProbeResult> | null = null

function probeArecord(): Promise<ArecordProbeResult> {
  arecordProbe ??= new Promise(resolve => {
    const child = spawn(
      'arecord',
      [
        '-f',
        'S16_LE',
        '-r',
        String(RECORDING_SAMPLE_RATE),
        '-c',
        String(RECORDING_CHANNELS),
        '-t',
        'raw',
        '/dev/null',
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    )
    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    const timer = setTimeout(
      (c: ChildProcess, r: (v: ArecordProbeResult) => void) => {
        c.kill('SIGTERM')
        r({ ok: true, stderr: '' })
      },
      150,
      child,
      resolve,
    )
    child.once('close', code => {
      clearTimeout(timer)
      // SIGTERM close (code=null) after timer fired is already resolved.
      // Early close with code=0 is unusual (arecord shouldn't exit on its
      // own) but treat as ok.
      void resolve({ ok: code === 0, stderr: stderr.trim() })
    })
    child.once('error', () => {
      clearTimeout(timer)
      void resolve({ ok: false, stderr: 'arecord: command not found' })
    })
  })
  return arecordProbe
}
// probeArecord 解决的是「二进制存在 ≠ 能开麦」：hasCommand 只查 PATH，而 WSL1 / Win10-WSL2 / 无头 Linux 上 arecord 装了但 open() 失败（没有 ALSA 声卡、没有 PulseAudio）。做法是用与真正录音完全相同的参数 spawn 一次，**竞速 150ms 定时器**——还活着说明设备开成功了，提前退出就把 stderr 里的原因带回来。WSL2+WSLg（Win11）走 RDP 管道给 PulseAudio，arecord 能成功。整个探测按会话记忆化，因为每次按键都会经 checkRecordingAvailability 调它。

export function _resetArecordProbeForTesting(): void {
  arecordProbe = null
}

// cpal's ALSA backend writes to our process stderr when it can't find any
// sound cards (it runs in-process — no subprocess pipe to capture it). The
// spawn fallbacks below pipe stderr correctly, so skip native when ALSA has
// nothing to open. Memoized: card presence doesn't change mid-session.
let linuxAlsaCardsMemo: Promise<boolean> | null = null

function linuxHasAlsaCards(): Promise<boolean> {
  linuxAlsaCardsMemo ??= readFile('/proc/asound/cards', 'utf8').then(
    cards => {
      const c = cards.trim()
      return c !== '' && !c.includes('no soundcards')
    },
    () => false,
  )
  return linuxAlsaCardsMemo
}
// linuxHasAlsaCards 读 `/proc/asound/cards` 判断有没有声卡，空文件或含 `no soundcards` 都算没有。为什么要这道额外检查：cpal 的 ALSA 后端找不到声卡时会**往本进程的 stderr 直接写**（进程内运行，没有子进程管道可捕获），与其放任噪声，不如在原生路径之前先否决掉它，让后面的 spawn 兜底路径接管（那两个能正确接住 stderr）。同样记忆化。

export function _resetAlsaCardsForTesting(): void {
  linuxAlsaCardsMemo = null
}

type PackageManagerInfo = {
  cmd: string
  args: string[]
  displayCommand: string
}

function detectPackageManager(): PackageManagerInfo | null {
  if (process.platform === 'darwin') {
    if (hasCommand('brew')) {
      return {
        cmd: 'brew',
        args: ['install', 'sox'],
        displayCommand: 'brew install sox',
      }
    }
    return null
  }

  if (process.platform === 'linux') {
    if (hasCommand('apt-get')) {
      return {
        cmd: 'sudo',
        args: ['apt-get', 'install', '-y', 'sox'],
        displayCommand: 'sudo apt-get install sox',
      }
    }
    if (hasCommand('dnf')) {
      return {
        cmd: 'sudo',
        args: ['dnf', 'install', '-y', 'sox'],
        displayCommand: 'sudo dnf install sox',
      }
    }
    if (hasCommand('pacman')) {
      return {
        cmd: 'sudo',
        args: ['pacman', '-S', '--noconfirm', 'sox'],
        displayCommand: 'sudo pacman -S sox',
      }
    }
  }

  return null
}
// detectPackageManager：macOS 只认 brew；Linux 依次试 apt-get / dnf / pacman，统一装 `sox`。返回的 `displayCommand` 是给人看的完整命令（含 sudo），`cmd`+`args` 是真正可执行的形态——报错提示里直接用前者。

export async function checkVoiceDependencies(): Promise<{
  available: boolean
  missing: string[]
  installCommand: string | null
}> {
  // Native audio module (cpal) handles everything on macOS, Linux, and Windows
  const napi = await loadAudioNapi()
  if (napi.isNativeAudioAvailable()) {
    return { available: true, missing: [], installCommand: null }
  }

  // Windows has no supported fallback — native module is required
  if (process.platform === 'win32') {
    return {
      available: false,
      missing: ['Voice mode requires the native audio module (not loaded)'],
      installCommand: null,
    }
  }

  // On Linux, arecord (ALSA utils) is a valid fallback recording backend
  if (process.platform === 'linux' && hasCommand('arecord')) {
    return { available: true, missing: [], installCommand: null }
  }

  const missing: string[] = []

  if (!hasCommand('rec')) {
    missing.push('sox (rec command)')
  }

  const pm = missing.length > 0 ? detectPackageManager() : null
  return {
    available: missing.length === 0,
    missing,
    installCommand: pm?.displayCommand ?? null,
  }
}
// checkVoiceDependencies 的优先级链：原生模块（全平台首选）→ Windows 没有兜底（直接不可用）→ Linux 的 arecord 也算可用 → 否则查 `rec`（SoX）。missing 数组为空才算 available，安装命令来自包管理器探测。注意这里**只看命令存在**，能不能真开麦由 checkRecordingAvailability 的探测回答，两个函数职责分开。

// ─── Recording availability ──────────────────────────────────────────

export type RecordingAvailability = {
  available: boolean
  reason: string | null
}

// Probe-record through the full fallback chain (native → arecord → SoX)
// to verify that at least one backend can record. On macOS this also
// triggers the TCC permission dialog on first use. We trust the probe
// result over the TCC status API, which can be unreliable for ad-hoc
// signed or cross-architecture binaries (e.g., x64-on-arm64).
export async function requestMicrophonePermission(): Promise<boolean> {
  const napi = await loadAudioNapi()
  if (!napi.isNativeAudioAvailable()) {
    return true // non-native platforms skip this check
  }

  const started = await startRecording(
    _chunk => {}, // discard audio data — this is a permission probe only
    () => {}, // ignore silence-detection end signal
    { silenceDetection: false },
  )
  if (started) {
    stopRecording()
    return true
  }
  return false
}
// requestMicrophonePermission 用「真录一次」来要权限：调用 startRecording 但不保存音频（onData 丢弃）、不理会静音结束信号，能启动就立刻停。注释解释了为什么不用 TCC 状态 API——对 ad-hoc 签名或跨架构二进制（x64-on-arm64）它的返回不可靠，**探测结果比权限查询更可信**。非原生平台直接返回 true 跳过检查。

export async function checkRecordingAvailability(): Promise<RecordingAvailability> {
  // Remote environments have no local microphone
  if (isRunningOnHomespace() || isEnvTruthy(process.env.CLAUDE_CODE_REMOTE)) {
    return {
      available: false,
      reason:
        'Voice mode requires microphone access, but no audio device is available in this environment.\n\nTo use voice mode, run Claude Code locally instead.',
    }
  }
// checkRecordingAvailability 的第一道门：homespace（远程托管环境）或 `CLAUDE_CODE_REMOTE` 直接判不可用，理由文案直接告诉用户「在本地跑 Claude Code」——远端没有本地麦克风，后面所有后端探测都没意义。

  // Native audio module (cpal) handles everything on macOS, Linux, and Windows
  const napi = await loadAudioNapi()
  if (napi.isNativeAudioAvailable()) {
    return { available: true, reason: null }
  }

  // Windows has no supported fallback
  if (process.platform === 'win32') {
    return {
      available: false,
      reason:
        'Voice recording requires the native audio module, which could not be loaded.',
    }
  }

  const wslNoAudioReason =
    'Voice mode could not access an audio device in WSL.\n\nWSL2 with WSLg (Windows 11) provides audio via PulseAudio — if you are on Windows 10 or WSL1, run Claude Code in native Windows instead.'

  // On Linux (including WSL), probe arecord. hasCommand() is insufficient:
  // the binary can exist while the device open() fails (WSL1, Win10-WSL2,
  // headless Linux). WSL2+WSLg (Win11 default) works via PulseAudio RDP
  // pipes — cpal fails (no /proc/asound/cards) but arecord succeeds.
  if (process.platform === 'linux' && hasCommand('arecord')) {
    const probe = await probeArecord()
    if (probe.ok) {
      return { available: true, reason: null }
    }
    if (getPlatform() === 'wsl') {
      return { available: false, reason: wslNoAudioReason }
    }
    logForDebugging(`[voice] arecord probe failed: ${probe.stderr}`)
    // fall through to SoX
  }
// Linux 分支的关键：arecord 走 `probeArecord()` 而不是 hasCommand。探测失败且是 WSL，就返回 WSLg 专属提示（Win11 走 PulseAudio 能用、Win10/WSL1 请回原生 Windows）；非 WSL 则**继续往下掉到 SoX**——这是「探测结果决定后端选择」的第一处体现。

  // Fallback: check for SoX
  if (!hasCommand('rec')) {
    // WSL without arecord AND without SoX: the generic "install SoX"
    // hint below is misleading on WSL1/Win10 (no audio devices at all),
    // but correct on WSL2+WSLg (SoX works via PulseAudio). Since we can't
    // distinguish WSLg-vs-not without a backend to probe, show the WSLg
    // guidance — it points WSL1 users at native Windows AND tells WSLg
    // users their setup should work (they can install sox or alsa-utils).
    // Known gap: WSL with SoX but NO arecord skips both this branch and
    // the probe above — hasCommand('rec') lies the same way. We optimistically
    // trust it (WSLg+SoX would work) rather than probeSox() for a near-zero
    // population (WSL1 × minimal distro × SoX-but-not-alsa-utils).
    if (getPlatform() === 'wsl') {
      return { available: false, reason: wslNoAudioReason }
    }
    const pm = detectPackageManager()
    return {
      available: false,
      reason: pm
        ? `Voice mode requires SoX for audio recording. Install it with: ${pm.displayCommand}`
        : 'Voice mode requires SoX for audio recording. Install SoX manually:\n  macOS: brew install sox\n  Ubuntu/Debian: sudo apt-get install sox\n  Fedora: sudo dnf install sox',
    }
  }

  return { available: true, reason: null }
}
// 收尾分支同样先看 WSL：WSL 上没有 arecord 也没有 SoX 时，通用的「装 SoX」提示在 WSL1/Win10 上是误导（根本没有音频设备），所以仍给 WSLg 指引。注释还诚实记录了一个已知缺口——WSL 装了 SoX 但没有 arecord 时，既跳过上面的探测也跳过这里的判断（hasCommand('rec') 会以同样的方式撒谎），作者选择乐观相信它可用，理由是「WSL1 × 精简发行版 × 有 SoX 没 alsa-utils」这个组合的用户量接近零。有缺口就写在注释里，而不是假装不存在。

// ─── Recording (native audio on macOS/Linux/Windows, SoX/arecord fallback on Linux) ─────────────

let activeRecorder: ChildProcess | null = null
let nativeRecordingActive = false

export async function startRecording(
  onData: (chunk: Buffer) => void,
  onEnd: () => void,
  options?: { silenceDetection?: boolean },
): Promise<boolean> {
  logForDebugging(`[voice] startRecording called, platform=${process.platform}`)

  // Try native audio module first (macOS, Linux, Windows via cpal)
  const napi = await loadAudioNapi()
  const nativeAvailable =
    napi.isNativeAudioAvailable() &&
    (process.platform !== 'linux' || (await linuxHasAlsaCards()))
// nativeAvailable 的判定在 Linux 上多一道 `linuxHasAlsaCards()`：不只是模块加载成功，还得真的有声卡——否则 cpal 会在进程内往 stderr 喷错误（见前面 139 行的说明）。macOS / Windows 不需要这道检查。
  const useSilenceDetection = options?.silenceDetection !== false
  if (nativeAvailable) {
    // Ensure any previous recording is fully stopped
    if (nativeRecordingActive || napi.isNativeRecordingActive()) {
      napi.stopNativeRecording()
      nativeRecordingActive = false
    }
    const started = napi.startNativeRecording(
      (data: Buffer) => {
        onData(data)
      },
      () => {
        if (useSilenceDetection) {
          nativeRecordingActive = false
          onEnd()
        }
        // In push-to-talk mode, ignore the native module's silence-triggered
        // onEnd.  Recording continues until the caller explicitly calls
        // stopRecording() (e.g. when the user presses Ctrl+X).
      },
    )
// 原生录音的 onEnd 回调带条件：只有启用静音检测时才把 `nativeRecordingActive` 置 false 并回调 onEnd；**按住说话模式（silenceDetection: false）下故意忽略原生模块的静音触发**，录音一直持续到调用方显式 stopRecording()（例如用户松开 Ctrl+X）。静音检测是「说完自动停」，按住说话是「松手才算停」，两种交互不能混。
    if (started) {
      nativeRecordingActive = true
      return true
    }
    // Native recording failed — fall through to platform fallbacks
  }

  // Windows has no supported fallback
  if (process.platform === 'win32') {
    logForDebugging('[voice] Windows native recording unavailable, no fallback')
    return false
  }

  // On Linux, try arecord (ALSA utils) before SoX. Consult the probe so
  // backend selection matches checkRecordingAvailability() — otherwise
  // on headless Linux with both alsa-utils and SoX, the availability
  // check falls through to SoX (probe.ok=false, not WSL) but this path
  // would still pick broken arecord. Probe is memoized; zero latency.
  if (
    process.platform === 'linux' &&
    hasCommand('arecord') &&
    (await probeArecord()).ok
  ) {
    return startArecordRecording(onData, onEnd)
  }

  // Fallback: SoX rec (Linux, or macOS if native module unavailable)
  return startSoxRecording(onData, onEnd, options)
}
// startRecording 的后端选择顺序：原生 → Windows 无兜底 → Linux arecord（**必须咨询 probeArecord**）→ SoX。注释点明为什么 arecord 那道要用探测结果：否则「无头 Linux 同时装了 alsa-utils 和 SoX」时，可用性检查会掉到 SoX（probe.ok=false），而录音路径却选了坏的 arecord——**两个函数对同一环境的判断必须一致**。探测是记忆化的，这一步零延迟。

function startSoxRecording(
  onData: (chunk: Buffer) => void,
  onEnd: () => void,
  options?: { silenceDetection?: boolean },
): boolean {
  const useSilenceDetection = options?.silenceDetection !== false

  // Record raw PCM: 16 kHz, 16-bit signed, mono, to stdout.
  // --buffer 1024 forces SoX to flush audio in small chunks instead of
  // accumulating data in its internal buffer. Without this, SoX may buffer
  // several seconds of audio before writing anything to stdout when piped,
  // causing zero data flow until the process exits.
  const args = [
    '-q', // quiet
    '--buffer',
    '1024',
    '-t',
    'raw',
    '-r',
    String(RECORDING_SAMPLE_RATE),
    '-e',
    'signed',
    '-b',
    '16',
    '-c',
    String(RECORDING_CHANNELS),
    '-', // stdout
  ]
// SoX 的录制参数：raw PCM、16 kHz、signed 16-bit、单声道、写 stdout。`--buffer 1024` 是这里最容易被忽略的一行——不加的话 SoX 在管道模式下可能先攒好几秒音频才往 stdout 写，表现得像「直到进程退出才有数据」。小缓冲强制它小块小块地冲。

  // Add silence detection filter (auto-stop on silence).
  // Omit for push-to-talk where the user manually controls start/stop.
  if (useSilenceDetection) {
    args.push(
      'silence', // start/stop on silence
      '1',
      '0.1',
      SILENCE_THRESHOLD,
      '1',
      SILENCE_DURATION_SECS,
      SILENCE_THRESHOLD,
    )
  }
// 静音检测只在需要时追加：SoX 的 `silence` 滤镜参数含义是「1 个 0.1 秒的起始静音段 → 2.0 秒低于 3% 判停」。按住说话模式直接不拼这段参数，录音完全由调用方的 start/stop 控制。

  const child = spawn('rec', args, {
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  activeRecorder = child

  child.stdout?.on('data', (chunk: Buffer) => {
    onData(chunk)
  })

  // Consume stderr to prevent backpressure
  child.stderr?.on('data', () => {})

  child.on('close', () => {
    activeRecorder = null
    onEnd()
  })

  child.on('error', err => {
    logError(err)
    activeRecorder = null
    onEnd()
  })

  return true
}
// startSoxRecording 的收尾两件事：**必须消费 stderr**（`child.stderr.on('data', () => {})`）——不读的话管道写满会把子进程阻塞住；close 与 error 两条路都调 onEnd，保证上层不会因为进程异常退出而永远等不到结束信号。

function startArecordRecording(
  onData: (chunk: Buffer) => void,
  onEnd: () => void,
): boolean {
  // Record raw PCM: 16 kHz, 16-bit signed little-endian, mono, to stdout.
  // arecord does not support built-in silence detection, so this backend
  // is best suited for push-to-talk (silenceDetection: false).
  const args = [
    '-f',
    'S16_LE', // signed 16-bit little-endian
    '-r',
    String(RECORDING_SAMPLE_RATE),
    '-c',
    String(RECORDING_CHANNELS),
    '-t',
    'raw', // raw PCM, no WAV header
    '-q', // quiet — no progress output
    '-', // write to stdout
  ]

  const child = spawn('arecord', args, {
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  activeRecorder = child

  child.stdout?.on('data', (chunk: Buffer) => {
    onData(chunk)
  })

  // Consume stderr to prevent backpressure
  child.stderr?.on('data', () => {})

  child.on('close', () => {
    activeRecorder = null
    onEnd()
  })

  child.on('error', err => {
    logError(err)
    activeRecorder = null
    onEnd()
  })

  return true
}
// startArecordRecording 与 SoX 版本结构完全对称，差别只有两点：arecord 不支持内建静音检测（所以注释说它最适合按住说话），以及参数用 ALSA 的写法（`-f S16_LE`、`-t raw`、`-q` 静默）。同一套 stdout/stderr/close/error 处理照抄，是有意的「两个后端长得一样」，方便上层无感切换。

export function stopRecording(): void {
  if (nativeRecordingActive && audioNapi) {
    audioNapi.stopNativeRecording()
    nativeRecordingActive = false
    return
  }
  if (activeRecorder) {
    activeRecorder.kill('SIGTERM')
    activeRecorder = null
  }
}
// stopRecording 分两条路：原生录音优先（`stopNativeRecording()` 后直接 return），子进程后端则 SIGTERM + 清空句柄。注意静音自动结束的路径不经过这里——那是 onEnd 回调；这个函数只负责「用户主动叫停」。
