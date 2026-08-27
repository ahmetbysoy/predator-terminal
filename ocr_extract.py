#!/usr/bin/env python3
"""
PREDATOR TERMINAL - PDF OCR Extractor
======================================
PyMuPDF + Tesseract OCR ile görsel PDF'den metin çıkarma.
Türkçe + İngilizce dil desteği.
"""

import fitz  # PyMuPDF
import pytesseract
from PIL import Image
import io
import sys
import os

PDF_PATH = "/home/user/uploads/Predator Terminal Projesi.pdf"
OUTPUT_DIR = "/home/user/predator-terminal/pdf_pages"
OUTPUT_TEXT = "/home/user/predator-terminal/PDF_FULL_TEXT.md"

def extract_and_ocr(pdf_path: str, dpi: int = 300) -> list[dict]:
    """
    PDF'in her sayfasını yüksek çözünürlükte render edip OCR yapar.
    """
    print(f"📄 PDF açılıyor: {pdf_path}")
    doc = fitz.open(pdf_path)
    total_pages = len(doc)
    print(f"📊 Toplam sayfa: {total_pages}")
    print(f"🔍 OCR DPI: {dpi}")
    print("=" * 60)

    results = []

    for page_num in range(total_pages):
        page = doc[page_num]
        
        # Yüksek çözünürlükte render
        zoom = dpi / 72.0
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        
        # PNG olarak kaydet
        img_path = os.path.join(OUTPUT_DIR, f"page_{page_num + 1:02d}.png")
        pix.save(img_path)
        
        # PIL Image'a çevir
        img_data = pix.tobytes("png")
        img = Image.open(io.BytesIO(img_data))
        
        # OCR - Türkçe + İngilizce
        print(f"  🔎 Sayfa {page_num + 1}/{total_pages} OCR yapılıyor...", end=" ", flush=True)
        
        # Türkçe + İngilizce birlikte
        text_tur = pytesseract.image_to_string(img, lang="tur+eng", config="--psm 6")
        
        # Sadece İngilizce (fallback - bazı teknik terimler için)
        text_eng = pytesseract.image_to_string(img, lang="eng", config="--psm 6")
        
        # Hangi sonuç daha uzun (daha çok metin yakaladıysa onu kullan)
        text = text_tur if len(text_tur.strip()) >= len(text_eng.strip()) else text_eng
        
        print(f"✅ {len(text)} karakter")
        
        results.append({
            "page": page_num + 1,
            "image_path": img_path,
            "text": text.strip(),
            "char_count": len(text.strip()),
        })
    
    doc.close()
    return results


def save_results(results: list[dict], output_path: str):
    """OCR sonuçlarını Markdown dosyasına kaydeder."""
    with open(output_path, "w", encoding="utf-8") as f:
        f.write("# Predator Terminal Projesi - PDF OCR Çıktısı\n\n")
        f.write(f"> **Kaynak:** Predator Terminal Projesi.pdf  \n")
        f.write(f"> **OCR Engine:** Tesseract 5.5.0 (tur+eng)  \n")
        f.write(f"> **DPI:** 300  \n")
        f.write(f"> **Toplam Sayfa:** {len(results)}  \n\n")
        f.write("---\n\n")
        
        for r in results:
            f.write(f"## Sayfa {r['page']} ({r['char_count']} karakter)\n\n")
            if r['text']:
                f.write(f"{r['text']}\n\n")
            else:
                f.write("*(OCR metin bulamadı)*\n\n")
            f.write("---\n\n")
    
    print(f"\n💾 Tam metin kaydedildi: {output_path}")


if __name__ == "__main__":
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    results = extract_and_ocr(PDF_PATH, dpi=300)
    save_results(results, OUTPUT_TEXT)
    
    # Özet
    total_chars = sum(r["char_count"] for r in results)
    print(f"\n{'=' * 60}")
    print(f"📊 ÖZET: {len(results)} sayfa, {total_chars} toplam karakter")
    print(f"{'=' * 60}")
    
    # Her sayfanın ilk 200 karakterini göster
    for r in results:
        preview = r["text"][:200].replace("\n", " ") if r["text"] else "(boş)"
        print(f"  Sayfa {r['page']}: {preview}...")
