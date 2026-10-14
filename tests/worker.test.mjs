import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  DEFAULT_CONFIG,
  PluginRuntime,
  buildHello,
  encodeAudioFrame,
  validateConfig
} from "../worker/index.mjs";

const root = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "vokie.plugin.json"), "utf8"));

test("plugin_hello echoes only the v1 authority manifest fields", () => {
  const hello = buildHello({...manifest, origin:"ignored", extra:"ignored"}, "one-time-token");
  assert.equal(hello.type, "plugin_hello");
  assert.equal(hello.token, "one-time-token");
  assert.deepEqual(hello.manifest, {
    id: manifest.id, name: manifest.name, version: manifest.version,
    apiVersion: manifest.apiVersion, platforms: manifest.platforms,
    transports: manifest.transports, capabilities: manifest.capabilities,
    permissions: manifest.permissions, icon: manifest.icon, ui: manifest.ui
  });
  assert.equal("worker" in hello.manifest, false);
});

test("audio frames use the required big-endian header and PCM payload", () => {
  const pcm = Buffer.from([0, 0, 1, 0]);
  const frame = encodeAudioFrame("req-1", 0, pcm);
  const length = frame.readUInt32BE(0);
  const header = JSON.parse(frame.subarray(4, 4 + length).toString("utf8"));
  assert.deepEqual(header, {
    type:"audio", requestId:"req-1", sequence:0,
    sampleRate:16000, channels:1, format:"pcm_s16le"
  });
  assert.deepEqual(frame.subarray(4 + length), pcm);
  assert.throws(() => encodeAudioFrame("req-1", 0, Buffer.from([1])), /Invalid/);
});

test("settings preserve the three default actions while allowing them to be remapped", () => {
  const config = validateConfig({
    hidSource:"iokit",
    appSwitcherNavigation:true,
    keyboardTrigger:{enabled:true,key:"F9",modifiers:["command"]},
    buttonMappings:{"03":"key:A","04":"key:7","07":"escape","0B":"none","0A":"return","0E":"appSwitcher"}
  });
  assert.equal(config.buttonMappings["03"], "key:A");
  assert.equal(config.buttonMappings["04"], "key:7");
  assert.equal(config.buttonMappings["07"], "escape");
  assert.equal(config.buttonMappings["0B"], "none");
  assert.equal(config.buttonMappings["0A"], "return");
  assert.equal(config.buttonMappings["0E"], "appSwitcher");
  assert.equal(config.appSwitcherNavigation, true);
  assert.equal(validateConfig({}).appSwitcherNavigation, true);
  assert.equal(validateConfig({}).configVersion, 8);
  assert.equal(validateConfig({configVersion:5,appSwitcherNavigation:false}).appSwitcherNavigation, true);
  assert.equal(validateConfig({configVersion:6,appSwitcherNavigation:false}).appSwitcherNavigation, false);
  assert.equal(DEFAULT_CONFIG.buttonMappings["07"], "sendEnter");
  assert.equal(DEFAULT_CONFIG.buttonMappings["0B"], "cancelRecording");
  assert.equal(DEFAULT_CONFIG.buttonMappings["0A"], "showDesktop");
  assert.deepEqual(DEFAULT_CONFIG.keyboardTrigger, {enabled:true,key:"Fn",modifiers:[],captureCancelOnly:false});
  assert.deepEqual(validateConfig({}).keyboardTrigger, DEFAULT_CONFIG.keyboardTrigger);
  assert.deepEqual(validateConfig({configVersion:7,keyboardTrigger:{enabled:false,key:"F9",modifiers:[]}}).keyboardTrigger,
    {enabled:true,key:"Fn",modifiers:[],captureCancelOnly:false});
  assert.equal(validateConfig({configVersion:7,keyboardTrigger:{enabled:true,key:"F9",modifiers:[]}}).keyboardTrigger.key,"F9",
    "an already customized shortcut remains unchanged");
  assert.equal(validateConfig({}).buttonMappings["01"], "lockScreen");
  assert.equal(validateConfig({buttonMappings:{"01":"none"}}).buttonMappings["01"], "lockScreen");
  assert.equal(validateConfig({configVersion:3,buttonMappings:{"01":"none"}}).buttonMappings["01"], "none");
  assert.throws(() => validateConfig({appSwitcherNavigation:"yes"}), /App Switcher/);
  assert.throws(() => validateConfig({fallbackAudioInputId:42}), /备用麦克风/);
  assert.throws(() => validateConfig({hidSource:"ble-gatt"}), /IOKit/);
  assert.throws(() => validateConfig({buttonMappings:{"03":"key:?"}}), /mappings/);
  assert.equal(validateConfig({}).hidSource, DEFAULT_CONFIG.hidSource);
});

