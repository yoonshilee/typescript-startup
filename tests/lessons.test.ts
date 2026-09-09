import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "..");

function getLessonSource(lesson: number) {
  const lessonId = String(lesson).padStart(2, "0");
  const fileName = `lesson-${lessonId}.ts`;

  return {
    lessonId,
    path: resolve(ROOT, "src", fileName).replaceAll("\\", "/"),
    url: new URL(`../src/${fileName}`, import.meta.url),
  };
}

async function loadLesson(lesson: number) {
  const source = getLessonSource(lesson);

  try {
    return {
      exports: await import(source.url.href),
      path: source.path,
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ERR_MODULE_NOT_FOUND") {
      assert.fail(`Lesson ${source.lessonId} incomplete: create src/lesson-${source.lessonId}.ts.`);
    }
    throw error;
  }
}

function requireLabFunction<T extends (...args: never[]) => unknown>(
  lesson: Record<string, unknown>,
  lessonId: string,
  exportName: string,
  labContract = `function ${exportName}`,
): T {
  const value = lesson[exportName];
  assert.equal(
    typeof value,
    "function",
    `Lesson ${lessonId} incomplete: export ${labContract} from src/lesson-${lessonId}.ts.`,
  );
  return value as T;
}

async function typecheckFixture(source: string) {
  const directory = await mkdtemp(join(tmpdir(), "typescript-startup-lesson-"));
  const fixture = join(directory, "contract.ts");
  await writeFile(fixture, source);

  try {
    await run(process.execPath, [
      resolve(ROOT, "node_modules/typescript/bin/tsc"),
      "--ignoreConfig",
      "--noEmit",
      "--strict",
      "--exactOptionalPropertyTypes",
      "--skipLibCheck",
      "--types", "node",
      "--target", "ES2024",
      "--module", "ESNext",
      "--moduleResolution", "Bundler",
      "--allowImportingTsExtensions",
      "--verbatimModuleSyntax",
      "--erasableSyntaxOnly",
      fixture,
    ]);
  } finally {
    await rm(directory, { recursive: true });
  }
}

function run(command: string, args: readonly string[]) {
  return new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, [...args], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(output || `${command} exited with ${code}`));
    });
  });
}

test("typechecking fixtures resolves Node built-in modules", async () => {
  await typecheckFixture(`
import { basename } from "node:path";
const name: string = basename("notes.json");
`);
});

test("01 formats an exact welcome message", async () => {
  const { exports: lesson, path } = await loadLesson(1);
  const formatWelcome = requireLabFunction<(name: string) => string>(lesson, "01", "formatWelcome");
  assert.equal(formatWelcome("Ada"), "Welcome, Ada.");
  assert.equal(formatWelcome("Guido"), "Welcome, Guido.");
  assert.equal(formatWelcome(""), "Welcome, .");

  await typecheckFixture(`
    import { formatWelcome } from "${path}";
    const contract: (name: string) => string = formatWelcome;
    // @ts-expect-error — Lesson 01 must reject non-string names.
    formatWelcome(42);
    void contract;
  `);
});

test("02 recognizes titles with visible content", async () => {
  const { exports: lesson, path } = await loadLesson(2);
  const isMeaningfulTitle = requireLabFunction<(title: string) => boolean>(lesson, "02", "isMeaningfulTitle");
  assert.equal(isMeaningfulTitle("Release notes"), true);
  assert.equal(isMeaningfulTitle("  draft  "), true);
  assert.equal(isMeaningfulTitle(""), false);
  assert.equal(isMeaningfulTitle("   \n\t"), false);

  await typecheckFixture(`
    import { isMeaningfulTitle } from "${path}";
    const contract: (title: string) => boolean = isMeaningfulTitle;
    // @ts-expect-error — Lesson 02 must reject non-string titles.
    isMeaningfulTitle(null);
    void contract;
  `);
});

test("03 creates independent tag normalizers", async () => {
  const { exports: lesson, path } = await loadLesson(3);
  const createTagNormalizer = requireLabFunction<(prefix: string) => (tag: string) => string>(
    lesson,
    "03",
    "createTagNormalizer",
  );
  const courseTag = createTagNormalizer(" Course ");
  const projectTag = createTagNormalizer(" PROJECT ");

  assert.equal(courseTag(" TypeScript "), "course:typescript");
  assert.equal(courseTag(" Node "), "course:node");
  assert.equal(projectTag(" CLI "), "project:cli");

  await typecheckFixture(`
    import { createTagNormalizer } from "${path}";
    const contract: (prefix: string) => (tag: string) => string = createTagNormalizer;
    // @ts-expect-error — Lesson 03 must reject non-string prefixes.
    createTagNormalizer(1);
    void contract;
  `);
});

test("04 adds a normalized tag to a new array", async () => {
  const { exports: lesson, path } = await loadLesson(4);
  const addTag = requireLabFunction<(
    tags: string[],
    tag: string,
  ) => string[]>(
    lesson,
    "04",
    "addTag",
  );
  const original = ["typescript"];
  const before = structuredClone(original);

  const updated = addTag(original, " Node ");

  assert.deepEqual(updated, ["typescript", "node"]);
  assert.notStrictEqual(updated, original);
  assert.deepEqual(original, before);

  await typecheckFixture(`
    import { addTag } from "${path}";
    const contract: (tags: string[], tag: string) => string[] = addTag;
    // @ts-expect-error — Lesson 04 requires a string array as the first argument.
    addTag("typescript", "node");
    // @ts-expect-error — Lesson 04 requires a string tag.
    addTag(["typescript"], 1);
    void contract;
  `);
});

