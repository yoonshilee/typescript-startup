import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";

import { findExampleNames } from "../scripts/run-examples.mjs";
import { createCourseServer } from "../scripts/serve-course.mjs";
import { decodeCodeBlocks, findLabNames, lessonFileName } from "../scripts/course-contract.mjs";
import { lessonTestArgs } from "../scripts/check-lesson.mjs";

function courseHtml(solution = "export function lab() { throw new Error('Do not execute the answer'); }") {
  return `<section id="lab"><p>Implement the Lab.</p></section><section id="solution"><pre><code>${solution}</code></pre></section>`;
}

async function createTestCourse(context) {
  const root = await mkdtemp(join(tmpdir(), "typescript-course-"));
  await mkdir(join(root, "src"));
  await mkdir(join(root, "lessons"));
  await writeFile(join(root, "package.json"), '{"type":"module"}\n');
  await writeFile(join(root, "lessons", lessonFileName("01")), courseHtml());
  const server = createCourseServer(root);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  return { root, url: `http://127.0.0.1:${server.address().port}` };
}

test("example and Lab panels reveal results without a loading placeholder", async (context) => {
  for (const isLab of [false, true]) await context.test(isLab ? "Lab" : "example", async () => {
    const output = (value, passed = true) => isLab ? `${passed ? "校验通过" : "校验未通过"}\n\n${value}` : value;
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
      classList: { add() {} },
      querySelector: (selector) => selector === "button" ? button : result,
    };
    const code = {
      textContent: "export function demoValue() { return 42; }",
      closest: () => isLab ? {} : null,
      parentElement: { after: (element) => assert.equal(element, panel) },
    };
    let request = Promise.withResolvers();

    // Minimal DOM doubles run the actual page script without another dependency.
    runInNewContext(await readFile(new URL("../assets/course.js", import.meta.url), "utf8"), {
      document: {
        querySelector: () => isLab ? { append: (element) => assert.equal(element, panel) } : null,
        querySelectorAll: (selector) => selector === "pre > code" ? [code] : [],
        createElement: () => panel,
      },
      window: { location: { pathname: "/lessons/0001-example.html", protocol: "http:" } },
      fetch: (url, options) => {
        assert.equal(url, isLab ? "/api/labs/01" : "/api/examples/01/demoValue");
        assert.equal(options.method, isLab ? "POST" : "GET");
        return request.promise;
      },
    });

    assert.match(panel.innerHTML, /<pre[^>]* hidden>/);
    assert.match(panel.innerHTML, /class="example-output__button"/);
    const firstRun = click();
    assert.equal(button.disabled, true);
    assert.equal(button.dataset.state, "loading");
    assert.equal(buttonLabel.textContent, isLab ? "校验中…" : "运行中…");
    assert.equal(result.hidden, true);
    assert.equal(resultCode.textContent, "");
    request.resolve({ ok: true, json: async () => ({ passed: true, output: "42" }) });
    await firstRun;
    assert.equal(result.hidden, false);
    assert.equal(resultCode.textContent, output("42"));
    assert.equal(result.dataset.state, "success");
    assert.equal(buttonLabel.textContent, isLab ? "再次校验" : "再次运行");
    assert.equal(button.disabled, false);
    assert.equal(attributes.has("aria-busy"), false);

    request = Promise.withResolvers();
    const rerun = click();
    assert.equal(result.hidden, false);
    assert.equal(resultCode.textContent, output("42"));
    assert.equal(attributes.get("aria-busy"), "true");
    request.resolve(isLab
      ? { ok: true, json: async () => ({ passed: false, output: "Expected 42." }) }
      : { ok: false, json: async () => ({ error: "Example demoValue is unavailable." }) });
    await rerun;
    assert.equal(resultCode.textContent, isLab ? output("Expected 42.", false) : "Example demoValue is unavailable.");
    assert.equal(result.dataset.state, "error");
    assert.equal(button.dataset.state, "error");
    assert.equal(buttonLabel.textContent, isLab ? "再次校验" : "重试");
    assert.equal(button.disabled, false);

    request = Promise.withResolvers();
    const retry = click();
    request.resolve({ ok: true, json: async () => ({ passed: true, output: "" }) });
    await retry;
    assert.equal(result.hidden, false);
    assert.equal(resultCode.textContent, output(""));
    assert.equal(result.dataset.state, "success");
    assert.equal(button.dataset.state, "success");
    assert.equal(button.disabled, false);
    assert.equal(attributes.has("aria-busy"), false);
  });
});

