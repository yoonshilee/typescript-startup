const CORRECT_MESSAGE = "回答正确。请继续用自己的话解释原因。";
const RETRY_MESSAGE = "暂时不对。回到上方心智模型，再比较两个选项。";
const LESSON_FILE_PATTERN = /\/(\d{4})-[^/]+\.html$/;
const EXAMPLE_FUNCTION_PATTERN =
  /^export (?:async\s+)?function\s+([A-Za-z_$][\w$]*)(?:<[^\n]+>)?\s*\(\s*\)/gm;
const LAB_FUNCTION_PATTERN =
  /\/\*\*\s*@lab\s*\*\/\s*export (?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g;

for (const quiz of document.querySelectorAll("[data-quiz]")) {
  quiz.addEventListener("submit", (event) => {
    event.preventDefault();

    const feedback = quiz.querySelector("[data-quiz-feedback]");
    if (!feedback) return;

    const selectedAnswer = new FormData(quiz).get("answer");
    const isCorrect = selectedAnswer === quiz.dataset.answer;
    feedback.dataset.state = isCorrect ? "correct" : "incorrect";
    feedback.textContent = isCorrect ? CORRECT_MESSAGE : RETRY_MESSAGE;
  });
}

const lessonMatch = window.location.pathname.match(LESSON_FILE_PATTERN);
if (lessonMatch) {
  const lesson = lessonMatch[1].slice(-2);
  let outputIndex = 0;

  async function runExample(name) {
    if (!window.location.protocol.startsWith("http")) {
      throw new Error("请先在项目根目录执行 pnpm course，并从终端显示的地址打开课程。");
    }

    const response = await fetch(`/api/examples/${lesson}/${encodeURIComponent(name)}`, {
      cache: "no-store",
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body) {
      throw new Error(body?.error ?? "请通过 pnpm course 启动课程页面后再运行示例。");
    }
    return body.output;
  }

  for (const code of document.querySelectorAll("pre > code")) {
    const source = code.textContent;
    const labNames = new Set([...source.matchAll(LAB_FUNCTION_PATTERN)].map((match) => match[1]));
    const exampleNames = [...source.matchAll(EXAMPLE_FUNCTION_PATTERN)]
      .map((match) => match[1])
      .filter((name) => !labNames.has(name));
    let anchor = code.parentElement;

    for (const name of exampleNames) {
      const resultId = `example-output-${outputIndex++}`;
      const panel = document.createElement("section");
      panel.className = "example-output";
      panel.setAttribute("aria-label", `${name} 的运行结果`);
      panel.innerHTML = `<div class="example-output__bar"><button class="example-output__button" type="button" aria-controls="${resultId}"><svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3 12 8 5 13Z" fill="currentColor"/></svg><span>运行示例</span></button></div><pre id="${resultId}" hidden><code aria-live="polite"></code></pre>`;

      const button = panel.querySelector("button");
      const buttonLabel = button.querySelector("span");
      const result = panel.querySelector("pre");
      const resultCode = result.querySelector("code");
      button.addEventListener("click", async () => {
        button.disabled = true;
        button.dataset.state = "loading";
        buttonLabel.textContent = "运行中…";
        result.setAttribute("aria-busy", "true");

        try {
          resultCode.textContent = await runExample(name);
          button.dataset.state = "success";
          buttonLabel.textContent = "再次运行";
        } catch (error) {
          button.dataset.state = "error";
          buttonLabel.textContent = "重试";
          resultCode.textContent = error.message;
        } finally {
          result.dataset.state = button.dataset.state;
          result.hidden = false;
          result.removeAttribute("aria-busy");
          button.disabled = false;
        }
      });

      anchor.after(panel);
      anchor = panel;
    }
  }
}
