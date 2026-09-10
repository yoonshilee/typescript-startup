import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const LESSONS = [
  "0001-typescript-javascript-node.html",
  "0002-values-operators-truthiness.html",
  "0003-control-flow-functions-scope.html",
  "0004-collections-and-immutability.html",
  "0005-type-inference-and-literals.html",
  "0006-object-types-and-contracts.html",
  "0007-unions-narrowing-and-never.html",
  "0008-null-undefined-unknown-boundaries.html",
  "0009-function-types-generics-overloads.html",
  "0010-generic-constraints-keyof-type-queries.html",
  "0011-utility-mapped-types-safe-updates.html",
  "0012-conditional-infer-template-literal-types.html",
  "0013-javascript-node-execution-model.html",
  "0014-esm-package-boundaries-module-resolution.html",
  "0015-event-loop-promises-async-fetch.html",
  "0016-error-result-abort-signal.html",
  "0017-package-pnpm-tsconfig-check-build.html",
  "0018-node-files-path-process-json.html",
  "0019-parseargs-stdio-exit-codes.html",
  "0020-node-test-assert-temp-debug.html",
  "0021-api-unknown-runtime-validation.html",
  "0022-versioned-files-atomic-write-recovery.html",
  "0023-bin-shebang-build-cross-platform.html",
  "0024-cli-acceptance-refactor-agent-map.html",
];
export const EXPORTED_FUNCTION_PATTERN =
  /^export (?:async\s+)?function\s+([A-Za-z_$][\w$]*)(?:<[^\n]+>)?\s*\(/gm;

export function lessonFileName(lesson) {
  const file = LESSONS.find((name) => name.slice(2, 4) === lesson);
  if (!file) throw new Error("Lesson must be a published two-digit number (01..24).");
  return file;
}

export function decodeCodeBlocks(html) {
  return [...html.matchAll(/<pre\b[^>]*>\s*<code\b[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/g)]
    .map((match) => match[1]
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&quot;", '"')
      .replaceAll("&#39;", "'")
      .replaceAll("&amp;", "&"))
    .join("\n\n");
}

export function findLabNames(html, sourceName = "course HTML") {
  // ponytail: requires the course's flat, double-quoted section markup; use an HTML parser if it changes.
  const sections = [...html.matchAll(/<section\b[^>]*\sid="(lab|solution)"[^>]*>([\s\S]*?)<\/section>/g)];
  for (const id of ["lab", "solution"]) {
    const matches = sections.filter((match) => match[1] === id);
    const openings = [...html.matchAll(new RegExp(`<section\\b[^>]*\\sid="${id}"`, "g"))];
    if (matches.length !== 1 || openings.length !== 1 || /<section\b/.test(matches[0][2])) {
      throw new Error(`${sourceName} must contain exactly one complete, non-nested #${id} section.`);
    }
  }
  const solution = sections.find((match) => match[1] === "solution")[2];
  const names = [...decodeCodeBlocks(solution).matchAll(EXPORTED_FUNCTION_PATTERN)].map((match) => match[1]);
  if (names.length !== 1 || !/^[a-z][A-Za-z0-9]*$/.test(names[0])) {
    throw new Error(`${sourceName} must declare exactly one lowerCamelCase Lab function in #solution.`);
  }
  return new Set(names);
}

export async function readLabNames(root, lesson) {
  const file = lessonFileName(lesson);
  let html;
  try {
    html = await readFile(join(root, "lessons", file), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`Lesson ${lesson} course unavailable: missing lessons/${file}.`, { cause: error });
    }
    throw error;
  }
  return findLabNames(html, file);
}
