#!/bin/sh
':' //; set -eu; if [ -n "${VOKIE_PLUGIN_HOST_EXECUTABLE:-}" ] && [ -x "$VOKIE_PLUGIN_HOST_EXECUTABLE" ]; then VOKIE_APP="$VOKIE_PLUGIN_HOST_EXECUTABLE"; elif [ -x "/Applications/Vokie.app/Contents/MacOS/Vokie" ]; then VOKIE_APP="/Applications/Vokie.app/Contents/MacOS/Vokie"; elif [ -n "${HOME:-}" ] && [ -x "$HOME/Applications/Vokie.app/Contents/MacOS/Vokie" ]; then VOKIE_APP="$HOME/Applications/Vokie.app/Contents/MacOS/Vokie"; else VOKIE_APP=""; fi; if [ -n "$VOKIE_APP" ]; then export ELECTRON_RUN_AS_NODE=1; exec "$VOKIE_APP" "$0" "$@"; fi; if [ -x "/opt/homebrew/bin/node" ]; then exec "/opt/homebrew/bin/node" "$0" "$@"; fi; if [ -x "/usr/local/bin/node" ]; then exec "/usr/local/bin/node" "$0" "$@"; fi; printf '%s\n' "Vokie Node runtime not found. Install Vokie in /Applications or ~/Applications, or set VOKIE_PLUGIN_HOST_EXECUTABLE." >&2; exit 126
import fs from "node:fs";
import path from "node:path";
import {spawn} from "node:child_process";
import {randomUUID} from "node:crypto";
import {fileURLToPath} from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const MANIFEST_PATH = path.join(ROOT, "vokie.plugin.json");
const HELPER_PATH = path.join(
  ROOT,
  "assets",
  "helper",
  "ChromecastVoiceRemoteHelper.app",
  "Contents",
  "MacOS",
  "ChromecastVoiceRemoteHelper"
);
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
const MAX_PRE_ACCEPT_BYTES = 1024 * 1024;
const LONG_PRESS_THRESHOLD_MS = 500;
const ALLOWED_TARGETS = new Set([
  "none", "sendEnter", "cancelRecording", "arrowUp", "arrowDown",
  "arrowLeft", "arrowRight", "return", "escape", "delete", "tab", "space", "lockScreen",
  "home", "end", "pageUp", "pageDown", "showDesktop", "commandSpace", "appSwitcher",
  "commandA", "commandC", "commandV", "commandZ", "commandS", "commandW", "commandQ",
  "volumeUp", "volumeDown", "mute",
  "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12"
]);
const BUTTONS = [
  {id: "03", label: "方向上"},
  {id: "04", label: "方向下"},
  {id: "05", label: "方向左"},
  {id: "06", label: "方向右"},
  {id: "07", label: "确认"},
  {id: "0B", label: "返回"},
  {id: "0A", label: "Home"},
  {id: "0E", label: "YouTube"},
  {id: "08", label: "静音"},
  {id: "0F", label: "Netflix"},
  {id: "01", label: "电源"},
  {id: "11", label: "信源"},
  {id: "0C", label: "音量＋"},
  {id: "0D", label: "音量－"}
];

export const DEFAULT_CONFIG = Object.freeze({
  configVersion: 8,
  hidSource: "iokit",
  appSwitcherNavigation: true,
  fallbackAudioInputId: "",
  keyboardTrigger: {enabled: true, key: "Fn", modifiers: [], captureCancelOnly: false},
  buttonMappings: {
    "03": "arrowUp",
    "04": "arrowDown",
    "05": "arrowLeft",
    "06": "arrowRight",
    "07": "sendEnter",
    "0B": "cancelRecording",
    "0A": "showDesktop",
    "0E": "none",
    "08": "mute",
    "0F": "none",
    "01": "lockScreen",
    "11": "none",
    "0C": "volumeUp",
    "0D": "volumeDown"
  },
  customTextByButton: {}
});

const CUSTOM_SHORTCUT_KEYS = new Set([
  ...Array.from({length:12}, (_,i)=>`F${i + 1}`),
  ...Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZ"),
  ...Array.from("0123456789"),
  "Space", "Return", "Escape", "Tab", "Backspace", "ForwardDelete",
  "Home", "End", "PageUp", "PageDown", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "LeftCommand", "RightCommand", "LeftOption", "RightOption",
  "LeftControl", "RightControl", "LeftShift", "RightShift", "Fn"
]);
const SHORTCUT_MODIFIERS = new Set(["command", "option", "control", "shift", "fn"]);
const STANDALONE_MODIFIER_KEYS = new Set([
  "LeftCommand", "RightCommand", "LeftOption", "RightOption",
  "LeftControl", "RightControl", "LeftShift", "RightShift", "Fn"
]);

function isCustomShortcutTarget(target) {
  if (typeof target !== "string") return false;
  const parts = target.split(":");
  if (parts.length !== 3 || parts[0] !== "shortcut" || !CUSTOM_SHORTCUT_KEYS.has(parts[2])) return false;
  const modifiers = parts[1] === "none" ? [] : parts[1].split("+");
  if (parts[1] !== "none" && (!modifiers.length || modifiers.some(name => !SHORTCUT_MODIFIERS.has(name)))) return false;
  if (new Set(modifiers).size !== modifiers.length) return false;
  return !(STANDALONE_MODIFIER_KEYS.has(parts[2]) && modifiers.length > 0);
}

