import json
import os
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.colors import Color, HexColor
from reportlab.pdfgen import canvas


def tone_color(tone: str | None, low_contrast: bool):
    if low_contrast:
        return Color(0.36, 0.36, 0.34)
    if tone == "muted":
        return HexColor("#626b7a")
    if tone == "hazard":
        return HexColor("#9e1f1f")
    if tone == "accent":
        return HexColor("#0b5794")
    return HexColor("#141c29")


def wrapped_lines(pdf: canvas.Canvas, text: str, font_name: str, font_size: float, max_width: float):
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if current and pdf.stringWidth(candidate, font_name, font_size) > max_width:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines


def draw_page(pdf: canvas.Canvas, page_spec: dict):
    width = page_spec["width"]
    height = page_spec["height"]
    low_contrast = page_spec.get("background") == "low_contrast"
    pdf.setFillColor(HexColor("#eeece3") if low_contrast else HexColor("#ffffff"))
    pdf.rect(0, 0, width, height, fill=1, stroke=0)

    for element in page_spec["elements"]:
        x_min, y_min, x_max, y_max = element["box"]
        x = x_min * width
        top = height - y_min * height
        box_width = (x_max - x_min) * width
        box_height = (y_max - y_min) * height
        font_size = element.get("fontSize") or (10 if element["type"] == "table_cell" else 12)
        font_name = "Helvetica-Bold" if element["type"] == "heading" or element.get("rowIndex") == 0 else "Helvetica-Oblique" if element["type"] == "annotation" else "Helvetica"

        if element["type"] == "table_cell":
            pdf.setStrokeColor(HexColor("#8a8e8d") if low_contrast else HexColor("#748092"))
            if element.get("rowIndex") == 0:
                pdf.setFillColor(HexColor("#e8eff6"))
                pdf.rect(x, top - box_height, box_width, box_height, fill=1, stroke=1)
            else:
                pdf.rect(x, top - box_height, box_width, box_height, fill=0, stroke=1)

        if element["type"] == "chart_label" and "8.5%" in element["text"]:
            pdf.setFillColor(HexColor("#1774b8"))
            pdf.rect(x, top - box_height - 30, box_width * 0.85, 16, fill=1, stroke=0)
        if element["type"] == "chart_label" and "9.0%" in element["text"]:
            pdf.setFillColor(HexColor("#5f6e87"))
            pdf.rect(x, top - box_height - 30, box_width * 0.9, 16, fill=1, stroke=0)

        pdf.saveState()
        pdf.setFillColor(tone_color(element.get("tone"), low_contrast))
        pdf.setFont(font_name, font_size)
        if element.get("rotateDegrees"):
            pdf.translate(x, top - font_size - 2)
            pdf.rotate(element["rotateDegrees"])
            text_x = 4 if element["type"] == "table_cell" else 0
            text_y = 0
        else:
            text_x = x + (4 if element["type"] == "table_cell" else 0)
            text_y = top - font_size - 2
        for index, line in enumerate(wrapped_lines(pdf, element["text"], font_name, font_size, max(20, box_width - 8))):
            pdf.drawString(text_x, text_y - index * (font_size + 3), line)
        pdf.restoreState()


def create_text_pdf(spec: dict, destination: Path):
    first = spec["pages"][0]
    pdf = canvas.Canvas(str(destination), pagesize=(first["width"], first["height"]), pageCompression=0)
    for page_index, page_spec in enumerate(spec["pages"]):
        if page_index:
            pdf.setPageSize((page_spec["width"], page_spec["height"]))
        draw_page(pdf, page_spec)
        pdf.showPage()
    pdf.save()