test("05 preserves exact default list options", async () => {
  const { exports: lesson, path } = await loadLesson(5);
  const createDefaultListOptions = requireLabFunction<() => {
    readonly status: "active";
    readonly limit: 20;
  }>(
    lesson,
    "05",
    "createDefaultListOptions",
  );

  assert.deepEqual(createDefaultListOptions(), {
    status: "active",
    limit: 20,
  });

  await typecheckFixture(`
    import { createDefaultListOptions } from "${path}";
    const options = createDefaultListOptions();
    const status: "active" = options.status;
    const limit: 20 = options.limit;
    // @ts-expect-error — Lesson 05 preserves status as a readonly literal.
    options.status = "archived";
    // @ts-expect-error — Lesson 05 preserves limit as a readonly literal.
    options.limit = 50;
    // @ts-expect-error — Lesson 05 requires a no-argument function.
    createDefaultListOptions("active");
    void status;
    void limit;
  `);
});

test("06 normalizes a draft without changing its object contract", async () => {
  type DraftNoteContract = {
    readonly id: string;
    title: string;
    body?: string;
  };

  const { exports: lesson, path } = await loadLesson(6);
  const normalizeDraft = requireLabFunction<(
    note: DraftNoteContract,
  ) => DraftNoteContract>(
    lesson,
    "06",
    "normalizeDraft",
  );
  const original = {
    id: "n1",
    title: " Draft ",
    body: "Keep",
  };
  const before = structuredClone(original);

  const normalized = normalizeDraft(original);

  assert.deepEqual(normalized, {
    id: "n1",
    title: "Draft",
    body: "Keep",
  });
  assert.notStrictEqual(normalized, original);
  assert.deepEqual(original, before);
  assert.deepEqual(normalizeDraft({ id: "n2", title: " Title " }), {
    id: "n2",
    title: "Title",
  });

  await typecheckFixture(`
    import { normalizeDraft } from "${path}";
    import type { DraftNote } from "${path}";
    const minimal: DraftNote = { id: "n1", title: "Draft" };
    const complete: DraftNote = { id: "n2", title: "Release", body: "Ship" };
    const contract: (note: DraftNote) => DraftNote = normalizeDraft;
    // @ts-expect-error — Lesson 06 requires title.
    const missingTitle: DraftNote = { id: "n3" };
    // @ts-expect-error — Lesson 06 requires body to be a string when present.
    const undefinedBody: DraftNote = { id: "n4", title: "Draft", body: undefined };
    // @ts-expect-error — Lesson 06 keeps id readonly.
    complete.id = "other";
    // @ts-expect-error — Lesson 06 requires a string title.
    normalizeDraft({ id: "n5", title: 42 });
    void minimal;
    void contract;
    void missingTitle;
    void undefinedBody;
  `);
});

test("07 describes every note command variant", async () => {
  type NoteCommandContract =
    | { kind: "add"; title: string }
    | { kind: "list" }
    | { kind: "show"; id: string }
    | { kind: "search"; query: string }
    | { kind: "archive"; id: string }
    | { kind: "import"; path: string }
    | { kind: "export"; path: string };

  const { exports: lesson, path } = await loadLesson(7);
  const describeCommand = requireLabFunction<(
    command: NoteCommandContract,
  ) => string>(
    lesson,
    "07",
    "describeCommand",
  );

  assert.equal(describeCommand({ kind: "add", title: "Draft" }), "add:Draft");
  assert.equal(describeCommand({ kind: "list" }), "list");
  assert.equal(describeCommand({ kind: "show", id: "n1" }), "show:n1");
  assert.equal(describeCommand({ kind: "search", query: "typescript" }), "search:typescript");
  assert.equal(describeCommand({ kind: "archive", id: "n2" }), "archive:n2");
  assert.equal(describeCommand({ kind: "import", path: "notes.json" }), "import:notes.json");
  assert.equal(describeCommand({ kind: "export", path: "backup.json" }), "export:backup.json");

  await typecheckFixture(`
    import { describeCommand } from "${path}";
    import type { NoteCommand } from "${path}";
    const contract: (command: NoteCommand) => string = describeCommand;
    const valid: NoteCommand = { kind: "search", query: "typescript" };
    // @ts-expect-error — Lesson 07 rejects unknown command kinds.
    describeCommand({ kind: "remove", id: "n1" });
    // @ts-expect-error — Lesson 07 requires show commands to include id.
    describeCommand({ kind: "show" });
    // @ts-expect-error — Lesson 07 requires archive id to be a string.
    describeCommand({ kind: "archive", id: 1 });
    // @ts-expect-error — Lesson 07 list commands have no payload.
    describeCommand({ kind: "list", id: "n1" });
    void contract;
    void valid;
  `);
});

test("08 reads a safe optional title from an unknown boundary", async () => {
  const { exports: lesson, path } = await loadLesson(8);
  const readNoteTitle = requireLabFunction<(
    value: unknown,
  ) => string | undefined>(
    lesson,
    "08",
    "readNoteTitle",
  );

  assert.equal(readNoteTitle({ title: " Release notes " }), "Release notes");
  assert.equal(readNoteTitle({ title: "\n TypeScript \t" }), "TypeScript");
  assert.equal(readNoteTitle({ title: "   " }), undefined);
  assert.equal(readNoteTitle({ title: 42 }), undefined);
  assert.equal(readNoteTitle({ title: null }), undefined);
  assert.equal(readNoteTitle({ title: undefined }), undefined);
  assert.equal(readNoteTitle({}), undefined);
  assert.equal(readNoteTitle(null), undefined);
  assert.equal(readNoteTitle(undefined), undefined);
  assert.equal(readNoteTitle("Release notes"), undefined);

  await typecheckFixture(`
    import { readNoteTitle } from "${path}";
    type IsAny<T> = 0 extends (1 & T) ? true : false;
    const contract: (value: unknown) => string | undefined = readNoteTitle;
    const inputIsAny: IsAny<Parameters<typeof readNoteTitle>[0]> = false;
    const maybeTitle = readNoteTitle({ title: "Draft" });
    // @ts-expect-error — Lesson 08 keeps absence visible in the return type.
    const title: string = maybeTitle;
    if (maybeTitle !== undefined) {
      const narrowedTitle: string = maybeTitle;
      void narrowedTitle;
    }
    void contract;
    void inputIsAny;
    void title;
  `);
});

