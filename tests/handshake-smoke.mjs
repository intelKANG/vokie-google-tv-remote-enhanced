import assert from "node:assert/strict";
import {createServer} from "node:http";
import {createHash} from "node:crypto";
import {spawn} from "node:child_process";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = process.env.VOKIE_PLUGIN_TEST_ROOT
  ? path.resolve(process.env.VOKIE_PLUGIN_TEST_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workerPath = path.join(root, "worker/index.mjs");
const expected = JSON.parse(await (await import("node:fs/promises")).readFile(path.join(root, "vokie.plugin.json"), "utf8"));
const server = createServer();
let resolveHello;
let rejectHello;
const helloReceived = new Promise((resolve,reject) => {resolveHello=resolve; rejectHello=reject;});
let child;
let childOutput = "";
let childError = "";
const timeout = setTimeout(() => rejectHello(new Error("Worker did not send plugin_hello in time.")), 8000);

function decodeFrame(buffer) {
  if (buffer.length < 2) return null;
  const first = buffer[0], second = buffer[1];
  let length = second & 0x7f, offset = 2;
  if (length === 126) { if (buffer.length < 4) return null; length = buffer.readUInt16BE(2); offset = 4; }
  else if (length === 127) { if (buffer.length < 10) return null; const n = buffer.readBigUInt64BE(2); if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("frame too large"); length = Number(n); offset = 10; }
  const masked = !!(second & 0x80);
  const maskOffset = offset;
  if (masked) offset += 4;
  if (buffer.length < offset + length) return null;
  let payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (masked) for (let i=0;i<payload.length;i++) payload[i] ^= buffer[maskOffset + (i % 4)];
  return {opcode:first & 0x0f, payload, rest:buffer.subarray(offset+length)};
}
function serverFrame(opcode, payload=Buffer.alloc(0)) {
  if (payload.length > 125) throw new Error("test server frame too large");
  return Buffer.concat([Buffer.from([0x80 | opcode, payload.length]), payload]);
}
server.on("upgrade", (request, socket, head) => {
  const accept = createHash("sha1").update(request.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n");
  let buffer = Buffer.from(head);
  const onData = data => {
    buffer = Buffer.concat([buffer, data]);
    const frame = decodeFrame(buffer);
    if (!frame) return;
    socket.off("data", onData);
    assert.equal(frame.opcode, 1, "first Worker message must be text JSON");
    const message = JSON.parse(frame.payload.toString("utf8"));
    resolveHello(message);
    socket.write(serverFrame(1, Buffer.from(JSON.stringify({type:"handshake_ok",pluginId:expected.id,connectionId:"smoke-test"}))));
    socket.end(serverFrame(8, Buffer.from([0x03,0xE8])));
  };
  if (buffer.length) onData(Buffer.alloc(0));
  if (!buffer.length) socket.on("data", onData);
  else if (!decodeFrame(buffer)) socket.on("data", onData);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const useNodeRuntime = expected.worker.runtime === "node" || process.platform === "win32";
const workerCommand = useNodeRuntime ? process.execPath : workerPath;
const workerArgs = useNodeRuntime ? [workerPath, ...(expected.worker.args ?? [])] : (expected.worker.args ?? []);
child = spawn(workerCommand, workerArgs, {
  env: {
    ...process.env,
    ...(useNodeRuntime ? {ELECTRON_RUN_AS_NODE:"1"} : {}),
    VOKIE_PLUGIN_WS_URL:"ws://127.0.0.1:"+address.port,
    VOKIE_PLUGIN_TOKEN:"test-token"
  },
  stdio:["ignore","pipe","pipe"]
});
child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
child.stdout.on("data", chunk => childOutput += chunk);
child.stderr.on("data", chunk => childError += chunk);
try {
  const hello = await helloReceived;
  assert.equal(hello.type,"plugin_hello");
  assert.equal(hello.token,"test-token");
  assert.equal(hello.manifest.id,expected.id);
  assert.equal(hello.manifest.apiVersion,"1");
  assert.deepEqual(hello.manifest.platforms,expected.platforms);
  assert.deepEqual(hello.manifest.transports,expected.transports);
  assert.deepEqual(hello.manifest.capabilities,expected.capabilities);
  assert.deepEqual(hello.manifest.permissions,expected.permissions);
  assert.deepEqual(hello.manifest.ui,expected.ui);
  assert.equal(hello.manifest.icon,expected.icon);
  assert.equal("worker" in hello.manifest,false);
  const [code] = await new Promise((resolve,reject) => {
    const timer=setTimeout(()=>reject(new Error("Worker did not close after fake Host closed.")),5000);
    child.once("exit",(status,signal)=>{clearTimeout(timer);resolve([status,signal]);});
  });
  assert.equal(code,0,childError || childOutput);
  console.log("Worker first message is a valid Vokie v1 plugin_hello; fake Host handshake completed.");
} catch (error) {
  rejectHello = () => {};
  child?.kill("SIGTERM");
  throw error;
} finally {
  clearTimeout(timeout);
  server.close();
}
