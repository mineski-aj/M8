/* html/js/sponsor-set.js — which sponsor set (country feed) this page shows: MAIN | ID | MY | PH.
   Taken from the page URL (?set=ID), default MAIN, anything else falls back to MAIN. Every sponsor fetch on a page
   must carry it:   fetch('/api/sponsors' + SponsorSet.qs())   /   fetch('/api/sponsors?ingame=1' + SponsorSet.qs(true))
   One browser source per country, e.g.  /html/postgame.html?set=MY  and  /html/ingame.html?set=MY
   (each set has its own logos in assets/sponsor/<SET>/ and its own categories/order edited in the dashboard's Sponsors tab). */
(function () {
  var SETS = ['MAIN', 'ID', 'MY', 'PH'];
  var q = '';
  try { q = (new URLSearchParams(location.search).get('set') || '').toUpperCase(); } catch (e) {}
  var name = SETS.indexOf(q) !== -1 ? q : 'MAIN';
  window.SponsorSet = {
    sets: SETS,
    name: name,
    /* "?set=ID" for a URL with no query yet, "&set=ID" when appended (pass true) */
    qs: function (append) { return (append ? '&' : '?') + 'set=' + name; },
  };
})();
