import { spawnSync } from "node:child_process";

const PUBLISHED_LESSONS = new Set([
  "01", "02", "03", "04", "05", "06", "07", "08",
  "09", "10", "11", "12", "13", "14", "15", "16",
  "17", "18", "19", "20", "21", "22", "23", "24",
]);
const lesson = process.argv[2];

if (!lesson || !PUBLISHED_LESSONS.has(lesson)) {
  console.error("Usage: pnpm lesson <01..24>");
  process.exit(2);
}

const testResult = spawnSync(
  process.execPath,
  [
    "--test",
    "--test-name-pattern",
    `^${lesson} `,
    "tests/lessons.test.ts",
  ],
  { stdio: "inherit" },
);

if (testResult.status !== 0) {
  process.exit(testResult.status ?? 1);
}
