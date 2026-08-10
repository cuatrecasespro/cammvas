---
description: Complete list of all Cammvas commands.
---

# Commands

All commands are available from the command palette (`Ctrl/Cmd+P`). Search for "Cammvas" to find them. Default hotkeys can be changed in **Settings > Hotkeys**.

## Node editing

| Command                      | Description                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| Edit selected node           | Start editing the selected node's text                                                      |
| Add child node               | Create a child node from the selected node. If text is selected, it moves to the child      |
| Add sibling node             | Create a sibling node next to the current one. If text is selected, it moves to the sibling |
| Create root node             | Create an independent root at the center of the visible canvas                            |
| Delete node and focus parent | Remove the current node and select its parent                                               |

## Navigation

| Command                      | Description                                                             |
| ---------------------------- | ----------------------------------------------------------------------- |
| Navigate right               | Move to the nearest right-side child, or to parent if children are left |
| Navigate left                | Move to the nearest left-side child, or to parent if children are right |
| Navigate to next sibling     | Move to the next sibling (side-aware in balanced layouts)               |
| Navigate to previous sibling | Move to the previous sibling (side-aware in balanced layouts)           |

## Layout and formatting

| Command                   | Description                                                |
| ------------------------- | ---------------------------------------------------------- |
| Re-layout mind map        | Recalculate layout for all trees on the canvas             |
| Re-layout selected branch | Arrange only descendants of the selected node              |
| Layout forest             | Arrange trees within the selected group into a grid        |
| Flip branch to other side | Move a branch to the opposite side of its parent           |
| Toggle balanced layout    | Distribute children on both sides, or collapse to one side |
| Apply branch colors       | Manually assign colors to top-level branches               |

## Resize

| Command                             | Description                                                |
| ----------------------------------- | ---------------------------------------------------------- |
| Resize & re-layout selected subtree | Resize nodes in the subtree to fit content, then re-layout |
| Resize all nodes to fit content     | Resize every node on the canvas and apply full layout      |

## Other

| Command                              | Description                                           |
| ------------------------------------ | ----------------------------------------------------- |
| Toggle mindmap mode                  | Enable or disable mindmap mode for the current canvas |
| Detach subtree as independent tree   | Disconnect a branch from its parent                   |
| Import mind map (.mm) file to canvas | Import a FreeMind/Coggle file into a new canvas       |

## Hotkeys

| Command                      | Hotkey                     |
| ---------------------------- | -------------------------- |
| Edit selected node           | `Enter`                    |
| Delete node and focus parent | `Ctrl + Shift + Backspace` |
| Flip branch                  | `Ctrl + Shift + S`         |
| Toggle balanced layout       | `Ctrl + Shift + D`         |
| Navigate right/left/up/down  | `Arrow keys`               |
| Resize & re-layout subtree   | `Ctrl + Shift + L`         |

{% hint style="info" %}
Cammvas includes a physical-key fallback for non-Latin keyboard layouts. See [Working with RTL content](/broken/pages/T0FxqT2PDsBShPB5TUm4).
{% endhint %}

When **Mind mapping Enter and Tab** is enabled, plain `Enter` creates a sibling while editing, `Tab` creates a child from the selected node, and `Shift + Enter` inserts a line break. Double-click empty Canvas space to create a root. Node creation commands have no default hotkeys but can be customized under **Settings > Hotkeys**.
