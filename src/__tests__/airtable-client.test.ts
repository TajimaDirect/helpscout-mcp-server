import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import nock from 'nock';
import { AirtableClient } from '../utils/airtable-client.js';

describe('AirtableClient', () => {
  const baseURL = 'https://content.airtable.com/v0';

  beforeEach(() => {
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('uploads attachment with bearer auth and returns the record', async () => {
    let receivedBody: unknown;
    let receivedAuth: string | undefined;

    nock(baseURL)
      .post('/appBASE123/recREC456/fldFIELD789/uploadAttachment', (body) => {
        receivedBody = body;
        return true;
      })
      .matchHeader('authorization', (val: string) => {
        receivedAuth = val;
        return true;
      })
      .reply(200, {
        id: 'recREC456',
        createdTime: '2026-04-28T12:00:00.000Z',
        fields: { Photo: [{ id: 'attXYZ', filename: 'photo.jpg' }] },
      });

    const client = new AirtableClient('patSECRET123');
    const result = await client.uploadAttachment({
      baseId: 'appBASE123',
      recordId: 'recREC456',
      fieldId: 'fldFIELD789',
      filename: 'photo.jpg',
      contentType: 'image/jpeg',
      base64: Buffer.from('fake-image-bytes').toString('base64'),
    });

    expect(result.id).toBe('recREC456');
    expect(receivedAuth).toBe('Bearer patSECRET123');
    expect(receivedBody).toEqual({
      contentType: 'image/jpeg',
      file: Buffer.from('fake-image-bytes').toString('base64'),
      filename: 'photo.jpg',
    });
  });

  it('throws a clear error when PAT is undefined', async () => {
    const client = new AirtableClient(undefined);

    await expect(
      client.uploadAttachment({
        baseId: 'appBASE',
        recordId: 'recREC',
        fieldId: 'fldFLD',
        filename: 'x.jpg',
        contentType: 'image/jpeg',
        base64: 'aGVsbG8=',
      })
    ).rejects.toThrow(/AIRTABLE_PAT/);
  });

  it('surfaces Airtable error response body when API returns 422', async () => {
    nock(baseURL)
      .post('/appBASE/recREC/fldFLD/uploadAttachment')
      .reply(422, { error: { type: 'INVALID_FIELD', message: 'Invalid field' } });

    const client = new AirtableClient('patABC');

    await expect(
      client.uploadAttachment({
        baseId: 'appBASE',
        recordId: 'recREC',
        fieldId: 'fldFLD',
        filename: 'x.jpg',
        contentType: 'image/jpeg',
        base64: 'aGVsbG8=',
      })
    ).rejects.toThrow(/Airtable upload failed \(422\)/);
  });

  it('propagates a network-level error', async () => {
    nock(baseURL)
      .post('/appBASE/recREC/fldFLD/uploadAttachment')
      .replyWithError('socket hang up');

    const client = new AirtableClient('patABC');

    await expect(
      client.uploadAttachment({
        baseId: 'appBASE',
        recordId: 'recREC',
        fieldId: 'fldFLD',
        filename: 'x.jpg',
        contentType: 'image/jpeg',
        base64: 'aGVsbG8=',
      })
    ).rejects.toThrow(/socket hang up/);
  });
});
