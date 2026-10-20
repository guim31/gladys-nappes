// -----------------------------------------------------------------------------
// The "Find stations" action: what can be typed, and the list it answers.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery } from '../src/search.js';
import { LOMBEZ, createWorld } from './helpers/world.js';

test('the query is the house, a station code, a commune or a department', () => {
  assert.deepEqual(parseQuery(''), { kind: 'house', value: null });
  assert.deepEqual(parseQuery(' bss002fvwc '), { kind: 'station', value: LOMBEZ });
  assert.deepEqual(parseQuery('09838D0727/F'), { kind: 'station', value: '09838D0727/F' });
  assert.deepEqual(parseQuery('31555'), { kind: 'commune', value: '31555' });
  assert.deepEqual(parseQuery('2a004'), { kind: 'commune', value: '2A004' });
  assert.deepEqual(parseQuery('31'), { kind: 'department', value: '31' });
  assert.deepEqual(parseQuery('974'), { kind: 'department', value: '974' });
  assert.equal(parseQuery('Toulouse').kind, 'invalid');
});

const search = async (world, fields) =>
  (await world.fake.action('search_stations', fields)).data.message;

test('around the house: the stations in service, nearest first, with their codes', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const message = await search(world, { radius: '30' });
  const lines = message.fr.split('\n');
  assert.match(lines[0], /^4 station\(s\), les plus proches d'abord/);
  assert.match(
    lines[1],
    /^BSS002FVWC — Toulouse – LOMBEZ, 2,1 km, depuis 1997, dernière mesure le 16\/10\/2026$/,
  );
  assert.ok(!message.fr.includes('BSS002HSFG'), 'Lamasquère is no longer in service');
  assert.match(message.en, /^4 station\(s\), nearest first/);
  assert.match(message.de, /letzte Messung am/);
  assert.match(message.es, /última medición el/);
});

test('a commune lists its stations in service first, then the old ones', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const message = await search(world, { query: '31269' });
  assert.match(message.en, /BSS002HSFG — Lamasquère – LAMASQUÈRE/);
});

test('by code, by department, and the failures', async (t) => {
  const world = await createWorld({ houses: [] });
  t.after(() => world.app.stop());
  assert.match((await search(world, { query: '09838D0727/F' })).en, /^1 station/);
  assert.match((await search(world, { query: '31' })).en, /^4 station/);
  assert.match((await search(world, {})).en, /no location in Gladys/);
  assert.match((await search(world, { query: 'Toulouse' })).en, /^Not understood/);
  assert.equal((await search(world, { query: '75' })).en, 'No station found.');
  world.api.down = 'network';
  assert.match((await search(world, { query: '31' })).fr, /Hub'Eau ne répond pas/);
});
