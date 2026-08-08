import { instantiateComponent, validateComponentDefinition, type ComponentDefinition, type ComponentInstanceTransform, type ComponentOverride, type InstantiatedComponent } from "../../components/src/index.js";

export interface ComponentVariantAxis { id: string; name: string; values: string[]; defaultValue: string; }
export interface ComponentVariantRule { id: string; name?: string; when: Record<string, string>; overrides: ComponentOverride[]; }
export interface ComponentVariantSet { schemaVersion: "0.1"; id: string; componentId: string; name: string; axes: ComponentVariantAxis[]; rules: ComponentVariantRule[]; }
export interface ResolvedComponentVariant { selection: Record<string, string>; matchedRuleIds: string[]; overrides: ComponentOverride[]; }

const ID_RE = /^[a-zA-Z][a-zA-Z0-9._-]{0,63}$/;
function id(value: string, label: string): string {
  const next = value.trim();
  if (!ID_RE.test(next)) throw new Error(`${label} must start with a letter and contain only letters, digits, dot, underscore or dash`);
  return next;
}
function validateOverrideSlots(definition: ComponentDefinition, overrides: ComponentOverride[]): void {
  const slots = new Map(definition.slots.map((slot) => [slot.id, slot]));
  const seen = new Set<string>();
  for (const override of overrides) {
    if (seen.has(override.slotId)) throw new Error(`Duplicate override for slot ${override.slotId} in one variant rule`);
    seen.add(override.slotId);
    const slot = slots.get(override.slotId);
    if (!slot) throw new Error(`Variant override targets unknown component slot ${override.slotId}`);
    if (slot.kind !== override.value.kind) throw new Error(`Variant override ${override.slotId} expects ${slot.kind}, got ${override.value.kind}`);
  }
}
export function validateComponentVariantSet(definition: ComponentDefinition, set: ComponentVariantSet): void {
  validateComponentDefinition(definition);
  if (set.schemaVersion !== "0.1") throw new Error(`Unsupported component variant schema: ${set.schemaVersion}`);
  id(set.id, "Variant set id");
  if (set.componentId !== definition.id) throw new Error(`Variant set ${set.id} belongs to ${set.componentId}, not ${definition.id}`);
  if (!set.name.trim()) throw new Error("Variant set name is required");
  const axisIds = new Set<string>();
  for (const axis of set.axes) {
    const axisId = id(axis.id, "Variant axis id");
    if (axisIds.has(axisId)) throw new Error(`Duplicate variant axis ${axisId}`);
    axisIds.add(axisId);
    if (!axis.name.trim()) throw new Error(`Variant axis ${axisId} name is required`);
    const values = axis.values.map((value) => id(value, `Variant axis ${axisId} value`));
    if (!values.length) throw new Error(`Variant axis ${axisId} must contain at least one value`);
    if (new Set(values).size !== values.length) throw new Error(`Variant axis ${axisId} contains duplicate values`);
    if (!values.includes(axis.defaultValue)) throw new Error(`Variant axis ${axisId} default ${axis.defaultValue} is not in values`);
  }
  const ruleIds = new Set<string>();
  for (const rule of set.rules) {
    const ruleId = id(rule.id, "Variant rule id");
    if (ruleIds.has(ruleId)) throw new Error(`Duplicate variant rule ${ruleId}`);
    ruleIds.add(ruleId);
    if (!Object.keys(rule.when).length) throw new Error(`Variant rule ${ruleId} must declare at least one axis condition`);
    for (const [axisId, value] of Object.entries(rule.when)) {
      const axis = set.axes.find((item) => item.id === axisId);
      if (!axis) throw new Error(`Variant rule ${ruleId} references unknown axis ${axisId}`);
      if (!axis.values.includes(value)) throw new Error(`Variant rule ${ruleId} uses invalid ${axisId} value ${value}`);
    }
    validateOverrideSlots(definition, rule.overrides);
  }
}
export function normalizeVariantSelection(set: ComponentVariantSet, selection: Record<string, string> = {}): Record<string, string> {
  const result: Record<string, string> = {};
  for (const axis of set.axes) {
    const value = selection[axis.id] ?? axis.defaultValue;
    if (!axis.values.includes(value)) throw new Error(`Invalid ${axis.id} variant value ${value}`);
    result[axis.id] = value;
  }
  for (const axisId of Object.keys(selection)) if (!set.axes.some((axis) => axis.id === axisId)) throw new Error(`Unknown variant axis ${axisId}`);
  return result;
}
function matches(rule: ComponentVariantRule, selection: Record<string, string>): boolean { return Object.entries(rule.when).every(([axisId, value]) => selection[axisId] === value); }
export function resolveComponentVariant(definition: ComponentDefinition, set: ComponentVariantSet, selection: Record<string, string> = {}): ResolvedComponentVariant {
  validateComponentVariantSet(definition, set);
  const normalized = normalizeVariantSelection(set, selection);
  const matched = set.rules.map((rule, index) => ({ rule, index })).filter(({ rule }) => matches(rule, normalized)).sort((a, b) => Object.keys(a.rule.when).length - Object.keys(b.rule.when).length || a.index - b.index);
  const overrideMap = new Map<string, ComponentOverride>();
  for (const { rule } of matched) for (const override of rule.overrides) overrideMap.set(override.slotId, structuredClone(override));
  const overrides = [...overrideMap.values()];
  instantiateComponent(definition, { x: 0, y: 0 }, overrides, "variant_validation");
  return { selection: normalized, matchedRuleIds: matched.map(({ rule }) => rule.id), overrides };
}
export function instantiateComponentVariant(definition: ComponentDefinition, set: ComponentVariantSet, selection: Record<string, string>, transform: ComponentInstanceTransform, instanceId?: string): InstantiatedComponent & { variant: ResolvedComponentVariant } {
  const variant = resolveComponentVariant(definition, set, selection);
  const built = instantiateComponent(definition, transform, variant.overrides, instanceId);
  return { ...built, variant };
}
