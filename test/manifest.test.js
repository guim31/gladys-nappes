// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG, HOME_RADII, LANGUAGES } from '../src/config.js';
import { SILENCE_DAYS, TRIGGERS, WIDGET_KEY } from '../src/monitor.js';
import { SEARCH_RADII } from '../src/search.js';
import { SITUATIONS } from '../src/situation.js';
import { WIDGETS } from '../src/widgets.js';
import { DAY, LAMASQUERE, LOMBEZ, create, createWorld } from './helpers/world.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Every list of form fields the manifest can declare (same field grammar).
const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

// The handlers the integration actually registers on the SDK.
const { gladys: registered, app } = await createWorld({ connect: false });
await app.stop();
const handlerKeys = (prefix) =>
  Object.keys(registered.handlers)
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length));

const keysOf = (list) => (list ?? []).map((entry) => entry.key);
const optionValues = (field) => field.options.map((option) => option.value);
const field = (list, key) => list.find((entry) => entry.key === key);

function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

test('identity: name, image, cover, cloud transport, environment category', () => {
  assert.equal(manifest.name, 'Nappes phréatiques');
  assert.equal(manifest.type, 'device');
  assert.match(manifest.docker_image, /^ghcr\.io\/guim31\/gladys-nappes:/);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/guim31/gladys-nappes/main/cover.png',
  );
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.deepEqual(manifest.categories, ['environment']);
});

test('"around my house" reads the house location: the manifest declares it', () => {
  assert.equal(manifest.location, true);
});

test('Gladys 5.1.0 at least: widgets and scene triggers', () => {
  const [major, minor] = minGladysVersion();
  assert.ok(major > 5 || (major === 5 && minor >= 1), manifest.gladys_version);
});

test('every manifest action has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.actions).sort(), handlerKeys('action:').sort());
});

test('no scene action: the states and the triggers cover the use', () => {
  assert.equal(manifest.scene_actions, undefined);
  assert.deepEqual(handlerKeys('sceneAction:'), []);
});

test('the scene triggers the monitor fires are declared, with their filters and variables', async (t) => {
  assert.deepEqual(keysOf(manifest.scene_triggers), [TRIGGERS.SITUATION, TRIGGERS.SILENT]);
  const world = await createWorld({ config: { stations: `${LOMBEZ}, ${LAMASQUERE}` } });
  t.after(() => world.app.stop());
  const device = await create(world, LOMBEZ);
  await create(world, LAMASQUERE);
  for (let day = 20; day <= 30; day += 1) {
    world.api.addDaily(LOMBEZ, `2026-10-${day}`, 132.2, 6.71);
  }
  world.clock.advance(18 * DAY);
  await world.monitor.runCycle();
  const keys = new Set(world.fake.sceneEvents.map((event) => event.key));
  assert.deepEqual([...keys].sort(), [TRIGGERS.SITUATION, TRIGGERS.SILENT]);
  for (const event of world.fake.sceneEvents) {
    const trigger = field(manifest.scene_triggers, event.key);
    assert.deepEqual(
      Object.keys(event.data).sort(),
      [...new Set([...keysOf(trigger.fields), ...keysOf(trigger.variables)])].sort(),
      `${event.key}: every declared key, nothing else`,
    );
    for (const filter of trigger.fields.filter((f) => f.type === 'multi_select')) {
      assert.ok(optionValues(filter).includes(event.data[filter.key]), filter.key);
    }
  }
  assert.equal(
    world.fake.sceneEvents.find((event) => event.key === TRIGGERS.SITUATION).data.station,
    device.external_id,
    'the station filter is the device',
  );
  const situation = field(manifest.scene_triggers, TRIGGERS.SITUATION);
  assert.deepEqual(optionValues(field(situation.fields, 'situation')), SITUATIONS);
  const silent = field(manifest.scene_triggers, TRIGGERS.SILENT);
  assert.deepEqual(optionValues(field(silent.fields, 'days')), SILENCE_DAYS);
});

test('every widget has its handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.widgets), [WIDGET_KEY]);
  assert.deepEqual(Object.keys(WIDGETS), [WIDGET_KEY]);
  assert.deepEqual(handlerKeys('widget:'), [WIDGET_KEY]);
});

test('config_schema defaults and options are the ones of the code', () => {
  for (const entry of manifest.config_schema) {
    if (entry.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[entry.key], entry.default, entry.key);
    }
  }
  assert.deepEqual(
    Object.keys(DEFAULT_CONFIG).sort(),
    manifest.config_schema
      .filter((entry) => entry.type !== 'section')
      .map((entry) => entry.key)
      .sort(),
  );
  assert.deepEqual(optionValues(field(manifest.config_schema, 'language')), LANGUAGES);
  assert.deepEqual(optionValues(field(manifest.config_schema, 'around_home')), HOME_RADII);
  const searchFields = field(manifest.actions, 'search_stations').fields;
  assert.deepEqual(optionValues(field(searchFields, 'radius')), SEARCH_RADII);
});

test('section fields are purely presentational', () => {
  for (const section of manifest.config_schema.filter((entry) => entry.type === 'section')) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//);
    }
  }
});

test('dynamic selects declare the devices source and no static options', () => {
  const dynamic = allFields.filter((entry) => entry.source !== undefined);
  assert.equal(dynamic.length, 3);
  for (const entry of dynamic) {
    assert.equal(entry.source, 'devices');
    assert.equal(entry.options, undefined, entry.key);
  }
});

test('number fields have integer bounds (the form has no step)', () => {
  for (const entry of allFields.filter((f) => f.type === 'number')) {
    for (const key of ['min', 'max', 'default']) {
      if (entry[key] !== undefined) {
        assert.ok(Number.isInteger(entry[key]), `${entry.key}.${key}`);
      }
    }
  }
});

test('actions: no secret field, no default, no required field (the core applies no default)', () => {
  // GladysAssistant/Gladys#3154 and #3155.
  for (const action of manifest.actions) {
    for (const entry of action.fields ?? []) {
      assert.notEqual(entry.type, 'secret', `${action.key}.${entry.key}`);
      assert.equal(entry.default, undefined, `${action.key}.${entry.key}`);
      assert.notEqual(entry.required, true, `${action.key}.${entry.key}`);
    }
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version);
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`));
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, `description.${lang}: ${text.length}`);
  }
});
