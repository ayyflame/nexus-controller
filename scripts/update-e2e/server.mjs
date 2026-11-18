// Test-only HTTPS file server for the Windows update end-to-end check
// (.github/workflows/update-e2e.yml). Never used by NEXUS itself.
//
//   node server.mjs <pfx> <pfx-password> <root-dir> <port> [bytes-per-second]
//
// Installers (*.exe) are sent in throttled chunks so download progress can
// be observed; everything else is sent at once.
import { createServer } from "node:https";
import { readFileSync, statSync, createReadStream } from "node:fs";
import { join, normalize, sep } from "node:path";

const [pfx, passphrase, root, port, rateArg] = process.argv.slice(2);
const rate = Number(rateArg ?? 0);

createServer({ pfx: readFileSync(pfx), passphrase }, (req, res) => {
  const path = normalize(join(root, decodeURIComponent(new URL(req.url, "https://x").pathname)));
  const log = (code) => console.log(`${new Date().toISOString()} ${req.method} ${req.url} ${code}`);
  if (!path.startsWith(normalize(root) + sep)) { res.writeHead(403).end(); log(403); return; }
  let st;
  try { st = statSync(path); } catch { res.writeHead(404).end(); log(404); return; }
  if (!st.isFile()) { res.writeHead(404).end(); log(404); return; }
  const type = path.endsWith(".json") ? "application/json" : "application/octet-stream";
  res.writeHead(200, { "content-type": type, "content-length": st.size, "cache-control": "no-cache" });
  log(200);
  if (!rate || !path.endsWith(".exe")) { createReadStream(path).pipe(res); return; }
  const data = readFileSync(path);
  const chunk = Math.max(1024, Math.floor(rate / 10));
  let at = 0;
  const timer = setInterval(() => {
    if (at >= data.length) { clearInterval(timer); res.end(); return; }
    res.write(data.subarray(at, at + chunk));
    at += chunk;
  }, 100);
  res.on("close", () => clearInterval(timer));
}).listen(Number(port), "127.0.0.1", () => console.log(`serving ${root} on https://localhost:${port}`));
