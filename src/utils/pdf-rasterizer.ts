import { pdfToPng, PngPageOutput } from 'pdf-to-png-converter';
import { logger } from './logger.js';

export interface RasterizeOptions {
  startPage?: number;     // 1-indexed, inclusive. Default: 1
  endPage?: number;       // 1-indexed, inclusive. Default: startPage + 4 (5 pages total)
  dpi?: number;           // Default: 200. Clamped to 72-400.
}

export interface RasterizedPage {
  pageNumber: number;
  pngBuffer: Buffer;
  width: number;
  height: number;
}

export interface RasterizeResult {
  pages: RasterizedPage[];
  totalPagesInPdf: number;
  pagesReturned: number;
  pagesSkipped: number;  // pages in the PDF outside the requested range
}

const DEFAULT_PAGE_SPAN = 5;
const PDF_VIEWPORT_BASE_DPI = 72;

export async function rasterizePdf(
  pdfBuffer: Buffer,
  options: RasterizeOptions = {}
): Promise<RasterizeResult> {
  const startPage = Math.max(1, options.startPage ?? 1);
  const endPage = Math.max(startPage, options.endPage ?? (startPage + DEFAULT_PAGE_SPAN - 1));
  const dpi = Math.min(400, Math.max(72, options.dpi ?? 200));
  const viewportScale = dpi / PDF_VIEWPORT_BASE_DPI;

  logger.debug('rasterizing pdf', {
    bufferBytes: pdfBuffer.length,
    startPage,
    endPage,
    dpi,
    viewportScale,
  });

  // Step 1: cheap metadata-only pass to learn total page count.
  let totalPages = 0;
  try {
    const metadata = await pdfToPng(pdfBuffer, { returnMetadataOnly: true });
    totalPages = metadata.length;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'unknown';
    throw new Error(`PDF rasterization failed (metadata pass): ${message}`);
  }

  // Step 2: render the requested page range. pdf-to-png-converter silently ignores pages above doc count.
  const pagesToProcess: number[] = [];
  for (let p = startPage; p <= endPage; p++) {
    if (p <= totalPages) pagesToProcess.push(p);
  }

  let renderedPages: PngPageOutput[];
  if (pagesToProcess.length === 0) {
    renderedPages = [];
  } else {
    try {
      renderedPages = await pdfToPng(pdfBuffer, {
        viewportScale,
        pagesToProcess,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'unknown';
      throw new Error(`PDF rasterization failed (render pass): ${message}`);
    }
  }

  const pages: RasterizedPage[] = renderedPages
    .filter((p): p is PngPageOutput & { content: Buffer } => Buffer.isBuffer(p.content))
    .map(p => ({
      pageNumber: p.pageNumber,
      pngBuffer: p.content,
      width: p.width,
      height: p.height,
    }));

  const pagesReturned = pages.length;
  const pagesSkipped = Math.max(0, totalPages - pagesReturned);

  logger.debug('pdf rasterized', {
    pagesReturned,
    totalPages,
    pagesSkipped,
    avgBytes: pages.length > 0
      ? Math.round(pages.reduce((s, p) => s + p.pngBuffer.length, 0) / pages.length)
      : 0,
  });

  return {
    pages,
    totalPagesInPdf: totalPages,
    pagesReturned,
    pagesSkipped,
  };
}
