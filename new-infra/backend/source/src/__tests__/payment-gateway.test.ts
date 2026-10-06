import { describe, it, expect } from '@jest/globals';
import { MongikeGateway } from '../services/gateways/mongike.gateway';
import { AnypayGateway } from '../services/gateways/anypay.gateway';
import { ZenoPayMobileGateway } from '../services/gateways/zenopay-mobile.gateway';
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

  it('returns PENDING for ZenoPayMobile status check', async () => {
    const gateway = new ZenoPayMobileGateway('test-key');
    const status = await gateway.getTransactionStatus('order-123');
    expect(status?.status).toBe('PENDING');
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
});
