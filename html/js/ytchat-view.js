/* ytchat-view.js — renders the shared Live Comments feed (server: lib/ytchat.js, SSE event `ytchat` on /overlay/events).
   Used by html/livecomments.html (output) and html/livecomments-dashboard.html (the Live Comments tab).

   const view = YtChat.createView({ feed: el, onMessage(m){…}, onReset(){…}, onStatus(s){…}, onInfo(title){…}, onPrefs(p){…}, stickAlways: bool, jump: el });
   The view restores from GET /ytchat/state, then follows the SSE stream. Incoming messages are released at the chosen "Update speed"
   (1-9 = speed*2 messages/s, a big backlog still drains within ~2 s; 10 = instantly). Filter words hide matching messages. */
(function () {
  var MAX_DOM = 400;
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function hue(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; }
  function nameColor(s) { return 'hsl(' + hue(s) + ' 75% 74%)'; }
  function clock(t) { return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }

  function createView(opts) {
    var feed = opts.feed, jump = opts.jump || null;
    var prefs = { fs: 15, speed: 5, photos: true, words: [], width: 480, height: 900, bg: 'solid' };
    var stick = true, queue = [], credit = 0, lastTick = performance.now(), seen = {}, seenN = 0, emptyEl = null;
    feed.classList.add('yc-feed');

    function initial(m) {
      var a = el('div', 'avatar', (m.author || '?').replace(/^@/, '').charAt(0).toUpperCase());
      a.style.background = nameColor(m.author || '?');
      return a;
    }
    function avatar(m) {
      if (!m.avatarUrl) return initial(m);
      var i = el('img'); i.src = m.avatarUrl; i.alt = ''; i.referrerPolicy = 'no-referrer';
      i.onerror = function () { i.replaceWith(initial(m)); };
      return i;
    }
    function applyFilter(node) {
      var t = node.dataset.t, hide = prefs.words.some(function (w) { return t.indexOf(w) !== -1; });
      node.classList.toggle('filtered', hide);
    }
    function scrollEnd() { if (stick || opts.stickAlways) feed.scrollTop = feed.scrollHeight; }

    function render(m) {
      if (emptyEl) { emptyEl.remove(); emptyEl = null; }
      var node;
      if (m.type === 'paid' || m.type === 'member') {
        node = el('div', 'paid');
        node.style.background = m.type === 'paid' ? (m.color || '#8fc9ff') : '#5fd6a0';
        node.style.color = m.ink || '#17131f';
        node.appendChild(avatar(m));
        var body = el('div');
        body.appendChild(el('div', 'name', m.author));
        body.appendChild(el('div', 'kind', m.kind));
        if (m.text) body.appendChild(el('div', 'text', m.text));
        node.appendChild(body);
        if (m.amount) node.appendChild(el('div', 'amt', m.amount));
      } else {
        node = el('div', 'msg new' + (m.owner ? ' owner' : m.mod ? ' mod' : m.member ? ' member' : ''));
        node.appendChild(avatar(m));
        var b = el('div'), who = el('div', 'who');
        var n = el('span', 'name', m.author); n.style.color = nameColor(m.author); who.appendChild(n);
        if (m.owner) { var t1 = el('span', 'tag', 'Host'); t1.style.color = 'var(--yc-owner)'; who.appendChild(t1); }
        else if (m.mod) { var t2 = el('span', 'tag', 'Mod'); t2.style.color = 'var(--yc-mod)'; who.appendChild(t2); }
        else if (m.member) { var t3 = el('span', 'tag', 'Member'); t3.style.color = 'var(--yc-member)'; who.appendChild(t3); }
        who.appendChild(el('span', 'time', clock(m.time)));
        b.appendChild(who); b.appendChild(el('div', 'text', m.text));
        node.appendChild(b);
      }
      node.dataset.t = (m.author + ' ' + (m.text || '')).toLowerCase();
      applyFilter(node);
      feed.appendChild(node);
      while (feed.children.length > MAX_DOM) feed.removeChild(feed.firstChild);
    }
    function show(m) {
      var key = m.id || (m.author + m.text + m.time);
      if (seen[key]) return;
      seen[key] = 1; if (++seenN > 5000) { seen = {}; seenN = 0; }
      render(m);
      if (opts.onMessage) opts.onMessage(m);
    }
    function showBatch(list) {
      list.forEach(show);
      if (stick || opts.stickAlways) { scrollEnd(); if (jump) jump.classList.remove('show'); }
      else if (jump) jump.classList.add('show');
    }

    function applyPrefs(p) {
      prefs = Object.assign(prefs, p || {});
      feed.style.setProperty('--fs', prefs.fs + 'px');
      feed.style.setProperty('--av', Math.round(prefs.fs * 2.27) + 'px');
      feed.classList.toggle('no-photo', !prefs.photos);
      Array.prototype.forEach.call(feed.querySelectorAll('[data-t]'), applyFilter);
      scrollEnd();
      if (opts.onPrefs) opts.onPrefs(prefs);
    }
    function reset(placeholder) {
      queue.length = 0; credit = 0; seen = {}; seenN = 0;
      feed.replaceChildren();
      emptyEl = null;
      if (placeholder) { emptyEl = el('div', 'empty'); emptyEl.innerHTML = placeholder; feed.appendChild(emptyEl); }
      stick = true; if (jump) jump.classList.remove('show');
      if (opts.onReset) opts.onReset();
    }

    feed.addEventListener('scroll', function () {
      stick = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 60;
      if (stick && jump) jump.classList.remove('show');
    });
    if (jump) jump.addEventListener('click', function () { feed.scrollTop = feed.scrollHeight; stick = true; jump.classList.remove('show'); });

    /* release queue */
    setInterval(function () {
      var now = performance.now(), dt = (now - lastTick) / 1000; lastTick = now;
      if (!queue.length) { credit = 0; return; }
      var n;
      if (prefs.speed >= 10) n = queue.length;
      else { var rate = Math.max(prefs.speed * 2, queue.length / 2); credit += rate * dt; n = Math.floor(credit); credit -= n; }
      if (n > 0) showBatch(queue.splice(0, n));
    }, 50);

    var placeholderHtml = opts.placeholder || '<h2>Chat appears here</h2>Connect to a live stream from the Live Comments tab.';
    reset(placeholderHtml);

    function onEvent(d) {
      if (!d) return;
      if (d.t === 'msg') queue.push(d.m);
      else if (d.t === 'reset') reset(placeholderHtml);
      else if (d.t === 'prefs') applyPrefs(d.prefs);
      else if (d.t === 'status') { if (opts.onStatus) opts.onStatus(d); }
      else if (d.t === 'info') { if (opts.onInfo) opts.onInfo(d.title); }
      else if (d.t === 'fatal') { if (opts.onFatal) opts.onFatal(d.text); }
    }
    if (typeof createOverlaySSE === 'function') {
      var sse = createOverlaySSE();
      sse.addEventListener('ytchat', function (e) { try { onEvent(JSON.parse(e.data)); } catch (err) {} });
    }
    /* restore: prefs + status + the recent messages (shown at once, not through the speed queue) */
    fetch('/ytchat/state', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (s) {
      applyPrefs(s.prefs);
      if (opts.onInfo) opts.onInfo(s.title);
      if (opts.onStatus) opts.onStatus(s.status);
      if (s.backlog && s.backlog.length) { if (emptyEl) { emptyEl.remove(); emptyEl = null; } showBatch(s.backlog); }
    }).catch(function () {});

    return { applyPrefs: applyPrefs, reset: reset, prefs: function () { return prefs; } };
  }
  window.YtChat = { createView: createView, el: el, nameColor: nameColor };
})();
