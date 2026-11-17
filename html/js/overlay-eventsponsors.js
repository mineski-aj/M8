/* html/js/overlay-eventsponsors.js — per-country event sponsors for the Ingame overlay.
   GET /api/event-sponsors?set=<this page's SponsorSet> -> { events: { doublekill, triplekill, turtleslain, golddiff } }, each value
   '' (no sponsor on that event) | 'builtin' (golddiff only: the themed chip that ships with the overlay) | an image URL under
   assets/sponsor/<SET>/events/.  Edited per set in the dashboard's Sponsors tab.  Re-read every 20s so a dashboard save reaches a
   live page without a reload.  Needs html/js/sponsor-set.js loaded first.

     EventSponsors.get('doublekill')     -> current value for that slot ('' until loaded)
     EventSponsors.onChange(fn)          -> fn() runs after every load whose values differ from the previous ones (and once on first load) */
var EventSponsors = (function () {
  var events = {}, listeners = [], last = '';
  function load() {
    fetch('/api/event-sponsors' + SponsorSet.qs(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.events) return;
        var sig = JSON.stringify(d.events);
        if (sig === last) return;
        last = sig; events = d.events;
        listeners.forEach(function (fn) { try { fn(); } catch (e) {} });
      }).catch(function () {});
  }
  load(); setInterval(load, 20000);
  return {
    get: function (slot) { return events[slot] || ''; },
    onChange: function (fn) { listeners.push(fn); if (last) { try { fn(); } catch (e) {} } },
  };
})();
