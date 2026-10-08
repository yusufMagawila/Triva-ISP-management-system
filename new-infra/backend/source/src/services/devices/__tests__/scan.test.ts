import { describe, it, expect } from '@jest/globals';
import { normalizeScannedPayload } from '../device.service';

describe('normalizeScannedPayload', () => {
  it('parses a bare hex serial label', () => {
    const r = normalizeScannedPayload('F43E0FEFA14C');
    expect(r.serialNumber).toBe('F43E0FEFA14C');
  });

  it('parses a MAC label with colons', () => {
    const r = normalizeScannedPayload('dc:2c:6e:c9:d9:b0');
    expect(r.macAddress).toBe('dc:2c:6e:c9:d9:b0');
  });

  it('parses labeled serial+MAC text', () => {
    const r = normalizeScannedPayload('MIKROTIK S/N: F43E0FEFA14C MAC: dc:2c:6e:c9:d9:b0');
    expect(r.serialNumber).toBe('F43E0FEFA14C');
    expect(r.macAddress).toBe('dc:2c:6e:c9:d9:b0');
    expect(r.vendorHint).toBe('MIKROTIK');
  });

  it('parses a JSON QR payload', () => {
    const r = normalizeScannedPayload(JSON.stringify({
      vendor: 'MikroTik', model: 'hAP ac lite', serial: 'f43e0fefa14c', mac: 'dc-2c-6e-c9-d9-b0',
    }));
    expect(r.serialNumber).toBe('F43E0FEFA14C');
    expect(r.macAddress).toBe('dc:2c:6e:c9:d9:b0');
    expect(r.vendorHint).toBe('MIKROTIK');
    expect(r.modelHint).toBe('hAP ac lite');
  });

  it('preserves the raw payload as barcodeValue', () => {
    const r = normalizeScannedPayload('SOME-BARCODE-123');
    expect(r.barcodeValue).toBe('SOME-BARCODE-123');
  });

  it('detects Omada vendor hint', () => {
    const r = normalizeScannedPayload('TP-LINK OMADA EAP225 S/N: 2233AA');
    expect(r.vendorHint).toBe('OMADA');
  });

  it('rejects empty and oversized payloads', () => {
    expect(() => normalizeScannedPayload('   ')).toThrow();
    expect(() => normalizeScannedPayload('x'.repeat(600))).toThrow();
  });
});