test("custom strings can be mapped to any button and send text before Enter", async () => {
  const config = validateConfig({
    buttonMappings: {"11":"typeText", "07":"typeText"},
    customTextByButton: {"11":"订单号：482731", "07":"ChatGPT 你好!"}
  });
  assert.equal(config.buttonMappings["11"], "typeText");
  assert.equal(config.customTextByButton["11"], "订单号：482731");
  assert.equal(config.buttonMappings["07"], "typeText");
  assert.equal(config.customTextByButton["07"], "ChatGPT 你好!");
  assert.throws(() => validateConfig({buttonMappings:{"11":"typeText"}}), /invalid/);
  assert.throws(() => validateConfig({customTextByButton:{"11":"bad\ntext"}}), /control characters/);
  assert.throws(() => validateConfig({customTextByButton:{"11":"x".repeat(129)}}), /control characters/);

  const outgoing = [];
  const helperMessages = [];
  const helper = {write:message => helperMessages.push(message), onMessage:null, onExit:null};
  const runtime = new PluginRuntime({
    sendJson:message => outgoing.push(message), sendBinary:() => {},
    launchHelper:async () => helper, stopHelper:async () => {}
  });
  await runtime.start();
  await runtime.handleHost({type:"configuration_changed",requestId:"custom-text",config:{
    buttonMappings:{"07":"typeText"}, customTextByButton:{"07":"你好，ChatGPT 42!"}
  }});
  helperMessages.length = 0;
  runtime.buttonDown("07");
  assert.deepEqual(helperMessages, [{type:"post_key",target:"typeTextAndEnter",text:"你好，ChatGPT 42!"}]);
  assert.ok(outgoing.some(message => message.type === "configured" && message.requestId === "custom-text"));
  await runtime.shutdown();
});