test("09 creates reusable generic filters", async () => {
  type CreateFilter = <T>(
    predicate: (value: T) => boolean,
  ) => (values: readonly T[]) => T[];

  const { exports: lesson, path } = await loadLesson(9);
  const createFilter = requireLabFunction<CreateFilter>(
    lesson,
    "09",
    "createFilter",
  );
  const numbers = [1, 2, 3, 4];
  const before = structuredClone(numbers);
  const selectEven = createFilter<number>((value) => value % 2 === 0);
  const selectedNumbers = selectEven(numbers);

  assert.deepEqual(selectedNumbers, [2, 4]);
  assert.notStrictEqual(selectedNumbers, numbers);
  assert.deepEqual(numbers, before);

  const visited: string[] = [];
  const selectLongTitle = createFilter<string>((title) => {
    visited.push(title);
    return title.length >= 7;
  });
  assert.deepEqual(selectLongTitle(["Draft", "Release", "TypeScript"]), ["Release", "TypeScript"]);
  assert.deepEqual(visited, ["Draft", "Release", "TypeScript"]);

  const selectActive = createFilter<{ id: string; active: boolean }>((note) => note.active);
  assert.deepEqual(selectActive([
    { id: "n1", active: true },
    { id: "n2", active: false },
  ]), [{ id: "n1", active: true }]);

  await typecheckFixture(`
    import { createFilter } from "${path}";
    const contract: <T>(predicate: (value: T) => boolean) => (values: readonly T[]) => T[] = createFilter;
    const selectLongTitle = createFilter((title: string) => title.length >= 7);
    const readonlyTitles = ["Draft", "Release"] as const;
    const selectedTitles: string[] = selectLongTitle(readonlyTitles);
    // @ts-expect-error — Lesson 09 predicates must return boolean.
    createFilter((value: number) => value.toFixed());
    // @ts-expect-error — The returned string filter rejects number arrays.
    selectLongTitle([1, 2]);
    const selectActive = createFilter((note: { readonly id: string; active: boolean }) => note.active);
    const selectedNotes = selectActive([{ id: "n1", active: true }] as const);
    // @ts-expect-error — Generic filtering preserves the element type, not string[].
    const wrongOutput: string[] = selectedNotes;
    void contract;
    void selectedTitles;
    void wrongOutput;
  `);
});

test("10 reads properties with exact generic types", async () => {
  type GetProperty = <T, K extends keyof T>(value: T, key: K) => T[K];

  const { exports: lesson, path } = await loadLesson(10);
  const getProperty = requireLabFunction<GetProperty>(
    lesson,
    "10",
    "getProperty",
  );
  const note = {
    id: "n1",
    title: "Draft",
    archived: false,
    tags: ["typescript"],
  };
  const before = structuredClone(note);

  assert.equal(getProperty(note, "title"), "Draft");
  assert.equal(getProperty(note, "archived"), false);
  assert.strictEqual(getProperty(note, "tags"), note.tags);
  assert.deepEqual(note, before);
  assert.equal(getProperty(["Draft", "Release"] as const, 1), "Release");

  await typecheckFixture(`
    import { getProperty } from "${path}";
    const contract: <T, K extends keyof T>(value: T, key: K) => T[K] = getProperty;
    const note = {
      id: "n1",
      title: "Draft",
      status: "active" as const,
      body: undefined as string | undefined,
    };
    const title: string = getProperty(note, "title");
    const status: "active" = getProperty(note, "status");
    const body: string | undefined = getProperty(note, "body");
    const readonlyNote = { id: "n2", archived: false } as const;
    const archived: false = getProperty(readonlyNote, "archived");
    // @ts-expect-error — Lesson 10 rejects keys missing from the object type.
    getProperty(note, "missing");
    // @ts-expect-error — Lesson 10 returns the selected property's type.
    const wrongTitle: number = getProperty(note, "title");
    void contract;
    void title;
    void status;
    void body;
    void archived;
    void wrongTitle;
  `);
});

