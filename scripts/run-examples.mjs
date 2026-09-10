import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { EXPORTED_FUNCTION_PATTERN, readLabNames } from "./course-contract.mjs";

const LESSON_PATTERN = /^\d{2}$/;
const FUNCTION_NAME = "([A-Za-z_$][\\w$]*)";
const ZERO_ARGUMENT_EXPORT_PATTERN = new RegExp(
  `^export (?:async\\s+)?function\\s+${FUNCTION_NAME}(?:<[^\\n]+>)?\\s*\\(\\s*\\)`,
  "gm",
);

function collectNames(source, pattern) {
  return new Set([...source.matchAll(pattern)].map((match) => match[1]));
}

export function findExampleNames(source, labNames, sourceName = "lesson source") {
  // ponytail: scans the course's fixed top-level function style; use a parser if authoring syntax expands.
  const zeroArgumentNames = collectNames(source, ZERO_ARGUMENT_EXPORT_PATTERN);
  const exportedFunctions = [...source.matchAll(EXPORTED_FUNCTION_PATTERN)];

  for (const match of exportedFunctions) {
    const name = match[1];
    if (!labNames.has(name) && !zeroArgumentNames.has(name)) {
      throw new Error(`Example ${name} in ${sourceName} must not declare parameters.`);
    }
  }

  return exportedFunctions
    .map((match) => match[1])
    .filter((name) => !labNames.has(name));
}

async function main() {
  const lesson = process.argv[2];

  if (!lesson || !LESSON_PATTERN.test(lesson)) {
    console.error("Usage: pnpm examples <NN>");
    process.exitCode = 2;
    return;
  }

  const sourceName = `src/lesson-${lesson}.ts`;
  const lessonFile = new URL(`../${sourceName}`, import.meta.url);
  let source;

  try {
    source = await readFile(lessonFile, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`Lesson ${lesson} examples unavailable: create ${sourceName}.`);
    }
    throw error;
  }

  const labNames = await readLabNames(fileURLToPath(new URL("..", import.meta.url)), lesson);
  const exampleNames = findExampleNames(source, labNames, sourceName);
  if (exampleNames.length === 0) {
    throw new Error(`Lesson ${lesson} examples unavailable: export at least one zero-argument example.`);
  }

  const lessonModule = await import(lessonFile.href);
  for (const name of exampleNames) {
    if (typeof lessonModule[name] !== "function") {
      throw new Error(`Discovered example ${name} is not a function export.`);
    }
    console.log(`${name}:`, await lessonModule[name]());
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