export function buildHello(sourceManifest, token) {
  const wireManifest = {
    id: sourceManifest.id,
    name: sourceManifest.name,
    version: sourceManifest.version,
    apiVersion: sourceManifest.apiVersion,
    platforms: sourceManifest.platforms,
    transports: sourceManifest.transports,
    capabilities: sourceManifest.capabilities,
    permissions: sourceManifest.permissions,
    icon: sourceManifest.icon,
    ui: sourceManifest.ui
  };
  return {type: "plugin_hello", token, manifest: wireManifest};
}

export function encodeAudioFrame(requestId, sequence, pcm) {
  const payload = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm);
  if (!requestId || !Number.isInteger(sequence) || sequence < 0 || payload.length === 0 || payload.length % 2 !== 0) {
    throw new Error("Invalid Vokie PCM frame.");
  }
  const header = Buffer.from(JSON.stringify({
    type: "audio",
    requestId,
    sequence,
    sampleRate: 16000,
    channels: 1,
    format: "pcm_s16le"
  }), "utf8");
  const prefix = Buffer.allocUnsafe(4);
  prefix.writeUInt32BE(header.length, 0);
  return Buffer.concat([prefix, header, payload]);
}

export function validateConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Settings must be a JSON object.");
  }
  const hidSource = value.hidSource ?? DEFAULT_CONFIG.hidSource;
  if (hidSource !== "iokit" && hidSource !== "disabled") {
    throw new Error("Choose IOKit or turn off remote button input.");
  }
  let appSwitcherNavigation = value.appSwitcherNavigation ?? DEFAULT_CONFIG.appSwitcherNavigation;
  if (typeof appSwitcherNavigation !== "boolean") {
    throw new Error("App Switcher navigation setting must be true or false.");
  }
  const configVersion = value.configVersion ?? 0;
  if (!Number.isInteger(configVersion) || configVersion < 0) {
    throw new Error("Settings version is invalid.");
  }
  // Version 6 promotes direct app switching to the default. Earlier saved
  // settings cannot distinguish the old disabled default from user intent.
  if (configVersion < 6) appSwitcherNavigation = DEFAULT_CONFIG.appSwitcherNavigation;
  const fallbackAudioInputId = value.fallbackAudioInputId ?? DEFAULT_CONFIG.fallbackAudioInputId;
  if (typeof fallbackAudioInputId !== "string" || fallbackAudioInputId.length > 256) {
    throw new Error("备用麦克风设置无效，请重新选择 Mac 麦克风。");
  }
  let trigger = value.keyboardTrigger ?? DEFAULT_CONFIG.keyboardTrigger;
  if (!trigger || typeof trigger !== "object" || typeof trigger.enabled !== "boolean") {
    throw new Error("Keyboard trigger settings are invalid.");
  }
  // Upgrade only the untouched previous default. Keep user-selected shortcuts.
  if (configVersion < 8 && trigger.enabled === false && trigger.key === "F9" &&
      Array.isArray(trigger.modifiers) && trigger.modifiers.length === 0) {
    trigger = {...trigger, enabled: true, key: "Fn", modifiers: []};
  }
  if (trigger.captureCancelOnly !== undefined && typeof trigger.captureCancelOnly !== "boolean") {
    throw new Error("Keyboard capture mode is invalid.");
  }
  const allowedKeys = new Set([
    ...Array.from({length:12}, (_,i)=>"F"+(i+1)),
    ...Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZ"),
    ...Array.from("0123456789"),
    "Space","Return","Escape","Tab",
    "LeftCommand","RightCommand","LeftOption","RightOption",
    "LeftControl","RightControl","LeftShift","RightShift","Fn"
  ]);
  if (!allowedKeys.has(trigger.key)) throw new Error("Choose a supported keyboard shortcut key.");
  const allowedModifiers = new Set(["command","option","control","shift","fn"]);
  if (!Array.isArray(trigger.modifiers) || trigger.modifiers.some(x => !allowedModifiers.has(x))) {
    throw new Error("Keyboard shortcut modifiers are invalid.");
  }
  const uniqueModifiers = [...new Set(trigger.modifiers)];
  // Vokie may persist only the public keyboardTrigger fields and strip custom
  // fields. This deliberately unusual, valid chord is an internal temporary
  // signal used only while the UI is capturing a shortcut.
  const captureCancelSentinel = trigger.enabled && trigger.key === "Escape" &&
    ["command","option","control","shift","fn"].every(name => uniqueModifiers.includes(name)) && uniqueModifiers.length === 5;
  const captureCancelOnly = trigger.captureCancelOnly === true || captureCancelSentinel;
  const standaloneModifierKeys = new Set([
    "LeftCommand","RightCommand","LeftOption","RightOption",
    "LeftControl","RightControl","LeftShift","RightShift","Fn"
  ]);
  if (standaloneModifierKeys.has(trigger.key) && trigger.modifiers.length > 0) {
    throw new Error("Modifier keys used as the trigger must be selected alone.");
  }
  if (trigger.enabled && /^[A-Z0-9]$/.test(trigger.key) && trigger.modifiers.length === 0) {
    throw new Error("Letter and number triggers require at least one modifier key.");
  }
  const incomingMappings = value.buttonMappings ?? {};
  if (!incomingMappings || typeof incomingMappings !== "object" || Array.isArray(incomingMappings)) {
    throw new Error("Button mappings must be an object.");
  }
  const incomingCustomText = value.customTextByButton ?? {};
  if (!incomingCustomText || typeof incomingCustomText !== "object" || Array.isArray(incomingCustomText)) {
    throw new Error("Custom button text must be an object.");
  }
  const customTextByButton = {};
  for (const [buttonId, text] of Object.entries(incomingCustomText)) {
    if (!BUTTONS.some(button => button.id === buttonId) || typeof text !== "string" || text.length > 128 || /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/.test(text)) {
      throw new Error("A mapped button can accept up to 128 characters of text without control characters.");
    }
    customTextByButton[buttonId] = text;
  }
  const buttonMappings = {...DEFAULT_CONFIG.buttonMappings};
  for (const [buttonId, target] of Object.entries(incomingMappings)) {
    const customKeyboardTarget = typeof target === "string" && /^key:(?:[A-Z]|[0-9])$/.test(target);
    const customShortcutTarget = isCustomShortcutTarget(target);
    const plainAppTarget = typeof target === "string" && /^openApp:[A-Za-z0-9][A-Za-z0-9.-]{0,254}$/.test(target);
    const focusChatTarget = typeof target === "string" && /^openAppFocus:(?:com\.openai\.codex|com\.openai\.chatgpt)$/.test(target);
    const legacyChatBarTarget = typeof target === "string" && /^openAppChatBar:[A-Za-z0-9][A-Za-z0-9.-]{0,254}$/.test(target);
    const applicationTarget = plainAppTarget || focusChatTarget || legacyChatBarTarget;
    const filePath = typeof target === "string" && target.startsWith("openFile:") ? target.slice("openFile:".length) : "";
    const fileTarget = filePath.startsWith("/") && filePath.length <= 4096 && !/[\u0000-\u001F\u007F]/.test(filePath);
    const pickerMatch = typeof target === "string" && target.match(/^pickFile:([0-9A-F]{2}):([A-Za-z0-9_-]{1,80})$/);
    const pickerTarget = !!pickerMatch && pickerMatch[1] === buttonId;
    const customTextTarget = target === "typeText" && customTextByButton[buttonId]?.length > 0;
    if (!/^[0-9A-F]{2}$/.test(buttonId) || typeof target !== "string" || (!ALLOWED_TARGETS.has(target) && !customKeyboardTarget && !customShortcutTarget && !applicationTarget && !fileTarget && !pickerTarget && !customTextTarget)) {
      throw new Error("One or more remote button mappings are invalid.");
    }
    // Migrate old Chat Bar actions to plain app launch. Option+Space opens
    // Chat Bar and may start a separate chat; it does not focus the main composer.
    buttonMappings[buttonId] = target.startsWith("openAppChatBar:")
      ? `openApp:${target.slice("openAppChatBar:".length)}`
      : target;
  }
  // Upgrade the previous default (power button: no action) to the requested
  // one-press screen lock once. Later explicit choices, including "none", stick.
  if (configVersion < 3 && incomingMappings["01"] === "none") {
    buttonMappings["01"] = "lockScreen";
  }
  return {
    configVersion: Math.max(configVersion, 8),
    hidSource,
    appSwitcherNavigation,
    fallbackAudioInputId,
    keyboardTrigger: {
      enabled: captureCancelOnly ? false : trigger.enabled,
      key: captureCancelOnly ? "Escape" : trigger.key,
      modifiers: captureCancelOnly ? [] : uniqueModifiers,
      captureCancelOnly
    },
    buttonMappings,
    customTextByButton
  };
}