test("11 updates plain notes without exposing their identity", async () => {
  type UpdateNote = <T extends { readonly id: string }>(
    note: T,
    changes: Partial<Omit<T, "id">> & { readonly id?: never },
  ) => T;

  const { exports: lesson, path } = await loadLesson(11);
  const updateNote = requireLabFunction<UpdateNote>(
    lesson,
    "11",
    "updateNote",
  );
  const note = {
    id: "n1",
    title: "Draft",
    archived: false,
    tags: ["typescript"],
  };
  const before = structuredClone(note);

  const changes = {
    title: "Release",
    archived: true,
  };
  const changesBefore = structuredClone(changes);
  const updated = updateNote(note, changes);

  assert.deepEqual(updated, {
    id: "n1",
    title: "Release",
    archived: true,
    tags: ["typescript"],
  });
  assert.notStrictEqual(updated, note);
  assert.strictEqual(updated.tags, note.tags);
  assert.deepEqual(note, before);
  assert.deepEqual(changes, changesBefore);

  const replacementTags = ["typescript", "types"];
  const retagged = updateNote(note, { tags: replacementTags });
  assert.strictEqual(retagged.tags, replacementTags);
  assert.notStrictEqual(retagged, note);
  const unchanged = updateNote(note, {});
  assert.deepEqual(unchanged, note);
  assert.notStrictEqual(unchanged, note);

  await typecheckFixture(`
    import { updateNote } from "${path}";
    const contract: <T extends { readonly id: string }>(
      note: T,
      changes: Partial<Omit<T, "id">> & { readonly id?: never },
    ) => T = updateNote;
    type Note = {
      readonly id: string;
      title: string;
      body?: string;
      archived: boolean;
    };
    const note: Note = { id: "n1", title: "Draft", archived: false };
    const updated: Note = updateNote(note, { title: "Release", archived: true });
    const readonlyNote: Readonly<Note> = note;
    const readonlyUpdated: Readonly<Note> = updateNote(readonlyNote, { title: "Release" });
    const changesWithId = { id: "n2", title: "Release" };
    // @ts-expect-error — Lesson 11 keeps id outside the update surface.
    updateNote(note, { id: "n2" });
    // @ts-expect-error — A variable containing id cannot bypass the update contract.
    updateNote(note, changesWithId);
    // @ts-expect-error — Lesson 11 rejects fields missing from the note type.
    updateNote(note, { missing: true });
    // @ts-expect-error — Updated values must match their original property types.
    updateNote(note, { archived: "yes" });
    // @ts-expect-error — exact optional properties reject an explicit undefined body.
    updateNote(note, { body: undefined });
    void contract;
    void updated;
    void readonlyUpdated;
  `);
});

test("12 derives note events from command kinds", async () => {
  type CreateNoteEvent = <Kind extends string>(kind: Kind) => `note:${Kind}`;

  const { exports: lesson, path } = await loadLesson(12);
  const createNoteEvent = requireLabFunction<CreateNoteEvent>(
    lesson,
    "12",
    "createNoteEvent",
  );

  assert.equal(createNoteEvent("add"), "note:add");
  assert.equal(createNoteEvent("list"), "note:list");
  assert.equal(createNoteEvent("archive"), "note:archive");
  assert.equal(createNoteEvent("custom-event"), "note:custom-event");

  await typecheckFixture(`
    import { createNoteEvent } from "${path}";
    import type { KindOf, NoteEvent } from "${path}";
    type Equal<Left, Right> =
      (<Value>() => Value extends Left ? 1 : 2) extends
      (<Value>() => Value extends Right ? 1 : 2) ? true : false;
    type Expect<Value extends true> = Value;
    type NoteCommand =
      | { kind: "add"; title: string }
      | { kind: "list" }
      | { kind: "archive"; id: string };
    type CommandKindsAreExact = Expect<Equal<
      KindOf<NoteCommand>,
      "add" | "list" | "archive"
    >>;
    type NoteEventsAreExact = Expect<Equal<
      NoteEvent<NoteCommand>,
      "note:add" | "note:list" | "note:archive"
    >>;
    type MissingKindBecomesNever = Expect<Equal<
      KindOf<{ title: string }>,
      never
    >>;
    const addEvent: "note:add" = createNoteEvent("add");
    const unionEvent: "note:add" | "note:list" =
      createNoteEvent<"add" | "list">("list");
    const contract: <Kind extends string>(kind: Kind) => \`note:\${Kind}\` = createNoteEvent;
    // @ts-expect-error — Lesson 12 event kinds must be strings.
    createNoteEvent(12);
    // @ts-expect-error — The literal input must remain visible in the return type.
    const wrongEvent: "note:list" = createNoteEvent("add");
    void addEvent;
    void unionEvent;
    void contract;
    void wrongEvent;
  `);
});

test("13 creates independent stateful note factories", async () => {
  type CreatedNoteContract = {
    readonly id: string;
    title: string;
  };
  type CreateNoteFactory = (
    prefix: string,
  ) => (title: string) => CreatedNoteContract;

  const { exports: lesson, path } = await loadLesson(13);
  const createNoteFactory = requireLabFunction<CreateNoteFactory>(
    lesson,
    "13",
    "createNoteFactory",
  );
  const createCourseNote = createNoteFactory("course");
  const createWorkNote = createNoteFactory("work");

  const first = createCourseNote("Draft");
  const second = createCourseNote(" Release ");
  const work = createWorkNote("Plan");

  assert.deepEqual(first, { id: "course-1", title: "Draft" });
  assert.deepEqual(second, { id: "course-2", title: " Release " });
  assert.deepEqual(work, { id: "work-1", title: "Plan" });
  assert.notStrictEqual(first, second);
  assert.deepEqual(createCourseNote("Ship"), { id: "course-3", title: "Ship" });
  assert.deepEqual(createWorkNote("Review"), { id: "work-2", title: "Review" });

  await typecheckFixture(`
    import { createNoteFactory } from "${path}";
    import type { CreatedNote } from "${path}";
    const contract: (prefix: string) => (title: string) => CreatedNote = createNoteFactory;
    const createNote = createNoteFactory("note");
    const note: CreatedNote = createNote("Draft");
    const id: string = note.id;
    const title: string = note.title;
    // @ts-expect-error — Lesson 13 keeps generated ids readonly.
    note.id = "other-1";
    // @ts-expect-error — Factory prefixes must be strings.
    createNoteFactory(13);
    // @ts-expect-error — Note titles must be strings.
    createNote(false);
    void contract;
    void id;
    void title;
  `);
});

