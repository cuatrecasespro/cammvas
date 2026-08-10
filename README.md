# Cammvas

**A dedicated mind-mapping experience inside Obsidian Canvas.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) [![GitHub release](https://img.shields.io/github/v/release/cuatrecasespro/cammvas)](https://github.com/cuatrecasespro/cammvas/releases) [![Obsidian](https://img.shields.io/badge/Obsidian-1.13.4%2B-purple.svg)](https://obsidian.md)

Cammvas adds the interactions people expect from standalone mind-mapping software while keeping every map as a standard `.canvas` file in the vault. Build branches from the keyboard, drag nodes onto other nodes to restructure a map, collapse complete subtrees, and navigate the hierarchy without leaving Canvas.

## What Cammvas Adds

- **Mind-map keyboard workflow:** `Enter` creates a sibling, `Tab` creates a child, `Shift + Enter` inserts a line break, and arrow keys navigate the tree.
- **Drag to create branches:** drop a node onto another node to reparent its complete subtree, with cycle prevention and a highlighted target.
- **Collapsible branches:** fold and restore complete descendant trees directly from their parent nodes.
- **Automatic tree layout:** compact contour-based placement with left, right, and balanced branches.
- **Branch-aware dragging:** moving a node moves its descendants while preserving their relative positions.
- **Map outline:** search, navigate, group, rename, and reorganize roots from a synchronized sidebar.
- **Branch colors:** configurable palettes with automatic propagation through each branch.
- **Canvas-native storage:** no proprietary format, external service, network request, or telemetry.

## Quick Start

1. Open a Canvas and activate **Mindmap mode** from the Canvas controls.
2. Select a node and use `Shift + Tab` to create a child or the command palette to create a root.
3. Enable **Mind mapping Enter and Tab** for the conventional `Enter`/`Tab` workflow.
4. Enable **Drag to reparent** to restructure branches by dropping nodes onto other nodes.
5. Use the node chevrons to collapse or expand branches.

All behavior can be configured under **Settings > Cammvas**.

## Default Hotkeys

| Action | Hotkey |
| --- | --- |
| Add child node | `Shift + Tab` |
| Add sibling node | `Shift + º` |
| Create root node | `Shift + Enter` |
| Navigate between nodes | Arrow keys |

When **Mind mapping Enter and Tab** is enabled, plain `Enter` creates a sibling while editing and plain `Tab` creates a child. `Shift + Enter` remains available for line breaks while editing.

## Installation

### Community Plugins

Once Cammvas is accepted into the Obsidian community directory:

1. Open **Settings > Community plugins**.
2. Search for **Cammvas**.
3. Select **Install**, then **Enable**.

### Manual Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/cuatrecasespro/cammvas/releases/latest).
2. Create `.obsidian/plugins/cammvas/` inside the vault.
3. Place the three files in that folder.
4. Enable Cammvas under **Settings > Community plugins**.

## Compatibility

Cammvas currently requires Obsidian 1.13.4 or newer and is desktop-only. Several advanced Canvas interactions depend on undocumented runtime APIs, so compatibility is tested against current Obsidian releases.

## Origin And Attribution

Cammvas is an independent Obsidian plugin developed by [cuatrecasespro](https://github.com/cuatrecasespro). It is based on the MIT-licensed [Mindvas](https://github.com/mobench/mindvas) project by mobench and retains its original copyright and license notice.

Cammvas extends that foundation with a workflow designed to reproduce dedicated mind-mapping software inside Canvas, including drag-to-reparent branch creation, persistent branch collapsing, conventional mind-map hotkeys, spatial navigation, configurable branch palettes, root creation, and an expanded synchronized outline.

Cammvas is not affiliated with or endorsed by the original Mindvas project.

## License

[MIT](LICENSE). See the license file for the original and current copyright notices.

## Contributing

Bug reports and feature requests are welcome in the [issue tracker](https://github.com/cuatrecasespro/cammvas/issues).