export class PluginRuntime {
  constructor({sendJson, sendBinary, launchHelper, stopHelper, now = Date.now, id = randomUUID}) {
    this.sendJson = sendJson;
    this.sendBinary = sendBinary;
    this.launchHelper = launchHelper;
    this.stopHelper = stopHelper;
    this.now = now;
    this.id = id;
    this.config = structuredClone(DEFAULT_CONFIG);
    this.helper = null;
    this.state = "starting";
    this.device = {bleConnected: false, hidConnected: false, bluetooth: "waiting", buttonInput: "waiting", sampleRate: null, lastButtonId: null, lastButtonAt: null, captureCancelGeneration: 0, captureCancelReady: false, captureCancelHelperConfigured: false, escapeCancel: "idle", appSwitcherActive: false, appSwitcherEscapeCancelAvailable: false, applications: [], filePicker: null};
    this.active = null;
    this.pendingAudioInputQueries = new Map();
    this.triggerPresses = new Map();
    this.pressedButtons = new Set();
    this.started = false;
    this.closed = false;
    this.lastError = null;
  }

  emitState(state = this.state) {
    this.state = state;
    this.sendJson({
      type: "state",
      state,
      extensions: {
        chromecastVoiceRemote: {
          device: {...this.device},
          config: structuredClone(this.config),
          lastError: this.lastError
        }
      }
    });
  }

