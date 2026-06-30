import { spawn } from "node:child_process";
import process from "node:process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const children = new Set();

await run("build:server", npm, ["run", "build:server"]);

const api = start("api", process.execPath, ["dist/server.js"]);
const web = start("web", npm, ["run", "dev", "--prefix", "web"]);

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await Promise.race([
  exitPromise(api, "api"),
  exitPromise(web, "web"),
]).finally(shutdown);

function start(label, command, args) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    shell: process.platform === "win32" && command === npm,
    stdio: ["inherit", "pipe", "pipe"],
  });
  children.add(child);
  child.stdout.on("data", (chunk) => prefix(label, chunk));
  child.stderr.on("data", (chunk) => prefix(label, chunk));
  child.on("exit", () => children.delete(child));
  return child;
}

function run(label, command, args) {
  return new Promise((resolve, reject) => {
    const child = start(label, command, args);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${label} exited with code ${code}`));
      }
    });
    child.on("error", reject);
  });
}

function exitPromise(child, label) {
  return new Promise((resolve, reject) => {
    child.on("exit", (code) => {
      if (code === 0 || code === null) {
        resolve();
      } else {
        reject(new Error(`${label} exited with code ${code}`));
      }
    });
    child.on("error", reject);
  });
}

function prefix(label, chunk) {
  for (const line of chunk.toString("utf8").split(/\r?\n/)) {
    if (line.trim()) {
      console.log(`[${label}] ${line}`);
    }
  }
}

function shutdown() {
  for (const child of children) {
    if (!child.killed) {
      child.kill();
    }
  }
}
