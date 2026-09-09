import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { formatWithOptions } from "node:util";

import { findExampleNames } from "./run-examples.mjs";

const API_PATTERN = /^\/api\/examples\/(\d{2})\/([A-Za-z_$][\w$]*)$/;
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

  if (!findExampleNames(source, sourceName).includes(name)) {
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

export function createCourseServer(rootDirectory = DEFAULT_ROOT) {
  const root = resolve(rootDirectory);

  return createServer(async (request, response) => {
    try {
      if (request.method !== "GET") {
        throw new HttpError(405, "Only GET requests are supported.");
      }

      const requestUrl = new URL(request.url ?? "/", `http://${DEFAULT_HOST}`);
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
      const status = error.status ?? (error.code === "ENOENT" ? 404 : 500);
      sendJson(response, status, { error: error.message });
    }
  });
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
