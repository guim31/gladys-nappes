// -----------------------------------------------------------------------------
// What the integration writes to `docker logs`: at info, only the lifecycle
// (the start, a station going silent or coming back, a situation change),
// never one line per refresh cycle; a failure that repeats at every cycle is
// logged once, plus one line when it is over. Never the house coordinates.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOUSE, LOMBEZ, captureLogs, create, createWorld, cycle } from './helpers/world.js';

const strip = (line) => line.text.replace(/^\[[^\]]+\] /, '');

async function followed(t, config = {}) {
  const world = await createWorld({ config: { stations: LOMBEZ, ...config } });
  t.after(() => world.app.stop());
  await create(world, LOMBEZ);
  return world;
}

test('the start is one info line', async (t) => {
  const lines = captureLogs(t, 'info');
  const world = await createWorld({ config: { stations: LOMBEZ } });
  t.after(() => world.app.stop());
  assert.deepEqual(lines.map(strip), [
    '[INFO] [nappes] Started: 1 station(s) followed, refreshed every 6 hours',
  ]);
});

test('a normal refresh cycle writes nothing at info', async (t) => {
  const world = await followed(t);
  const lines = captureLogs(t, 'info');
  for (let day = 20; day <= 23; day += 1) {
    world.api.addDaily(LOMBEZ, `2026-10-${day}`, 133.85, 5.06);
    await cycle(world, 24);
  }
  assert.deepEqual(lines, []);
});

test('LOG_LEVEL=debug shows the cycles, never the house coordinates', async (t) => {
  const lines = captureLogs(t, 'debug');
  const world = await followed(t, { around_home: '20' });
  await cycle(world);
  assert.ok(lines.some((line) => /Refresh cycle: 3 station/.test(line.text)));
  const all = lines.map((line) => line.text).join('\n');
  assert.doesNotMatch(all, new RegExp(String(HOUSE.latitude).replace('.', '\\.')));
  assert.doesNotMatch(all, new RegExp(String(HOUSE.longitude).replace('.', '\\.')));
});

test('a silence and the return of the measurements are one info line each', async (t) => {
  const world = await followed(t);
  const lines = captureLogs(t, 'info');
  for (let i = 0; i < 8 * 4; i += 1) {
    await cycle(world);
  }
  world.api.addDaily(LOMBEZ, '2026-10-28', 133.85, 5.06);
  await cycle(world);
  // The 28/10 value is ranked against other days: the situation may move too.
  const silence = lines.map(strip).filter((line) => !line.includes('groundwater situation'));
  assert.deepEqual(silence, [
    '[INFO] [nappes] Toulouse – LOMBEZ: no new measurement for 7 days',
    '[INFO] [nappes] Toulouse – LOMBEZ: measurements are back',
  ]);
});

test("Hub'Eau down at every cycle: one warning, then one line at recovery", async (t) => {
  const world = await followed(t);
  const lines = captureLogs(t, 'info');
  world.api.down = 503;
  for (let i = 0; i < 4; i += 1) {
    await cycle(world);
  }
  assert.deepEqual(
    lines.map((line) => [line.level, strip(line).replace(/^\[\w+\] /, '')]),
    [['warn', "[nappes] Hub'Eau unreachable: hubeau.eaufrance.fr: HTTP 503"]],
  );
  world.api.down = false;
  await cycle(world);
  assert.deepEqual(lines.slice(1).map(strip), ["[INFO] [nappes] Hub'Eau answers again"]);
});

test('states refused at every cycle: one warning, then one line at recovery', async (t) => {
  const world = await followed(t);
  const lines = captureLogs(t, 'info');
  const publish = t.mock.method(world.gladys, 'publishChangedStates', async () => {
    throw new Error('Gladys unreachable');
  });
  for (let day = 20; day <= 22; day += 1) {
    world.api.addDaily(LOMBEZ, `2026-10-${day}`, 133.85 + day / 1000, 5.06);
    await cycle(world, 24);
  }
  assert.ok(publish.mock.callCount() >= 3);
  assert.deepEqual(
    lines.map((line) => [line.level, strip(line).replace(/^\[\w+\] /, '')]),
    [['warn', '[nappes] Publishing the states failed: Gladys unreachable']],
  );
  publish.mock.restore();
  await cycle(world);
  assert.match(lines.at(-1).text, /\[INFO\].*Publishing the states works again/);
});

test('an unknown station code is one warning, not one per cycle', async (t) => {
  const lines = captureLogs(t, 'info');
  const world = await createWorld({ config: { stations: 'BSS999ZZZZ' } });
  t.after(() => world.app.stop());
  for (let i = 0; i < 6; i += 1) {
    await cycle(world);
  }
  assert.equal(
    lines.filter((line) => /Unknown station code: BSS999ZZZZ/.test(line.text)).length,
    1,
  );
});