test("14 keeps module state behind a named ESM export", async () => {
  type ModuleNoteContract = {
    readonly id: string;
    title: string;
  };
  type CreateModuleNote = (title: string) => ModuleNoteContract;

  const source = getLessonSource(14);
  const { exports: lesson, path } = await loadLesson(14);
  const createModuleNote = requireLabFunction<CreateModuleNote>(
    lesson,
    "14",
    "createModuleNote",
  );

  assert.deepEqual(createModuleNote("Draft"), {
    id: "module-1",
    title: "Draft",
  });
  assert.deepEqual(createModuleNote(" Release "), {
    id: "module-2",
    title: " Release ",
  });

  const importedAgain = await import(source.url.href);
  assert.strictEqual(importedAgain, lesson);
  assert.strictEqual(importedAgain.createModuleNote, createModuleNote);
  assert.deepEqual(importedAgain.createModuleNote("Ship"), {
    id: "module-3",
    title: "Ship",
  });

  await typecheckFixture(`
    import { createModuleNote } from "${path}";
    import type { ModuleNote } from "${path}";
    const contract: (title: string) => ModuleNote = createModuleNote;
    const note: ModuleNote = createModuleNote("Draft");
    const id: string = note.id;
    const title: string = note.title;
    // @ts-expect-error — Lesson 14 keeps module-generated ids readonly.
    note.id = "module-99";
    // @ts-expect-error — Module note titles must be strings.
    createModuleNote(14);
    void contract;
    void id;
    void title;
  `);
});

test("15 loads note titles concurrently while preserving input order", async () => {
  type LoadedNoteContract = {
    readonly id: string;
    title: string;
  };
  type NoteLoaderContract = (id: string) => Promise<LoadedNoteContract>;
  type LoadNoteTitles = (
    ids: readonly string[],
    loadNote: NoteLoaderContract,
  ) => Promise<string[]>;

  const { exports: lesson, path } = await loadLesson(15);
  const loadNoteTitles = requireLabFunction<LoadNoteTitles>(
    lesson,
    "15",
    "loadNoteTitles",
  );
  const first = Promise.withResolvers<LoadedNoteContract>();
  const second = Promise.withResolvers<LoadedNoteContract>();
  const third = Promise.withResolvers<LoadedNoteContract>();
  const pendingById = new Map([
    ["n1", first.promise],
    ["n2", second.promise],
    ["n3", third.promise],
  ]);
  const started: string[] = [];

  const titlesPromise = loadNoteTitles(["n1", "n2", "n3"], (id) => {
    started.push(id);
    const pending = pendingById.get(id);
    assert.ok(pending, `Unexpected note id: ${id}`);
    return pending;
  });

  assert.deepEqual(started, ["n1", "n2", "n3"]);
  third.resolve({ id: "n3", title: "Ship" });
  first.resolve({ id: "n1", title: "Draft" });
  second.resolve({ id: "n2", title: "Review" });
  assert.deepEqual(await titlesPromise, ["Draft", "Review", "Ship"]);

  let emptyCalls = 0;
  assert.deepEqual(await loadNoteTitles([], async (id) => {
    emptyCalls += 1;
    return { id, title: id };
  }), []);
  assert.equal(emptyCalls, 0);

  const failure = new Error("load failed");
  await assert.rejects(
    loadNoteTitles(["broken"], async () => { throw failure; }),
    (error) => error === failure,
  );

  await typecheckFixture(`
    import { loadNoteTitles } from "${path}";
    import type { LoadedNote, NoteLoader } from "${path}";
    const loader: NoteLoader = async (id) => ({ id, title: "Draft" });
    const contract: (
      ids: readonly string[],
      loadNote: NoteLoader,
    ) => Promise<string[]> = loadNoteTitles;
    const titles: Promise<string[]> = loadNoteTitles(["n1"] as const, loader);
    const note: LoadedNote = { id: "n1", title: "Draft" };
    // @ts-expect-error — Loaded note ids are readonly.
    note.id = "n2";
    // @ts-expect-error — Lesson 15 ids must be strings.
    loadNoteTitles([1], loader);
    // @ts-expect-error — A loader must return a Promise of LoadedNote.
    loadNoteTitles(["n1"], (id) => ({ id, title: "Draft" }));
    void contract;
    void titles;
  `);
});

test("16 captures loader failures and preserves cancellation", async () => {
  type LoadResultContract<T> =
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: Error };
  type AbortableLoaderContract<T> = (signal: AbortSignal) => Promise<T>;
  type CaptureLoadResult = <T>(
    load: AbortableLoaderContract<T>,
    signal: AbortSignal,
  ) => Promise<LoadResultContract<T>>;

  const { exports: lesson, path } = await loadLesson(16);
  const captureLoadResult = requireLabFunction<CaptureLoadResult>(
    lesson,
    "16",
    "captureLoadResult",
  );
  const activeSignal = new AbortController().signal;
  let receivedSignal: AbortSignal | undefined;
  const success = await captureLoadResult(async (signal) => {
    receivedSignal = signal;
    return "Draft";
  }, activeSignal);
  assert.deepEqual(success, { ok: true, value: "Draft" });
  assert.strictEqual(receivedSignal, activeSignal);

  const failure = new Error("offline");
  const failed = await captureLoadResult(async () => { throw failure; }, activeSignal);
  assert.equal(failed.ok, false);
  if (!failed.ok) assert.strictEqual(failed.error, failure);

  const nonError = await captureLoadResult(async () => { throw "missing"; }, activeSignal);
  assert.equal(nonError.ok, false);
  if (!nonError.ok) {
    assert.ok(nonError.error instanceof Error);
    assert.equal(nonError.error.message, "missing");
  }

  const abortReason = new Error("cancelled");
  let preAbortedLoaderCalls = 0;
  const preAborted = await captureLoadResult(async () => {
    preAbortedLoaderCalls += 1;
    return "unreachable";
  }, AbortSignal.abort(abortReason));
  assert.equal(preAbortedLoaderCalls, 0);
  assert.equal(preAborted.ok, false);
  if (!preAborted.ok) assert.strictEqual(preAborted.error, abortReason);

  const controller = new AbortController();
  const inFlightReason = new Error("stopped");
  const inFlight = captureLoadResult((signal) => new Promise<string>((resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    void resolve;
  }), controller.signal);
  controller.abort(inFlightReason);
  const abortedInFlight = await inFlight;
  assert.equal(abortedInFlight.ok, false);
  if (!abortedInFlight.ok) assert.strictEqual(abortedInFlight.error, inFlightReason);

  await typecheckFixture(`
    import { captureLoadResult } from "${path}";
    import type { AbortableLoader, LoadResult } from "${path}";
    const loader: AbortableLoader<number> = async (signal) => {
      signal.throwIfAborted();
      return 42;
    };
    const contract: <T>(
      load: AbortableLoader<T>,
      signal: AbortSignal,
    ) => Promise<LoadResult<T>> = captureLoadResult;
    const result: Promise<LoadResult<number>> = captureLoadResult(
      loader,
      new AbortController().signal,
    );
    // @ts-expect-error — The loader result type must be preserved.
    const wrong: Promise<LoadResult<string>> = result;
    // @ts-expect-error — Lesson 16 requires an AbortSignal.
    captureLoadResult(loader, {});
    void contract;
    void wrong;
  `);
});

