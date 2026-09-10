import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { formatWithOptions } from "node:util";

import { findExampleNames } from "./run-examples.mjs";
import { lessonFileName, readLabNames } from "./course-contract.mjs";
import { lessonTestArgs } from "./check-lesson.mjs";

const API_PATTERN = /^\/api\/examples\/(\d{2})\/([A-Za-z_$][\w$]*)$/;
const LAB_API_PATTERN = /^\/api\/labs\/(\d{2})$/;
const LAB_TIMEOUT_MS = 60_000;
const LAB_OUTPUT_LIMIT = 1024 * 1024;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4173;
const DEFAULT_ROOT = fileURLToPath(new URL("..", import.meta.url));
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};
let importVersion = 0;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

async function executeExample(root, lesson, name) {
  const sourceName = `src/lesson-${lesson}.ts`;
  const lessonFile = resolve(root, sourceName);
  let source;

  try {
    source = await readFile(lessonFile, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new HttpError(404, `Lesson ${lesson} examples unavailable: create ${sourceName}.`);
    }
    throw error;
  }

  const labNames = await readLabNames(root, lesson);
  if (!findExampleNames(source, labNames, sourceName).includes(name)) {
    throw new HttpError(404, `Example ${name} is unavailable in ${sourceName}.`);
  }

  // ponytail: reloads the lesson file itself; use isolated workers if examples gain mutable imports.
  const lessonUrl = pathToFileURL(lessonFile);
  lessonUrl.searchParams.set("run", String(importVersion++));
  const lessonModule = await import(lessonUrl.href);
  if (typeof lessonModule[name] !== "function") {
    throw new HttpError(500, `Discovered example ${name} is not a function export.`);
  }

  return formatWithOptions({ colors: false }, await lessonModule[name]());
}

async function checkLab(root, lesson, signal) {
  await readLabNames(root, lesson);
  await access(resolve(root, "tests/lessons.test.ts"));
  const args = lessonTestArgs(lesson);
  args.unshift(`--test-timeout=${LAB_TIMEOUT_MS}`, "--test-reporter=spec");
  const env = { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" };
  // A server under node:test must start an independent runner, not inherit its worker context.
  delete env.NODE_TEST_CONTEXT;

  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      env,
      detached: process.platform !== "win32",
    });
    const chunks = [];
    let bytes = 0;
    let failure;

    function stop(error) {
      if (failure) return;
      failure = error;
      // The test runner starts workers and tsc children; stop the whole tree on cancellation.
      if (!child.pid) return;
      if (process.platform === "win32") {
        const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
        killer.on("error", () => child.kill());
      } else {
        try { process.kill(-child.pid, "SIGKILL"); } catch (error) {
          if (error.code !== "ESRCH") child.kill("SIGKILL");
        }
      }
    }

    function collect(chunk) {
      if (failure) return;
      bytes += chunk.length;
      if (bytes > LAB_OUTPUT_LIMIT) {
        stop(new HttpError(413, "Lab output exceeded 1 MiB. Reduce debug output and retry."));
      } else {
        chunks.push(chunk);
      }
    }
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const abort = () => stop(new HttpError(499, "Lab check cancelled."));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    // Allow the built-in timeout to report first; this also catches a stuck runner or open handles.
    const timer = setTimeout(() => stop(new HttpError(504, "Lab check timed out. Check for loops or open handles and retry.")), LAB_TIMEOUT_MS + 5000);
    child.on("error", (error) => { failure = error; });
    child.on("close", (code, exitSignal) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (failure) reject(failure);
      else if (exitSignal) reject(new Error(`Lab check terminated by ${exitSignal}.`));
      else resolveResult({ passed: code === 0, output: Buffer.concat(chunks).toString("utf8") });
    });
  });
}

export function createCourseServer(rootDirectory = DEFAULT_ROOT) {
  const root = resolve(rootDirectory);
  const runningLabs = new Map();

  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", `http://${DEFAULT_HOST}`);
      if (requestUrl.pathname.startsWith("/api/labs/")) {
        if (request.method !== "POST") throw new HttpError(405, "Lab checks require POST.");
        const labMatch = requestUrl.pathname.match(LAB_API_PATTERN);
        try { lessonFileName(labMatch?.[1]); } catch {
          throw new HttpError(400, "Lab lesson must be a published two-digit number (01..24).");
        }
        if (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`) {
          throw new HttpError(403, "Lab checks require a same-origin request.");
        }
        const lesson = labMatch[1];
        if (runningLabs.has(lesson)) throw new HttpError(409, `Lab ${lesson} is already running. Wait and retry.`);
        const controller = new AbortController();
        const cancel = () => controller.abort();
        runningLabs.set(lesson, controller);
        response.once("close", cancel);
        try {
          const result = await checkLab(root, lesson, controller.signal);
          sendJson(response, 200, result);
        } finally {
          response.off("close", cancel);
          runningLabs.delete(lesson);
        }
        return;
      }
      if (request.method !== "GET") {
        throw new HttpError(405, "Only GET requests are supported.");
      }

      const apiMatch = requestUrl.pathname.match(API_PATTERN);
      if (apiMatch) {
        const output = await executeExample(root, apiMatch[1], apiMatch[2]);
        sendJson(response, 200, { output });
        return;
      }

      const pathname = decodeURIComponent(requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname);
      const file = resolve(root, `.${pathname}`);
      if (file !== root && !file.startsWith(`${root}${sep}`)) {
        throw new HttpError(403, "Requested path is outside the course directory.");
      }

      const content = await readFile(file);
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": MIME_TYPES[extname(file)] ?? "application/octet-stream",
      });
      response.end(content);
    } catch (error) {
      const status = error.status ?? (error.code === "ENOENT" || error.cause?.code === "ENOENT" ? 404 : 500);
      if (!response.destroyed) sendJson(response, status, { error: error.message });
    }
  });
  server.on("close", () => {
    for (const controller of runningLabs.values()) controller.abort();
  });
  return server;
}

if (import.meta.main) {
  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error("PORT must be an integer between 1 and 65535.");
    process.exitCode = 1;
  } else {
    const server = createCourseServer();
    server.on("error", (error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
    server.listen(port, DEFAULT_HOST, () => {
      console.log(`Course available at http://${DEFAULT_HOST}:${port}`);
    });
  }
}
