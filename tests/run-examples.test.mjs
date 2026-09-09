import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { findExampleNames } from "../scripts/run-examples.mjs";
import { createCourseServer } from "../scripts/serve-course.mjs";

test("course validation rejects duplicate and non-camelCase example names", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "typescript-course-names-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await cp(new URL("../lessons", import.meta.url), join(root, "lessons"), { recursive: true });
  await cp(new URL("../index.html", import.meta.url), join(root, "index.html"));
  const lessonPath = join(root, "lessons/0001-typescript-javascript-node.html");
  const html = await readFile(lessonPath, "utf8");
  const duplicate = "<pre><code>export function DuplicateExample() { return 1; }</code></pre>";
  await writeFile(lessonPath, html.replace("</section>", `${duplicate}${duplicate}</section>`));

  const result = spawnSync(
    process.execPath,
    [join(import.meta.dirname, "../scripts/check-course.mjs")],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /repeats example DuplicateExample/);
  assert.match(result.stderr, /example DuplicateExample must use lowerCamelCase/);
});

test("discovers examples in source order and excludes marked functions", () => {
  const source = `
export function first() { return 1; }
/** @lab */
export function lab<T>(value: T): T { return value; }
/** @example-skip */
function unsafe() { throw new Error("unsafe"); }
export async function second() { return 2; }
`;

  assert.deepEqual(findExampleNames(source), ["first", "second"]);
});

test("rejects an exported example with parameters", () => {
  assert.throws(
    () => findExampleNames("export function example(value: string) { return value; }"),
    /Example example .* must not declare parameters/,
  );
});

test("rejects a top-level function that was not exported", () => {
  assert.throws(
    () => findExampleNames("function forgotten() { return 1; }"),
    /Top-level function forgotten .* must be exported or marked @example-skip/,
  );
});

test("course server runs an example but not a Lab", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "typescript-course-"));
  await mkdir(join(root, "src"));
  await writeFile(join(root, "package.json"), '{"type":"module"}\n');
  await writeFile(
    join(root, "src/lesson-01.ts"),
    `export function demoValue(): number { return 42; }
/** @lab */
export function lab(): number { return 0; }
`,
  );

  const server = createCourseServer(root);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/examples/01/demoValue`);
  assert.deepEqual(await response.json(), { output: "demoValue: 42" });

  await writeFile(
    join(root, "src/lesson-01.ts"),
    `export function demoValue(): number { return 43; }
/** @lab */
export function lab(): number { return 0; }
`,
  );
  const updatedResponse = await fetch(
    `http://127.0.0.1:${port}/api/examples/01/demoValue`,
  );
  assert.deepEqual(await updatedResponse.json(), { output: "demoValue: 43" });

  const labResponse = await fetch(`http://127.0.0.1:${port}/api/examples/01/lab`);
  assert.equal(labResponse.status, 404);
});
