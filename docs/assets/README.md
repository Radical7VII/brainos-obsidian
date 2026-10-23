# README media

These assets are real screen captures, not rendered mockups.

- Application: Obsidian 1.14.4 on macOS.
- Plugin: BrainOS Graph 0.2.6.
- Theme: Obsidian default light theme.
- Content: a separate demo vault containing only example thought paths.
- `brainos-graph.png`: full Obsidian application window showing four nodes and four directed connections.
- `brainos-node-suggestions.png`: detail crop of the native suggestion popup while entering a node title.
- `brainos-workflow.gif`: a continuous ScreenCaptureKit recording of only the demo window, showing Space to rename, Tab to extend, and typing to reuse an existing node. The source averages 29.23 fps (1,171 real frames over 40.06 seconds), with no audio. Seconds 20–40 are cropped and exported at 30 fps, at original speed and without motion interpolation. GIF frame delays alternate between 30 and 40 ms because GIF timing has 10 ms precision.

Post-processing is implemented in `scripts/build-readme-media.py`. To rebuild the GIF, install FFmpeg and run:

```sh
python3 scripts/build-readme-media.py --video /path/to/recording.mp4 --start 20 --duration 20
```

The original screenshot packaging mode requires Pillow and accepts a local capture directory containing screenshots and a `frames.json` list of `{ "path": "...", "duration": 100 }` entries. Raw recordings and screenshots are kept outside the repository. Both READMEs use the same media.