test("17 creates an ordered build plan from available scripts", async () => {
  type BuildStepContract = {
    readonly name: "check" | "test" | "build";
    readonly command: string;
  };
  type CreateBuildPlan = (
    scripts: Readonly<Record<string, string | undefined>>,
  ) => BuildStepContract[];

  const { exports: lesson, path } = await loadLesson(17);
  const createBuildPlan = requireLabFunction<CreateBuildPlan>(
    lesson,
    "17",
    "createBuildPlan",
  );
  const scripts = {
    build: "tsc -p tsconfig.build.json",
    check: "pnpm typecheck",
    test: "node --test",
    lint: "eslint .",
  };
  const before = structuredClone(scripts);

  assert.deepEqual(createBuildPlan(scripts), [
    { name: "check", command: "pnpm typecheck" },
    { name: "test", command: "node --test" },
    { name: "build", command: "tsc -p tsconfig.build.json" },
  ]);
  assert.deepEqual(scripts, before);
  assert.deepEqual(createBuildPlan({ test: "node --test" }), [
    { name: "test", command: "node --test" },
  ]);
  assert.deepEqual(createBuildPlan({ check: "   ", build: undefined }), []);
  assert.deepEqual(createBuildPlan({}), []);

  await typecheckFixture(`
    import { createBuildPlan } from "${path}";
    import type { BuildStep, BuildStepName } from "${path}";
    const contract: (
      scripts: Readonly<Record<string, string | undefined>>,
    ) => BuildStep[] = createBuildPlan;
    const name: BuildStepName = "check";
    const step: BuildStep = { name, command: "pnpm typecheck" };
    // @ts-expect-error — Build step names are a closed union.
    const wrong: BuildStepName = "deploy";
    // @ts-expect-error — Script commands must be strings when present.
    createBuildPlan({ check: 17 });
    void contract;
    void step;
    void wrong;
  `);
});