test("modifier-only hotkeys and app/file mappings validate without widening other targets", () => {
  for (const key of ["LeftCommand", "RightCommand", "LeftOption", "RightOption", "LeftControl", "RightControl", "LeftShift", "RightShift", "Fn"]) {
    assert.equal(validateConfig({keyboardTrigger:{enabled:true,key,modifiers:[]}}).keyboardTrigger.key, key);
  }
  const config = validateConfig({buttonMappings:{
    "0E":"openApp:com.openai.chatgpt",
    "0F":"openFile:/Users/example/Documents/notes.txt",
    "11":"pickFile:11:request-42"
  }});
  assert.equal(config.buttonMappings["0E"], "openApp:com.openai.chatgpt");
  assert.equal(config.buttonMappings["0F"], "openFile:/Users/example/Documents/notes.txt");
  assert.equal(config.buttonMappings["11"], "pickFile:11:request-42");
  const sharedMenu = validateConfig({buttonMappings:{
    "07":"lockScreen", "0B":"shortcut:control+command:K", "0A":"commandS",
    "03":"shortcut:none:F12", "0C":"openFile:/Users/example/Documents/notes.txt"
  },customTextByButton:{"07":"1234"}});
  assert.equal(sharedMenu.buttonMappings["07"], "lockScreen");
  assert.equal(sharedMenu.buttonMappings["0B"], "shortcut:control+command:K");
  assert.equal(sharedMenu.buttonMappings["0A"], "commandS");
  assert.equal(sharedMenu.buttonMappings["03"], "shortcut:none:F12");
  assert.equal(sharedMenu.buttonMappings["0C"], "openFile:/Users/example/Documents/notes.txt");
  assert.throws(() => validateConfig({buttonMappings:{"0B":"shortcut:control+control:K"}}), /mappings/);
  assert.throws(() => validateConfig({buttonMappings:{"0B":"shortcut:invalid:K"}}), /mappings/);
  assert.throws(() => validateConfig({buttonMappings:{"03":"openFile:relative/path"}}), /mappings/);
  assert.throws(() => validateConfig({buttonMappings:{"0E":"pickFile:0F:request-42"}}), /mappings/);
  assert.throws(() => validateConfig({keyboardTrigger:{enabled:true,key:"RightControl",modifiers:["control"]}}), /selected alone/);
  assert.equal(validateConfig({keyboardTrigger:{enabled:false,key:"LeftControl",modifiers:[],captureCancelOnly:true}}).keyboardTrigger.captureCancelOnly, true);
  assert.throws(() => validateConfig({keyboardTrigger:{enabled:false,key:"F9",modifiers:[],captureCancelOnly:"yes"}}), /capture mode/);
  const captureSentinel = validateConfig({keyboardTrigger:{enabled:true,key:"Escape",modifiers:["command","option","control","shift","fn"]}}).keyboardTrigger;
  assert.equal(captureSentinel.captureCancelOnly, true);
  assert.equal(captureSentinel.enabled, false);
  assert.deepEqual(captureSentinel.modifiers, []);
});

test("legacy Chat Bar mapping opens ChatGPT without starting a new chat", async () => {
  const outgoing = [];
  const helperMessages = [];
  const helper = {write:message => helperMessages.push(message), onMessage:null, onExit:null};
  const runtime = new PluginRuntime({
    sendJson:message => outgoing.push(message), sendBinary:() => {},
    launchHelper:async () => helper, stopHelper:async () => {}
  });
  await runtime.start();
  await runtime.handleHost({type:"configuration_changed",requestId:"chatbar",config:{
    buttonMappings:{"0E":"openAppChatBar:com.openai.codex"}
  }});
  helperMessages.length = 0;
  runtime.buttonDown("0E");
  assert.deepEqual(helperMessages, [{type:"post_key",target:"openApp:com.openai.codex"}]);
  assert.ok(outgoing.some(message => message.type === "configured" && message.requestId === "chatbar"));
  assert.equal(validateConfig({buttonMappings:{"0E":"openAppChatBar:com.openai.codex"}}).buttonMappings["0E"], "openApp:com.openai.codex");
  assert.throws(() => validateConfig({buttonMappings:{"0E":"openAppChatBar:bad bundle id"}}), /mappings/);
  assert.equal(validateConfig({buttonMappings:{"0E":"openAppFocus:com.openai.codex"}}).buttonMappings["0E"], "openAppFocus:com.openai.codex");
  assert.throws(() => validateConfig({buttonMappings:{"0E":"openAppFocus:com.apple.finder"}}), /mappings/);
  await runtime.handleHelper({type:"button_up",buttonId:"0E"});
  await runtime.handleHost({type:"configuration_changed",requestId:"focus",config:{buttonMappings:{"0E":"openAppFocus:com.openai.codex"}}});
  helperMessages.length = 0;
  runtime.buttonDown("0E");
  assert.deepEqual(helperMessages, [{type:"post_key",target:"openAppFocus:com.openai.codex"}]);
  await runtime.shutdown();
});

test("app-switcher Escape permission failure leaves remote control connected", () => {
  const outgoing = [];
  const runtime = new PluginRuntime({sendJson: message => outgoing.push(message), sendBinary: () => {}, launchHelper: async () => null, stopHelper: async () => {}});
  runtime.handleHelper({type:"device_ready",sampleRate:16000});
  runtime.handleHelper({type:"app_switcher_state",active:true,escapeCancelAvailable:false});
  runtime.handleHelper({type:"permission_required",permission:"accessibility",source:"app-switcher",message:"Keyboard Escape capture unavailable."});
  assert.equal(runtime.state, "connected");
  assert.equal(runtime.device.appSwitcherActive, true);
  assert.equal(runtime.device.appSwitcherEscapeCancelAvailable, false);
  assert.equal(runtime.device.requiredPermission, undefined);
});

