import dotenv from 'dotenv';

// Only load .env in non-test environments
if (process.env.NODE_ENV !== 'test') {
  dotenv.config();
}

const HARDCODED_INLINE_IMAGE_ALLOWLIST = [
  'd33v4339jhl8k0.cloudfront.net',  // Help Scout's inline image CDN
  '*.cloudfront.net',                // Other CloudFront-hosted images
  'cdn.shopify.com',                 // Shopify product images
  '*.airtableusercontent.com',       // Airtable attachment URLs
];

function parseAllowlistEnvVar(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

export interface Config {
  helpscout: {
    apiKey: string;         // Deprecated: kept for backwards compatibility only
    clientId?: string;      // OAuth2 client ID (required)
    clientSecret?: string;  // OAuth2 client secret (required)
    baseUrl: string;
    defaultInboxId?: string; // Optional: default inbox for scoped searches
  };
  airtable: {
    pat?: string;           // Optional: enables pushAttachmentToAirtable; other tools work without it
  };
  inlineImageAllowlist: string[]; // Domains whose images getInlineImage will fetch
  cache: {
    ttlSeconds: number;
    maxSize: number;
  };
  logging: {
    level: string;
  };
  security: {
    allowPii: boolean;
  };
  connectionPool: {
    maxSockets: number;
    maxFreeSockets: number;
    timeout: number;
    keepAlive: boolean;
    keepAliveMsecs: number;
  };
}

export const config: Config = {
  helpscout: {
    // OAuth2 authentication (Client Credentials flow)
    apiKey: process.env.HELPSCOUT_API_KEY || '', // Deprecated, kept for backwards compatibility
    clientId: process.env.HELPSCOUT_APP_ID || process.env.HELPSCOUT_CLIENT_ID || process.env.HELPSCOUT_API_KEY || '',
    clientSecret: process.env.HELPSCOUT_APP_SECRET || process.env.HELPSCOUT_CLIENT_SECRET || '',
    baseUrl: process.env.HELPSCOUT_BASE_URL || 'https://api.helpscout.net/v2/',
    defaultInboxId: process.env.HELPSCOUT_DEFAULT_INBOX_ID,
  },
  airtable: {
    pat: process.env.AIRTABLE_PAT,
  },
  inlineImageAllowlist: [
    ...HARDCODED_INLINE_IMAGE_ALLOWLIST,
    ...parseAllowlistEnvVar(process.env.INLINE_IMAGE_ALLOWLIST),
  ],
  cache: {
    ttlSeconds: parseInt(process.env.CACHE_TTL_SECONDS || '300', 10),
    maxSize: parseInt(process.env.MAX_CACHE_SIZE || '10000', 10),
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },
  security: {
    // Default: show content. Set REDACT_MESSAGE_CONTENT=true to hide message bodies
    // ALLOW_PII=true is backwards compat (always shows content)
    allowPii: process.env.REDACT_MESSAGE_CONTENT !== 'true' || process.env.ALLOW_PII === 'true',
  },
  connectionPool: {
    maxSockets: parseInt(process.env.HTTP_MAX_SOCKETS || '50', 10),
    maxFreeSockets: parseInt(process.env.HTTP_MAX_FREE_SOCKETS || '10', 10),
    timeout: parseInt(process.env.HTTP_SOCKET_TIMEOUT || '30000', 10),
    keepAlive: process.env.HTTP_KEEP_ALIVE !== 'false', // Default to true
    keepAliveMsecs: parseInt(process.env.HTTP_KEEP_ALIVE_MSECS || '1000', 10),
  },
};

export function validateConfig(): void {
  // Check if user is trying to use deprecated Personal Access Token
  if (process.env.HELPSCOUT_API_KEY?.startsWith('Bearer ')) {
    throw new Error(
      'Personal Access Tokens are no longer supported.\n\n' +
      'Help Scout API now requires OAuth2 Client Credentials.\n' +
      'Please migrate your configuration:\n\n' +
      '  OLD (deprecated):\n' +
      '    HELPSCOUT_API_KEY=Bearer your-token\n\n' +
      '  NEW (required):\n' +
      '    HELPSCOUT_APP_ID=your-app-id\n' +
      '    HELPSCOUT_APP_SECRET=your-app-secret\n\n' +
      'Get OAuth2 credentials: Help Scout → My Apps → Create Private App'
    );
  }

  const hasOAuth2 = (config.helpscout.clientId && config.helpscout.clientSecret);

  if (!hasOAuth2) {
    throw new Error(
      'OAuth2 authentication required. Help Scout API only supports OAuth2 Client Credentials flow.\n' +
      'Please provide:\n' +
      '  - HELPSCOUT_APP_ID: Your App ID from Help Scout\n' +
      '  - HELPSCOUT_APP_SECRET: Your App Secret from Help Scout\n\n' +
      'Get these from: Help Scout → My Apps → Create Private App\n\n' +
      'Optional configuration:\n' +
      '  - HELPSCOUT_DEFAULT_INBOX_ID: Default inbox for scoped searches (improves LLM context)'
    );
  }

  // Enforce HTTPS for API base URL to prevent credential exposure
  if (config.helpscout.baseUrl && !config.helpscout.baseUrl.startsWith('https://')) {
    throw new Error(
      'Security Error: HELPSCOUT_BASE_URL must use HTTPS to protect credentials in transit.\n' +
      `Current value: ${config.helpscout.baseUrl}\n` +
      'Please use: https://api.helpscout.net/v2/'
    );
  }

  // Soft check: warn if Airtable PAT is missing (pushAttachmentToAirtable will be unavailable, but other tools still work).
  // Use console.error directly (stderr) to avoid a circular import with logger.ts.
  if (!config.airtable.pat) {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'warn',
      message: 'AIRTABLE_PAT not set — pushAttachmentToAirtable will return an error if called. Other tools work normally.',
    }));
  }

  const customDomains = parseAllowlistEnvVar(process.env.INLINE_IMAGE_ALLOWLIST);
  if (customDomains.length > 0) {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'info',
      message: `INLINE_IMAGE_ALLOWLIST extended with ${customDomains.length} domain(s): ${customDomains.join(', ')}`,
    }));
  }
}