/* Console — lib/format.js
   Small date/number helpers shared across modules. Kept deliberately minimal for Phase 1 —
   modules that need more (recurrence math, FX conversion, etc.) add their own lib files
   in later phases rather than growing this one into a grab-bag. */
(function () {
  'use strict';
  window.Console = window.Console || {};
  Console.lib = Console.lib || {};

  var WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  var WEEKDAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  // YYYY-MM-DD in local time (IndexedDB date indexes are stored as this string form)
  function isoDate(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function todayISO() { return isoDate(new Date()); }

  function longWeekday(d) { return WEEKDAYS_FULL[d.getDay()]; }

  function monthDay(d) { return MONTHS[d.getMonth()] + ' ' + d.getDate(); }

  function timeHM(d) { return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }

  // Monday-start week containing `d`, returned as 7 Date objects
  function weekOf(d) {
    var day = d.getDay(); // 0=sun..6=sat
    var mondayOffset = day === 0 ? -6 : 1 - day;
    var monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + mondayOffset);
    var out = [];
    for (var i = 0; i < 7; i++) {
      out.push(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i));
    }
    return out;
  }

  function weekdayAbbr(d) { return WEEKDAYS[d.getDay()]; }

  function isWeekend(d) { var day = d.getDay(); return day === 0 || day === 6; }

  function sameDate(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  // ISO-string date math, added in Phase 2 (Tasks) — shared here instead of duplicated per
  // module, since Tasks/Today's capture parser and Tasks' own date-bucket grouping both need it.
  function addDaysISO(iso, n) {
    var d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return isoDate(d);
  }

  function daysBetweenISO(fromISO, toISO) {
    var a = new Date(fromISO + 'T00:00:00');
    var b = new Date(toISO + 'T00:00:00');
    return Math.round((b - a) / 86400000);
  }

  // Next occurrence (today counts as "next") of `targetDow` (0=Sun..6=Sat) on/after `fromDate`.
  function nextWeekdayISO(targetDow, fromDate) {
    var cur = fromDate.getDay();
    var delta = (targetDow - cur + 7) % 7;
    var d = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate() + delta);
    return isoDate(d);
  }

  Console.lib.format = {
    isoDate: isoDate,
    todayISO: todayISO,
    longWeekday: longWeekday,
    monthDay: monthDay,
    timeHM: timeHM,
    weekOf: weekOf,
    weekdayAbbr: weekdayAbbr,
    isWeekend: isWeekend,
    sameDate: sameDate,
    addDaysISO: addDaysISO,
    daysBetweenISO: daysBetweenISO,
    nextWeekdayISO: nextWeekdayISO
  };
})();
