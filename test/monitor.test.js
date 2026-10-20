// -----------------------------------------------------------------------------
// The monitor end to end, against the SDK's fake Gladys and a fake Hub'Eau
// serving the real captures: which stations are followed, the states, the
// requests made, the scene triggers and the connection status.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRIGGERS } from '../src/monitor.js';
import {
  DAUX,
  DAY,
  HOUSE,
  LAMASQUERE,
  LOMBEZ,
  UPS,
  create,
  createApi,
  createWorld,
  cycle,
  discovered,
  featureId,
} from './helpers/world.js';

const ids = (world) =>
  world.fake.discoveredDevices.map(
    (device) => device.params.find((p) => p.name === 'BSS_ID').value,
  );

test('stations by new and old code, as devices named after their commune', async (t) => {
  const world = await createWorld({ config: { stations: `${LOMBEZ}; 09845c1426/f` } });
  t.after(() => world.app.stop());
  assert.deepEqual(ids(world), [LOMBEZ, UPS]);
  const device = discovered(world, UPS);
  assert.equal(device.name, 'Toulouse – UPS');
  assert.equal(device.should_poll, false);
  assert.deepEqual(device.params.slice(0, 2), [
    { name: 'BSS_ID', value: UPS },
    { name: 'BSS_CODE', value: '09845C1426/F' },
  ]);
  assert.match(device.params[2].value, /^Molasses du bassin de la Garonne/);
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
});

test('a created station gets every state at once, then only what changes', async (t) => {
  const world = await createWorld({ config: { stations: LOMBEZ, language: 'en' } });
  t.after(() => world.app.stop());
  assert.equal(world.fake.states.length, 0, 'nothing before the device exists');
  const device = await create(world, LOMBEZ);
  const state = (key) => world.fake.lastState(featureId(device, key));
  assert.equal(state('depth'), 5.06);
  assert.equal(state('level'), 133.85);
  assert.equal(state('situation_index'), 5);
  assert.equal(state('situation'), 'Very high');
  assert.equal(state('last_measurement'), '19/10/2026');
  assert.ok(world.fake.widgetRefreshes.includes('stations'));

  const published = world.fake.states.length;
  await cycle(world);
  assert.equal(world.fake.states.length, published, 'no new state without a new measurement');

  // A new daily value: depth, level and date change.
  world.api.addDaily(LOMBEZ, '2026-10-20', 133.8, 5.11);
  await cycle(world);
  assert.equal(state('depth'), 5.11);
  assert.equal(state('last_measurement'), '20/10/2026');
});

test('a real-time value of the same day wins, with its time', async (t) => {
  const world = await createWorld({ config: { stations: LOMBEZ } });
  t.after(() => world.app.stop());
  const device = await create(world, LOMBEZ);
  world.api.addDaily(LOMBEZ, '2026-10-20', 133.8, 5.11, { withRealtime: true });
  await cycle(world);
  // 12:00 UTC is 14:00 in Paris (TZ of the Gladys supervisor).
  assert.equal(world.fake.lastState(featureId(device, 'last_measurement')), '20/10/2026 14:00');
});

test('requests: the whole history once, then the last week and the newest real-time value', async (t) => {
  const world = await createWorld({ config: { stations: LOMBEZ } });
  t.after(() => world.app.stop());
  const daily = world.api.calls('chroniques');
  assert.equal(daily.length, 1);
  assert.equal(daily[0].searchParams.get('bss_id'), LOMBEZ);
  assert.equal(daily[0].searchParams.get('size'), '20000');
  assert.equal(daily[0].searchParams.has('date_debut_mesure'), false);
  assert.equal(world.api.calls('chroniques_tr').length, 1);

  await cycle(world);
  const next = world.api.calls('chroniques').at(-1);
  assert.equal(next.searchParams.get('date_debut_mesure'), '2026-10-12');
  assert.equal(world.api.calls('chroniques').length, 2);
  assert.equal(world.api.calls('chroniques_tr').length, 2);
  // The metadata is cached: one station request in all.
  assert.equal(world.api.calls('stations').length, 1);

  // 90 days later, the whole history again.
  world.clock.advance(90 * DAY);
  await world.monitor.runCycle();
  assert.equal(world.api.calls('chroniques').at(-1).searchParams.has('date_debut_mesure'), false);
});