  async handleHost(message) {
    if (!message || typeof message !== "object") return;
    switch (message.type) {
      case "initialize":
        this.sendJson({type: "initialized"});
        break;
      case "configuration_changed":
      case "configure":
        await this.applyConfiguration(message);
        break;
      case "start":
        await this.start();
        break;
      case "stop":
        await this.stop(message.reason || "user");
        break;
      case "shutdown":
        await this.shutdown();
        break;
      case "session_accepted":
        this.sessionAccepted(message);
        break;
      case "session_rejected":
        this.sessionRejected(message);
        break;
      case "audio_inputs":
        this.audioInputsResponse(message);
        break;
      default:
        break;
    }
  }

  async applyConfiguration(message) {
    const requestId = typeof message.requestId === "string" ? message.requestId : undefined;
    try {
      const next = validateConfig(message.config ?? {});
      const filePickerRequests = [];
      if (this.started && requestId) {
        for (const [buttonId, target] of Object.entries(next.buttonMappings)) {
          const match = typeof target === "string" && target.match(/^pickFile:([0-9A-F]{2}):([A-Za-z0-9_-]{1,80})$/);
          if (match && match[1] === buttonId && this.config.buttonMappings[buttonId] !== target) {
            filePickerRequests.push({buttonId, pickerId: match[2]});
          }
        }
      }
      this.config = next;
      this.device.captureCancelReady = false;
      this.device.captureCancelHelperConfigured = false;
      if (this.helper) this.helper.write({type: "configure", config: next});
      for (const picker of filePickerRequests) {
        this.device.filePicker = {status: "pending", ...picker};
        this.helper?.write({type: "choose_file", ...picker});
      }
      if (requestId) this.sendJson({type: "configured", requestId});
      this.emitState(this.state);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Invalid settings.";
      if (requestId) {
        this.sendJson({type: "configuration_rejected", requestId, error: reason});
      } else {
        this.sendJson({type: "error", code: "lifecycle_failed", message: reason});
      }
    }
  }

  async start() {
    if (!this.started) {
      this.started = true;
      this.closed = false;
      delete this.device.requiredPermission;
      this.lastError = null;
      this.emitState("starting");
      try {
        this.helper = await this.launchHelper(HELPER_PATH, message => this.handleHelper(message));
        this.helper.onMessage = message => this.handleHelper(message);
        this.helper.onExit = (code, signal) => this.helperExited(code, signal);
        this.helper.write({type: "configure", config: this.config});
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : "Could not start the Bluetooth helper.";
        this.emitState("error");
      }
    }
    this.sendJson({type: "ready"});
  }

  async stop(reason = "user") {
    if (this.active) this.cancelSession("host_stop");
    this.pressedButtons.clear();
    const helper = this.helper;
    this.helper = null;
    this.started = false;
    if (helper) {
      try { helper.write({type: "stop_capture"}); } catch {}
      await this.stopHelper(helper);
    }
    this.device.bleConnected = false;
    this.device.hidConnected = false;
    this.device.bluetooth = "stopped";
    this.device.buttonInput = "stopped";
    this.device.appSwitcherActive = false;
    this.device.appSwitcherEscapeCancelAvailable = false;
    this.emitState("stopped");
    this.sendJson({type: "stopped"});
  }

  async shutdown() {
    if (this.closed) return;
    this.closed = true;
    if (this.active) this.cancelSession("shutdown");
    const helper = this.helper;
    this.helper = null;
    if (helper) await this.stopHelper(helper);
    this.device.appSwitcherActive = false;
    this.device.appSwitcherEscapeCancelAvailable = false;
    this.sendJson({type: "destroyed"});
  }

