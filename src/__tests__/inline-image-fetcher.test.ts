import { describe, it, expect, beforeAll, beforeEach, afterEach, jest } from '@jest/globals';
import nock from 'nock';
import sharp from 'sharp';

type DnsRecord = { address: string; family: number };
const dnsLookupMock = jest.fn<(hostname: string, opts?: unknown) => Promise<DnsRecord[]>>();

jest.mock('node:dns/promises', () => ({
  __esModule: true,
  default: { lookup: (h: string, o?: unknown) => dnsLookupMock(h, o) },
  lookup: (h: string, o?: unknown) => dnsLookupMock(h, o),
}));

import { fetchInlineImage } from '../utils/inline-image-fetcher.js';

describe('fetchInlineImage', () => {
  let realPng: Buffer;
  let realJpeg: Buffer;

  beforeAll(async () => {
    realPng = await sharp({
      create: { width: 10, height: 10, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
    })
      .png()
      .toBuffer();
    realJpeg = await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 100, g: 150, b: 200 } },
    })
      .jpeg()
      .toBuffer();
  });

  beforeEach(() => {
    nock.cleanAll();
    dnsLookupMock.mockReset();
    // Public IP by default; individual tests override.
    dnsLookupMock.mockResolvedValue([{ address: '203.0.113.10', family: 4 }]);
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('fetches an image from an allowlisted CDN domain', async () => {
    nock('https://d33v4339jhl8k0.cloudfront.net')
      .get('/inline/test.jpg')
      .reply(200, realJpeg, { 'content-type': 'image/jpeg' });

    const result = await fetchInlineImage('https://d33v4339jhl8k0.cloudfront.net/inline/test.jpg');

    expect(result.contentType).toBe('image/jpeg');
    expect(result.data.length).toBe(realJpeg.length);
  });

  it('matches wildcard *.cloudfront.net subdomain', async () => {
    nock('https://other.cloudfront.net')
      .get('/img.png')
      .reply(200, realPng, { 'content-type': 'image/png' });

    const result = await fetchInlineImage('https://other.cloudfront.net/img.png');
    expect(result.contentType).toBe('image/png');
  });

  it('accepts an image even when Content-Type header is application/octet-stream (Help Scout case)', async () => {
    nock('https://d33v4339jhl8k0.cloudfront.net')
      .get('/inline/helpscout.png')
      .reply(200, realPng, { 'content-type': 'application/octet-stream' });

    const result = await fetchInlineImage('https://d33v4339jhl8k0.cloudfront.net/inline/helpscout.png');

    // Magic-byte detection wins over the misleading header
    expect(result.contentType).toBe('image/png');
    expect(result.data.length).toBe(realPng.length);
  });

  it('rejects unrecognized bytes with a "could not detect file type" error', async () => {
    nock('https://d33v4339jhl8k0.cloudfront.net')
      .get('/inline/garbage.bin')
      .reply(200, Buffer.from([0, 0, 0, 0, 1, 2, 3, 4]), { 'content-type': 'image/png' });

    await expect(
      fetchInlineImage('https://d33v4339jhl8k0.cloudfront.net/inline/garbage.bin')
    ).rejects.toThrow(/Could not detect file type/);
  });

  it('rejects http:// URLs', async () => {
    await expect(
      fetchInlineImage('http://d33v4339jhl8k0.cloudfront.net/x.jpg')
    ).rejects.toThrow(/Only https/);
  });

  it('rejects non-allowlisted hostnames', async () => {
    await expect(
      fetchInlineImage('https://evil.example.com/x.jpg')
    ).rejects.toThrow(/not in the inline image allowlist/);
  });

  it('rejects URLs that resolve to private IPv4 (loopback)', async () => {
    dnsLookupMock.mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);

    await expect(
      fetchInlineImage('https://d33v4339jhl8k0.cloudfront.net/x.jpg')
    ).rejects.toThrow(/private IP address 127\.0\.0\.1/);
  });

  it('rejects URLs that resolve to AWS metadata IP', async () => {
    dnsLookupMock.mockResolvedValueOnce([{ address: '169.254.169.254', family: 4 }]);

    await expect(
      fetchInlineImage('https://d33v4339jhl8k0.cloudfront.net/x.jpg')
    ).rejects.toThrow(/private IP address 169\.254\.169\.254/);
  });

  it('rejects URLs that resolve to private IPv6 loopback', async () => {
    dnsLookupMock.mockResolvedValueOnce([{ address: '::1', family: 6 }]);

    await expect(
      fetchInlineImage('https://d33v4339jhl8k0.cloudfront.net/x.jpg')
    ).rejects.toThrow(/private IP address ::1/);
  });

  it('rejects responses whose actual bytes are not an image (header is ignored)', async () => {
    // Server lies that this is image/png, but the bytes are HTML. Magic-byte sniffer catches it.
    nock('https://d33v4339jhl8k0.cloudfront.net')
      .get('/notreally.jpg')
      .reply(200, '<!DOCTYPE html><html><body>not an image at all</body></html>', { 'content-type': 'image/png' });

    await expect(
      fetchInlineImage('https://d33v4339jhl8k0.cloudfront.net/notreally.jpg')
    ).rejects.toThrow(/non-image|Could not detect file type/);
  });

  it('surfaces HTTP error status with descriptive message', async () => {
    nock('https://d33v4339jhl8k0.cloudfront.net')
      .get('/missing.jpg')
      .reply(404);

    await expect(
      fetchInlineImage('https://d33v4339jhl8k0.cloudfront.net/missing.jpg')
    ).rejects.toThrow(/HTTP 404/);
  });

  it('rejects malformed URLs', async () => {
    await expect(fetchInlineImage('not a url')).rejects.toThrow(/Invalid URL/);
  });
});