test('a station without real-time values is asked for them once a day only', async (t) => {
  const api = createApi();
  api.realtime[UPS] = [];
  const world = await createWorld({ config: { stations: UPS }, api });
  t.after(() => world.app.stop());
  await cycle(world);
  await cycle(world);
  assert.equal(api.calls('chroniques_tr').length, 1);
  await cycle(world, 12);
  assert.equal(api.calls('chroniques_tr').length, 2);
});

test('situation changed: the trigger fires with the declared data', async (t) => {
  const world = await createWorld({ config: { stations: LOMBEZ, language: 'fr' } });
  t.after(() => world.app.stop());
  const device = await create(world, LOMBEZ);
  assert.equal(world.fake.sceneEvents.length, 0, 'the first situation fires nothing');
  // The water table drops 1.5 m within ten days: very low.
  for (let day = 20; day <= 30; day += 1) {
    world.api.addDaily(LOMBEZ, `2026-10-${day}`, 132.2, 6.71);
  }
  world.clock.advance(11 * DAY);
  await world.monitor.runCycle();
  const events = world.fake.sceneEvents.filter((event) => event.key === TRIGGERS.SITUATION);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].data, {
    station: device.external_id,
    situation: 'very_low',
    station_name: 'Toulouse – LOMBEZ',
    situation_name: 'Très bas',
    previous_situation: 'very_high',
    previous_situation_name: 'Très haut',
    depth: 6.71,
    level: 132.2,
  });
  assert.equal(world.fake.lastState(featureId(device, 'situation_index')), 1);
  await cycle(world);
  assert.equal(world.fake.sceneEvents.length, 1, 'once per change');
});

test('situation changes are remembered across a restart', async (t) => {
  const first = await createWorld({ config: { stations: LOMBEZ } });
  const device = await create(first, LOMBEZ);
  await first.app.stop();
  const api = createApi();
  for (let day = 20; day <= 30; day += 1) {
    api.addDaily(LOMBEZ, `2026-10-${day}`, 132.2, 6.71);
  }
  first.clock.advance(11 * DAY);
  const second = await createWorld({
    config: { stations: LOMBEZ },
    devices: [device],
    api,
    clock: first.clock,
    dataDir: first.dataDir,
  });
  t.after(() => second.app.stop());
  // The history was read from /data: only the last week was asked.
  assert.ok(api.calls('chroniques').every((url) => url.searchParams.has('date_debut_mesure')));
  assert.deepEqual(
    second.fake.sceneEvents.map((event) => event.key),
    [TRIGGERS.SITUATION],
  );
});

test('station silent: fires when 7, 15, 30, 60 days pass, never at first sight', async (t) => {
  const world = await createWorld({ config: { stations: `${LAMASQUERE}, ${UPS}` } });
  t.after(() => world.app.stop());
  const device = await create(world, LAMASQUERE);
  await create(world, UPS);
  // Silent for 42 days when first seen: remembered, not fired.
  assert.equal(world.fake.sceneEvents.length, 0);
  const state = (key) => world.fake.lastState(featureId(device, key));
  assert.equal(state('situation'), 'Inconnue : pas de mesure récente');
  assert.equal(state('depth'), 4.277, 'the last value is kept 45 days');
  assert.equal(state('last_measurement'), '08/09/2026 10:00');

  // Day 60 of the silence.
  world.clock.advance(18 * DAY);
  await world.monitor.runCycle();
  const events = world.fake.sceneEvents.filter(
    (event) => event.key === TRIGGERS.SILENT && event.data.station === device.external_id,
  );
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].data, {
    station: device.external_id,
    days: '60',
    station_name: 'Lamasquère – LAMASQUÈRE',
    last_measurement: '08/09/2026 10:00',
  });
  // UPS gets no new value in the fake: 18 days after its last one, 7 and 15
  // days are crossed together and only the longest fires.
  const ups = world.fake.sceneEvents.filter(
    (event) => event.key === TRIGGERS.SILENT && event.data.station_name === 'Toulouse – UPS',
  );
  assert.deepEqual(
    ups.map((event) => event.data.days),
    ['15'],
  );
  await cycle(world);
  assert.equal(world.fake.sceneEvents.length, 2, 'once per threshold');

  // Depth and level are no longer published as current values.
  const published = world.fake.states.filter(
    (s) => s.device_feature_external_id === featureId(device, 'depth'),
  ).length;
  await cycle(world, 24);
  assert.equal(
    world.fake.states.filter((s) => s.device_feature_external_id === featureId(device, 'depth'))
      .length,
    published,
  );
});

