import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(dir, "adpcm-test.c");
const output = path.join(os.tmpdir(), "vokie-adpcm-test-" + process.pid);
const build = spawnSync("clang", ["-std=c11", "-Wall", "-Wextra", "-Werror", "-I", path.join(dir, "../native"), source, "-o", output], {encoding:"utf8"});
assert.equal(build.status, 0, build.stderr || build.stdout);
const run = spawnSync(output, [], {encoding:"utf8"});
assert.equal(run.status, 0, run.stderr || "ADPCM assertion failed");
console.log("ATVV ADPCM nibble decode, saturation, and 8→16 kHz interpolation: OK");