test("remote BLE disconnect recovers from startup through scanning to ready", async () => {
  const outgoing = [];
  const runtime = new PluginRuntime({
    sendJson:message => outgoing.push(message), sendBinary:() => {},
    launchHelper:async () => null, stopHelper:async () => {}
  });
  runtime.handleHelper({type:"device_ready",sampleRate:16000});
  assert.equal(runtime.state, "connected");

  runtime.handleHelper({type:"ble_disconnected",message:"remote disconnected"});
  assert.equal(runtime.state, "starting");
  assert.equal(runtime.device.bleConnected, false);
  assert.equal(runtime.device.sampleRate, null);

  runtime.handleHelper({type:"scanning"});
  assert.equal(runtime.state, "starting");
  assert.equal(runtime.lastError, null);
  assert.equal(runtime.device.bluetooth, "scanning");

  runtime.handleHelper({type:"connecting"});
  runtime.handleHelper({type:"ble_connected"});
  assert.equal(runtime.state, "starting");
  runtime.handleHelper({type:"device_ready",sampleRate:16000});
  assert.equal(runtime.state, "connected");
  assert.equal(runtime.device.bluetooth, "ready");
});

test("direct app-switcher mode opens from either remote direction key", async () => {
  const outgoing = [];
  const helperMessages = [];
  const helper = {write:message => helperMessages.push(message), onMessage:null, onExit:null};
  const runtime = new PluginRuntime({
    sendJson:message => outgoing.push(message), sendBinary:() => {},
    launchHelper:async () => helper, stopHelper:async () => {}
  });
  await runtime.start();
  await runtime.handleHost({type:"configuration_changed",requestId:"direct-switcher",config:{
    appSwitcherNavigation:true,
    buttonMappings:{"05":"key:A","06":"key:B"}
  }});
  runtime.handleHelper({type:"button_down",buttonId:"05"});
  assert.equal(runtime.device.appSwitcherActive, true);
  assert.ok(helperMessages.some(message => message.type === "post_key" && message.target === "appSwitcherLeft"));
  runtime.handleHelper({type:"app_switcher_state",active:true,escapeCancelAvailable:true});
  runtime.handleHelper({type:"button_up",buttonId:"05"});
  runtime.handleHelper({type:"button_down",buttonId:"06"});
  assert.ok(helperMessages.some(message => message.type === "post_key" && message.target === "appSwitcherRight"));
  runtime.handleHelper({type:"button_up",buttonId:"06"});
  runtime.handleHelper({type:"button_down",buttonId:"07"});
  assert.ok(helperMessages.some(message => message.type === "app_switcher_commit"));
  assert.equal(outgoing.some(message => message.type === "command" && message.command === "send_enter"), false);
});

