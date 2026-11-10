import test from 'node:test'; import assert from 'node:assert/strict';
import { regionsForCountry } from '../src/institutions.js';
test('India region data includes states and union territories without inventing institutions', () => { const regions = regionsForCountry('IN'); assert.equal(regions.length, 36); assert.ok(regions.includes('Delhi')); assert.ok(regions.includes('Tamil Nadu')); });
test('unsupported country codes fail safely to an empty region list', () => assert.deepEqual(regionsForCountry('ZZ'), []));
