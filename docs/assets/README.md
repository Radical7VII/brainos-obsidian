# README media

These assets are real screen captures, not rendered mockups.

- Application: Obsidian 1.14.4 on macOS.
- Plugin: BrainOS Graph 0.2.6.
- Theme: Obsidian default light theme.
- Content: a separate demo vault containing only example thought paths.
- `brainos-graph.png`: full Obsidian application window showing four nodes and four directed connections.
- `brainos-node-suggestions.png`: detail crop of the native suggestion popup while entering a node title.
- `brainos-workflow.gif`: actual captured frames showing Space to rename, Tab to extend, and typing to reuse an existing node. Playback timing is adjusted; application UI and note content are not synthesized or composited.

Post-processing is implemented in `scripts/build-readme-media.py` and requires Pillow. It takes a local capture directory containing the screenshots and a `frames.json` list of `{ "path": "...", "duration": 100 }` entries. Raw capture frames are kept outside the repository. Both READMEs use the same media.
