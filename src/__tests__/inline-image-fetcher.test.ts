import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import nock from 'nock';

type DnsRecord = { address: string; family: number };
const dnsLookupMock = jest.fn<(hostname: string, opts?: unknown) => Promise<DnsRecord[]>>();

jest.mock('node:dns/promises', () => ({
  __esModule: true,
  default: { lookup: (h: string, o?: unknown) => dnsLookupMock(h, o) },
  lookup: (h: string, o?: unknown) => dnsLookupMock(h, o),
}));

import { fetchInlineImage } from '../utils/inline-image-fetcher.js';

describe('fetchInlineImage', () => {
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
      .reply(200, Buffer.from('fake-jpeg-bytes'), { 'content-type': 'image/jpeg' });

    const result = await fetchInlineImage('https://d33v4339jhl8k0.cloudfront.net/inline/test.jpg');

    expect(result.contentType).toBe('image/jpeg');
    expect(result.data.toString()).toBe('fake-jpeg-bytes');
  });

  it('matches wildcard *.cloudfront.net subdomain', async () => {
    nock('https://other.cloudfront.net')
      .get('/img.png')
      .reply(200, Buffer.from('png-bytes'), { 'content-type': 'image/png' });

    const result = await fetchInlineImage('https://other.cloudfront.net/img.png');
    expect(result.contentType).toBe('image/png');
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

  it('rejects responses whose Content-Type is not an image', async () => {
    nock('https://d33v4339jhl8k0.cloudfront.net')
      .get('/notreally.jpg')
      .reply(200, '<html>oops</html>', { 'content-type': 'text/html' });

    await expect(
      fetchInlineImage('https://d33v4339jhl8k0.cloudfront.net/notreally.jpg')
    ).rejects.toThrow(/did not return an image content type/);
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