test("five quizzes keep answers and retry feedback independent", async () => {
  const quizzes = Array.from({ length: 5 }, (_, index) => {
    const feedback = { dataset: {}, textContent: "" };
    return {
      dataset: { answer: String(index % 2) },
      selected: "",
      feedback,
      querySelector: () => feedback,
      addEventListener(_, handler) { this.submit = handler; },
    };
  });
  runInNewContext(await readFile(new URL("../assets/course.js", import.meta.url), "utf8"), {
    document: { querySelectorAll: () => quizzes },
    window: { location: { pathname: "/" } },
    FormData: class {
      constructor(quiz) { this.get = () => quiz.selected; }
    },
  });
  for (const [index, quiz] of quizzes.entries()) {
    quiz.selected = String(1 - Number(quiz.dataset.answer));
    quiz.submit({ preventDefault() {} });
    assert.equal(quiz.feedback.dataset.state, "incorrect");
    assert.match(quiz.feedback.textContent, /暂时不对/);
    quiz.selected = quiz.dataset.answer;
    quiz.submit({ preventDefault() {} });
    assert.equal(quiz.feedback.dataset.state, "correct");
    assert.match(quiz.feedback.textContent, /回答正确/);
    for (const untouched of quizzes.slice(index + 1)) assert.equal(untouched.feedback.textContent, "");
    for (const answered of quizzes.slice(0, index)) assert.equal(answered.feedback.dataset.state, "correct");
  }
});

test("course validation requires five independent, balanced two-option quizzes", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "typescript-course-quizzes-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await cp(new URL("../lessons", import.meta.url), join(root, "lessons"), { recursive: true });
  await cp(new URL("../index.html", import.meta.url), join(root, "index.html"));
  const lessonPath = join(root, "lessons/0001-typescript-javascript-node.html");
  const html = await readFile(lessonPath, "utf8");
  const forms = [...html.matchAll(/<form\b[^>]*data-quiz[^>]*>[\s\S]*?<\/form>/g)].map(([form]) => form);
  const run = () => spawnSync(process.execPath, [join(import.meta.dirname, "../scripts/check-course.mjs")], { cwd: root, encoding: "utf8" });
  const valid = run();
  assert.equal(valid.status, 0, valid.stderr);

  for (const [changed, expected] of [
    [html.replace(forms[0], ""), /exactly 5 quizzes/],
    [html.replace(forms[0], forms[0] + forms[0]), /exactly 5 quizzes/],
    [html.replace(forms[1], forms[0]), /unique, non-empty question/],
    [html.replace('data-answer="0"', 'data-answer="2"'), /valid answer/],
    [html.replace('value="1" required', 'value="0" required'), /two distinct answer options/],
    [html.replace('<span data-quiz-option>', '<span data-quiz-option>extra'), /equal character length/],
    [html.replace('data-quiz-feedback aria-live="polite"', 'data-quiz-feedback'), /own submit button and aria-live feedback/],
    [html.replaceAll(/data-answer="[01]"/g, 'data-answer="0"'), /balanced within the lesson/],
  ]) {
    await writeFile(lessonPath, changed);
    const result = run();
    assert.equal(result.status, 1, expected.source);
    assert.match(result.stderr, expected);
  }
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

test("discovers examples in source order and excludes HTML Labs and private functions", () => {
  const source = `
export function first() { return 1; }
export function lab<T>(value: T): T { return value; }
function unsafe() { throw new Error("unsafe"); }
export async function second() { return 2; }
`;

  const labs = findLabNames(courseHtml("export function lab&lt;T&gt;(value: T): T { return value; }"));
  assert.deepEqual(findExampleNames(source, labs), ["first", "second"]);
  assert.deepEqual(findExampleNames("export function lab() { return 0; }", labs), []);
  assert.deepEqual(findExampleNames("function helper() { return 1; }", labs), []);
});

test("rejects an exported example with parameters", () => {
  assert.throws(
    () => findExampleNames("export function example(value: string) { return value; }", new Set()),
    /Example example .* must not declare parameters/,
  );
});

test("rejects incomplete or ambiguous HTML contracts without executing source", () => {
  for (const html of [
    "", courseHtml().replace('id="lab"', 'id="other"'),
    courseHtml().replaceAll('id=', 'data-id='),
    courseHtml().replace('</section>', ''),
    courseHtml() + courseHtml(), courseHtml(""),
    courseHtml("export const lab = () => 1;"),
    courseHtml("export function first() {}\nexport function second() {}"),
    courseHtml().replace('<p>', '<section><p>'),
  ]) assert.throws(() => findLabNames(html), /must contain|must declare/);
  assert.equal(decodeCodeBlocks('<pre><code>&lt;&gt;&quot;&#39;&amp;</code></pre>'), '<>"\'&');
  assert.throws(() => lessonTestArgs("1"), /two-digit/);
  assert.throws(() => lessonTestArgs("25"), /published/);
});

test("examples CLI preserves source order and reports invalid inputs, missing source, or no examples", async (context) => {
  const { root } = await createTestCourse(context);
  await mkdir(join(root, "scripts"));
  for (const file of ["run-examples.mjs", "course-contract.mjs"]) {
    await cp(new URL(`../scripts/${file}`, import.meta.url), join(root, "scripts", file));
  }
  const run = (lesson) => spawnSync(process.execPath, [join(root, "scripts/run-examples.mjs"), lesson], { cwd: root, encoding: "utf8" });
  const source = join(root, "src/lesson-01.ts");
  await writeFile(source, 'export async function second() { return 2; }\nfunction unsafe() { throw new Error("Must not run"); }\nexport function lab() { throw new Error("Lab must not run"); }\nexport function first() { return 1; }');
  let result = run("01");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "second: 2\nfirst: 1\n");
  result = run("1");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage/);
  result = run("06");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /create src\/lesson-06.ts/);
  await writeFile(source, "export function lab() {}\nfunction privateHelper() {}");
  result = run("01");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /export at least one/);
});

