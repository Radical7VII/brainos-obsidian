"""Package real Obsidian captures; never draw or synthesize application UI.

Usage: python3 scripts/build-readme-media.py /path/to/capture-directory
Or: python3 scripts/build-readme-media.py --video /path/to/recording.mp4
Requires Pillow for screenshots, FFmpeg for video. See docs/assets/README.md.
"""
from pathlib import Path
import argparse
import json
import subprocess
from PIL import Image

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('capture_directory', nargs='?', type=Path)
parser.add_argument('--video', type=Path, help='Continuous recording of the demo window')
parser.add_argument('--start', type=float, default=20)
parser.add_argument('--duration', type=float, default=20)
args = parser.parse_args()
if args.video is None and args.capture_directory is None:
    parser.error('provide a capture directory or --video')
source = args.capture_directory
output = Path(__file__).resolve().parents[1] / 'docs' / 'assets'
output.mkdir(parents=True, exist_ok=True)
if args.video is not None:
    # Preserve real-time motion; sample at 30 fps without motion interpolation.
    subprocess.run([
        'ffmpeg', '-hide_banner', '-loglevel', 'error',
        '-ss', str(args.start), '-t', str(args.duration), '-i', str(args.video),
        '-filter_complex',
        '[0:v]fps=30,crop=1300:710:250:250,split[a][b];'
        '[a]palettegen=stats_mode=diff[p];'
        '[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle',
        '-loop', '0', '-y', str(output / 'brainos-workflow.gif')
    ], check=True)
    print(f"brainos-workflow.gif: {(output / 'brainos-workflow.gif').stat().st_size:,} bytes")
    raise SystemExit(0)
frames = json.loads((source / 'frames.json').read_text())

# Keep the full app window in the overview; the second image is a detail crop.
Image.open(source / 'frame-0000.png').save(output / 'brainos-graph.png', optimize=True)
Image.open(source / 'candidates.png').crop((550, 280, 1510, 690)).save(
    output / 'brainos-node-suggestions.png', optimize=True)

images = [Image.open(frame['path']).convert('RGB').crop((350, 250, 1550, 960)) for frame in frames]
# A shared palette keeps text edges stable between genuine captured frames.
palette_source = Image.new('RGB', (300 * len(images), 178), 'white')
for index, image in enumerate(images):
    palette_source.paste(image.resize((300, 178)), (300 * index, 0))
palette = palette_source.quantize(colors=256, method=Image.Quantize.MEDIANCUT)
gif_frames = [image.quantize(palette=palette, dither=Image.Dither.NONE) for image in images]
gif_frames[0].save(output / 'brainos-workflow.gif', save_all=True,
    append_images=gif_frames[1:], duration=[frame['duration'] for frame in frames],
    loop=0, optimize=True, disposal=1)

# Local contact sheet for visual review; not part of the published assets.
preview = Image.new('RGB', (1200, 710), '#e5e5e5')
for index, frame_index in enumerate([0, 12, 26, len(images) - 1]):
    preview.paste(images[frame_index].resize((600, 355)), ((index % 2) * 600, (index // 2) * 355))
preview.save(source / 'review-contact-sheet.png')
for name in ['brainos-graph.png', 'brainos-node-suggestions.png', 'brainos-workflow.gif']:
    path = output / name
    print(f'{name}: {path.stat().st_size:,} bytes')
