import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { resolve } from "node:path";

const npmCli = process.env.npm_execpath || resolve(process.cwd(), "node_modules", "npm", "bin", "npm-cli.js");
const children = [];
let stopping = false;

const portAvailable = async (port) => {
  const probe = createServer();
  probe.listen(port, "127.0.0.1");
  try { await once(probe, "listening"); return true; }
  catch { return false; }
  finally { probe.close(); }
};

const start = (args) => {
  const child = spawn(process.execPath, [npmCli, ...args], { cwd: process.cwd(), env: process.env, stdio: "inherit" });
  children.push(child);
  return child;
};

const stop = (code = 0) => {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exit(code);
};

const waitForApi = async (server) => {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error("The API stopped before becoming ready. Review its configuration error above.");
    try { if ((await fetch("http://localhost:4000/health")).ok) return; }
    catch { /* The API is still connecting to Atlas. */ }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error("The API did not become ready within 45 seconds. Check Atlas Network Access and Internet connectivity.");
};

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop());

try {
  for (const port of [4000, 5173]) if (!(await portAvailable(port))) throw new Error(`Port ${port} is already in use. Stop the existing development server and try again.`);
  console.info("Starting the API with MongoDB Atlas configuration from .env…");
  const server = start(["run", "dev", "-w", "server"]);
  await waitForApi(server);
  const client = start(["run", "dev", "-w", "client"]);
  for (const child of [server, client]) child.once("exit", (code) => { if (!stopping) { console.error(`A development process exited${code === null ? "" : ` with code ${code}`}.`); stop(code || 1); } });
  console.info("ExamGuard is ready: http://localhost:5173");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Development startup failed.");
  stop(1);
}
