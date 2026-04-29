import axios, { AxiosInstance } from 'axios';
import { logger } from './logger.js';
import { config } from './config.js';

const AIRTABLE_CONTENT_BASE_URL = 'https://content.airtable.com/v0';

export interface AirtableUploadAttachmentInput {
  baseId: string;
  recordId: string;
  fieldId: string;
  filename: string;
  contentType: string;
  base64: string;
}

export interface AirtableUploadAttachmentResponse {
  id: string;
  createdTime: string;
  fields: Record<string, unknown>;
}

export class AirtableClient {
  private readonly client: AxiosInstance;
  private readonly pat: string | undefined;

  constructor(pat: string | undefined) {
    this.pat = pat;
    this.client = axios.create({
      baseURL: AIRTABLE_CONTENT_BASE_URL,
      timeout: 60_000,
    });
  }

  async uploadAttachment(input: AirtableUploadAttachmentInput): Promise<AirtableUploadAttachmentResponse> {
    if (!this.pat) {
      throw new Error(
        'AIRTABLE_PAT environment variable is not configured. pushAttachmentToAirtable cannot be used until this is set.'
      );
    }

    const url = `/${input.baseId}/${input.recordId}/${input.fieldId}/uploadAttachment`;

    logger.debug('airtable upload starting', {
      baseId: input.baseId,
      recordId: input.recordId,
      fieldId: input.fieldId,
      filename: input.filename,
      contentType: input.contentType,
      base64Length: input.base64.length,
    });

    try {
      const response = await this.client.post<AirtableUploadAttachmentResponse>(
        url,
        {
          contentType: input.contentType,
          file: input.base64,
          filename: input.filename,
        },
        {
          headers: {
            Authorization: `Bearer ${this.pat}`,
            'Content-Type': 'application/json',
          },
        }
      );

      logger.debug('airtable upload succeeded', { recordId: response.data.id });
      return response.data;
    } catch (error: unknown) {
      if (axios.isAxiosError(error) && error.response) {
        const status = error.response.status;
        const data = error.response.data as unknown;
        let detail: string;
        if (data && typeof data === 'object' && 'error' in data) {
          detail = JSON.stringify((data as { error: unknown }).error);
        } else {
          detail = `HTTP ${status}`;
        }
        throw new Error(`Airtable upload failed (${status}): ${detail}`);
      }
      throw error;
    }
  }
}

export const airtableClient = new AirtableClient(config.airtable.pat);
