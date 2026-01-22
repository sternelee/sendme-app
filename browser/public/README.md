# PWA Icons

This directory contains PWA-related assets.

## Required Icons

The following icon files are referenced in the PWA manifest:

- `icon-192x192.png` - 192x192 PNG icon
- `icon-512x512.png` - 512x512 PNG icon
- `apple-touch-icon.png` - 180x180 PNG icon
- `og-image.png` - 1200x630 PNG for Open Graph
- `twitter-image.png` - 1200x630 PNG for Twitter Cards

## Generating PNG from SVG

To generate PNG files from `icon.svg`, use one of these methods:

### Using ImageMagick:
```bash
convert -background none icon.svg -resize 192x192 icon-192x192.png
convert -background none icon.svg -resize 512x512 icon-512x512.png
convert -background none icon.svg -resize 180x180 apple-touch-icon.png
```

### Using online tools:
- https://cloudconvert.com/svg-to-png
- https://convertio.co/svg-png/
- https://www.aconvert.com/image/svg-to-png/

### Using Figma/Sketch:
1. Open the SVG
2. Export at the required sizes