test("18 persists notes as readable UTF-8 JSON", async () => {
  type PersistedNoteContract = {
    readonly id: string;
    readonly title: string;
  };
  type PersistNotes = (
    filePath: string,
    notes: readonly PersistedNoteContract[],
  ) => Promise<void>;

  const { exports: lesson, path } = await loadLesson(18);
  const persistNotes = requireLabFunction<PersistNotes>(
    lesson,
    "18",
    "persistNotes",
  );
  const directory = await mkdtemp(join(tmpdir(), "typescript-startup-18-"));
  try {
    const file = join(directory, "nested", "notes.json");
    const notes = [{ id: "n1", title: "草稿" }] as const;
    const before = structuredClone(notes);
    await persistNotes(file, notes);
    const content = await readFile(file, "utf8");
    assert.equal(content, `${JSON.stringify([...notes], null, 2)}\n`);
    assert.deepEqual(JSON.parse(content), notes);
    assert.deepEqual(notes, before);

    const emptyFile = join(directory, "empty.json");
    await persistNotes(emptyFile, []);
    assert.equal(await readFile(emptyFile, "utf8"), "[]\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }

  await typecheckFixture(`
    import { persistNotes } from "${path}";
    import type { PersistedNote } from "${path}";
    const notes: readonly PersistedNote[] = [{ id: "n1", title: "Draft" }];
    const result: Promise<void> = persistNotes("notes.json", notes);
    // @ts-expect-error — Persisted note ids are readonly.
    notes[0]!.id = "n2";
    // @ts-expect-error — The file path must be a string.
    persistNotes(18, notes);
    void result;
  `);
});

test("19 parses argv into a closed note command", async () => {
  type NoteCommandContract =
    | { readonly kind: "add"; readonly title: string }
    | { readonly kind: "list"; readonly json: boolean }
    | { readonly kind: "help" };
  type ParseNoteCommand = (argv: readonly string[]) => NoteCommandContract;

  const { exports: lesson, path } = await loadLesson(19);
  const parseNoteCommand = requireLabFunction<ParseNoteCommand>(
    lesson,
    "19",
    "parseNoteCommand",
  );
  const addArgs = ["add", " Draft "] as const;
  assert.deepEqual(parseNoteCommand(addArgs), { kind: "add", title: " Draft " });
  assert.deepEqual(parseNoteCommand(["list"]), { kind: "list", json: false });
  assert.deepEqual(parseNoteCommand(["list", "--json"]), { kind: "list", json: true });
  assert.deepEqual(parseNoteCommand(["list", "-j"]), { kind: "list", json: true });
  assert.deepEqual(parseNoteCommand(["help"]), { kind: "help" });
  assert.deepEqual(addArgs, ["add", " Draft "]);

  for (const invalid of [
    [], ["add"], ["add", "   "], ["add", "Draft", "extra"],
    ["add", "Draft", "--json"], ["list", "extra"], ["help", "--json"],
    ["unknown"], ["list", "--missing"],
  ]) {
    assert.throws(() => parseNoteCommand(invalid), Error);
  }

  await typecheckFixture(`
    import { parseNoteCommand } from "${path}";
    import type { NoteCommand } from "${path}";
    const contract: (argv: readonly string[]) => NoteCommand = parseNoteCommand;
    const command: NoteCommand = parseNoteCommand(["list"] as const);
    // @ts-expect-error — argv entries must be strings.
    parseNoteCommand([19]);
    // @ts-expect-error — NoteCommand kinds are closed.
    const wrong: NoteCommand = { kind: "remove", id: "n1" };
    void contract;
    void command;
    void wrong;
  `);
});

test("20 reports duplicate note ids once in encounter order", async () => {
  type DuplicateNoteContract = { readonly id: string };
  type FindDuplicateNoteIds = (
    notes: readonly DuplicateNoteContract[],
  ) => string[];

  const { exports: lesson, path } = await loadLesson(20);
  const findDuplicateNoteIds = requireLabFunction<FindDuplicateNoteIds>(
    lesson,
    "20",
    "findDuplicateNoteIds",
  );
  const notes = [
    { id: "n1" }, { id: "n2" }, { id: "n1" },
    { id: "n1" }, { id: "n3" }, { id: "n2" }, { id: "n3" },
  ] as const;
  const before = structuredClone(notes);
  assert.deepEqual(findDuplicateNoteIds(notes), ["n1", "n2", "n3"]);
  assert.deepEqual(findDuplicateNoteIds([{ id: "n1" }]), []);
  assert.deepEqual(findDuplicateNoteIds([]), []);
  assert.deepEqual(notes, before);

  await typecheckFixture(`
    import { findDuplicateNoteIds } from "${path}";
    import type { DuplicateNote } from "${path}";
    const notes: readonly DuplicateNote[] = [{ id: "n1" }];
    const ids: string[] = findDuplicateNoteIds(notes);
    // @ts-expect-error — Duplicate note ids are readonly strings.
    notes[0]!.id = "n2";
    // @ts-expect-error — Each input item needs a string id.
    findDuplicateNoteIds([{ id: 20 }]);
    void ids;
  `);
});

test("21 validates unknown API notes at runtime", async () => {
  type ApiNoteContract = {
    readonly id: string;
    readonly title: string;
    readonly tags: readonly string[];
  };
  type ParseApiNote = (value: unknown) => ApiNoteContract;

  const { exports: lesson, path } = await loadLesson(21);
  const parseApiNote = requireLabFunction<ParseApiNote>(
    lesson,
    "21",
    "parseApiNote",
  );
  const tags = ["ts", "node"];
  const note = parseApiNote({ id: "n1", title: " Draft ", tags, ignored: true });
  assert.deepEqual(note, { id: "n1", title: " Draft ", tags: ["ts", "node"] });
  assert.notStrictEqual(note.tags, tags);
  tags.push("changed");
  assert.deepEqual(note.tags, ["ts", "node"]);

  for (const invalid of [
    null, [], {},
    { id: "", title: "Draft", tags: [] },
    { id: "n1", title: "   ", tags: [] },
    { id: "n1", title: "Draft", tags: "ts" },
    { id: "n1", title: "Draft", tags: ["ts", 21] },
  ]) {
    assert.throws(() => parseApiNote(invalid), /Invalid API note/);
  }

  await typecheckFixture(`
    import { parseApiNote } from "${path}";
    import type { ApiNote } from "${path}";
    const note: ApiNote = parseApiNote({ id: "n1", title: "Draft", tags: [] });
    const tags: readonly string[] = note.tags;
    // @ts-expect-error — Parsed note fields are readonly.
    note.title = "Other";
    // @ts-expect-error — Parsed tags are readonly.
    note.tags.push("node");
    void tags;
  `);
});

test("22 atomically writes a versioned notes file", async () => {
  type VersionedNoteContract = { readonly id: string; readonly title: string };
  type WriteNotesAtomically = (
    filePath: string,
    notes: readonly VersionedNoteContract[],
  ) => Promise<void>;

  const { exports: lesson, path } = await loadLesson(22);
  const writeNotesAtomically = requireLabFunction<WriteNotesAtomically>(
    lesson,
    "22",
    "writeNotesAtomically",
  );
  const directory = await mkdtemp(join(tmpdir(), "typescript-startup-22-"));
  try {
    const nested = join(directory, "data");
    const file = join(nested, "notes.json");
    const notes = [{ id: "n1", title: "Draft" }] as const;
    const before = structuredClone(notes);
    await writeNotesAtomically(file, notes);
    const first = await readFile(file, "utf8");
    assert.equal(first, `${JSON.stringify({ version: 1, notes: [...notes] }, null, 2)}\n`);
    assert.deepEqual(await readdir(nested), ["notes.json"]);

    await writeFile(file, "old data", "utf8");
    await writeNotesAtomically(file, []);
    assert.equal(await readFile(file, "utf8"), '{\n  "version": 1,\n  "notes": []\n}\n');
    assert.deepEqual(await readdir(nested), ["notes.json"]);
    assert.deepEqual(notes, before);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }

  await typecheckFixture(`
    import { writeNotesAtomically } from "${path}";
    import type { VersionedNote } from "${path}";
    const notes: readonly VersionedNote[] = [{ id: "n1", title: "Draft" }];
    const result: Promise<void> = writeNotesAtomically("notes.json", notes);
    // @ts-expect-error — Versioned note ids must be strings.
    writeNotesAtomically("notes.json", [{ id: 22, title: "Draft" }]);
    void result;
  `);
});

test("23 resolves source output and package bin paths", async () => {
  type CliPathsContract = {
    readonly source: string;
    readonly output: string;
    readonly binTarget: "./dist/cli.js";
  };
  type ResolveCliPaths = (projectRoot: string) => CliPathsContract;

  const { exports: lesson, path } = await loadLesson(23);
  const resolveCliPaths = requireLabFunction<ResolveCliPaths>(
    lesson,
    "23",
    "resolveCliPaths",
  );
  const relative = resolveCliPaths("course-project");
  assert.equal(relative.source, resolve("course-project", "src", "cli.ts"));
  assert.equal(relative.output, resolve("course-project", "dist", "cli.js"));
  assert.equal(relative.binTarget, "./dist/cli.js");

  const absoluteRoot = resolve(ROOT, "fixture-project");
  assert.deepEqual(resolveCliPaths(absoluteRoot), {
    source: join(absoluteRoot, "src", "cli.ts"),
    output: join(absoluteRoot, "dist", "cli.js"),
    binTarget: "./dist/cli.js",
  });

  await typecheckFixture(`
    import { resolveCliPaths } from "${path}";
    import type { CliPaths } from "${path}";
    const paths: CliPaths = resolveCliPaths(".");
    const target: "./dist/cli.js" = paths.binTarget;
    // @ts-expect-error — Project roots must be strings.
    resolveCliPaths(23);
    // @ts-expect-error — The bin target is a fixed package-relative path.
    const wrong: "./src/cli.ts" = paths.binTarget;
    void target;
    void wrong;
  `);
});

test("24 orchestrates note commands into explicit CLI results", async () => {
  type CliNoteContract = { readonly id: string; readonly title: string };
  type FinalNoteCommandContract =
    | { readonly kind: "add"; readonly title: string }
    | { readonly kind: "list"; readonly json: boolean }
    | { readonly kind: "help" };
  type CliDependenciesContract = {
    readonly add: (title: string) => Promise<CliNoteContract>;
    readonly list: () => Promise<readonly CliNoteContract[]>;
  };
  type CliResultContract = {
    readonly exitCode: 0 | 1;
    readonly stdout: string;
    readonly stderr: string;
  };
  type ExecuteNoteCommand = (
    command: FinalNoteCommandContract,
    dependencies: CliDependenciesContract,
  ) => Promise<CliResultContract>;

  const { exports: lesson, path } = await loadLesson(24);
  const executeNoteCommand = requireLabFunction<ExecuteNoteCommand>(
    lesson,
    "24",
    "executeNoteCommand",
  );
  const calls: string[] = [];
  const dependencies: CliDependenciesContract = {
    async add(title) {
      calls.push(`add:${title}`);
      return { id: "n1", title };
    },
    async list() {
      calls.push("list");
      return [{ id: "n1", title: "Draft" }, { id: "n2", title: "Ship" }];
    },
  };

  assert.deepEqual(await executeNoteCommand({ kind: "help" }, dependencies), {
    exitCode: 0,
    stdout: "notes add <title>\nnotes list [--json]\nnotes help\n",
    stderr: "",
  });
  assert.deepEqual(calls, []);
  assert.deepEqual(await executeNoteCommand({ kind: "add", title: "Draft" }, dependencies), {
    exitCode: 0,
    stdout: "Added n1: Draft\n",
    stderr: "",
  });
  assert.deepEqual(calls, ["add:Draft"]);
  assert.deepEqual(await executeNoteCommand({ kind: "list", json: false }, dependencies), {
    exitCode: 0,
    stdout: "n1\tDraft\nn2\tShip\n",
    stderr: "",
  });
  assert.deepEqual(await executeNoteCommand({ kind: "list", json: true }, dependencies), {
    exitCode: 0,
    stdout: `${JSON.stringify([
      { id: "n1", title: "Draft" },
      { id: "n2", title: "Ship" },
    ], null, 2)}\n`,
    stderr: "",
  });

  const emptyDependencies: CliDependenciesContract = {
    async add(title) { return { id: "n1", title }; },
    async list() { return []; },
  };
  assert.deepEqual(await executeNoteCommand({ kind: "list", json: false }, emptyDependencies), {
    exitCode: 0,
    stdout: "",
    stderr: "",
  });
  const failedDependencies: CliDependenciesContract = {
    async add() { throw new Error("offline"); },
    async list() { throw "missing"; },
  };
  assert.deepEqual(await executeNoteCommand({ kind: "add", title: "Draft" }, failedDependencies), {
    exitCode: 1,
    stdout: "",
    stderr: "Error: offline\n",
  });
  assert.deepEqual(await executeNoteCommand({ kind: "list", json: false }, failedDependencies), {
    exitCode: 1,
    stdout: "",
    stderr: "Error: missing\n",
  });

  await typecheckFixture(`
    import { executeNoteCommand } from "${path}";
    import type { CliDependencies, CliResult, FinalNoteCommand } from "${path}";
    const dependencies: CliDependencies = {
      add: async (title) => ({ id: "n1", title }),
      list: async () => [],
    };
    const command: FinalNoteCommand = { kind: "help" };
    const result: Promise<CliResult> = executeNoteCommand(command, dependencies);
    // @ts-expect-error — Final commands are a closed union.
    executeNoteCommand({ kind: "remove", id: "n1" }, dependencies);
    // @ts-expect-error — Dependencies must return Promises.
    executeNoteCommand(command, { add: (title) => ({ id: "n1", title }), list: () => [] });
    void result;
  `);
});