test("default confirm, back, and Home actions remain configurable and are dispatched by target", async () => {
  const outgoing = [];
  const helperMessages = [];
  const helper = {write:message => helperMessages.push(message), onMessage:null, onExit:null};
  const runtime = new PluginRuntime({
    sendJson:message => outgoing.push(message), sendBinary:() => {},
    launchHelper:async () => helper, stopHelper:async () => {}
  });
  await runtime.start();
  await runtime.handleHost({type:"configuration_changed",requestId:"shared-mappings",config:{
    buttonMappings:{"07":"arrowUp", "0B":"commandC", "0A":"lockScreen", "03":"sendEnter"}
  }});
  helperMessages.length = 0;
  runtime.handleHelper({type:"button_down",buttonId:"07"});
  runtime.handleHelper({type:"button_up",buttonId:"07"});
  runtime.handleHelper({type:"button_down",buttonId:"0B"});
  runtime.handleHelper({type:"button_up",buttonId:"0B"});
  runtime.handleHelper({type:"button_down",buttonId:"0A"});
  assert.ok(helperMessages.some(message => message.type === "post_key" && message.target === "arrowUp"));
  assert.ok(helperMessages.some(message => message.type === "post_key" && message.target === "commandC"));
  assert.ok(helperMessages.some(message => message.type === "post_key" && message.target === "lockScreen"));
  runtime.handleHelper({type:"button_down",buttonId:"03"});
  assert.ok(outgoing.some(message => message.type === "command" && message.command === "send_enter"));
  runtime.handleHelper({type:"app_switcher_state",active:true,escapeCancelAvailable:false});
  helperMessages.length = 0;
  runtime.handleHelper({type:"button_up",buttonId:"0A"});
  runtime.handleHelper({type:"button_down",buttonId:"0A"});
  assert.deepEqual(helperMessages.slice(-2), [
    {type:"app_switcher_cancel"},
    {type:"post_key",target:"lockScreen"}
  ]);
});

test("power button defaults to the screen-lock target and can still be remapped", async () => {
  const outgoing = [];
  const helperMessages = [];
  const helper = {write:message => helperMessages.push(message), onMessage:null, onExit:null};
  const runtime = new PluginRuntime({
    sendJson:message => outgoing.push(message), sendBinary:() => {},
    launchHelper:async () => helper, stopHelper:async () => {}
  });
  await runtime.start();
  runtime.handleHelper({type:"button_down",buttonId:"01"});
  assert.ok(helperMessages.some(message => message.type === "post_key" && message.target === "lockScreen"));
  runtime.handleHelper({type:"button_up",buttonId:"01"});
  await runtime.handleHost({type:"configuration_changed",requestId:"power-remap",config:{
    configVersion:3,buttonMappings:{"01":"F9"}
  }});
  helperMessages.length = 0;
  runtime.handleHelper({type:"button_down",buttonId:"01"});
  assert.ok(helperMessages.some(message => message.type === "post_key" && message.target === "F9"));
});

test("remote voice key keeps press modes while keyboard shortcut toggles on each press", async () => {
  const outgoing = [];
  const helperMessages = [];
  let now = 1_000;
  const helper = {write:message => helperMessages.push(message), onMessage:null, onExit:null};
  const runtime = new PluginRuntime({
    sendJson:message => outgoing.push(message), sendBinary:() => {},
    launchHelper:async () => helper, stopHelper:async () => {}, now:() => now
  });
  await runtime.start();
  await runtime.handleHost({type:"configuration_changed",requestId:"remote-priority",config:{
    configVersion:7, fallbackAudioInputId:"vokie-macbook-input"
  }});
  runtime.handleHelper({type:"device_ready",sampleRate:16000});

  runtime.handleHelper({type:"voice_press"});
  const firstRemoteSession = runtime.active.requestId;
  assert.equal(outgoing.findLast(message => message.type === "session_start").options.audioSource.type,"stream");
  assert.equal(outgoing.some(message => message.type === "query_audio_inputs"),false,"a ready remote microphone takes priority over the fallback");
  runtime.sessionAccepted({requestId:firstRemoteSession});
  now += 200;
  runtime.handleHelper({type:"voice_release"});
  assert.equal(runtime.active.requestId, firstRemoteSession, "a short remote tap stays in hands-free mode");
  assert.equal(outgoing.some(message => message.type === "session_stop" && message.requestId === firstRemoteSession), false);

  now += 100;
  runtime.handleHelper({type:"voice_press"});
  now += 100;
  runtime.handleHelper({type:"voice_release"});
  assert.ok(outgoing.some(message => message.type === "session_stop" && message.requestId === firstRemoteSession), "the next remote tap ends hands-free mode");

  now += 1_000;
  runtime.handleHelper({type:"voice_press"});
  const longRemoteSession = runtime.active.requestId;
  runtime.sessionAccepted({requestId:longRemoteSession});
  now += 500;
  runtime.handleHelper({type:"voice_release"});
  assert.ok(outgoing.some(message => message.type === "session_stop" && message.requestId === longRemoteSession), "a long remote press stops on release");

  now += 1_000;
  runtime.handleHelper({type:"keyboard_trigger_down"});
  const firstKeyboardSession = runtime.active.requestId;
  runtime.sessionAccepted({requestId:firstKeyboardSession});
  now += 700;
  runtime.handleHelper({type:"keyboard_trigger_up"});
  assert.equal(runtime.active.requestId, firstKeyboardSession, "holding the keyboard shortcut does not stop recording");
  assert.equal(outgoing.some(message => message.type === "session_stop" && message.requestId === firstKeyboardSession), false);
  runtime.handleHelper({type:"keyboard_trigger_down"});
  assert.ok(outgoing.some(message => message.type === "session_stop" && message.requestId === firstKeyboardSession), "the next keyboard press ends recording immediately");
  runtime.handleHelper({type:"keyboard_trigger_up"});

  now += 1_000;
  runtime.handleHelper({type:"keyboard_trigger_down"});
  const longKeyboardSession = runtime.active.requestId;
  runtime.sessionAccepted({requestId:longKeyboardSession});
  now += 501;
  runtime.handleHelper({type:"keyboard_trigger_up"});
  assert.equal(runtime.active.requestId, longKeyboardSession, "a long keyboard press remains active after release");
  runtime.handleHelper({type:"keyboard_trigger_down"});
  assert.ok(outgoing.some(message => message.type === "session_stop" && message.requestId === longKeyboardSession), "the next keyboard press ends a held session");
  runtime.handleHelper({type:"keyboard_trigger_up"});
  assert.ok(helperMessages.filter(message => message.type === "ensure_capture").length >= 3);
  await runtime.shutdown();
});

