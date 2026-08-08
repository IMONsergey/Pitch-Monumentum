import test from "node:test";
import assert from "node:assert/strict";
import type { ComponentDefinition, ComponentInstanceRecord } from "../packages/components/src/index.js";
import { detachComponentInstance, instantiateComponent, refreshComponentInstance, validateComponentDefinition } from "../packages/components/src/index.js";

function definition(): ComponentDefinition {
  return {
    schemaVersion: "0.1",
    id: "kpi-card",
    name: "KPI Card",
    widthDU: 480,
    heightDU: 260,
    rootIds: ["frame"],
    elements: [
      { id: "frame", type: "frame", name: "Card", semanticRole: "visual", geometry: { x: 0, y: 0, width: 480, height: 260 }, zIndex: 1, origin: "deterministic", exportStrategy: "native", dependencies: [], childIds: ["label", "value"], fill: "#F2F4F7", clipContent: false },
      { id: "label", type: "text", name: "Label", semanticRole: "label", geometry: { x: 28, y: 28, width: 360, height: 48 }, zIndex: 2, origin: "deterministic", exportStrategy: "native", dependencies: [], groupId: "frame", paragraphs: [{ runs: [{ text: "Metric", fontSizePt: 16, color: "#475467" }] }] },
      { id: "value", type: "text", name: "Value", semanticRole: "metric", geometry: { x: 28, y: 92, width: 380, height: 110 }, zIndex: 3, origin: "deterministic", exportStrategy: "native", dependencies: [], groupId: "frame", paragraphs: [{ runs: [{ text: "42%", fontSizePt: 52, bold: true, color: "#111111" }] }] },
    ],
    slots: [
      { id: "label", name: "Label", kind: "text", targetElementId: "label" },
      { id: "value", name: "Value", kind: "text", targetElementId: "value" },
      { id: "surface", name: "Surface", kind: "fill", targetElementId: "frame" },
    ],
  };
}

test("component instance deep-remaps hierarchy, applies transform and explicit overrides", () => {
  const built = instantiateComponent(definition(), { x: 100, y: 200, scaleX: 1.5, scaleY: 2 }, [
    { slotId: "label", value: { kind: "text", paragraphs: [{ runs: [{ text: "Revenue", fontSizePt: 16 }] }] } },
    { slotId: "surface", value: { kind: "fill", color: "#FFFFFF" } },
  ], "instance_card");
  assert.equal(built.instance.id, "instance_card");
  assert.deepEqual(built.instance.rootIds, ["instance_card_frame"]);
  const frame = built.elements.find(element => element.id === "instance_card_frame") as any;
  const label = built.elements.find(element => element.id === "instance_card_label") as any;
  assert(frame && label);
  assert.deepEqual(frame.childIds, ["instance_card_label", "instance_card_value"]);
  assert.equal(label.groupId, "instance_card_frame");
  assert.deepEqual(frame.geometry, { x: 100, y: 200, width: 720, height: 520 });
  assert.deepEqual(label.geometry, { x: 142, y: 256, width: 540, height: 96 });
  assert.equal(label.paragraphs[0].runs[0].text, "Revenue");
  assert.equal(frame.fill, "#FFFFFF");
  assert(built.elements.every(element => element.tags?.includes("component:instance_card")));
});

test("refresh preserves stable instance element ids while adopting component-definition changes", () => {
  const first = instantiateComponent(definition(), { x: 50, y: 60 }, [], "instance_card");
  const nextDefinition = definition();
  nextDefinition.elements = nextDefinition.elements.map(element => element.id === "value" ? { ...element, geometry: { ...element.geometry, y: 110 }, paragraphs: [{ runs: [{ text: "99", fontSizePt: 60, bold: true }] }] } as any : element);
  const refreshed = refreshComponentInstance(nextDefinition, first.instance);
  assert.deepEqual(refreshed.instance.elementIdMap, first.instance.elementIdMap);
  const value = refreshed.elements.find(element => element.id === first.instance.elementIdMap.value) as any;
  assert.equal(value.geometry.y, 170);
  assert.equal(value.paragraphs[0].runs[0].text, "99");
});

test("refresh reapplies explicit instance overrides over newer component defaults", () => {
  const first = instantiateComponent(definition(), { x: 0, y: 0 }, [
    { slotId: "value", value: { kind: "text", paragraphs: [{ runs: [{ text: "OVERRIDE", fontSizePt: 48 }] }] } },
  ], "instance_card");
  const changed = definition();
  const defaultValue = changed.elements.find(element => element.id === "value") as any;
  defaultValue.paragraphs[0].runs[0].text = "NEW DEFAULT";
  const refreshed = refreshComponentInstance(changed, first.instance);
  const value = refreshed.elements.find(element => element.id === first.instance.elementIdMap.value) as any;
  assert.equal(value.paragraphs[0].runs[0].text, "OVERRIDE");
});

test("detach removes instance binding tags without changing visual object ids or geometry", () => {
  const built = instantiateComponent(definition(), { x: 10, y: 20 }, [], "instance_card");
  const detached = detachComponentInstance(built.elements, "instance_card");
  assert.deepEqual(detached.map(element => element.id), built.elements.map(element => element.id));
  assert.deepEqual(detached.map(element => element.geometry), built.elements.map(element => element.geometry));
  assert(detached.every(element => !element.tags?.includes("component:instance_card")));
});

test("definition validation catches invalid root and incompatible slot types", () => {
  const missingRoot = definition();
  missingRoot.rootIds = ["missing"];
  assert.throws(() => validateComponentDefinition(missingRoot), /root missing/);

  const badSlot = definition();
  badSlot.slots.push({ id: "bad", name: "Bad", kind: "image", targetElementId: "value" });
  assert.throws(() => validateComponentDefinition(badSlot), /must target an image/);
});

test("refresh rejects a definition from another component", () => {
  const built = instantiateComponent(definition(), { x: 0, y: 0 }, [], "instance_card");
  const other = definition();
  other.id = "other";
  assert.throws(() => refreshComponentInstance(other, built.instance as ComponentInstanceRecord), /belongs to/);
});
