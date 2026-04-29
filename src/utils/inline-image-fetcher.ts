// Inline image fetcher with SSRF protections.
//
// Defense layers:
//   1. URL must be valid + https:// (blocks data:, file:, http:, etc.)
//   2. Hostname must match the configured allowlist (exact or *.suffix wildcards)
//   3. DNS-resolved IPs are checked against private/reserved ranges before fetch
//   4. axios is configured with size and timeout caps
//
// Known gap: axios follows up to 5 redirects by default. A trusted host could
// 301 to an attacker-controlled or non-allowlisted host whose Host header
// gets rewritten on redirect. Acceptable for now since the CDN targets we
// expect (Help Scout, Shopify, Airtable, CloudFront) don't behave that way,
// but if we ever observe abuse, switch to maxRedirects: 0 and re-validate
// the redirect target against the allowlist + DNS check explicitly.

import axios from 'axios';
import dns from 'node:dns/promises';
import FileType from 'file-type';
import { logger } from './logger.js';
import { config } from './config.js';

const PRIVATE_IPV4_RANGES: Array<[number, number]> = [
  [ipv4ToInt('10.0.0.0'), 8],
  [ipv4ToInt('172.16.0.0'), 12],
  [ipv4ToInt('192.168.0.0'), 16],
  [ipv4ToInt('127.0.0.0'), 8],
  [ipv4ToInt('169.254.0.0'), 16],   // link-local incl. cloud metadata 169.254.169.254
  [ipv4ToInt('100.64.0.0'), 10],    // CGNAT
  [ipv4ToInt('0.0.0.0'), 8],
];

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map(n => parseInt(n, 10));
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

export function isPrivateIpv4(ip: string): boolean {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return false;
  const ipInt = ipv4ToInt(ip);
  return PRIVATE_IPV4_RANGES.some(([network, prefix]) => {
    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
    return (ipInt & mask) === (network & mask);
  });
}

export function isPrivateIpv6(ip: string): boolean {
  if (ip === '::1' || ip === '::') return true;
  const lower = ip.toLowerCase();
  if (lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) return true;
  const v4MappedMatch = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4MappedMatch) return isPrivateIpv4(v4MappedMatch[1]);
  return false;
}

export function hostMatchesPattern(hostname: string, pattern: string): boolean {
  const h = hostname.toLowerCase();
  const p = pattern.toLowerCase();
  if (p.startsWith('*.')) {
    const suffix = p.slice(1); // ".cloudfront.net"
    return h.endsWith(suffix) && h.length > suffix.length;
  }
  return h === p;
}

export interface InlineImageFetchResult {
  data: Buffer;
  contentType: string;
}

export async function fetchInlineImage(url: string): Promise<InlineImageFetchResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(
      `Only https:// URLs are allowed (got ${parsed.protocol}). Plain HTTP can leak credentials and expose you to MITM.`
    );
  }

  const allowlist = config.inlineImageAllowlist;
  const hostname = parsed.hostname;
  const allowed = allowlist.some(pattern => hostMatchesPattern(hostname, pattern));
  if (!allowed) {
    throw new Error(
      `Hostname "${hostname}" is not in the inline image allowlist. ` +
      `Allowed patterns: ${allowlist.join(', ')}. ` +
      `To add a domain, set INLINE_IMAGE_ALLOWLIST env var (comma-separated) in claude_desktop_config.json and restart Claude Desktop.`
    );
  }

  let resolvedAddresses: string[];
  try {
    const records = await dns.lookup(hostname, { all: true, verbatim: true });
    resolvedAddresses = records.map(r => r.address);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'DNS lookup failed';
    throw new Error(`DNS lookup failed for ${hostname}: ${message}`);
  }

  for (const addr of resolvedAddresses) {
    if (isPrivateIpv4(addr) || isPrivateIpv6(addr)) {
      throw new Error(
        `Hostname "${hostname}" resolved to private IP address ${addr}. Refusing to fetch — possible DNS rebinding or misconfigured DNS.`
      );
    }
  }

  logger.debug('fetching inline image', { hostname, urlLength: url.length });

  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 30_000,
      maxContentLength: 25 * 1024 * 1024,
      maxRedirects: 5,
      validateStatus: (s) => s >= 200 && s < 300,
    });

    const buffer = Buffer.from(response.data);

    const detected = await FileType.fromBuffer(buffer);

    if (!detected) {
      throw new Error(
        `Could not detect file type from response bytes (${buffer.length} bytes). ` +
        `The URL may not be returning a recognized image format. First 16 bytes (hex): ${buffer.subarray(0, 16).toString('hex')}.`
      );
    }

    if (!detected.mime.startsWith('image/')) {
      throw new Error(
        `URL returned a non-image file. Detected type: "${detected.mime}" (${detected.ext}). This tool is for fetching images only.`
      );
    }

    const contentType = detected.mime;

    logger.debug('inline image detected via magic bytes', {
      hostname,
      detectedMime: detected.mime,
      detectedExt: detected.ext,
      headerContentType: response.headers['content-type'],
      bytes: buffer.length,
    });

    return { data: buffer, contentType };
  } catch (error: unknown) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      throw new Error(`Failed to fetch ${hostname}: ${status ? `HTTP ${status}` : error.message}`);
    }
    throw error;
  }
}
