---
description: A sidebar panel showing your mind map structure with search, groups, and navigation.
---

# Map outline

The Map outline panel appears in the right sidebar when mindmap mode is active. It shows every mind map as a complete tree, with root nodes organized by canvas groups.

## Toolbar

The toolbar at the top of the panel has two buttons:

* **Search** — toggle a text filter to find nodes and groups by name
* **Collapse/Expand all** — toggle all groups collapsed or expanded

## Tree nodes

Every node appears as a row in its tree. Use the chevrons to collapse or expand branches in the outline. Long titles are truncated with an ellipsis. Markdown links in titles display as clean text (e.g., `[My Link](url)` shows as "My Link").

**Click** any node to select it on the canvas and zoom to it. The clicked node stays highlighted — this is the **active node highlight**.

**Bidirectional sync** — clicking a node on the canvas also highlights it in the outline. Clicking empty canvas or pressing Escape clears the highlight.

## Groups

Groups match canvas groups and are sorted by their position on the canvas (top-left to bottom-right). Each group header shows:

* Group name
* Node count badge
* Collapse chevron

### Group actions

| Action | Result |
| --- | --- |
| Click group header | Toggle collapse/expand |
| Double-click group name | Rename inline (click away to save, Escape to cancel) |
| Right-click group header | Context menu: Rename group, Layout forest |

## Drag and drop

Each root node has a **grip handle** that appears on hover. Drag it to:

* Move a tree from ungrouped area into a group
* Move a tree between groups
* Drag a tree out of a group to the ungrouped area

When you drop a tree into a group, the entire subtree moves together (preserving left/right arrangement) and forest layout runs automatically.

## Multi-select and grouping

**Ctrl+click** ungrouped root nodes to multi-select them. Then right-click and choose **Create group** to wrap them in a new canvas group. The group is created around all selected trees and enters edit mode for naming.

## Search

Click the search icon to show a filter input. Type to filter complete trees and groups by name. A tree remains visible when any of its descendants matches the search query.

{% hint style="info" %}
See also: [Commands reference](../reference/commands.md) for the full list of keyboard commands.
{% endhint %}
