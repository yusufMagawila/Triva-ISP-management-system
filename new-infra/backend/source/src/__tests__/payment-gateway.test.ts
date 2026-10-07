import { describe, it, expect } from '@jest/globals';
import { AnypayGateway } from '../services/gateways/anypay.gateway';
import { parseAnypayCredentialBundle } from '../services/gateways/anypay.gateway';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('Payment gateway parsing and status mapping', () => {
  it('parses AnyPay bundle formats correctly', () => {
    expect(parseAnypayCredentialBundle('access::apikey')).toEqual({
      accessToken: 'access',
      apiKey: 'apikey',
    });
    expect(parseAnypayCredentialBundle('onlykey')).toEqual({
      accessToken: '',
      apiKey: 'onlykey',
    });
    expect(parseAnypayCredentialBundle('{"accessToken":"a","apiKey":"b"}')).toEqual({
      accessToken: 'a',
      apiKey: 'b',
    });
  });

  it('maps AnyPay completed status', async () => {
    mockedAxios.create.mockReturnValue({
      get: jest.fn().mockResolvedValue({
        data: { data: { selcom_payment_status: 'COMPLETED', selcom_transid: 'txn-1' } },
      }),
    } as any);
    const gateway = new AnypayGateway('access::apikey');
    const status = await gateway.getTransactionStatus('order-123');
    expect(status?.status).toBe('SUCCESS');
    expect(status?.transaction_id).toBe('txn-1');
  });

  it('maps AnyPay failed/cancelled/pending statuses', async () => {
    const get = jest.fn()
      .mockResolvedValueOnce({ data: { data: { selcom_payment_status: 'FAILED' } } })
      .mockResolvedValueOnce({ data: { data: { selcom_payment_status: 'CANCELLED' } } })
      .mockResolvedValueOnce({ data: { data: { selcom_payment_status: 'PENDING' } } });
    mockedAxios.create.mockReturnValue({ get } as any);
    const gateway = new AnypayGateway('access::apikey');
    expect((await gateway.getTransactionStatus('o1'))?.status).toBe('FAILED');
    expect((await gateway.getTransactionStatus('o2'))?.status).toBe('CANCELLED');
    expect((await gateway.getTransactionStatus('o3'))?.status).toBe('PENDING');
  });
});
