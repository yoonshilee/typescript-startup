import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const HTML_DIRECTORIES = ["lessons", "reference"];
const htmlFiles = [path.join(ROOT, "index.html")];

for (const directory of HTML_DIRECTORIES) {
  const entries = await readdir(path.join(ROOT, directory));
  htmlFiles.push(
    ...entries
      .filter((entry) => entry.endsWith(".html"))
      .map((entry) => path.join(ROOT, directory, entry)),
  );
}

const failures = [];

// ponytail: targeted regex is enough for authored static HTML; use a DOM parser if markup becomes generated.
for (const htmlFile of htmlFiles) {
  const html = await readFile(htmlFile, "utf8");
  const references = html.matchAll(/\b(?:href|src)="([^"]+)"/g);

  for (const [, rawReference] of references) {
    if (
      rawReference.startsWith("http://") ||
      rawReference.startsWith("https://") ||
      rawReference.startsWith("mailto:") ||
      rawReference.startsWith("//")
    ) {
      continue;
    }

    const [rawTarget = "", rawFragment] = rawReference.split("#", 2);
    const targetFile = rawTarget
      ? path.resolve(path.dirname(htmlFile), rawTarget.split("?", 1)[0])
      : htmlFile;

    try {
      await access(targetFile);
    } catch {
      failures.push(
        `${path.relative(ROOT, htmlFile)} -> missing ${rawReference}`,
      );
      continue;
    }

    if (rawFragment) {
      const targetHtml = await readFile(targetFile, "utf8");
      const fragment = decodeURIComponent(rawFragment);
      if (!targetHtml.includes(`id="${fragment}"`)) {
        failures.push(
          `${path.relative(ROOT, htmlFile)} -> missing #${fragment} in ${path.relative(ROOT, targetFile)}`,
        );
      }
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`Checked ${htmlFiles.length} HTML files: all local links resolve.`);
