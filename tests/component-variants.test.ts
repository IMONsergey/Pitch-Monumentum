import test from "node:test";
import assert from "node:assert/strict";
import type { ComponentDefinition } from "../packages/components/src/index.js";
import { instantiateComponentVariant, resolveComponentVariant, validateComponentVariantSet, type ComponentVariantSet } from "../packages/component-variants/src/index.js";

function definition(): ComponentDefinition {
  return {
    schemaVersion: "0.1", id: "component_button", name: "Button", widthDU: 320, heightDU: 96, rootIds: ["bg", "label"],
    elements: [
      { id: "bg", type: "shape", shape: "roundRect", fill: "#222222", semanticRole: "visual", geometry: { x: 0, y: 0, width: 320, height: 96 }, zIndex: 1, origin: "user", exportStrategy: "native", dependencies: [] },
      { id: "label", type: "text", semanticRole: "label", geometry: { x: 40, y: 24, width: 240, height: 48 }, zIndex: 2, origin: "user", exportStrategy: "native", dependencies: [], paragraphs: [{ runs: [{ text: "Continue", color: "#FFFFFF", fontSizePt: 24 }] }] },
    ],
    slots: [
      { id: "fill_bg", name: "Background", kind: "fill", targetElementId: "bg" },
      { id: "text_label", name: "Label", kind: "text", targetElementId: "label" },
    ],
  };
}

function variants(): ComponentVariantSet {
  return {
    schemaVersion: "0.1", id: "button_variants", componentId: "component_button", name: "Button variants",
    axes: [
      { id: "tone", name: "Tone", values: ["primary", "danger"], defaultValue: "primary" },
      { id: "state", name: "State", values: ["default", "disabled"], defaultValue: "default" },
    ],
    rules: [
      { id: "danger", when: { tone: "danger" }, overrides: [{ slotId: "fill_bg", value: { kind: "fill", color: "#CC2233" } }] },
      { id: "disabled", when: { state: "disabled" }, overrides: [{ slotId: "fill_bg", value: { kind: "fill", color: "#777777" } }] },
      { id: "danger_disabled", when: { tone: "danger", state: "disabled" }, overrides: [{ slotId: "fill_bg", value: { kind: "fill", color: "#99404A" } }] },
    ],
  };
}

test("variant defaults normalize selection and rule specificity wins", () => {
  const resolved = resolveComponentVariant(definition(), variants(), { tone: "danger", state: "disabled" });
  assert.deepEqual(resolved.selection, { tone: "danger", state: "disabled" });
  assert.deepEqual(resolved.matchedRuleIds, ["danger", "disabled", "danger_disabled"]);
  assert.deepEqual(resolved.overrides, [{ slotId: "fill_bg", value: { kind: "fill", color: "#99404A" } }]);
});

test("variant instantiation produces ordinary editable component elements", () => {
  const built = instantiateComponentVariant(definition(), variants(), { tone: "danger" }, { x: 500, y: 300 }, "instance_button");
  const bg = built.elements.find(element => element.id === "instance_button_bg") as any;
  assert.equal(bg.fill, "#CC2233");
  assert.equal(bg.geometry.x, 500);
  assert.equal(bg.geometry.y, 300);
  assert.equal(built.instance.componentId, "component_button");
  assert.equal(built.variant.selection.state, "default");
});

test("variant validation rejects unknown axis values and slot kind mismatches", () => {
  const set = variants();
  assert.throws(() => resolveComponentVariant(definition(), set, { tone: "ghost" }), /Invalid tone variant value/);
  const bad = variants();
  bad.rules.push({ id: "bad", when: { tone: "primary" }, overrides: [{ slotId: "fill_bg", value: { kind: "text", paragraphs: [] } }] });
  assert.throws(() => validateComponentVariantSet(definition(), bad), /expects fill, got text/);
});
