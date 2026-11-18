from pathlib import Path


def make_pdf(path: Path, lines: list[str]) -> Path:
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas

    path.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(path), pagesize=A4)
    y = 800
    for line in lines:
        c.setFont("Helvetica", 10)
        c.drawString(48, y, line[:110])
        y -= 16
    c.save()
    return path