def image_font(size: int, bold: bool = False):
    candidates = [
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for candidate in candidates:
        if os.path.exists(candidate):
            return ImageFont.truetype(candidate, size=size, index=1 if bold and candidate.endswith(".ttc") else 0)
    return ImageFont.load_default()


def image_wrapped_lines(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont, max_width: int):
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if current and draw.textlength(candidate, font=font) > max_width:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines


def render_page_image(page_spec: dict, destination: Path):
    scale = min(page_spec.get("renderDpi", 96), 96) / 72
    width = round(page_spec["width"] * scale)
    height = round(page_spec["height"] * scale)
    low_contrast = page_spec.get("background") == "low_contrast"
    image = Image.new("RGB", (width, height), "#eeece3" if low_contrast else "white")
    draw = ImageDraw.Draw(image)
    for element in page_spec["elements"]:
        x_min, y_min, x_max, y_max = element["box"]
        x = round(x_min * width)
        top = round(y_min * height)
        box_width = round((x_max - x_min) * width)
        box_height = round((y_max - y_min) * height)
        font_size = round((element.get("fontSize") or (10 if element["type"] == "table_cell" else 12)) * scale)
        bold = element["type"] == "heading" or element.get("rowIndex") == 0
        font = image_font(font_size, bold)
        if element["type"] == "table_cell":
            fill = "#e8eff6" if element.get("rowIndex") == 0 else None
            draw.rectangle((x, top, x + box_width, top + box_height), outline="#748092", fill=fill, width=1)
        if element["type"] == "chart_label" and "8.5%" in element["text"]:
            draw.rectangle((x, top + box_height + 8, x + round(box_width * 0.85), top + box_height + 24), fill="#1774b8")
        if element["type"] == "chart_label" and "9.0%" in element["text"]:
            draw.rectangle((x, top + box_height + 8, x + round(box_width * 0.9), top + box_height + 24), fill="#5f6e87")
        color = "#5c5c57" if low_contrast else "#626b7a" if element.get("tone") == "muted" else "#9e1f1f" if element.get("tone") == "hazard" else "#0b5794" if element.get("tone") == "accent" else "#141c29"
        lines = image_wrapped_lines(draw, element["text"], font, max(20, box_width - 8))
        text_image = Image.new("RGBA", (max(1, box_width + 80), max(1, box_height + 80)), (255, 255, 255, 0))
        text_draw = ImageDraw.Draw(text_image)
        for index, text in enumerate(lines):
            text_draw.text((4 if element["type"] == "table_cell" else 0, index * (font_size + 3)), text, fill=color, font=font)
        if element.get("rotateDegrees"):
            text_image = text_image.rotate(-element["rotateDegrees"], expand=True, resample=Image.Resampling.BICUBIC)
        image.paste(text_image, (x, top), text_image)
    if page_spec["rotation"]:
        image = image.rotate(-page_spec["rotation"], expand=True, fillcolor="white")
    image.save(destination, format="PNG", optimize=True)


def create_raster_pdf(page_paths: list[Path], destination: Path):
    first = Image.open(page_paths[0])
    pdf = canvas.Canvas(str(destination), pagesize=first.size, pageCompression=1)
    for page_index, page_path in enumerate(page_paths):
        image = Image.open(page_path)
        if page_index:
            pdf.setPageSize(image.size)
        pdf.drawImage(str(page_path), 0, 0, image.width, image.height)
        pdf.showPage()
    pdf.save()


def render_fixture(spec: dict, output_root: Path, temporary_root: Path):
    text_pdf = temporary_root / f"{spec['documentId']}-text.pdf"
    create_text_pdf(spec, text_pdf)
    page_paths: list[Path] = []
    for index, page_spec in enumerate(spec["pages"], start=1):
        destination = output_root / f"{spec['documentId']}-page-{index}.png"
        render_page_image(page_spec, destination)
        page_paths.append(destination)

    mode = spec["sourceMode"]
    if mode == "digital_pdf":
        (output_root / f"{spec['documentId']}.pdf").write_bytes(text_pdf.read_bytes())
    elif mode == "raster_pdf":
        create_raster_pdf(page_paths, output_root / f"{spec['documentId']}.pdf")
    elif mode == "jpeg":
        Image.open(page_paths[0]).convert("RGB").save(output_root / f"{spec['documentId']}.jpg", format="JPEG", quality=80, optimize=True)
    elif mode == "corrupted_png":
        (output_root / f"{spec['documentId']}.png").write_bytes(b"synthetic-corrupted-png")
    else:
        (output_root / f"{spec['documentId']}.png").write_bytes(page_paths[0].read_bytes())


def main():
    if len(sys.argv) not in (4, 6):
        raise SystemExit("Usage: render-document-intelligence-fixtures.py SPECS_JSON OUTPUT_ROOT TEMP_ROOT [START COUNT]")
    spec_path, output_root_value, temporary_root_value = sys.argv[1:4]
    output_root = Path(output_root_value)
    temporary_root = Path(temporary_root_value)
    output_root.mkdir(parents=True, exist_ok=True)
    specs = json.loads(Path(spec_path).read_text())
    if len(sys.argv) == 6:
        start = int(sys.argv[4])
        count = int(sys.argv[5])
        specs = specs[start:start + count]
    for spec in specs:
        render_fixture(spec, output_root, temporary_root)


if __name__ == "__main__":
    main()