  async handleHelper(message) {
    if (!message || typeof message !== "object") return;
    switch (message.type) {
      case "applications": {
        const seen = new Set();
        this.device.applications = (Array.isArray(message.applications) ? message.applications : [])
          .filter(item => item && typeof item.bundleId === "string" && /^[A-Za-z0-9][A-Za-z0-9.-]{0,254}$/.test(item.bundleId))
          .map(item => ({bundleId: item.bundleId, name: typeof item.name === "string" ? item.name.slice(0, 160) : item.bundleId}))
          .filter(item => !seen.has(item.bundleId) && seen.add(item.bundleId))
          .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
          .slice(0, 1000);
        this.emitState(this.state);
        break;
      }
      case "file_selected":
      case "file_picker_cancelled":
      case "file_picker_error":
        this.device.filePicker = {
          status: message.type === "file_selected" ? "selected" : message.type === "file_picker_cancelled" ? "cancelled" : "error",
          buttonId: typeof message.buttonId === "string" ? message.buttonId : "",
          pickerId: typeof message.pickerId === "string" ? message.pickerId : "",
          path: typeof message.path === "string" ? message.path : "",
          name: typeof message.name === "string" ? message.name.slice(0, 255) : "",
          message: typeof message.message === "string" ? message.message.slice(0, 500) : ""
        };
        this.emitState(this.state);
        break;
      case "action_error":
        this.device.actionError = typeof message.message === "string" ? message.message : "无法执行按键映射。";
        this.emitState(this.state);
        break;
      case "action_done":
        this.device.actionError = null;
        this.emitState(this.state);
        break;
      case "bluetooth_ready":
        // The adapter being powered on is not the same as an ATVV remote
        // connection. Keep the UI in a search state until ATVV capabilities
        // have been negotiated (device_ready).
        this.device.bluetooth = "scanning";
        this.device.bleConnected = false;
        this.device.sampleRate = null;
        this.lastError = null;
        if (this.device.requiredPermission === "bluetooth") {
          delete this.device.requiredPermission;
          this.lastError = null;
        }
        this.emitState("starting");
        break;
      case "scanning":
        this.device.bluetooth = "scanning";
        this.device.bleConnected = false;
        this.device.sampleRate = null;
        this.lastError = null;
        this.device.actionError = null;
        this.emitState("starting");
        break;
      case "connecting":
        this.device.bluetooth = "connecting";
        this.device.bleConnected = false;
        this.device.sampleRate = null;
        this.lastError = null;
        this.device.actionError = null;
        this.emitState("starting");
        break;
      case "ble_connected":
        this.device.bleConnected = true;
        this.device.bluetooth = "connected";
        this.lastError = null;
        this.emitState("starting");
        break;
      case "ble_disconnected":
        this.device.bleConnected = false;
        this.device.bluetooth = "disconnected";
        this.device.sampleRate = null;
        if (this.active?.audioSource?.type === "stream") this.cancelSession("device_disconnected");
        this.lastError = message.message || "Bluetooth remote disconnected.";
        this.emitState("starting");
        break;
      case "hid_connected":
        this.device.hidConnected = true;
        this.device.buttonInput = "connected";
        this.emitState(this.device.bleConnected ? "connected" : "starting");
        break;
      case "hid_listening":
        this.device.buttonInput = "listening";
        this.emitState(this.device.bleConnected ? "connected" : "starting");
        break;
      case "hid_disconnected":
        this.device.hidConnected = false;
        this.device.buttonInput = "disconnected";
        this.emitState(this.device.bleConnected ? "connected" : "starting");
        break;
      case "hid_disabled":
        this.device.hidConnected = false;
        this.device.buttonInput = "disabled";
        this.emitState(this.device.bleConnected ? "connected" : "starting");
        break;
      case "keyboard_trigger_ready":
        if (message.captureCancelOnly === true) this.device.captureCancelReady = true;
        else this.device.keyboardTrigger = "ready";
        this.emitState(this.device.bleConnected ? "connected" : "starting");
        break;
      case "configured":
        this.device.captureCancelHelperConfigured = message.captureCancelOnly === true;
        this.emitState(this.device.bleConnected ? "connected" : "starting");
        break;
      case "keyboard_capture_cancel":
        this.device.captureCancelGeneration = (this.device.captureCancelGeneration + 1) % Number.MAX_SAFE_INTEGER;
        this.emitState(this.state);
        break;
      case "keyboard_escape_cancel_ready":
        this.device.escapeCancel = message.enabled === false ? "idle" : "ready";
        this.emitState(this.state);
        break;
      case "keyboard_cancel_session":
        if (this.active) this.cancelSession("keyboard_escape");
        break;
      case "app_switcher_state":
        this.device.appSwitcherActive = message.active === true;
        this.device.appSwitcherEscapeCancelAvailable = message.escapeCancelAvailable === true;
        this.emitState(this.state);
        break;
      case "device_ready":
        this.device.bleConnected = true;
        this.device.bluetooth = "ready";
        this.device.sampleRate = Number(message.sampleRate) || null;
        if (!this.device.requiredPermission) this.lastError = null;
        this.emitState(this.device.requiredPermission ? "error" : "connected");
        break;
      case "permission_required":
        this.device.captureCancelReady = false;
        this.lastError = message.message || message.permission || "Required permission was denied.";
        if (message.source === "app-switcher") {
          // Keyboard Escape is an optional app-switcher cancel path. Remote
          // Back remains available, so this must not mark the device offline.
          this.device.appSwitcherEscapeCancelAvailable = false;
          this.emitState(this.state);
          break;
        }
        this.device.requiredPermission = message.permission || "unknown";
        if (message.permission === "bluetooth") this.device.bluetooth = "permission-required";
        else if (message.permission === "input-monitoring") this.device.buttonInput = "permission-required";
        else {
          if (message.source === "escape-cancel") this.device.escapeCancel = "permission-required";
          if (message.source !== "escape-cancel" || this.config.keyboardTrigger.enabled) this.device.keyboardTrigger = "permission-required";
        }
        this.emitState("error");
        break;
      case "device_error":
      case "keyboard_trigger_error":
      case "unsupported_platform":
      case "bluetooth_off":
      case "device_not_found":
      case "mic_open_error":
        this.lastError = message.message || message.permission || "Device helper reported an error.";
        if (message.permission) this.device.requiredPermission = message.permission;
        this.emitState("error");
        break;
      case "voice_press":
        this.triggerDown("remote");
        break;
      case "voice_release":
        this.triggerUp("remote");
        break;
      case "keyboard_trigger_down":
        this.triggerDown("keyboard");
        break;
      case "keyboard_trigger_up":
        this.triggerUp("keyboard");
        break;
      case "audio_frame":
        this.audioFrame(message);
        break;
      case "button_down":
        this.buttonDown(String(message.buttonId || "").toUpperCase());
        break;
      case "button_up":
        this.pressedButtons.delete(String(message.buttonId || "").toUpperCase());
        break;
      default:
        break;
    }
  }

