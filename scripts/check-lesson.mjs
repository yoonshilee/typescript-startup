import { spawnSync } from "node:child_process";
import { lessonFileName, readLabNames } from "./course-contract.mjs";

export function lessonTestArgs(lesson) {
  lessonFileName(lesson);
  return ["--test", "--test-name-pattern", `^${lesson} `, "tests/lessons.test.ts"];
}

if (import.meta.main) {
  const lesson = process.argv[2];
  let args;
  try {
    args = lessonTestArgs(lesson);
  } catch {
    console.error("Usage: pnpm lesson <01..24>");
    process.exit(2);
  }

  try {
    await readLabNames(process.cwd(), lesson);
    const result = spawnSync(process.execPath, args, { stdio: "inherit" });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
