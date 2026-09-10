import { readFile } from "node:fs/promises";
import path from "node:path";
import { findExampleNames } from "./run-examples.mjs";
import { LESSONS, decodeCodeBlocks, findLabNames } from "./course-contract.mjs";

const ROOT = process.cwd();
const REQUIRED_SECTIONS = [
  "task",
  "recall",
  "mental-model",
  "comparison",
  "examples",
  "pitfalls",
  "contract",
  "sources",
  "lab",
  "hints",
  "quiz",
  "solution",
  "acceptance",
];
const REQUIRED_LEARNER_MARKERS = ["由你创建或修改：", "不要修改："];
const REMOVED_RUNNER_NAME = "runExamples";
const EXAMPLE_NAME_PATTERN = /^[a-z][A-Za-z0-9]*$/;

const indexHtml = await readFile(path.join(ROOT, "index.html"), "utf8");
const roadmapEntries = [...indexHtml.matchAll(/<li data-lesson="\d{2}" data-status="(published|planned)">/g)];
const publishedCount = roadmapEntries.filter((entry) => entry[1] === "published").length;
const plannedCount = roadmapEntries.filter((entry) => entry[1] === "planned").length;
const failures = [];
const answerPositions = [];

if (roadmapEntries.length !== 24 || publishedCount !== LESSONS.length || plannedCount !== 24 - LESSONS.length) {
  failures.push(
    `Roadmap must contain 24 lessons: ${LESSONS.length} published and ${24 - LESSONS.length} planned; found ${roadmapEntries.length}, ${publishedCount}, ${plannedCount}.`,
  );
}

// ponytail: course markup is a fixed authoring contract; targeted checks avoid a second parser dependency.
for (const lessonFile of LESSONS) {
  const lessonPath = path.join(ROOT, "lessons", lessonFile);
  const lessonId = lessonFile.slice(2, 4);
  const html = await readFile(lessonPath, "utf8");

  for (const section of REQUIRED_SECTIONS) {
    if (!html.includes(`id="${section}"`)) {
      failures.push(`${lessonFile} is missing #${section}.`);
    }
  }

  for (const marker of REQUIRED_LEARNER_MARKERS) {
    if (!html.includes(marker)) {
      failures.push(`${lessonFile} is missing learner instruction: ${marker}`);
    }
  }
  if (!html.includes(`<code>src/lesson-${lessonId}.ts</code>`)) {
    failures.push(`${lessonFile} must name src/lesson-${lessonId}.ts.`);
  }
  if (html.includes(REMOVED_RUNNER_NAME)) {
    failures.push(`${lessonFile} must use automatic example discovery.`);
  }
  if (!html.includes(`<code>pnpm examples ${lessonId}</code>`)) {
    failures.push(`${lessonFile} must document pnpm examples ${lessonId}.`);
  }

  const tutorialSource = decodeCodeBlocks(html);
  try {
    const labNames = findLabNames(html, lessonFile);
    const exampleNames = findExampleNames(tutorialSource, labNames, lessonFile);
    if (exampleNames.length === 0) {
      failures.push(`${lessonFile} must contain at least one runnable example.`);
    }
    const seenNames = new Set();
    for (const name of exampleNames) {
      if (seenNames.has(name)) {
        failures.push(`${lessonFile} repeats example ${name}; reuse one definition.`);
      }
      if (!EXAMPLE_NAME_PATTERN.test(name)) {
        failures.push(`${lessonFile} example ${name} must use lowerCamelCase.`);
      }
      seenNames.add(name);
    }
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }

  const answerMatch = html.match(/data-quiz data-answer="(\d+)"/);
  const optionMatches = [
    ...html.matchAll(/<span data-quiz-option>([^<]+)<\/span>/g),
  ];
  const radioMatches = [
    ...html.matchAll(/<input type="radio" name="answer" value="[01]" required>/g),
  ];

  if (!answerMatch || optionMatches.length !== 2 || radioMatches.length !== 2) {
    failures.push(`${lessonFile} must contain one two-option quiz.`);
    continue;
  }

  const optionLengths = optionMatches.map((match) =>
    Array.from(match[1].trim()).length,
  );
  if (optionLengths[0] !== optionLengths[1]) {
    failures.push(
      `${lessonFile} quiz options must have equal character length; found ${optionLengths.join(" and ")}.`,
    );
  }

  if (!html.includes("aria-live=\"polite\"")) {
    failures.push(`${lessonFile} quiz feedback needs aria-live.`);
  }
  if (!/<section id="solution"[\s\S]*?<details>[\s\S]*?<summary>/.test(html)) {
    failures.push(`${lessonFile} solution must use keyboard-accessible details/summary.`);
  }

  answerPositions.push(Number(answerMatch[1]));
}

const firstAnswers = answerPositions.filter((position) => position === 0).length;
const secondAnswers = answerPositions.filter((position) => position === 1).length;
if (Math.abs(firstAnswers - secondAnswers) > 1) {
  failures.push(
    `Quiz answers must differ by at most one across positions; found ${firstAnswers} first and ${secondAnswers} second.`,
  );
}

for (const plannedEntry of indexHtml.matchAll(/<li data-lesson="\d{2}" data-status="planned">([\s\S]*?)<\/li>/g)) {
  if (plannedEntry[1].includes("<a ")) {
    failures.push("Planned lessons must not create dead links.");
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`Course contract verified: 24-roadmap, ${LESSONS.length} published lessons, balanced quizzes.`);