  buttonDown(buttonId) {
    if (!/^[0-9A-F]{2}$/.test(buttonId) || this.pressedButtons.has(buttonId)) return;
    this.pressedButtons.add(buttonId);
    this.device.lastButtonId = buttonId;
    this.device.lastButtonAt = this.now();
    this.device.actionError = null;
    this.emitState(this.state);
    const target = this.config.buttonMappings[buttonId] || "none";
    if (this.config.appSwitcherNavigation && (buttonId === "05" || buttonId === "06")) {
      if (!this.device.appSwitcherActive) {
        this.device.appSwitcherActive = true;
        this.device.appSwitcherEscapeCancelAvailable = false;
        this.emitState(this.state);
      }
      this.helper?.write({type: "post_key", target: buttonId === "05" ? "appSwitcherLeft" : "appSwitcherRight"});
      return;
    }
    if (this.device.appSwitcherActive && target !== "none" && !["sendEnter", "cancelRecording", "appSwitcher", "arrowLeft", "arrowRight"].includes(target)) {
      this.helper?.write({type: "app_switcher_cancel"});
      this.device.appSwitcherActive = false;
      this.device.appSwitcherEscapeCancelAvailable = false;
      this.emitState(this.state);
    }
    if (target === "sendEnter") {
      if (this.device.appSwitcherActive) {
        this.helper?.write({type: "app_switcher_commit"});
        this.device.appSwitcherActive = false;
        this.device.appSwitcherEscapeCancelAvailable = false;
        this.emitState(this.state);
      } else {
        this.sendJson({type: "command", command: "send_enter", requestId: this.id(), timestampMs: this.now()});
      }
    } else if (target === "cancelRecording") {
      if (this.device.appSwitcherActive) {
        this.helper?.write({type: "app_switcher_cancel"});
        this.device.appSwitcherActive = false;
        this.device.appSwitcherEscapeCancelAvailable = false;
        this.emitState(this.state);
      } else if (this.active) this.cancelSession("device");
    } else if (target === "typeText") {
      this.helper?.write({type: "post_key", target: "typeTextAndEnter", text: this.config.customTextByButton[buttonId]});
    } else if (target !== "none") {
      if (target === "appSwitcher") {
        this.device.appSwitcherActive = true;
        this.device.appSwitcherEscapeCancelAvailable = false;
        this.emitState(this.state);
      }
      this.helper?.write({type: "post_key", target});
    }
  }

  triggerDown(source) {
    if (this.triggerPresses.has(source) || this.active?.stopAfterAccept) return;
    const session = this.active;
    const press = {
      startedAt: this.now(),
      requestId: session?.requestId ?? null,
      sessionWasActive: !!session
    };
    this.triggerPresses.set(source, press);
    if (source === "keyboard") {
      if (!session) {
        this.beginSession(source);
        press.requestId = this.active?.requestId ?? null;
      } else {
        this.stopSessionFromTrigger(session);
      }
      return;
    }
    if (!session) {
      this.beginSession(source);
      press.requestId = this.active?.requestId ?? null;
    }
  }

  triggerUp(source) {
    const press = this.triggerPresses.get(source);
    if (!press) return;
    this.triggerPresses.delete(source);
    if (source === "keyboard") return;
    const session = this.active;
    if (!session || !press.requestId || session.requestId !== press.requestId) return;
    const heldFor = Math.max(0, this.now() - press.startedAt);
    if (press.sessionWasActive || heldFor >= LONG_PRESS_THRESHOLD_MS) {
      this.stopSessionFromTrigger(session);
    }
  }

  stopSessionFromTrigger(session) {
    if (session.accepted) this.finishSession("device");
    else {
      session.stopAfterAccept = true;
      if (session.audioSource?.type === "stream") this.helper?.write({type: "stop_capture"});
    }
  }

