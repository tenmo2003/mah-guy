#!/usr/bin/env node
/**
 * Desktop notification whenever Claude needs the user.
 *
 * Wired in settings.json to:
 *   - SubagentStop (task-implementer / task-verifier): subagent finished
 *   - PreToolUse (AskUserQuestion): a question is waiting
 *   - Notification: permission / idle prompt
 *   - Stop: main session finished a turn longer than CK_NOTIFY_MIN_TURN_SECONDS (default 30)
 *   - UserPromptSubmit: records the turn start time and clears the notification on screen, never notifies
 * Decision logic (which event notifies, threshold, dedupe) lives in lib/task-notify-decision.cjs.
 *
 * Windows + WSL: toast via PowerShell. macOS: osascript. Linux: notify-send.
 * Each session keeps at most one notification: a new one replaces the previous (Windows toast tag,
 * notify-send -r), and the next prompt removes it. macOS cannot replace or remove, so it only shows.
 * Falls back to a terminal bell. Never blocks Claude: always exits 0, prints nothing.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { decideNotification, getMinTurnSeconds, loadState, saveState } = require('./lib/task-notify-decision.cjs');

// Toasts only show for a registered app id; borrow PowerShell's.
const TOAST_APP_ID = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe';
// WSL sessions may not have Windows paths on PATH (appendWindowsPath=false).
const WSL_POWERSHELL = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
const TOAST_GROUP = 'claude-code';

function readInput() {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch {
    return {};
  }
}

function isWsl() {
  if (process.platform !== 'linux') return false;
  if (process.env.WSL_DISTRO_NAME) return true;
  try {
    return /microsoft/i.test(fs.readFileSync('/proc/version', 'utf8'));
  } catch {
    return false;
  }
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'ignore', timeout: 10000, windowsHide: true });
  return !result.error && result.status === 0;
}

function psQuote(text) {
  return `'${String(text).replace(/'/g, "''").slice(0, 200)}'`;
}

function powershellCandidates() {
  return isWsl() ? ['powershell.exe', WSL_POWERSHELL] : ['powershell.exe'];
}

function runPowerShell(script) {
  const encoded = Buffer.from(
    `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null\n${script}`,
    'utf16le'
  ).toString('base64');
  const args = ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded];
  return powershellCandidates().some((powershell) => run(powershell, args));
}

// Toast tags are capped at 64 characters.
function toastTag(sessionId) {
  return String(sessionId || 'no-session').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
}

function windowsToast(title, message, sessionId) {
  const script = `
$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$text = $xml.GetElementsByTagName('text')
$text.Item(0).AppendChild($xml.CreateTextNode(${psQuote(title)})) > $null
$text.Item(1).AppendChild($xml.CreateTextNode(${psQuote(message)})) > $null
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
$toast.Tag = ${psQuote(toastTag(sessionId))}
$toast.Group = ${psQuote(TOAST_GROUP)}
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier(${psQuote(TOAST_APP_ID)}).Show($toast)
`;
  return runPowerShell(script) ? { via: 'windows' } : null;
}

function removeWindowsToast(sessionId) {
  runPowerShell(
    `[Windows.UI.Notifications.ToastNotificationManager]::History.Remove(${psQuote(toastTag(sessionId))}, ${psQuote(TOAST_GROUP)}, ${psQuote(TOAST_APP_ID)})`
  );
}

function macNotification(title, message) {
  const script = `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`;
  return run('osascript', ['-e', script]) ? { via: 'mac' } : null;
}

function linuxNotification(title, message, replaceId) {
  const base = ['--app-name=Claude Code', title, message];
  const replace = Number.isInteger(replaceId) ? ['-r', String(replaceId)] : [];
  const result = spawnSync('notify-send', ['-p', ...replace, ...base], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 10000,
  });
  if (!result.error && result.status === 0) {
    const id = Number.parseInt(result.stdout, 10);
    return Number.isInteger(id) ? { via: 'linux', id } : { via: 'linux' };
  }
  // libnotify older than 0.7.9 rejects -p/-r; show without replacement.
  return run('notify-send', base) ? { via: 'linux' } : null;
}

function closeLinuxNotification(id) {
  run('gdbus', [
    'call', '--session',
    '--dest', 'org.freedesktop.Notifications',
    '--object-path', '/org/freedesktop/Notifications',
    '--method', 'org.freedesktop.Notifications.CloseNotification',
    String(id),
  ]);
}

function terminalBell() {
  try {
    fs.writeFileSync(process.platform === 'win32' ? '\\\\.\\CON' : '/dev/tty', '\x07');
  } catch {
    // no controlling terminal; nothing left to try
  }
}

// Tests set CK_NOTIFY_DRY_RUN to a file path: record actions there instead of touching the desktop.
function recordDryRun(entry) {
  fs.appendFileSync(process.env.CK_NOTIFY_DRY_RUN, `${JSON.stringify(entry)}\n`);
}

/** Shows (or replaces) the session's notification; returns what is now on screen, or null on failure. */
function notify(title, message, sessionId, previous) {
  if (process.env.CK_NOTIFY_DRY_RUN) {
    recordDryRun({ title, message });
    return { via: 'dry-run' };
  }
  const replaceId = previous && previous.via === 'linux' ? previous.id : undefined;
  if (process.platform === 'win32') return windowsToast(title, message, sessionId);
  if (process.platform === 'darwin') return macNotification(title, message);
  if (isWsl()) return windowsToast(title, message, sessionId) || linuxNotification(title, message, replaceId);
  return linuxNotification(title, message, replaceId);
}

function clearNotification(shown, sessionId) {
  if (process.env.CK_NOTIFY_DRY_RUN) return recordDryRun({ clear: true });
  if (shown.via === 'windows') removeWindowsToast(sessionId);
  else if (shown.via === 'linux' && Number.isInteger(shown.id)) closeLinuxNotification(shown.id);
}

function main() {
  const data = readInput();
  const state = loadState(data.session_id);
  const decision = decideNotification(data, state, { minTurnSeconds: getMinTurnSeconds() });
  let next = decision.state;

  // Only clear when something is on screen: spawning PowerShell on every prompt would add latency.
  if (decision.clear && next.shown) {
    clearNotification(next.shown, data.session_id);
    const { shown, ...rest } = next;
    next = rest;
  }

  if (decision.message) {
    const project = path.basename(data.cwd || process.cwd());
    const shown = notify(`Claude Code - ${project}`, decision.message, data.session_id, next.shown);
    if (shown) next = { ...next, shown };
    else terminalBell();
  }

  if (next !== state) saveState(data.session_id, next);
}

try {
  main();
} catch {
  // a failed notification must never fail the hook
}
process.exit(0);
