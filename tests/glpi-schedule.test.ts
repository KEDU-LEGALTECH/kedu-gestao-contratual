import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dailySyncTimes,scheduledSlot,latestDueSlot} from '../server/glpi-schedule.js';
test('daily GLPI sync uses Brasilia time and only configured minutes',()=>{
 const times=dailySyncTimes('07:00,12:00,16:00,07:00');
 assert.deepEqual(times,['07:00','12:00','16:00']);
 for(const hour of [10,15,19]) assert.ok(scheduledSlot(new Date(`2026-10-23T${hour}:00:30Z`),times));
 assert.equal(scheduledSlot(new Date('2026-10-23T10:01:00Z'),times),null);
 assert.equal(scheduledSlot(new Date('2026-10-23T07:00:00Z'),times),null);
 assert.throws(()=>dailySyncTimes('25:00'));
});
test('missed runs catch up once on startup, including previous day',()=>{
 const times=['07:00','12:00','16:00'];
 assert.equal(latestDueSlot(new Date('2026-10-26T13:30:00Z'),times),'2026-10-26T07:00');
 assert.equal(latestDueSlot(new Date('2026-10-26T18:30:00Z'),times),'2026-10-26T12:00');
 assert.equal(latestDueSlot(new Date('2026-10-26T09:30:00Z'),times),'2026-10-25T16:00');
 assert.equal(latestDueSlot(new Date('2026-11-01T09:30:00Z'),times),'2026-10-31T16:00');
 assert.equal(latestDueSlot(new Date(),[]),null);
});
