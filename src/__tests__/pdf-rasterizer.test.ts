import { describe, it, expect, beforeEach, jest } from '@jest/globals';

type FakePage = { pageNumber: number; width: number; height: number; content?: Buffer };
const pdfToPngMock = jest.fn<(...args: unknown[]) => Promise<FakePage[]>>();

jest.mock('pdf-to-png-converter', () => ({
  __esModule: true,
  pdfToPng: (...args: unknown[]) => pdfToPngMock(...args),
}));

import { rasterizePdf } from '../utils/pdf-rasterizer.js';

const fakePngBuffer = (label: string) => Buffer.from(`png:${label}`);

describe('rasterizePdf', () => {
  beforeEach(() => {
    pdfToPngMock.mockReset();
  });

  it('renders the requested page range and returns metadata + buffers', async () => {
    pdfToPngMock
      // Metadata pass
      .mockResolvedValueOnce([
        { pageNumber: 1, width: 612, height: 792 },
        { pageNumber: 2, width: 612, height: 792 },
        { pageNumber: 3, width: 612, height: 792 },
      ])
      // Render pass
      .mockResolvedValueOnce([
        { pageNumber: 1, width: 1224, height: 1584, content: fakePngBuffer('p1') },
        { pageNumber: 2, width: 1224, height: 1584, content: fakePngBuffer('p2') },
      ]);

    const result = await rasterizePdf(Buffer.from('%PDF-fake'), { startPage: 1, endPage: 2, dpi: 144 });

    expect(result.totalPagesInPdf).toBe(3);
    expect(result.pagesReturned).toBe(2);
    expect(result.pagesSkipped).toBe(1);
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0].pageNumber).toBe(1);
    expect(result.pages[0].pngBuffer.toString()).toBe('png:p1');

    // Metadata call: no pagesToProcess, returnMetadataOnly: true
    expect(pdfToPngMock).toHaveBeenNthCalledWith(
      1,
      expect.any(Buffer),
      expect.objectContaining({ returnMetadataOnly: true })
    );
    // Render call: viewportScale 144/72=2, pagesToProcess [1,2]
    expect(pdfToPngMock).toHaveBeenNthCalledWith(
      2,
      expect.any(Buffer),
      expect.objectContaining({ viewportScale: 2, pagesToProcess: [1, 2] })
    );
  });

  it('clamps DPI below 72 up to 72 and above 400 down to 400', async () => {
    pdfToPngMock
      .mockResolvedValueOnce([{ pageNumber: 1, width: 100, height: 100 }])
      .mockResolvedValueOnce([{ pageNumber: 1, width: 100, height: 100, content: fakePngBuffer('p1') }]);

    await rasterizePdf(Buffer.from('%PDF-fake'), { dpi: 50 });

    expect(pdfToPngMock).toHaveBeenLastCalledWith(
      expect.any(Buffer),
      expect.objectContaining({ viewportScale: 1 }) // 72/72
    );

    pdfToPngMock.mockReset();
    pdfToPngMock
      .mockResolvedValueOnce([{ pageNumber: 1, width: 100, height: 100 }])
      .mockResolvedValueOnce([{ pageNumber: 1, width: 100, height: 100, content: fakePngBuffer('p1') }]);

    await rasterizePdf(Buffer.from('%PDF-fake'), { dpi: 9999 });

    expect(pdfToPngMock).toHaveBeenLastCalledWith(
      expect.any(Buffer),
      expect.objectContaining({ viewportScale: 400 / 72 })
    );
  });

  it('truncates the requested range to the actual page count without errors', async () => {
    pdfToPngMock
      .mockResolvedValueOnce([
        { pageNumber: 1, width: 100, height: 100 },
        { pageNumber: 2, width: 100, height: 100 },
      ])
      .mockResolvedValueOnce([
        { pageNumber: 1, width: 100, height: 100, content: fakePngBuffer('p1') },
        { pageNumber: 2, width: 100, height: 100, content: fakePngBuffer('p2') },
      ]);

    const result = await rasterizePdf(Buffer.from('%PDF-fake'), { startPage: 1, endPage: 10 });

    expect(result.pagesReturned).toBe(2);
    expect(result.totalPagesInPdf).toBe(2);
    expect(result.pagesSkipped).toBe(0);
    // Render call should only ask for pages that exist (1, 2) — not 3..10
    expect(pdfToPngMock).toHaveBeenLastCalledWith(
      expect.any(Buffer),
      expect.objectContaining({ pagesToProcess: [1, 2] })
    );
  });

  it('returns empty pages array if startPage is past the end of the PDF', async () => {
    pdfToPngMock.mockResolvedValueOnce([{ pageNumber: 1, width: 100, height: 100 }]);

    const result = await rasterizePdf(Buffer.from('%PDF-fake'), { startPage: 5, endPage: 7 });

    expect(result.pagesReturned).toBe(0);
    expect(result.totalPagesInPdf).toBe(1);
    // pagesSkipped should reflect that the doc has 1 page we didn't render
    expect(result.pagesSkipped).toBe(1);
    // Should NOT call pdfToPng for the render pass (no pages to process)
    expect(pdfToPngMock).toHaveBeenCalledTimes(1);
  });

  it('throws a descriptive error when pdf-to-png-converter fails', async () => {
    pdfToPngMock.mockRejectedValueOnce(new Error('Invalid PDF: header not found'));

    await expect(
      rasterizePdf(Buffer.from('not-a-pdf'))
    ).rejects.toThrow(/PDF rasterization failed.*Invalid PDF/);
  });
});
