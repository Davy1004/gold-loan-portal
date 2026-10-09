import { describe, expect, it } from 'vitest';
import { formatDay, formatRupees } from './format';
import { EMPTY_FORM, SERVER_FIELD_MAP, detailsStepValid, parseWeights, validate, type FormValues } from './validation';

const ok: FormValues = { name: 'Ravi Kumar', mobile: '9876543210', gross: '50', net: '45', karat: '22', planId: 'PLAN_EMI_01' };

describe('client validation mirrors the API rules', () => {
  it('accepts a valid form', () => {
    expect(validate(ok)).toEqual({});
    expect(detailsStepValid(ok)).toBe(true);
  });
  it('flags every empty field', () => {
    const e = validate(EMPTY_FORM);
    expect(Object.keys(e).sort()).toEqual(['gross', 'karat', 'mobile', 'name', 'net', 'planId']);
  });
  it('mobile: must start 6-9 and be 10 digits', () => {
    expect(validate({ ...ok, mobile: '5876543210' }).mobile).toBeTruthy();
    expect(validate({ ...ok, mobile: '98765' }).mobile).toBeTruthy();
    expect(validate({ ...ok, mobile: '6876543210' }).mobile).toBeUndefined();
  });
  it('name: letters and single spaces, 2-60 chars', () => {
    expect(validate({ ...ok, name: 'R' }).name).toBeTruthy();
    expect(validate({ ...ok, name: 'Ravi 2' }).name).toBeTruthy();
    expect(validate({ ...ok, name: 'A'.repeat(61) }).name).toBeTruthy();
    expect(validate({ ...ok, name: '  Ravi Kumar ' }).name).toBeUndefined();
  });
  it('net above gross is an error on the net field', () => {
    expect(validate({ ...ok, net: '52', gross: '50' }).net).toMatch(/cannot be more than gross/);
  });
  it('weights: >0, <=1000, max 3 decimals, numeric', () => {
    expect(validate({ ...ok, net: '0' }).net).toBeTruthy();
    expect(validate({ ...ok, gross: '1001' }).gross).toBeTruthy();
    expect(validate({ ...ok, net: '1.2345' }).net).toBeTruthy();
    expect(validate({ ...ok, net: 'abc' }).net).toBeTruthy();
    expect(validate({ ...ok, net: '12.345', gross: '13' }).net).toBeUndefined();
  });
  it('parseWeights returns numbers only when weights and karat are valid', () => {
    expect(parseWeights(ok)).toEqual({ grossWeightGrams: 50, netWeightGrams: 45, karat: 22 });
    expect(parseWeights({ ...ok, net: '52' })).toBeNull();
    expect(parseWeights({ ...ok, karat: '' })).toBeNull();
  });
  it('maps API field names back to form fields', () => {
    expect(SERVER_FIELD_MAP.mobileNumber).toBe('mobile');
    expect(SERVER_FIELD_MAP.netWeightGrams).toBe('net');
    expect(SERVER_FIELD_MAP.grossWeightGrams).toBe('gross');
  });
});

describe('formatting', () => {
  it('uses Indian digit grouping', () => {
    expect(formatRupees(216562)).toBe('₹2,16,562');
    expect(formatRupees('288750.00')).toBe('₹2,88,750');
  });
  it('formats a day like "3 Oct"', () => {
    expect(formatDay('2026-10-03T08:00:00.000Z')).toMatch(/3 Oct/);
  });
});
