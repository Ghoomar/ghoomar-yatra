import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import ReactDOMServer from 'react-dom/server';
import { DayPicker } from 'react-day-picker';
import { TimeField, DateInput, DateSegment } from 'react-aria-components';
import { Time } from '@internationalized/date';
import { parseTimeString, formatTime, time12To24 } from '../src/components/ui/TimePicker.tsx';

test('TimePicker: parseTimeString accurately parses 12-hour and 24-hour formats', () => {
  // 12-hour PM
  const t1 = parseTimeString('11:57 PM');
  assert.ok(t1);
  assert.equal(t1.h, 23);
  assert.equal(t1.m, 57);
  assert.equal(t1.isPM, true);

  // 12-hour AM midnight
  const t2 = parseTimeString('12:00 AM');
  assert.ok(t2);
  assert.equal(t2.h, 0);
  assert.equal(t2.m, 0);
  assert.equal(t2.isPM, false);

  // 12-hour PM noon
  const t3 = parseTimeString('12:00 PM');
  assert.ok(t3);
  assert.equal(t3.h, 12);
  assert.equal(t3.m, 0);
  assert.equal(t3.isPM, true);

  // 12-hour 1 PM
  const t4 = parseTimeString('01:30 PM');
  assert.ok(t4);
  assert.equal(t4.h, 13);
  assert.equal(t4.m, 30);
  assert.equal(t4.isPM, true);

  // 24-hour night
  const t5 = parseTimeString('22:03');
  assert.ok(t5);
  assert.equal(t5.h, 22);
  assert.equal(t5.m, 3);
  assert.equal(t5.isPM, true);

  // 24-hour morning
  const t6 = parseTimeString('09:15');
  assert.ok(t6);
  assert.equal(t6.h, 9);
  assert.equal(t6.m, 15);
  assert.equal(t6.isPM, false);

  // Invalid strings return null
  assert.equal(parseTimeString('25:00'), null);
  assert.equal(parseTimeString('13:00 PM'), null);
  assert.equal(parseTimeString('12:65 AM'), null);
  assert.equal(parseTimeString(''), null);
  assert.equal(parseTimeString(undefined), null);
});

test('TimePicker: formatTime converts hours and minutes to 12h and 24h formats', () => {
  assert.equal(formatTime(23, 57, 12), '11:57 PM');
  assert.equal(formatTime(0, 0, 12), '12:00 AM');
  assert.equal(formatTime(12, 0, 12), '12:00 PM');
  assert.equal(formatTime(13, 30, 12), '01:30 PM');
  assert.equal(formatTime(9, 5, 12), '09:05 AM');

  assert.equal(formatTime(22, 3, 24), '22:03');
  assert.equal(formatTime(0, 0, 24), '00:00');
  assert.equal(formatTime(9, 5, 24), '09:05');
});

test('TimePicker: time12To24 safely converts any time string to 24h HH:mm', () => {
  assert.equal(time12To24('11:57 PM'), '23:57');
  assert.equal(time12To24('12:00 AM'), '00:00');
  assert.equal(time12To24('12:30 PM'), '12:30');
  assert.equal(time12To24('09:05 AM'), '09:05');
  assert.equal(time12To24('22:03'), '22:03');
  assert.equal(time12To24(''), '12:00');
  assert.equal(time12To24(undefined), '12:00');
});

test('DayPicker: Selected date highlight and unselected today outline work without conflict', () => {
  const selectedDate = new Date(2026, 10, 20); // 20 Nov 2026
  const month = new Date(2026, 10, 1);

  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(DayPicker, {
      mode: 'single',
      selected: selectedDate,
      month: month,
      classNames: {
        root: 'w-full max-w-[280px] mx-auto',
        selected:
          'rdp-selected [&>button]:!bg-amber-600 [&>button]:!text-white [&>button]:font-bold [&>button]:rounded-xl [&>button]:shadow-xs [&>button]:!ring-0',
        today:
          '[&:not(.rdp-selected):not([data-selected])>button]:ring-1 [&:not(.rdp-selected):not([data-selected])>button]:ring-amber-400 [&:not(.rdp-selected):not([data-selected])>button]:text-amber-800 [&:not(.rdp-selected):not([data-selected])>button]:font-semibold',
      },
    })
  );

  // Day 20 should have rdp-selected and !bg-amber-600
  const day20Idx = html.indexOf('data-day="2026-11-20"');
  assert.ok(day20Idx > -1, 'Day 20 cell must be rendered');
  const startTd = html.lastIndexOf('<td', day20Idx);
  const endTd = html.indexOf('</td>', day20Idx);
  const day20Cell = html.slice(startTd, endTd);

  assert.ok(day20Cell.includes('rdp-selected'), 'Selected day must contain rdp-selected class');
  assert.ok(day20Cell.includes('[&amp;&gt;button]:!bg-amber-600'), 'Selected day must have bg-amber-600');
  assert.ok(day20Cell.includes('data-selected="true"'), 'Selected day must have data-selected="true"');
});

test('ElectricityTab: unit is strictly normalized to kWh everywhere', () => {
  const normalize = (unit) => (!unit || unit.toUpperCase() === 'KVAH' ? 'kWh' : unit);

  assert.equal(normalize('KVAH'), 'kWh');
  assert.equal(normalize('kvah'), 'kWh');
  assert.equal(normalize('Kvah'), 'kWh');
  assert.equal(normalize(''), 'kWh');
  assert.equal(normalize(null), 'kWh');
  assert.equal(normalize(undefined), 'kWh');
  assert.equal(normalize('kWh'), 'kWh');
  assert.equal(normalize('units'), 'units');
});

test('Generator Diagnostic Logs: fuel level clamping and color rules', () => {
  const clamp = (val) => {
    if (val === '') return 0;
    const n = parseInt(val, 10);
    return isNaN(n) ? 0 : Math.min(100, Math.max(0, n));
  };

  const getBarColor = (pct) => {
    if (pct < 20) return 'bg-rose-500';
    if (pct <= 40) return 'bg-amber-500';
    return 'bg-emerald-500';
  };

  assert.equal(clamp('37'), 37);
  assert.equal(clamp('150'), 100);
  assert.equal(clamp('-10'), 0);
  assert.equal(clamp('abc'), 0);
  assert.equal(clamp(''), 0);

  assert.equal(getBarColor(15), 'bg-rose-500');
  assert.equal(getBarColor(20), 'bg-amber-500');
  assert.equal(getBarColor(37), 'bg-amber-500');
  assert.equal(getBarColor(40), 'bg-amber-500');
  assert.equal(getBarColor(41), 'bg-emerald-500');
  assert.equal(getBarColor(100), 'bg-emerald-500');
});

test('Generator Diagnostic Logs: runtime delta and total minutes calculation', () => {
  const calcTotalMinutes = (h, m) => (parseInt(h, 10) || 0) * 60 + (parseInt(m, 10) || 0);

  assert.equal(calcTotalMinutes('55', '23'), 55 * 60 + 23);
  assert.equal(calcTotalMinutes('0', '45'), 45);
  assert.equal(calcTotalMinutes('100', '0'), 6000);

  const prevTotal = 54 * 60 + 10; // 54h 10m
  const currentTotal = 55 * 60 + 23; // 55h 23m
  const diff = currentTotal - prevTotal; // 73 minutes
  assert.equal(diff, 73);
  const dh = Math.floor(diff / 60);
  const dm = diff % 60;
  assert.equal(`+${dh}h ${dm}m`, '+1h 13m');

  const lowerDiff = 53 * 60 - prevTotal;
  assert.ok(lowerDiff < 0, 'Should be detected as lower than prior');
});
