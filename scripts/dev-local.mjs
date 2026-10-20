import { spawn } from "node:child_process";
import { setDefaultResultOrder } from "node:dns";
import { once } from "node:events";
import { createServer } from "node:net";
import { resolve } from "node:path";

// npm is usually installed with Node, rather than in this repository.
const npmCli = process.env.npm_execpath || resolve(process.cwd(), "node_modules", "npm", "bin", "npm-cli.js");
// Some local networks advertise IPv6 but cannot transfer CDN downloads over it.
setDefaultResultOrder("ipv4first");
const databaseName = "examguard_local";
const demoPassword = "ExamGuardLocalDemo2026!";
// Keep the MongoDB runtime inside the repository. The default per-user cache can
// be read-only in managed Windows environments, which leaves a completed
// `.downloading` file that MongoMemoryServer cannot rename and prevents startup.
process.env.MONGOMS_DOWNLOAD_DIR ||= resolve(process.cwd(), ".cache", "mongodb-binaries");
// mongodb-memory-server reads its configuration when it is imported, so this
// must happen after MONGOMS_DOWNLOAD_DIR is set.
const { MongoMemoryServer } = await import("mongodb-memory-server");
let mongo;
let children = [];
const start = (args, env = process.env) => { const child = spawn(process.execPath, [npmCli, ...args], { cwd: process.cwd(), env, stdio: "inherit" }); children.push(child); return child; };
const portAvailable = async port => { const server = createServer(); server.listen(port, "127.0.0.1"); try { await once(server, "listening"); return true; } catch { return false; } finally { server.close(); } };
const waitForApi = async () => { const deadline = Date.now() + 30_000; while (Date.now() < deadline) { try { if ((await fetch("http://localhost:4000/health")).ok) return; } catch {} await new Promise(resolve => setTimeout(resolve, 250)); } throw new Error("The local API did not become ready within 30 seconds."); };
const shutdown = async (code = 0) => { for (const child of children) child.kill(); if (mongo) await mongo.stop(); process.exit(code); };
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => void shutdown());

try {
  for (const port of [4000, 5173]) if (!(await portAvailable(port))) throw new Error(`Port ${port} is already in use. Stop the existing dev servers, then run npm run dev:local again.`);
  mongo = await MongoMemoryServer.create({ instance: { dbName: databaseName } });
  const env = { ...process.env, MONGODB_URI: mongo.getUri(), MONGODB_DB_NAME: databaseName, JWT_SECRET: process.env.JWT_SECRET || "local-development-jwt-secret-change-in-production", DEMO_SEED: "yes", DEMO_SEED_PASSWORD: demoPassword };
  console.info("Local in-memory MongoDB started. No Atlas or cloud data is used.");
  start(["run", "dev", "-w", "server"], env);
  await waitForApi();
  const seed = start(["run", "seed", "-w", "server"], env);
  const [seedCode] = await once(seed, "exit");
  if (seedCode !== 0) throw new Error("Demo-data seeding failed.");
  start(["run", "dev", "-w", "client"], env);
  console.info("\nExamGuard local demo is ready: http://localhost:5173");
  console.info("Sign in as aarav.admin@demo.examguard.test with password: ExamGuardLocalDemo2026!");
  console.info("Press Ctrl+C to stop all services and delete the in-memory database.");
} catch (error) { console.error(error instanceof Error ? error.message : error); await shutdown(1); }
