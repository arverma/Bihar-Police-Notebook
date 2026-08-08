# Vendored raster-PDF libraries

Pinned browser UMD builds used only by the iOS/iPadOS export path
(`editor/js/export/raster-pdf.js`). Desktop native print does not load these files.

| File | Package | Version |
|------|---------|---------|
| `html2canvas.min.js` | [html2canvas](https://github.com/niklasvh/html2canvas) | 1.4.1 |
| `jspdf.umd.min.js` | [jsPDF](https://github.com/parallax/jsPDF) | 2.5.2 |

Loaded lazily on first raster-PDF export via classic `<script>` tags (same pattern as Drive GIS).
