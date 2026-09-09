import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";

import { findExampleNames } from "../scripts/run-examples.mjs";
import { createCourseServer } from "../scripts/serve-course.mjs";

test("page reveals completed output without a loading placeholder", async () => {
  const buttonLabel = { textContent: "运行示例" };
  const resultCode = { textContent: "" };
  const attributes = new Map();
  const result = {
    hidden: true,
    dataset: {},
    querySelector: () => resultCode,
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: (name) => attributes.delete(name),
  };
  let click;
  const button = {
    dataset: {},
    querySelector: () => buttonLabel,
    addEventListener: (_, handler) => { click = handler; },
  };
  const panel = {
    setAttribute() {},
    querySelector: (selector) => selector === "button" ? button : result,
  };
  const code = {
    textContent: "export function demoValue() { return 42; }",
    parentElement: { after: (element) => assert.equal(element, panel) },
  };
  let request = Promise.withResolvers();

  // Minimal DOM doubles run the actual page script without another dependency.
  runInNewContext(await readFile(new URL("../assets/course.js", import.meta.url), "utf8"), {
    document: {
      querySelectorAll: (selector) => selector === "pre > code" ? [code] : [],
      createElement: () => panel,
    },
    window: { location: { pathname: "/lessons/0001-example.html", protocol: "http:" } },
    fetch: (url) => {
      assert.equal(url, "/api/examples/01/demoValue");
      return request.promise;
    },
  });

  assert.match(panel.innerHTML, /<pre[^>]* hidden>/);
  assert.match(panel.innerHTML, /class="example-output__button"/);
  const firstRun = click();
  assert.equal(button.disabled, true);
  assert.equal(button.dataset.state, "loading");
  assert.equal(buttonLabel.textContent, "运行中…");
  assert.equal(result.hidden, true);
  assert.equal(resultCode.textContent, "");
  request.resolve({ ok: true, json: async () => ({ output: "42" }) });
  await firstRun;
  assert.equal(result.hidden, false);
  assert.equal(resultCode.textContent, "42");
  assert.equal(result.dataset.state, "success");
  assert.equal(buttonLabel.textContent, "再次运行");
  assert.equal(button.disabled, false);
  assert.equal(attributes.has("aria-busy"), false);

  request = Promise.withResolvers();
  const rerun = click();
  assert.equal(result.hidden, false);
  assert.equal(resultCode.textContent, "42");
  assert.equal(attributes.get("aria-busy"), "true");
  request.resolve({ ok: false, json: async () => ({ error: "Example demoValue is unavailable." }) });
  await rerun;
  assert.equal(resultCode.textContent, "Example demoValue is unavailable.");
  assert.equal(result.dataset.state, "error");
  assert.equal(button.dataset.state, "error");
  assert.equal(buttonLabel.textContent, "重试");
  assert.equal(button.disabled, false);

  request = Promise.withResolvers();
  const retry = click();
  request.resolve({ ok: true, json: async () => ({ output: "" }) });
  await retry;
  assert.equal(result.hidden, false);
  assert.equal(resultCode.textContent, "");
  assert.equal(result.dataset.state, "success");
  assert.equal(button.dataset.state, "success");
  assert.equal(button.disabled, false);
  assert.equal(attributes.has("aria-busy"), false);
});

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

test("course server returns only example results and excludes Labs", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "typescript-course-"));
  await mkdir(join(root, "src"));
  await writeFile(join(root, "package.json"), '{"type":"module"}\n');
  await writeFile(
    join(root, "src/lesson-01.ts"),
    `export function demoValue(): number { return 42; }
export function demoText(): string { return "demoText: 100% %s %d"; }
export function demoObject() { return { value: 42 }; }
export function demoArray() { return [1, "two", false]; }
export function demoFalse(): boolean { return false; }
export function demoZero(): number { return 0; }
export function demoEmpty(): string { return ""; }
export function demoNull(): null { return null; }
export function demoUndefined(): void {}
export async function demoAsync(): Promise<number> { return 42; }
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
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { output: "42" });

  for (const [name, output] of [
    ["demoText", "demoText: 100% %s %d"],
    ["demoObject", "{ value: 42 }"],
    ["demoArray", "[ 1, 'two', false ]"],
    ["demoFalse", "false"],
    ["demoZero", "0"],
    ["demoEmpty", ""],
    ["demoNull", "null"],
    ["demoUndefined", "undefined"],
    ["demoAsync", "42"],
  ]) {
    const valueResponse = await fetch(`http://127.0.0.1:${port}/api/examples/01/${name}`);
    assert.equal(valueResponse.status, 200, name);
    assert.deepEqual(await valueResponse.json(), { output }, name);
  }

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
  assert.equal(updatedResponse.status, 200);
  assert.deepEqual(await updatedResponse.json(), { output: "43" });

  const labResponse = await fetch(`http://127.0.0.1:${port}/api/examples/01/lab`);
  assert.equal(labResponse.status, 404);
  assert.deepEqual(await labResponse.json(), {
    error: "Example lab is unavailable in src/lesson-01.ts.",
  });
});
