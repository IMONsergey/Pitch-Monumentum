# Slide Masters + Smart Layouts

Status: active development branch `feat/slide-masters-smart-layouts`, stacked after Design System 2.0. No pull request is intentionally open while the frozen Intel Desktop Preview release lane waits for GitHub-hosted runners.

## Product goal

Give Pitch Monumentum a Keynote-class slide-layout system without turning slides into opaque templates or sacrificing existing editable content.

The central contract is:

```text
SlideMasterDefinition
  ├─ master-owned layout / styling / decorations
  └─ typed placeholders
         ↓
existing slide content is mapped semantically
         ↓
linked editable slide instance
         ↓
Update Master → every linked slide refreshes in one deck version
```

Master owns visual structure. Placeholder owns semantic content. Freeform objects remain editable and are preserved by default.

## Canonical storage

Slide masters are stored inside the canonical deck version as:

`slideMasters?: Record<string, SlideMasterDefinition>`

This is intentional. Updating a master changes both the definition and every linked slide. Keeping both in one deck version means ordinary Pitch Undo can restore the previous master and all previous slide layouts atomically.

There is no independent master history.

## Master definition

A `SlideMasterDefinition` contains:

- id / name / optional description;
- canonical canvas size;
- editable scene elements;
- typed placeholders.

Placeholder kinds:

- title;
- subtitle;
- body;
- image;
- chart;
- table;
- metric;
- footer;
- other.

Auto-detection uses existing element semantic roles and element types. A master can also declare explicit placeholders.

## Instance identity

Applied master objects carry canonical tags:

- `slide-master:<masterId>`;
- `slide-master-source:<sourceElementId>`;
- `slide-placeholder:<placeholderId>`;
- `slide-master-instance:<instanceId>`.

These tags allow master authoring, propagation, QA and agent tooling to recover the relationship without a parallel hidden DOM model.

## Apply / switch semantics

Applying a layout does not rebuild the slide from scratch.

The engine:

1. identifies title/body/image/chart/table/etc. content;
2. maps it to compatible placeholders;
3. takes geometry and master-owned styling from the master;
4. preserves semantic content;
5. keeps unmatched freeform objects by default;
6. repairs hierarchy if a matched child was previously inside a frame/group;
7. validates the final hierarchy.

When switching from one master to another, old placeholder content is temporarily promoted into an ordinary content pool before the old master decorations are removed. That content can therefore remap into different placeholder IDs/structure on the new master.

## Content vs styling

Text placeholder content and master styling are deliberately separated.

Preserved from the slide:

- text strings;
- paragraph/bullet content;
- explicit inline emphasis such as bold/italic/underline where present.

Owned by the master:

- geometry;
- base font family;
- font size;
- color;
- letter spacing;
- paragraph alignment/spacing;
- vertical alignment;
- insets;
- text fit policy.

For images, content preserves:

- asset ID;
- alt text;
- explicit crop;
- focal point.

Master controls visual treatment such as:

- placeholder geometry;
- fit;
- clip shape;
- radius.

This matches the product expectation that the same photograph can survive a layout change while adopting the layout's framing treatment.

## Stable placeholder IDs

Layout switching attempts to preserve existing placeholder element IDs where the old and new placeholders are compatible.

Matching priority:

1. same placeholder name + kind;
2. same kind;
3. new ID only when no compatible identity exists.

Stable IDs reduce churn in:

- current selection;
- motion tracks/build references;
- agent handles;
- future comments/collaboration anchors.

When several placeholders have the same kind and generic names, fallback matching is deterministic but order-sensitive; explicit placeholder naming is recommended for complex layouts.

## Master commands

### createMaster
Creates a reusable master definition from one slide. This does not destroy the source slide.

### applyMaster
Applies/reapplies a master to one slide while preserving compatible content and freeform objects.

### updateMasterFromSlide
Treats the current master-owned scene on one linked slide as the new master version, then refreshes every linked slide in the same command result.

This is intentionally wide-scope and must be verified after execution.

### detachMaster
Removes master/source/placeholder/instance linkage tags while keeping ordinary editable scene objects.

### deleteMaster
Fails while any slide still uses the master.

## Smart Layout recommendations

`recommendSlideMasters` scores deck-local masters against the current slide using:

- compatible placeholder matches;
- required placeholder misses;
- unmatched semantic content.

The integrated Layouts panel sorts masters by recommendation score and shows short match reasons.

This is deterministic selection assistance, not a model hallucinating a new layout.

## Canonical history

`executeWorkspaceSlideMasterCommand` writes through the same `ArtifactStore` and `VersionJournal` used by normal editor operations.

Consequences:

- Apply Master is one deck undo point;
- Update Master + all linked-slide propagation is one deck undo point;
- ordinary manual edits remain separate undo points;
- Undo can reverse the master update without reversing the preceding manual edit;
- no second master timeline exists.

## Integrated editor

`createMasterDesignWorkspaceServer` composes Slide Masters on top of the existing enhanced Design Workspace.

It adds:

- `GET /api/master-state?slideId=...`;
- `POST /api/master-command`;
- the Slide Masters UI appended to the same editor bundle.

Every other route still delegates to the existing Design/Workspace server.

The same editor now exposes:

- top-bar **Layouts**;
- `Cmd/Ctrl + Shift + L`;
- current master state;
- recommendation-ranked layouts;
- Apply / Reapply;
- Create layout from current slide;
- Update Master;
- Detach layout;
- current placeholder list;
- per-master usage count.

Master-owned objects are edited with the ordinary Inspector, Moveable, Rich Text, Media and other editor tools. There is no separate limited template editor.

## QA

`packages/slide-master-qa` checks:

- invalid master definitions;
- missing master references;
- missing/unknown source IDs;
- unknown placeholders;
- placeholder/source mismatch;
- mixed master definitions in one instance;
- duplicate source identity in one instance;
- missing required placeholders;
- geometry/style drift from the current master.

Structural corruption is major/critical. Geometry/style drift is minor because it can be an intentional authoring step before **Update Master** or **Reapply**.

## Codex / MCP

Dedicated tools:

- `pitch_master_state`;
- `pitch_master_command`.

The state tool returns:

- deck hash;
- master definitions;
- current slide master;
- Smart Layout recommendations;
- master QA.

Commands:

- create;
- apply;
- update master from slide;
- delete;
- detach.

`pitch-mcp-next2` composes these tools into the same MCP server that already contains object/media/motion/component/design tools.

## Regression coverage

Implemented tests cover:

- master validation/autodetection;
- apply preserving title/body/image content;
- image crop/focal preservation with master media treatment;
- structurally different master switch;
- nested frame/group hierarchy repair;
- Smart Layout recommendation ranking;
- stable placeholder identities;
- multi-slide Update Master propagation;
- content vs master typography separation;
- detach semantics;
- master + propagation ordinary Undo behavior;
- integrity/drift QA;
- MCP state/command behavior;
- integrated browser workflow.

## Explicit next work

After this milestone:

- formally move `theme` / `slideMasters` into the core DeckDocument schema after stacked branches land;
- master thumbnails/previews;
- drag/drop placeholder authoring and placeholder-type UI;
- placeholder constraints/min-max/autolayout recipes;
- section masters / presentation-level recurring chrome;
- notes/footer/date/slide-number placeholders;
- save Smart Layout variants and component-variant selectors as first-class UI artifacts;
- AI Creative Director planning over Brand QA + Smart Layout recommendations + evidence/asset state.
