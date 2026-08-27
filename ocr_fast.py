#!/usr/bin/env python3
"""Hızlı OCR - kalan sayfalar için"""
import fitz
import pytesseract
from PIL import Image
import io, os

PDF_PATH = "/home/user/uploads/Predator Terminal Projesi.pdf"
OUTPUT_DIR = "/home/user/predator-terminal/pdf_pages"
OUTPUT_TEXT = "/home/user/predator-terminal/PDF_FULL_TEXT.md"

doc = fitz.open(PDF_PATH)
total_pages = len(doc)
results = []

for page_num in range(total_pages):
    img_path = os.path.join(OUTPUT_DIR, f"page_{page_num + 1:02d}.png")
    
    # PNG yoksa render et (200 DPI - daha hızlı)
    if not os.path.exists(img_path):
        page = doc[page_num]
        mat = fitz.Matrix(200/72, 200/72)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        pix.save(img_path)
        print(f"  📸 Sayfa {page_num+1} render edildi")
    
    # OCR yap
    img = Image.open(img_path)
    print(f"  🔎 Sayfa {page_num+1}/{total_pages} OCR...", end=" ", flush=True)
    text = pytesseract.image_to_string(img, lang="tur+eng", config="--psm 6")
    text = text.strip()
    print(f"✅ {len(text)} chars")
    
    results.append({"page": page_num+1, "text": text, "char_count": len(text)})

doc.close()

# Markdown output
with open(OUTPUT_TEXT, "w", encoding="utf-8") as f:
    f.write("# Predator Terminal Projesi - PDF OCR Çıktısı\n\n")
    f.write(f"> **Toplam Sayfa:** {total_pages}  \n")
    f.write(f"> **OCR:** Tesseract 5.5.0 (tur+eng)  \n\n---\n\n")
    for r in results:
        f.write(f"## Sayfa {r['page']} ({r['char_count']} karakter)\n\n")
        f.write(f"{r['text'] if r['text'] else '*(boş)*'}\n\n")
        f.write("---\n\n")

print(f"\n💾 Kaydedildi: {OUTPUT_TEXT}")
total_chars = sum(r["char_count"] for r in results)
print(f"📊 {total_pages} sayfa, {total_chars} toplam karakter")