  beginSession(source) {
    if (this.active || !this.started) return;
    const requestId = this.id();
    const remoteAudioReady = this.device.bluetooth === "ready" && this.device.bleConnected;
    this.active = {
      requestId,
      source,
      audioSource: remoteAudioReady
        ? {type: "stream", format: "pcm_s16le", sampleRate: 16000, channels: 1}
        : null,
      startSent: false,
      accepted: false,
      stopAfterAccept: false,
      sequence: 0,
      preAccept: [],
      preAcceptBytes: 0,
      droppedPreAcceptBytes: 0
    };
    this.device.escapeCancel = "starting";
    this.helper?.write({type: "set_escape_cancel", enabled: true});
    this.lastError = null;
    this.emitState("starting");
    if (this.active.audioSource) {
      this.sendSessionStart(this.active);
      return;
    }
    if (!this.config.fallbackAudioInputId) {
      this.failSessionStart("未连接 Google 遥控器。请先在插件设置中选择备用 Mac 麦克风。");
      return;
    }
    const queryRequestId = this.id();
    const timer = setTimeout(() => {
      const pending = this.pendingAudioInputQueries.get(queryRequestId);
      if (!pending) return;
      this.pendingAudioInputQueries.delete(queryRequestId);
      if (this.active?.requestId === requestId) {
        this.failSessionStart("无法读取所选的 Mac 麦克风，请在插件设置中刷新并重新选择。");
      }
    }, 5000);
    this.pendingAudioInputQueries.set(queryRequestId, {
      sessionRequestId: requestId,
      deviceId: this.config.fallbackAudioInputId,
      timer
    });
    this.sendJson({
      type: "query_audio_inputs",
      requestId: queryRequestId,
      query: {transport: "system", deviceId: this.config.fallbackAudioInputId}
    });
  }

  audioInputsResponse(message) {
    const pending = this.pendingAudioInputQueries.get(message.requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingAudioInputQueries.delete(message.requestId);
    const session = this.active;
    if (!session || session.requestId !== pending.sessionRequestId) return;
    const found = Array.isArray(message.devices) && message.devices.some(device =>
      device && device.deviceId === pending.deviceId && device.transport === "system" && device.available !== false
    );
    if (!found) {
      this.failSessionStart("所选的 Mac 麦克风在此设备上不可用，请刷新列表并重新选择。");
      return;
    }
    session.audioSource = {type: "system", deviceId: pending.deviceId};
    this.sendSessionStart(session);
  }

  sendSessionStart(session) {
    if (!session || this.active?.requestId !== session.requestId || !session.audioSource) return;
    session.startSent = true;
    this.sendJson({
      type: "session_start",
      requestId: session.requestId,
      mode: "ptt",
      timestampMs: this.now(),
      options: {audioSource: session.audioSource}
    });
  }

  failSessionStart(message) {
    if (!this.active) return;
    const session = this.active;
    this.clearAudioInputQueryForSession(session.requestId);
    if (session.audioSource?.type === "stream") this.helper?.write({type: "stop_capture"});
    this.active = null;
    this.lastError = message;
    this.disableEscapeCancel();
    this.emitState(this.device.bleConnected ? "connected" : "starting");
  }

  clearAudioInputQueryForSession(requestId) {
    for (const [queryId, pending] of this.pendingAudioInputQueries) {
      if (pending.sessionRequestId !== requestId) continue;
      clearTimeout(pending.timer);
      this.pendingAudioInputQueries.delete(queryId);
    }
  }

  sessionAccepted(message) {
    const session = this.active;
    if (!session || message.requestId !== session.requestId) return;
    session.accepted = true;
    if (session.stopAfterAccept) {
      this.finishSession("device");
      return;
    }
    if (session.audioSource?.type === "stream") {
      for (const pcm of session.preAccept) this.sendPCM(session, pcm);
    }
    session.preAccept = [];
    session.preAcceptBytes = 0;
    if (session.audioSource?.type === "stream" && this.helper) this.helper.write({type: "ensure_capture"});
    this.emitState("recording");
  }

  sessionRejected(message) {
    if (!this.active || message.requestId !== this.active.requestId) return;
    const session = this.active;
    this.lastError = message.reason === "busy"
      ? "Vokie 当前已有另一段语音输入正在进行，无法同时开始录音。请先结束或取消当前输入；并确认没有把同一快捷键同时绑定给 Vokie 自带的语音快捷键。"
      : "Vokie rejected the recording request: " + String(message.reason || "unknown");
    this.clearAudioInputQueryForSession(session.requestId);
    this.active = null;
    this.disableEscapeCancel();
    if (session.audioSource?.type === "stream") this.helper?.write({type: "stop_capture"});
    this.emitState(this.device.bleConnected ? "connected" : "starting");
  }

  audioFrame(message) {
    const session = this.active;
    if (!session || session.audioSource?.type !== "stream") return;
    if (Number(message.sampleRate) !== 16000) return;
    const pcm = Buffer.from(String(message.pcmBase64 || ""), "base64");
    if (pcm.length === 0 || pcm.length % 2 !== 0) return;
    if (session.accepted) {
      this.sendPCM(session, pcm);
      return;
    }
    session.preAccept.push(pcm);
    session.preAcceptBytes += pcm.length;
    while (session.preAcceptBytes > MAX_PRE_ACCEPT_BYTES && session.preAccept.length) {
      const dropped = session.preAccept.shift();
      session.preAcceptBytes -= dropped.length;
      session.droppedPreAcceptBytes += dropped.length;
    }
  }

  sendPCM(session, pcm) {
    try {
      this.sendBinary(encodeAudioFrame(session.requestId, session.sequence, pcm));
      session.sequence += 1;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : "Could not send PCM audio.";
      this.cancelSession("audio_error");
      this.emitState("error");
    }
  }

  finishSession(reason) {
    const session = this.active;
    if (!session) return;
    if (session.accepted) {
      this.sendJson({
        type: "session_stop",
        requestId: session.requestId,
        timestampMs: this.now(),
        reason
      });
    }
    this.clearAudioInputQueryForSession(session.requestId);
    this.active = null;
    this.disableEscapeCancel();
    if (session.audioSource?.type === "stream") this.helper?.write({type: "stop_capture"});
    this.emitState(this.device.bleConnected ? "connected" : "starting");
  }

  cancelSession(reason) {
    const session = this.active;
    if (!session) return;
    if (session.startSent) this.sendJson({
      type: "session_cancel",
      requestId: session.requestId,
      timestampMs: this.now(),
      reason
    });
    this.clearAudioInputQueryForSession(session.requestId);
    session.preAccept = [];
    session.preAcceptBytes = 0;
    this.active = null;
    this.disableEscapeCancel();
    if (session.audioSource?.type === "stream") this.helper?.write({type: "stop_capture"});
    this.emitState(this.device.bleConnected ? "connected" : "starting");
  }

  disableEscapeCancel() {
    this.device.escapeCancel = "idle";
    this.helper?.write({type: "set_escape_cancel", enabled: false});
  }

  helperExited(code, signal) {
    this.helper = null;
    if (this.active) this.cancelSession("helper_exit");
    if (this.started && !this.closed) {
      this.lastError = "Bluetooth helper exited (" + String(code ?? signal ?? "unknown") + ").";
      this.emitState("error");
    }
  }

  socketClosed() {
    this.closed = true;
    if (this.active) this.cancelSession("socket_closed");
    const helper = this.helper;
    this.helper = null;
    if (helper) {
      try { helper.write({type: "shutdown"}); } catch {}
      this.stopHelper(helper).catch(() => {});
    }
  }
}

function makeHelperProcess(helperPath, onMessage) {
  if (process.platform !== "darwin") throw new Error("This package supports macOS only.");
  if (!["arm64", "x64"].includes(process.arch)) throw new Error("This helper supports Apple Silicon and Intel Macs only.");
  if (!fs.existsSync(helperPath)) throw new Error("The bundled macOS helper is missing.");
  const child = spawn(helperPath, [], {cwd: ROOT, stdio: ["pipe", "pipe", "pipe"]});
  let buffer = "";
  const wrapper = {
    child,
    onMessage: onMessage || null,
    onExit: null,
    write(message) {
      child.stdin.write(JSON.stringify(message) + "\n");
    }
  };
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", chunk => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      try { wrapper.onMessage?.(JSON.parse(line)); }
      catch (error) { process.stderr.write("[Chromecast helper] invalid output: " + String(error) + "\n"); }
    }
  });
  child.stderr.on("data", chunk => process.stderr.write("[Chromecast helper] " + chunk));
  child.on("error", error => wrapper.onMessage?.({type: "device_error", message: error.message}));
  child.on("exit", (code, signal) => wrapper.onExit?.(code, signal));
  return wrapper;
}