test("keyboard trigger uses the selected Vokie system microphone when the remote is unavailable", async () => {
  const outgoing = [];
  const frames = [];
  const helperMessages = [];
  let now = 5_000;
  const helper = {write:message => helperMessages.push(message), onMessage:null, onExit:null};
  const runtime = new PluginRuntime({
    sendJson:message => outgoing.push(message), sendBinary:frame => frames.push(frame),
    launchHelper:async () => helper, stopHelper:async () => {}, now:() => now
  });
  await runtime.start();
  await runtime.handleHost({type:"configuration_changed",requestId:"mac-fallback",config:{
    configVersion:7, fallbackAudioInputId:"vokie-macbook-input"
  }});

  runtime.handleHelper({type:"keyboard_trigger_down"});
  const sessionId = runtime.active.requestId;
  const query = outgoing.findLast(message => message.type === "query_audio_inputs");
  assert.equal(query.query.transport, "system");
  assert.equal(query.query.deviceId, "vokie-macbook-input");
  now += 100;
  runtime.handleHelper({type:"keyboard_trigger_up"});
  await runtime.handleHost({type:"audio_inputs",requestId:query.requestId,devices:[{
    deviceId:"vokie-macbook-input", label:"MacBook Microphone", transport:"system", available:true
  }]});

  const start = outgoing.findLast(message => message.type === "session_start");
  assert.equal(start.requestId, sessionId);
  assert.deepEqual(start.options.audioSource,{type:"system",deviceId:"vokie-macbook-input"});
  runtime.sessionAccepted({requestId:sessionId});
  runtime.audioFrame({sampleRate:16000,pcmBase64:Buffer.from([0,0]).toString("base64")});
  assert.equal(frames.length,0,"Vokie captures a system source directly; the helper must not stream remote audio");
  assert.equal(helperMessages.some(message => message.type === "ensure_capture"),false);

  now += 100;
  runtime.handleHelper({type:"keyboard_trigger_down"});
  runtime.handleHelper({type:"keyboard_trigger_up"});
  assert.ok(outgoing.some(message => message.type === "session_stop" && message.requestId === sessionId));
  await runtime.shutdown();
});

