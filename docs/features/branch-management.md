---
description: Flip branches, balance layouts, and manage branch colors.
---

# Branch management

## Collapse branches

Nodes with children show a chevron on their right edge. Click it to hide or restore the complete descendant subtree. Collapsed state is stored in the `.canvas` file and restored when the map is reopened; node positions and content are never deleted or changed.

## Branch coloring

When **Auto-color branches** is enabled (on by default), each top-level branch from a root node gets a distinct color. Colors are reapplied automatically when you add or delete nodes.

To manually trigger coloring, run **Apply branch colors** from the command palette.

## Drag to reparent

Enable **Drag to reparent** in Cammvas settings or with the branch button directly below **Mindmap mode** in the Canvas sidebar. Then drag a node onto another node to make it a child of that target. The target is highlighted before the drop, and the dragged node keeps its complete descendant branch. Dropping onto the same node or one of its descendants is blocked to prevent cycles.

Multiple selected nodes can be dragged onto the same target in one operation. Each independent selected branch becomes a direct child of the target. If both an ancestor and one of its descendants are selected, Cammvas preserves their existing hierarchy instead of flattening the descendant.

When **Auto-layout** is enabled, the map is rearranged after the drop. Dropping outside another node keeps the normal Canvas drag behavior.

## Flip branch

Move a branch to the opposite side of its parent. If a child branch is on the right, flipping it moves it to the left (and vice versa).

Run **Flip branch to other side** from the command palette with a node selected.

## Balanced layout

Distribute a root node's children evenly on both sides for a centered mind map:

1. Select a root node that has children on one side
2. Run **Toggle balanced layout** from the command palette
3. Children alternate between right and left sides

Run the command again to collapse all children back to one side.

{% hint style="info" %}
Spatial navigation (up/down) is side-aware in balanced layouts — it navigates within the same side first, then crosses to the other side at the boundary.
{% endhint %}

## Auto-layout

When **Auto-layout** is enabled, the tree structure recalculates after every operation (add, delete, flip, drag). The contour-based algorithm packs sibling subtrees as tightly as possible — a shallow subtree tucks under a deep neighbor to save vertical space.

To manually trigger a full re-layout, run **Re-layout mind map** from the command palette.

Use **Re-layout selected branch** from the command palette or a parent node's context menu to arrange only descendants of that node. The branch parent and all earlier ancestors remain fixed.