function closeHelper(helper) {
  return new Promise(resolve => {
    const child = helper.child;
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 1500);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    try { helper.write({type: "shutdown"}); }
    catch { child.kill("SIGTERM"); }
  });
}

async function connect() {
  const wsUrl = process.env.VOKIE_PLUGIN_WS_URL;
  const token = process.env.VOKIE_PLUGIN_TOKEN;
  if (!wsUrl || !token) throw new Error("Vokie did not provide the authenticated Plugin connection.");
  if (typeof WebSocket !== "function") throw new Error("This Node runtime does not provide WebSocket.");
  const ws = new WebSocket(wsUrl);
  let runtime;
  ws.addEventListener("open", () => {
    runtime = new PluginRuntime({
      sendJson: value => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value)); },
      sendBinary: value => { if (ws.readyState === WebSocket.OPEN) ws.send(value); },
      launchHelper: async (helperPath, onMessage) => makeHelperProcess(helperPath, onMessage),
      stopHelper: closeHelper
    });
    ws.send(JSON.stringify(buildHello(manifest, token)));
  });
  ws.addEventListener("message", event => {
    let message;
    try {
      message = JSON.parse(typeof event.data === "string" ? event.data : Buffer.from(event.data).toString("utf8"));
    } catch {
      return;
    }
    if (message.type === "handshake_ok") return;
    runtime?.handleHost(message).catch(error => {
      process.stderr.write("[Chromecast Plugin] " + String(error) + "\n");
    });
  });
  ws.addEventListener("close", () => {
    runtime?.socketClosed();
    process.exitCode = 0;
  });
  ws.addEventListener("error", () => {
    runtime?.socketClosed();
    process.exitCode = 1;
  });
  process.once("SIGTERM", () => { runtime?.socketClosed(); ws.close(); });
  process.once("SIGINT", () => { runtime?.socketClosed(); ws.close(); });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  connect().catch(error => {
    process.stderr.write("[Chromecast Plugin] " + String(error) + "\n");
    process.exitCode = 1;
  });
}
