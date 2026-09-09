import { readFile } from "node:fs/promises";

const LESSON_PATTERN = /^\d{2}$/;
const FUNCTION_NAME = "([A-Za-z_$][\\w$]*)";
const EXPORTED_FUNCTION_PATTERN = new RegExp(
  `^export (?:async\\s+)?function\\s+${FUNCTION_NAME}(?:<[^\\n]+>)?\\s*\\(`,
  "gm",
);
const ZERO_ARGUMENT_EXPORT_PATTERN = new RegExp(
  `^export (?:async\\s+)?function\\s+${FUNCTION_NAME}(?:<[^\\n]+>)?\\s*\\(\\s*\\)`,
  "gm",
);
const LAB_PATTERN = new RegExp(
  `/\\*\\*\\s*@lab\\s*\\*/\\s*export (?:async\\s+)?function\\s+${FUNCTION_NAME}`,
  "g",
);
const SKIPPED_EXAMPLE_PATTERN = new RegExp(
  `/\\*\\*\\s*@example-skip\\s*\\*/\\s*(?:async\\s+)?function\\s+${FUNCTION_NAME}`,
  "g",
);
const ZERO_ARGUMENT_PRIVATE_PATTERN = new RegExp(
  `^(?:async\\s+)?function\\s+${FUNCTION_NAME}(?:<[^\\n]+>)?\\s*\\(\\s*\\)`,
  "gm",
);

function collectNames(source, pattern) {
  return new Set([...source.matchAll(pattern)].map((match) => match[1]));
}

export function findExampleNames(source, sourceName = "lesson source") {
  // ponytail: scans the course's fixed top-level function style; use a parser if authoring syntax expands.
  const labNames = collectNames(source, LAB_PATTERN);
  const skippedNames = collectNames(source, SKIPPED_EXAMPLE_PATTERN);
  const zeroArgumentNames = collectNames(source, ZERO_ARGUMENT_EXPORT_PATTERN);
  const exportedFunctions = [...source.matchAll(EXPORTED_FUNCTION_PATTERN)];

  for (const match of exportedFunctions) {
    const name = match[1];
    if (!labNames.has(name) && !zeroArgumentNames.has(name)) {
      throw new Error(`Example ${name} in ${sourceName} must not declare parameters.`);
    }
  }

  for (const match of source.matchAll(ZERO_ARGUMENT_PRIVATE_PATTERN)) {
    const name = match[1];
    if (!skippedNames.has(name)) {
      throw new Error(
        `Top-level function ${name} in ${sourceName} must be exported or marked @example-skip.`,
      );
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

  const exampleNames = findExampleNames(source, sourceName);
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
