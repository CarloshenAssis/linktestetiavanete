import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { PDFDocument } from "pdf-lib";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.7;

// Re-renders each page as a compressed JPEG and rebuilds the PDF from those images.
// Falls back to the original file if rendering fails or the result isn't smaller
// (this rasterizes text, which is an acceptable tradeoff for scanned/image-heavy materials).
export async function compressPdf(file: File): Promise<File> {
  try {
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    const out = await PDFDocument.create();

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(1, MAX_DIMENSION / Math.max(baseViewport.width, baseViewport.height));
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas 2D não suportado");
      await page.render({ canvasContext: ctx, viewport }).promise;

      const jpegBlob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob falhou"))), "image/jpeg", JPEG_QUALITY)
      );
      const jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());
      const jpegImage = await out.embedJpg(jpegBytes);
      const outPage = out.addPage([canvas.width, canvas.height]);
      outPage.drawImage(jpegImage, { x: 0, y: 0, width: canvas.width, height: canvas.height });
    }

    const compressedBytes = await out.save();
    if (compressedBytes.byteLength >= file.size) return file;
    return new File([compressedBytes as BlobPart], file.name, { type: "application/pdf" });
  } catch (err) {
    console.error("Falha ao comprimir PDF, enviando arquivo original:", err);
    return file;
  }
}
