// -----------------------------------------------------------------------------
// Normalization of the configuration and of the station codes.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, parseStationCodes } from '../src/config.js';

test('defaults', () => {
  assert.deepEqual(normalizeConfig(), {
    stationCodes: [],
    invalid: [],
    homeRadiusKm: 0,
    language: 'fr',
  });
  assert.deepEqual(normalizeConfig(DEFAULT_CONFIG), normalizeConfig({}));
});

test('station codes: new and old, upper-cased, without duplicates', () => {
  // Real old codes, designations included (ADES).
  const text =
    'bss002fvwc, 09838D0727/F;02201X0105/H2(S7) 01837A0569/SEINE- 01586X0064/F.E.D. BSS002FVWC';
  assert.deepEqual(parseStationCodes(text), {
    codes: [
      'BSS002FVWC',
      '09838D0727/F',
      '02201X0105/H2(S7)',
      '01837A0569/SEINE-',
      '01586X0064/F.E.D.',
    ],
    invalid: [],
  });
  assert.deepEqual(parseStationCodes('BSS12, 31555, https://example.org').invalid, [
    'BSS12',
    '31555',
    'https://example.org',
  ]);
});

test('unknown values fall back to the defaults', () => {
  const config = normalizeConfig({ around_home: '7', language: 'it', stations: 42 });
  assert.equal(config.homeRadiusKm, 0);
  assert.equal(config.language, 'fr');
  assert.deepEqual(normalizeConfig({ around_home: '50', language: 'de' }).homeRadiusKm, 50);
});