test('a station with no daily value: a device, but no state', async (t) => {
  const world = await createWorld({ config: { stations: DAUX } });
  t.after(() => world.app.stop());
  await create(world, DAUX);
  assert.equal(world.fake.states.length, 0);
});

test('around my house: the 3 nearest stations in service, nothing stored of the house', async (t) => {
  const world = await createWorld({ config: { around_home: '30' } });
  t.after(() => world.app.stop());
  // Lamasquère (silent since September) is not "in service".
  assert.deepEqual(ids(world), [LOMBEZ, UPS, DAUX]);
  const saved = JSON.stringify(world.monitor.data);
  assert.ok(!saved.includes(String(HOUSE.latitude)));
});

test('around my house without a located house, or without a station near it', async (t) => {
  const noHouse = await createWorld({ config: { around_home: '10' }, houses: [] });
  t.after(() => noHouse.app.stop());
  assert.match(noHouse.fake.connectionStatus.message.en, /give your house a location/);
  const far = await createWorld({
    config: { around_home: '10' },
    houses: [{ ...HOUSE, latitude: 48.85, longitude: 2.35 }],
  });
  t.after(() => far.app.stop());
  assert.match(far.fake.connectionStatus.message.en, /no station measuring/);
});

test('unknown and invalid codes are reported in the connection status', async (t) => {
  const world = await createWorld({ config: { stations: 'BSS999ZZZZ, hello, 31555' } });
  t.after(() => world.app.stop());
  const { message } = world.fake.connectionStatus;
  assert.match(message.en, /Unknown station code: BSS999ZZZZ\./);
  assert.match(message.en, /Ignored \(not a station code\): hello, 31555\./);
  assert.match(message.fr, /Code de station inconnu/);
});

test('no station at all: the status says how to start', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  assert.deepEqual(world.fake.connectionStatus.connected, true);
  assert.match(world.fake.connectionStatus.message.en, /Find stations/);
});

test("Hub'Eau down: disconnected with a message, values kept, back when it answers", async (t) => {
  const world = await createWorld({ config: { stations: LOMBEZ } });
  t.after(() => world.app.stop());
  const device = await create(world, LOMBEZ);
  world.api.down = 503;
  await cycle(world);
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.match(world.fake.connectionStatus.message.fr, /Hub'Eau ne répond pas/);
  assert.equal(world.fake.lastState(featureId(device, 'depth')), 5.06);
  world.api.down = false;
  await cycle(world);
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
});

test('a created station stays followed after leaving the configuration, until deleted', async (t) => {
  const world = await createWorld({ config: { stations: `${LOMBEZ}, ${UPS}` } });
  t.after(() => world.app.stop());
  const device = await create(world, UPS);
  await world.fake.configUpdated({ stations: LOMBEZ });
  assert.deepEqual(ids(world), [LOMBEZ, UPS]);
  await world.fake.deviceDeleted(device);
  assert.deepEqual(ids(world), [LOMBEZ]);
  assert.equal(world.monitor.data.history[UPS], undefined, 'its history is dropped');
});

test('poll fallback and reconnection publish the states again', async (t) => {
  const world = await createWorld({ config: { stations: LOMBEZ } });
  t.after(() => world.app.stop());
  const device = await create(world, LOMBEZ);
  const before = world.api.requests.length;
  await world.fake.poll(device);
  assert.equal(world.api.requests.length, before, 'a recent cycle is not run again');
  world.clock.advance(4 * 60 * 60 * 1000);
  await world.fake.poll(device);
  assert.ok(world.api.requests.length > before);

  const states = world.fake.states.length;
  await world.monitor.resync(world.monitor.config);
  assert.ok(world.fake.states.length > states, 'everything published again');
});
