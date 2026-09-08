import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import * as protocol from "../protocol.js";
import * as species from "../species.js";
import * as config from "../config.js";

// Execute the production event handlers with small DOM/storage test doubles.
// Only imports and the automatic startup call are omitted. These tests verify
// event cancellation and rendered state; they do not emulate native dialogs.
const source = (await fs.readFile(new URL("../app.js", import.meta.url), "utf8"))
  .replace(/^import\s+\{[\s\S]*?\}\s+from\s+"[^"\n]+";\s*/gm, "")
  .replace(/^initialize\(\);\s*$/m, "");

function fixture() {
  const handlers = new Map();
  const elements = new Map();
  const element = () => ({
    innerHTML: "", textContent: "", disabled: false,
    classList: { toggle() {} },
    addEventListener() {}, querySelectorAll: () => [],
    append() {}, remove() {}, focus() {},
  });
  const document = {
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, element());
      return elements.get(selector);
    },
    addEventListener(name, handler) { handlers.set(name, handler); },
    createElement: element,
  };
  const context = vm.createContext({
    ...protocol, ...species, ...config, document,
    navigator: { onLine: true },
    window: { addEventListener() {}, scrollTo() {} },
    setTimeout() {}, structuredClone,
  });
  vm.runInContext(source, context, { filename: "app.js" });
  const state = vm.runInContext("state", context);
  state.active = protocol.createTransect();
  state.view = "entry";
  vm.runInContext("render()", context);
  return { handlers, elements, state, context };
}

for (const id of ["cell-form", ""]) {
  test(`dialog form ${id || "confirmation"} preserves its native submit action`, async () => {
    const { handlers } = fixture();
    const event = new Event("submit", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "target", { value: { id, method: "dialog" } });
    await handlers.get("submit")(event);
    assert.equal(event.defaultPrevented, false,
      "Native dialog Close, Cancel and Continue require an uncancelled submit");
  });
}

for (const [id, callback] of [["details-form", "saveDetails"], ["class-form", "joinClass"]]) {
  test(`${id} still submits through the app without page navigation`, async () => {
    const { handlers, context } = fixture();
    const calls = [];
    context.recordCall = (form) => calls.push(form.id);
    vm.runInContext(`${callback} = async (form) => recordCall(form)`, context);
    const event = new Event("submit", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "target", { value: { id } });
    await handlers.get("submit")(event);
    assert.equal(event.defaultPrevented, true);
    assert.deepEqual(calls, [id]);
  });
}

test("Next, Previous and direct navigation keep both segment displays in agreement", async () => {
  const { handlers, state, elements } = fixture();
  const click = (action) => handlers.get("click")({
    target: { closest: () => ({ dataset: { action } }) },
  });
  const check = (index) => {
    assert.equal(state.segmentIndex, index);
    assert.equal(elements.get("#header-context").textContent, `Segment ${index}-${index + 1} m`);
    assert.ok(elements.get("#app").innerHTML.includes(`<h1>${index}-${index + 1} m</h1>`));
    assert.equal(protocol.computeSummary(state.active).completed, 0);
  };
  check(0);
  await click("next-segment");
  check(1);
  await click("previous-segment");
  check(0);
  await handlers.get("change")({ target: {
    value: "29", matches: (selector) => selector === '[data-action="jump-segment"]',
  } });
  check(29);
  await click("next-segment");
  assert.equal(state.view, "summary");
  assert.equal(elements.get("#header-context").textContent, "Review & submit");
});
