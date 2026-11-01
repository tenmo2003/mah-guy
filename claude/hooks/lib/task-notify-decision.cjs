/**
 * Decision logic for task-notify.cjs: which hook events produce a desktop
 * notification, with what message, plus the small per-session state file
 * (turn start time, last notification time, the notification on screen) kept under the OS temp dir.
 *
 * decideNotification() is pure so it can be tested without sending anything.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const DEFAULT_MIN_TURN_SECONDS = 30;
const DEDUPE_WINDOW_MS = 5000;
const MIN_TURN_ENV_VAR = "CK_NOTIFY_MIN_TURN_SECONDS";

const SUBAGENT_MESSAGES = {
  "task-implementer": "Implementation finished - your verdict is needed",
  "task-verifier": "Verification finished - findings are ready",
};
const FINISHED_MESSAGE = "Claude finished - your turn";
const QUESTION_MESSAGE = "Claude has a question waiting for your answer";
const ATTENTION_MESSAGE = "Claude needs your attention";

/** Threshold in seconds from the env var; 0 means always, bad values fall back to the default. */
function getMinTurnSeconds(env = process.env) {
  const raw = env[MIN_TURN_ENV_VAR];
  if (raw === undefined || String(raw).trim() === "")
    return DEFAULT_MIN_TURN_SECONDS;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0
    ? seconds
    : DEFAULT_MIN_TURN_SECONDS;
}

/** Payloads without hook_event_name but with agent_type are treated as SubagentStop (original wiring). */
function resolveEvent(data) {
  return data.hook_event_name || (data.agent_type ? "SubagentStop" : "");
}

/** Message the event wants to show, ignoring dedupe. null means this event never notifies. */
function messageForEvent(event, data, state, now, minTurnSeconds) {
  switch (event) {
    case "SubagentStop":
      return (
        SUBAGENT_MESSAGES[data.agent_type] || data.message || FINISHED_MESSAGE
      );
    case "PreToolUse":
      return data.tool_name === "AskUserQuestion" ? QUESTION_MESSAGE : null;
    case "Notification":
      return data.message || ATTENTION_MESSAGE;
    case "Stop": {
      if (data.stop_hook_active) return null;
      if (typeof state.turnStart !== "number") return null;
      return now - state.turnStart >= minTurnSeconds * 1000
        ? FINISHED_MESSAGE
        : null;
    }
    default:
      return null;
  }
}

/**
 * @param {object} data   hook payload from stdin
 * @param {object} state  per-session state: { turnStart?, lastNotifiedAt? } (epoch ms)
 * @param {{ now?: number, minTurnSeconds?: number }} [options]
 * @returns {{ message: string|null, clear?: boolean, state: object }} message to show (null = stay silent),
 *   whether to remove the notification on screen, and the state to persist
 */
function decideNotification(data, state, options = {}) {
  const now = options.now ?? Date.now();
  const minTurnSeconds = options.minTurnSeconds ?? DEFAULT_MIN_TURN_SECONDS;
  const current = state && typeof state === "object" ? state : {};
  const event = resolveEvent(data || {});

  if (event === "UserPromptSubmit") {
    return {
      message: null,
      clear: true,
      state: { ...current, turnStart: now },
    };
  }

  const message = messageForEvent(
    event,
    data || {},
    current,
    now,
    minTurnSeconds,
  );
  if (!message) return { message: null, state: current };

  // Subagent completions are exempt from dedupe: they neither get suppressed nor suppress others.
  if (event === "SubagentStop") return { message, state: current };

  const last = current.lastNotifiedAt;
  if (
    typeof last === "number" &&
    now - last >= 0 &&
    now - last < DEDUPE_WINDOW_MS
  ) {
    return { message: null, state: current };
  }
  return { message, state: { ...current, lastNotifiedAt: now } };
}

function stateFilePath(sessionId) {
  const safeId = String(sessionId || "no-session")
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .slice(0, 100);
  return path.join(os.tmpdir(), `ck-task-notify-${safeId}.json`);
}

function loadState(sessionId) {
  try {
    const state = JSON.parse(fs.readFileSync(stateFilePath(sessionId), "utf8"));
    return state && typeof state === "object" ? state : {};
  } catch {
    return {};
  }
}

function saveState(sessionId, state) {
  try {
    fs.writeFileSync(stateFilePath(sessionId), JSON.stringify(state));
  } catch {
    // state is best effort; losing it only costs a notification
  }
}

module.exports = {
  DEFAULT_MIN_TURN_SECONDS,
  DEDUPE_WINDOW_MS,
  MIN_TURN_ENV_VAR,
  getMinTurnSeconds,
  decideNotification,
  stateFilePath,
  loadState,
  saveState,
};
