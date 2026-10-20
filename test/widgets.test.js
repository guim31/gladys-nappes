// -----------------------------------------------------------------------------
// The `stations` widget: valid content for the core, within its budget (8
// components, 2 texts), bound to features that exist, in the four languages.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { LANGUAGES } from '../src/config.js';
import { EAUNES, LAMASQUERE, LOMBEZ, UPS, create, createWorld } from './helpers/world.js';

const get = async (world, settings = {}, language = 'en') =>
  (await world.fake.widgetGet('stations', { settings, language })).data.content;

function checkBudget(content, devices) {
  validateWidgetContent(content);
  assert.ok(content.components.length <= 8);
  assert.ok(content.components.filter((c) => c.type === 'text').length <= 2);
  const known = new Set(devices.flatMap((d) => d.features.map((f) => f.external_id)));
  for (const component of content.components.filter((c) => c.device_feature)) {
    assert.ok(known.has(component.device_feature), component.device_feature);
  }
  for (const item of content.components.flatMap((c) => c.items ?? [])) {
    assert.ok(String(item.value).length <= 40, item.value);
  }
}

test('without a station: how to start', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const content = await get(world, {}, 'fr');
  assert.match(content.components[0].text, /^Aucune station/);
});

test('overview: one line per station, coloured by its situation', async (t) => {
  const world = await createWorld({
    config: { stations: `${LOMBEZ}, ${UPS}, ${EAUNES}, ${LAMASQUERE}` },
  });
  t.after(() => world.app.stop());
  const devices = [];
  for (const id of [LOMBEZ, UPS, EAUNES, LAMASQUERE]) {
    devices.push(await create(world, id));
  }
  for (const language of LANGUAGES) {
    checkBudget(await get(world, {}, language), devices);
  }
  const content = await get(world, {}, 'fr');
  const [status, caption, button] = content.components;
  assert.deepEqual(
    status.items.map((item) => [item.value, item.color, item.icon]),
    [
      ['5,06 m · Très haut', 'info', 'minus'],
      ['5,05 m · Normal', 'success', 'minus'],
      ['14,95 m · Très bas', 'danger', 'trending-down'],
      ['4,28 m', 'neutral', 'clock'],
    ],
  );
  assert.equal(caption.text, "Source : Hub'Eau, ADES (BRGM) · 19/10/2026");
  assert.equal(button.link.url, 'https://ades.eaufrance.fr');
});

test('one station: live tiles, situation, trend, last measurement and its ADES page', async (t) => {
  const world = await createWorld({ config: { stations: `${LOMBEZ}, ${LAMASQUERE}` } });
  t.after(() => world.app.stop());
  const device = await create(world, LOMBEZ);
  const silent = await create(world, LAMASQUERE);
  for (const language of LANGUAGES) {
    checkBudget(await get(world, { station: device.external_id }, language), [device]);
  }
  const content = await get(world, { station: device.external_id }, 'en');
  const status = content.components.find((c) => c.type === 'status');
  assert.deepEqual(
    status.items.map((item) => item.value),
    ['Very high', 'steady', '19/10/2026'],
  );
  assert.equal(
    content.components.at(-1).link.url,
    'https://ades.eaufrance.fr/Fiche/PtEau?Code=09838D0727/F',
  );
  const old = await get(world, { station: silent.external_id }, 'fr');
  const items = old.components.find((c) => c.type === 'status').items;
  assert.equal(items[0].value, 'Inconnue : pas de mesure récente');
  assert.equal(items[2].color, 'success', 'still within 45 days');

  const gone = await get(world, { station: 'nappes:station:BSS000NONE' }, 'de');
  assert.equal(gone.components[0].text, 'Diese Station wird nicht mehr verfolgt.');
});