test("course server returns only example results and excludes Labs", async (context) => {
  const { root, url } = await createTestCourse(context);
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
export function lab(): number { return 0; }
`,
  );

  const response = await fetch(`${url}/api/examples/01/demoValue`);
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
    const valueResponse = await fetch(`${url}/api/examples/01/${name}`);
    assert.equal(valueResponse.status, 200, name);
    assert.deepEqual(await valueResponse.json(), { output }, name);
  }

  await writeFile(
    join(root, "src/lesson-01.ts"),
    `export function demoValue(): number { return 43; }
export function lab(): number { return 0; }
`,
  );
  const updatedResponse = await fetch(
    `${url}/api/examples/01/demoValue`,
  );
  assert.equal(updatedResponse.status, 200);
  assert.deepEqual(await updatedResponse.json(), { output: "43" });

  const labResponse = await fetch(`${url}/api/examples/01/lab`);
  assert.equal(labResponse.status, 404);
  assert.deepEqual(await labResponse.json(), {
    error: "Example lab is unavailable in src/lesson-01.ts.",
  });

  await writeFile(join(root, "src/lesson-01.ts"), "export function demoValue() { throw new Error('Must not run'); }");
  await writeFile(join(root, "lessons", lessonFileName("01")), courseHtml(""));
  const invalid = await fetch(`${url}/api/examples/01/demoValue`);
  assert.equal(invalid.status, 500);
  assert.match((await invalid.json()).error, /must declare/);
  await rm(join(root, "lessons", lessonFileName("01")));
  const missing = await fetch(`${url}/api/examples/01/demoValue`);
  assert.equal(missing.status, 404);
  assert.match((await missing.json()).error, /course unavailable/);
});

test("Lab HTTP checks reuse real runtime and type contracts, reload, and reject invalid requests", async (context) => {
  const { root, url } = await createTestCourse(context);
  await mkdir(join(root, "tests"));
  await cp(new URL("./lessons.test.ts", import.meta.url), join(root, "tests/lessons.test.ts"));
  await symlink(new URL("../node_modules", import.meta.url).pathname, join(root, "node_modules"), "junction");
  await writeFile(join(root, "lessons", lessonFileName("01")), courseHtml("export function formatWelcome(name: string): string { throw new Error('Answer must not run'); }"));
  const check = () => fetch(`${url}/api/labs/01`, { method: "POST", headers: { Origin: url } });
  const file = join(root, "src/lesson-01.ts");

  let response = await check();
  assert.equal(response.status, 200);
  let result = await response.json();
  assert.equal(result.passed, false, result.output);
  assert.match(result.output, /incomplete: create src\/lesson-01.ts/);

  for (const [source, passed, message] of [
    ['export function formatWelcome(name: string): string { return "Wrong"; }', false, /AssertionError/],
    ['export function formatWelcome(name: any): string { return `Welcome, ${name}.`; }', false, /Unused '@ts-expect-error'/],
    ['export function formatWelcome(name: string): string { return `Welcome, ${name}.`; }', true, /pass 1/],
  ]) {
    await writeFile(file, source);
    response = await check();
    assert.equal(response.status, 200);
    result = await response.json();
    assert.equal(result.passed, passed, result.output);
    assert.match(result.output, message);
    assert.doesNotMatch(result.output, /\u001b\[/);
  }
  assert.equal((await fetch(`${url}/api/examples/01/formatWelcome`)).status, 404);
  for (const lesson of ["1", "00", "25", "01;echo"]) {
    assert.equal((await fetch(`${url}/api/labs/${lesson}`, { method: "POST" })).status, 400);
  }
  assert.equal((await fetch(`${url}/api/labs/01`)).status, 405);
  assert.equal((await fetch(`${url}/api/labs/01`, { method: "POST", headers: { Origin: "https://example.com" } })).status, 403);
  assert.equal((await fetch(`${url}/api/labs/01`, { method: "POST", headers: { Origin: "null" } })).status, 403);
  await rm(join(root, "tests/lessons.test.ts"));
  assert.equal((await check()).status, 404);
});

test("Lab checks limit concurrent runs, cancel disconnected work, and cap output", async (context) => {
  const { root, url } = await createTestCourse(context);
  await mkdir(join(root, "tests"));
  const file = join(root, "tests/lessons.test.ts");
  await writeFile(file, 'import test from "node:test"; test("01 slow", async () => { await new Promise(r => setTimeout(r, 1000)); });');
  const first = fetch(`${url}/api/labs/01`, { method: "POST" });
  const second = await fetch(`${url}/api/labs/01`, { method: "POST" });
  assert.equal(second.status, 409);
  assert.equal((await first).status, 200);

  await writeFile(file, 'import test from "node:test"; test("01 output", () => { process.stdout.write("x".repeat(2 * 1024 * 1024)); });');
  const overflow = await fetch(`${url}/api/labs/01`, { method: "POST" });
  assert.equal(overflow.status, 413);
  assert.match((await overflow.json()).error, /exceeded 1 MiB/);

  const controller = new AbortController();
  await writeFile(file, 'import test from "node:test"; import { writeFileSync } from "node:fs"; test("01 hangs", () => { writeFileSync("started", "yes"); while (true) {} });');
  const pending = fetch(`${url}/api/labs/01`, { method: "POST", signal: controller.signal });
  // Wait for real worker startup rather than assuming a scheduling delay.
  for (let n = 0; ; n++) {
    try { await readFile(join(root, "started")); break; } catch {
      assert.ok(n < 100, "test worker did not start");
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  controller.abort();
  await assert.rejects(pending, /abort/i);
  await writeFile(file, 'import test from "node:test"; test("01 retry", () => {});');
  let retry;
  for (let n = 0; ; n++) {
    retry = await fetch(`${url}/api/labs/01`, { method: "POST" });
    if (retry.status !== 409) break;
    assert.ok(n < 100, "cancelled run did not release its slot");
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).passed, true);
});

test("Lab checks stop blocking loops after timeout and allow a subsequent retry", { timeout: 75_000 }, async (context) => {
  const { root, url } = await createTestCourse(context);
  await mkdir(join(root, "tests"));
  const file = join(root, "tests/lessons.test.ts");
  await writeFile(file, 'import test from "node:test"; test("01 loops", () => { while (true) {} });');
  const response = await fetch(`${url}/api/labs/01`, { method: "POST" });
  const result = await response.json();
  assert.equal(response.status, 504);
  assert.match(result.error, /timed out/i);
  await writeFile(file, 'import test from "node:test"; test("01 retry", () => {});');
  const retry = await fetch(`${url}/api/labs/01`, { method: "POST" });
  assert.equal((await retry.json()).passed, true);
});