test("session lifecycle buffers audio before acceptance, then sends stop or cancel", async () => {
  const outgoing = [];
  const frames = [];
  const helperMessages = [];
  let helperMessageHandler;
  const helper = {
    write(message) { helperMessages.push(message); },
    onMessage: null,
    onExit: null
  };
  const runtime = new PluginRuntime({
    sendJson: message => outgoing.push(message),
    sendBinary: frame => frames.push(frame),
    launchHelper: async (_path, onMessage) => { helperMessageHandler = onMessage; return helper; },
    stopHelper: async () => {}
  });

  await runtime.start();
  runtime.handleHelper({type:"device_ready",sampleRate:16000});
  assert.ok(outgoing.some(message => message.type === "ready"));
  assert.ok(helperMessages.some(message => message.type === "configure"));
  await runtime.handleHost({type:"configuration_changed",requestId:"pick-config-1",config:{buttonMappings:{"0E":"pickFile:0E:pick-1"}}});
  assert.ok(outgoing.some(message => message.type === "configured" && message.requestId === "pick-config-1"));
  assert.ok(helperMessages.some(message => message.type === "choose_file" && message.buttonId === "0E" && message.pickerId === "pick-1"));
  helperMessageHandler({type:"applications",applications:[
    {bundleId:"com.openai.chatgpt",name:"ChatGPT"}, {bundleId:"bad bundle id",name:"Invalid"}
  ]});
  helperMessageHandler({type:"configured",captureCancelOnly:true});
  helperMessageHandler({type:"keyboard_trigger_ready",key:"Escape",captureCancelOnly:true});
  helperMessageHandler({type:"file_selected",buttonId:"0E",pickerId:"pick-1",path:"/tmp/voice-remote-notes.txt",name:"voice-remote-notes.txt"});
  helperMessageHandler({type:"keyboard_capture_cancel"});
  const extension = outgoing.findLast(message => message.type === "state").extensions.chromecastVoiceRemote.device;
  assert.deepEqual(extension.applications, [{bundleId:"com.openai.chatgpt",name:"ChatGPT"}]);
  assert.equal(extension.filePicker.status, "selected");
  assert.equal(extension.filePicker.path, "/tmp/voice-remote-notes.txt");
  assert.equal(extension.captureCancelGeneration, 1);
  assert.equal(extension.captureCancelReady, true);
  assert.equal(extension.captureCancelHelperConfigured, true);
  await runtime.handleHost({type:"configuration_changed",requestId:"switcher-config",config:{configVersion:6,appSwitcherNavigation:false,buttonMappings:{"0E":"appSwitcher"}}});
  runtime.buttonDown("0E");
  assert.equal(runtime.device.appSwitcherActive, true);
  assert.ok(helperMessages.some(message => message.type === "post_key" && message.target === "appSwitcher"));
  await runtime.handleHelper({type:"app_switcher_state",active:true,escapeCancelAvailable:true});
  assert.equal(runtime.device.appSwitcherEscapeCancelAvailable, true);
  runtime.buttonDown("05");
  runtime.buttonDown("06");
  assert.ok(helperMessages.some(message => message.type === "post_key" && message.target === "arrowLeft"));
  assert.ok(helperMessages.some(message => message.type === "post_key" && message.target === "arrowRight"));
  runtime.buttonDown("07");
  assert.ok(helperMessages.some(message => message.type === "app_switcher_commit"));
  assert.equal(outgoing.some(message => message.type === "command" && message.command === "send_enter"), false);
  assert.equal(runtime.device.appSwitcherActive, false);
  runtime.handleHelper({type:"button_up",buttonId:"0E"});
  runtime.handleHelper({type:"button_up",buttonId:"05"});
  runtime.handleHelper({type:"button_up",buttonId:"06"});
  runtime.handleHelper({type:"button_up",buttonId:"07"});
  assert.equal(runtime.pressedButtons.has("0E"), false);
  runtime.buttonDown("0E");
  assert.equal(runtime.device.appSwitcherActive, true);
  runtime.handleHelper({type:"button_up",buttonId:"0E"});
  assert.equal(runtime.device.appSwitcherActive, true);
  runtime.buttonDown("0B");
  assert.ok(helperMessages.some(message => message.type === "app_switcher_cancel"));
  assert.equal(runtime.device.appSwitcherActive, false);
  runtime.handleHelper({type:"button_up",buttonId:"0B"});
  runtime.buttonDown("07");
  assert.ok(outgoing.some(message => message.type === "command" && message.command === "send_enter"));
  runtime.handleHelper({type:"button_up",buttonId:"07"});
  runtime.handleHelper({type:"voice_press"});
  const start = outgoing.findLast(message => message.type === "session_start");
  assert.equal(start.mode, "ptt");
  runtime.audioFrame({sampleRate:16000,pcmBase64:Buffer.from([0,0]).toString("base64")});
  assert.equal(frames.length, 0);
  runtime.sessionAccepted({requestId:start.requestId});
  assert.equal(frames.length, 1);
  let sentHeaderLength = frames[0].readUInt32BE(0);
  assert.equal(JSON.parse(frames[0].subarray(4,4+sentHeaderLength).toString()).requestId,start.requestId);
  runtime.handleHelper({type:"voice_release"});
  assert.equal(runtime.active.requestId, start.requestId, "the first short press enters hands-free mode");
  runtime.handleHelper({type:"voice_press"});
  runtime.handleHelper({type:"voice_release"});
  assert.ok(outgoing.some(message => message.type === "session_stop" && message.requestId === start.requestId));

  runtime.beginSession("remote");
  const cancelledId = runtime.active.requestId;
  runtime.cancelSession("device");
  assert.ok(outgoing.some(message => message.type === "session_cancel" && message.requestId === cancelledId));
  runtime.beginSession("remote");
  const escapeCancelledId = runtime.active.requestId;
  const escapeSession = runtime.active;
  const framesBeforeEscapeCancel = frames.length;
  assert.ok(helperMessages.some(message => message.type === "set_escape_cancel" && message.enabled === true));
  runtime.audioFrame({sampleRate:16000,pcmBase64:Buffer.from([1,0,2,0]).toString("base64")});
  assert.equal(runtime.active.preAcceptBytes, 4);
  await runtime.handleHelper({type:"keyboard_cancel_session"});
  const escapeCancel = outgoing.findLast(message => message.type === "session_cancel" && message.requestId === escapeCancelledId);
  assert.equal(escapeCancel.reason, "keyboard_escape");
  assert.equal(runtime.active, null);
  assert.deepEqual(escapeSession.preAccept, []);
  assert.equal(escapeSession.preAcceptBytes, 0);
  assert.equal(frames.length, framesBeforeEscapeCancel);
  assert.ok(helperMessages.some(message => message.type === "set_escape_cancel" && message.enabled === false));
  assert.ok(helperMessages.some(message => message.type === "stop_capture"));
  assert.equal(typeof helperMessageHandler, "function");
  await runtime.shutdown();
  assert.ok(outgoing.some(message => message.type === "destroyed"));
});

test("busy session rejection explains the active-session conflict", async () => {
  const outgoing = [];
  const helper = {write:() => {}, onMessage:null, onExit:null};
  const runtime = new PluginRuntime({
    sendJson:message => outgoing.push(message), sendBinary:() => {},
    launchHelper:async () => helper, stopHelper:async () => {}
  });
  await runtime.start();
  runtime.handleHelper({type:"device_ready",sampleRate:16000});
  runtime.handleHelper({type:"voice_press"});
  const requestId = runtime.active.requestId;
  runtime.sessionRejected({requestId,reason:"busy"});
  assert.match(runtime.lastError,/Vokie 当前已有另一段语音输入正在进行/);
  assert.equal(runtime.active,null);
  assert.equal(outgoing.some(message => message.type === "session_cancel" && message.requestId === requestId),false);
  await runtime.shutdown();
});
