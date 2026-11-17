// src/main.js
(function () {
  "use strict";

  /* ─────────────────────────────────────────────────────────────
     1. Data (Imported from rules.js and words.js)
     ───────────────────────────────────────────────────────────── */
  const RULES = window.RULES || {};
  const WORDS = Array.isArray(window.WORDS) ? window.WORDS : [];
  const LOAD_PROBLEMS = [];
  if (!Array.isArray(window.WORDS)) LOAD_PROBLEMS.push('words.js did not load (window.WORDS is missing) — check that words.js sits next to index.html and is served over http(s).');
  if (!window.RULES) LOAD_PROBLEMS.push('rules.js did not load (window.RULES is missing) — grammar explanations are unavailable.');

  /* ─────────────────────────────────────────────────────────────
     2. Theme Initialization
     ───────────────────────────────────────────────────────────── */
  (function () {
    var mq = matchMedia('(prefers-color-scheme: dark)'), root = document.documentElement;
    function saved() {
      try { var v = localStorage.getItem('treppenwitz-theme'); return (v === 'light' || v === 'dark') ? v : null; }
      catch (e) { return null; }
    }
    function apply() { root.dataset.theme = saved() || (mq.matches ? 'dark' : 'light'); }
    apply(); mq.addEventListener('change', apply);
    window.treppenwitzTheme = {
      get: function () { return root.dataset.theme; },
      toggle: function () {
        var n = root.dataset.theme === 'dark' ? 'light' : 'dark';
        try { localStorage.setItem('treppenwitz-theme', n); } catch (e) { }
        apply();
      }
    };
  })();

  /* ─────────────────────────────────────────────────────────────
     3. Storage
     ───────────────────────────────────────────────────────────── */
  const SKEY = 'treppenwitz-v1';
  const SETKEY = 'treppenwitz-settings-v1';

  function loadJSON(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) { return fallback; }
  }
  function saveJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }

  const DEFAULT_SETTINGS = { rounds: 20, autoTTS: true, arabic: true };

  let store = loadJSON(SKEY, { cards: {} });
  if (!store || typeof store !== 'object' || !store.cards) store = { cards: {} };

  let settings = Object.assign({}, DEFAULT_SETTINGS, loadJSON(SETKEY, {}));
  settings.rounds = Number(settings.rounds) || 20;
  settings.autoTTS = !!settings.autoTTS;
  settings.arabic = !!settings.arabic;

  function saveSettings() { saveJSON(SETKEY, settings); }

  /* ─────────────────────────────────────────────────────────────
     4. Deck parsing — Tier → Group → Deck (max 126 cards)
     ───────────────────────────────────────────────────────────── */
  const MAX_DECK = 126;        // a deck never holds more than this; bigger source rows are split into Parts
  const MASTERED_BOX = 5;      // a card counts as "mastered" once it reaches box 5 (11+ day interval)
  const ARABIC_RE = /[\u0600-\u06FF]/;
  function hasArabic(s) { return ARABIC_RE.test(s); }

  const decks = [];
  const rowCards = [];         // source-row index -> every valid card of that row (distractor pool)
  const tiers = [];
  const tierMap = Object.create(null);

  function getTier(name) {
    if (!tierMap[name]) {
      tierMap[name] = { name: name, groups: [], groupMap: Object.create(null), decks: [] };
      tiers.push(tierMap[name]);
    }
    return tierMap[name];
  }
  function getGroup(tier, name) {
    if (!tier.groupMap[name]) {
      tier.groupMap[name] = { name: name, tier: tier.name, decks: [] };
      tier.groups.push(tier.groupMap[name]);
    }
    return tier.groupMap[name];
  }

  // Pre-seed tiers and groups in the order declared by window.TIERS (defined at the bottom of words.js).
  (Array.isArray(window.TIERS) ? window.TIERS : []).forEach(function (t) {
    const tr = getTier(t.name);
    (t.groups || []).forEach(function (g) { getGroup(tr, g); });
  });

  WORDS.forEach(function (row, di) {
    if (!Array.isArray(row) || row.length < 3) return;
    if (row[6] !== undefined && row[6] !== null) return;       // exact duplicate of an earlier row (dupOf in words.js)

    const tierName = String(row[0]).trim();
    const packName = String(row[1]).trim();
    const deckRule = String(row[3] || '').trim();              // rule id shared by every card of the deck
    const groupName = String(row[4] || '').trim() || 'General';
    const sortKey = Number(row[5]);

    const seen = Object.create(null);
    const cards = [];
    String(row[2]).split('|').forEach(function (pair, ci) {
      const parts = pair.split('~');
      const front = (parts[0] || '').trim();
      const back = (parts[1] || '').trim();
      if (!front || !back) return;                             // malformed slot – id numbering (ci) is unaffected
      const key = front + '~' + back;
      if (seen[key]) return;                                   // identical card twice in one row
      seen[key] = 1;
      cards.push({
        id: di + ':' + ci,
        front: front,
        back: back,
        example: (parts[2] || '').trim(),                      // 3rd field = German example sentence (NOT Arabic)
        ruleId: (parts[3] || '').trim() || deckRule,
        row: di
      });
    });
    rowCards[di] = cards;

    const tier = getTier(tierName);
    const group = getGroup(tier, groupName);
    const parts = Math.max(1, Math.ceil(cards.length / MAX_DECK));
    for (let k = 0; k < parts; k++) {
      let name = packName;
      if (parts > 1) name += (/Part \d+ of \d+$/.test(packName) ? ' · Set ' : ' · Part ') + (k + 1) + ' of ' + parts;
      const deck = {
        id: decks.length, row: di, tier: tierName, group: groupName, name: name,
        sort: isFinite(sortKey) ? sortKey : 1e6 + di,
        cards: cards.slice(k * MAX_DECK, (k + 1) * MAX_DECK)
      };
      decks.push(deck);
      group.decks.push(deck);
    }
  });

  // Order decks inside groups, drop empty groups/tiers, and build each tier's flat deck list.
  tiers.forEach(function (t) {
    t.groups = t.groups.filter(function (g) { return g.decks.length; });
    t.groups.forEach(function (g) {
      g.decks.sort(function (a, b) { return a.sort - b.sort || a.id - b.id; });
      g.decks.forEach(function (d) { t.decks.push(d); });
    });
  });
  for (let i = tiers.length - 1; i >= 0; i--) if (!tiers[i].decks.length) tiers.splice(i, 1);

  const allCards = [];
  decks.forEach(function (d) { d.cards.forEach(function (c) { allCards.push(c); }); });

  /* ─────────────────────────────────────────────────────────────
     5. Spaced repetition (20 stages)
     ───────────────────────────────────────────────────────────── */
  const INTERVALS = [
    0, 1, 2, 4, 7, 11, 16, 22, 29, 37, 46, 56, 67, 79, 92, 106, 121, 137, 154, 180
  ].map(function (d) { return d * 86400000; });
  const WRONG_DELAY = 10 * 60 * 1000;
  const WRONG_DROP = 2;                  // a wrong answer drops the card two boxes (never below box 0)

  function cardState(id) {
    let s = store.cards[id];
    if (!s) {
      s = { box: 0, due: 0, seen: 0, correct: 0, wrong: 0 };
      store.cards[id] = s;
    }
    return s;
  }

  function isDue(card) {
    const s = store.cards[card.id];
    if (!s) return true;
    return s.due <= Date.now();
  }

  /* ─────────────────────────────────────────────────────────────
     6. Helpers
     ───────────────────────────────────────────────────────────── */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function uniq(arr) { return Array.from(new Set(arr)); }
  // Attributes that make mixed German / English / Arabic text lay out correctly:
  // Arabic strings get explicit rtl + lang="ar"; everything else is left-to-right.
  function textAttrs(s) {
    return hasArabic(s) ? ' dir="rtl" lang="ar"' : ' dir="ltr"';
  }

  const appEl = document.getElementById('app');
  const bandEl = document.getElementById('band');
  const liveEl = document.getElementById('live');

  function announce(msg) { liveEl.textContent = msg; }

  // Auto-translation German → Arabic (endpoint is allow-listed in the CSP in index.html).
  const ARCACHE_KEY = 'treppenwitz-ar-cache-v1';
  const arCache = loadJSON(ARCACHE_KEY, {});
  function saveArCache() {
    const keys = Object.keys(arCache);
    if (keys.length > 1500) keys.slice(0, keys.length - 1000).forEach(function (k) { delete arCache[k]; });
    saveJSON(ARCACHE_KEY, arCache);
  }
  async function fetchTranslation(text) {
    text = String(text || '').trim();
    if (!text) return null;
    if (arCache[text]) return arCache[text];
    const ctl = new AbortController();
    const timer = setTimeout(function () { ctl.abort(); }, 8000);
    try {
      const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=de&tl=ar&dt=t&q=' + encodeURIComponent(text);
      const res = await fetch(url, { signal: ctl.signal, referrerPolicy: 'no-referrer' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const out = (data[0] || []).map(function (seg) { return seg[0] || ''; }).join('').trim();   // long texts come back in several segments
      if (!out) return null;
      arCache[text] = out;
      saveArCache();
      return out;
    } catch (e) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /* ─────────────────────────────────────────────────────────────
     7. Speech (TTS)
     ───────────────────────────────────────────────────────────── */
  let voices = [];
  function refreshVoices() {
    try { voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : []; }
    catch (e) { voices = []; }
  }
  if ('speechSynthesis' in window) {
    refreshVoices();
    window.speechSynthesis.onvoiceschanged = refreshVoices;
  }

  function speak(text) {
    if (!text || !('speechSynthesis' in window)) return;
    try { window.speechSynthesis.cancel(); } catch (e) {}
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'de-DE';
    u.rate = 0.95;
    const de = voices.find(function (v) { return /^de/i.test(v.lang); });
    if (de) u.voice = de;
    try { window.speechSynthesis.speak(u); } catch (e) {}
  }

  /* ─────────────────────────────────────────────────────────────
     8. Views & navigation
     ───────────────────────────────────────────────────────────── */
  let view = 'path';
  let round = null;

  const navButtons = Array.from(document.querySelectorAll('#nav [data-nav]'));

  function updateNav() {
    navButtons.forEach(function (b) {
      if (b.dataset.nav === view) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
  }

  function showView(v) {
    view = v;
    hideBand();
    round = null;
    if (v === 'path') renderPath();
    else if (v === 'review') renderReview();
    else if (v === 'grammar') renderGrammar();
    else if (v === 'stats') renderStats();
    else if (v === 'settings') renderSettings();
    updateNav();
    window.scrollTo(0, 0);
    appEl.classList.remove('fade-in');
    void appEl.offsetWidth;
    appEl.classList.add('fade-in');
  }

  navButtons.forEach(function (b) {
    b.addEventListener('click', function () { showView(b.dataset.nav); });
  });

  document.getElementById('themeBtn').addEventListener('click', function () {
    window.treppenwitzTheme.toggle();
  });
  document.getElementById('settingsBtn').addEventListener('click', function () {
    showView('settings');
  });

  /* ─────────────────────────────────────────────────────────────
     9. Path view
     ───────────────────────────────────────────────────────────── */
  function deckStats(deck) {
    let seen = 0, mastered = 0, due = 0;
    const now = Date.now();
    deck.cards.forEach(function (c) {
      const s = store.cards[c.id];
      if (s && s.seen > 0) seen++;
      if (s && s.box >= MASTERED_BOX) mastered++;
      if (!s || s.due <= now) due++;
    });
    return { seen: seen, mastered: mastered, due: due, total: deck.cards.length };
  }
  function masteryPct(list) {                       // list of decks
    let m = 0, n = 0;
    list.forEach(function (d) {
      n += d.cards.length;
      d.cards.forEach(function (c) { const s = store.cards[c.id]; if (s && s.box >= MASTERED_BOX) m++; });
    });
    return n ? Math.round((m / n) * 100) : 0;
  }
  function masteryBar(pct, label) {
    return '<span class="mastery"><progress class="mastery-bar" max="100" value="' + pct + '" aria-label="' + esc(label) + ' mastery"></progress>' +
           '<span class="mastery-pct">' + pct + '%</span></span>';
  }

  let pathFilter = '';
  const collapsedTiers = {};
  const collapsedGroups = {};

  function renderPath() {
    if (LOAD_PROBLEMS.length) {
      appEl.innerHTML = '<div class="empty">' + LOAD_PROBLEMS.map(esc).join('<br><br>') + '</div>';
      if (!decks.length) return;
    }
    if (!decks.length) {
      appEl.innerHTML = '<div class="empty">No decks loaded. Check that words.js is next to index.html.</div>';
      return;
    }
    appEl.innerHTML = (LOAD_PROBLEMS.length ? appEl.innerHTML : '') +
      '<h2 class="view-title">Path</h2>' +
      '<div class="search-wrap">' +
        '<input id="pathSearch" class="filter-input" type="search" placeholder="Search decks…" ' +
          'aria-label="Search decks" value="' + esc(pathFilter) + '">' +
      '</div>' +
      '<div id="pathBody"></div>';

    const input = document.getElementById('pathSearch');
    input.addEventListener('input', function () {
      pathFilter = input.value;
      renderPathBody();
    });

    renderPathBody();
  }

  function renderPathBody() {
    const body = document.getElementById('pathBody');
    if (!body) return;
    const q = pathFilter.trim().toLowerCase();

    let html = '';
    let any = false;

    tiers.forEach(function (tier, tIdx) {
      const tierHit = q && tier.name.toLowerCase().indexOf(q) !== -1;
      const groups = [];
      tier.groups.forEach(function (g) {
        const groupHit = tierHit || (q && g.name.toLowerCase().indexOf(q) !== -1);
        const list = q && !groupHit
          ? g.decks.filter(function (d) { return d.name.toLowerCase().indexOf(q) !== -1; })
          : g.decks;
        if (list.length) groups.push({ g: g, decks: list });
      });
      if (!groups.length) return;
      any = true;

      const tierDecks = [];
      groups.forEach(function (x) { x.decks.forEach(function (d) { tierDecks.push(d); }); });

      if (collapsedTiers[tier.name] === undefined) collapsedTiers[tier.name] = tIdx > 0;
      const tierCollapsed = !q && !!collapsedTiers[tier.name];

      html += '<section class="tier' + (tierCollapsed ? ' is-collapsed' : '') + '" data-tier="' + esc(tier.name) + '">' +
        '<button type="button" class="tier-header" aria-expanded="' + (!tierCollapsed) + '">' +
          '<span class="tier-head-main">' +
            '<h3 class="tier-title">' + esc(tier.name) + '</h3>' +
            masteryBar(masteryPct(tierDecks), tier.name) +
          '</span>' +
          '<span class="tier-right">' +
            '<span>' + groups.length + (groups.length === 1 ? ' group' : ' groups') + ' · ' + tierDecks.length + (tierDecks.length === 1 ? ' deck' : ' decks') + '</span>' +
            '<svg class="tier-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" ' +
              'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>' +
          '</span>' +
        '</button>' +
        '<div class="tier-body">';

      groups.forEach(function (x) {
        const gKey = tier.name + '|' + x.g.name;
        if (collapsedGroups[gKey] === undefined) collapsedGroups[gKey] = groups.length > 1;   // a tier with one group opens flat
        const gCollapsed = !q && !!collapsedGroups[gKey];

        html += '<div class="group' + (gCollapsed ? ' is-collapsed' : '') + '" data-gkey="' + esc(gKey) + '">' +
          '<button type="button" class="group-header" aria-expanded="' + (!gCollapsed) + '">' +
            '<span class="group-head-main">' +
              '<span class="group-title">' + esc(x.g.name) + '</span>' +
              masteryBar(masteryPct(x.decks), x.g.name) +
            '</span>' +
            '<span class="tier-right"><span>' + x.decks.length + (x.decks.length === 1 ? ' deck' : ' decks') + '</span>' +
              '<svg class="group-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" ' +
                'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>' +
            '</span>' +
          '</button>' +
          '<div class="deck-list">';

        x.decks.forEach(function (d) {
          const st = deckStats(d);
          const pct = st.total ? Math.round((st.mastered / st.total) * 100) : 0;
          html += '<button type="button" class="deck-row" data-deck="' + d.id + '">' +
            '<span class="deck-row-main">' +
              '<span class="block deck-name">' + esc(d.name) + '</span>' +
              '<span class="block deck-meta">' + d.cards.length + ' cards · ' + st.due + ' due · ' + pct + '% mastered</span>' +
            '</span>' +
            '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
              'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>' +
          '</button>';
        });
        html += '</div></div>';
      });

      html += '</div></section>';
    });

    body.innerHTML = any ? html : '<div class="empty">No decks match “' + esc(pathFilter) + '”.</div>';

    body.querySelectorAll('.tier-header').forEach(function (hdr) {
      hdr.addEventListener('click', function () {
        const sec = hdr.closest('.tier');
        if (!sec) return;
        const nowCollapsed = !sec.classList.contains('is-collapsed');
        collapsedTiers[sec.dataset.tier] = nowCollapsed;
        sec.classList.toggle('is-collapsed', nowCollapsed);
        hdr.setAttribute('aria-expanded', String(!nowCollapsed));
      });
    });
    body.querySelectorAll('.group-header').forEach(function (hdr) {
      hdr.addEventListener('click', function () {
        const g = hdr.closest('.group');
        if (!g) return;
        const nowCollapsed = !g.classList.contains('is-collapsed');
        collapsedGroups[g.dataset.gkey] = nowCollapsed;
        g.classList.toggle('is-collapsed', nowCollapsed);
        hdr.setAttribute('aria-expanded', String(!nowCollapsed));
      });
    });
    body.querySelectorAll('[data-deck]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const d = decks[Number(btn.dataset.deck)];
        if (d) startRound(d.cards, 'study', d.name);
      });
    });
  }

  /* ─────────────────────────────────────────────────────────────
     10. Review view
     ───────────────────────────────────────────────────────────── */
  function renderReview() {
    const due = allCards.filter(isDue);
    const total = allCards.length;
    const seen = allCards.filter(function (c) {
      const s = store.cards[c.id];
      return s && s.seen > 0;
    }).length;

    let html = '<h2 class="view-title">Review</h2>' +
      '<div class="stat-grid">' +
        '<div class="card stat-card"><div class="stat-num">' + due.length + '</div>' +
          '<div class="stat-label">Cards due now</div></div>' +
        '<div class="card stat-card"><div class="stat-num">' + seen + ' / ' + total + '</div>' +
          '<div class="stat-label">Cards seen</div></div>' +
      '</div>';

    if (due.length) {
      html += '<button type="button" class="btn btn-primary btn-block btn-lg" id="startReview">' +
        'Start review (' + Math.min(settings.rounds, due.length) + ')</button>';
    } else {
      html += '<div class="empty">Nothing due right now. Come back later, or study a pack from the Path tab.</div>';
    }
    appEl.innerHTML = html;

    const btn = document.getElementById('startReview');
    if (btn) {
      btn.addEventListener('click', function () {
        startRound(due, 'review', 'Review');
      });
    }
  }

  /* ─────────────────────────────────────────────────────────────
     11. Round engine
     ───────────────────────────────────────────────────────────── */
  function startRound(sourceCards, mode, label) {
    if (!sourceCards.length) { announce('No cards available.'); return; }
    const pool = shuffle(sourceCards).slice(0, Math.min(settings.rounds, sourceCards.length));
    round = {
      source: sourceCards,
      mode: mode,
      label: label,
      cards: pool,
      idx: 0,
      correct: 0,
      wrong: 0,
      answered: false,
      choices: [],
      results: []
    };
    view = 'study';
    hideBand();
    drawRound();
    updateNav();
    window.scrollTo(0, 0);
  }

  function buildChoices(card) {
    const rowPool = rowCards[card.row] || allCards;
    const pool = uniq(rowPool
      .filter(function (c) { return c.id !== card.id && c.back !== card.back; })
      .map(function (c) { return c.back; }));

    let distractors = shuffle(pool).slice(0, 3);

    if (distractors.length < 3) {
      const globalPool = uniq(allCards
        .map(function (c) { return c.back; })
        .filter(function (b) { return b !== card.back && distractors.indexOf(b) === -1; }));
      distractors = distractors.concat(shuffle(globalPool).slice(0, 3 - distractors.length));
    }

    return shuffle([card.back].concat(distractors));
  }

  function progressHTML() {
    const total = round.cards.length;
    let segs = '';
    for (let i = 0; i < total; i++) {
      const r = round.results[i];
      const cls = r === true ? ' is-correct' : r === false ? ' is-wrong' : '';
      segs += '<span class="rp-seg' + cls + '"></span>';
    }
    return '<div class="round-progress" aria-hidden="true">' +
             '<div class="rp-track"><div class="rp-ticks">' + segs + '</div></div>' +
           '</div>';
  }

  function drawRound() {
    if (!round) { showView('path'); return; }
    if (round.idx >= round.cards.length) { drawSummary(); return; }

    const card = round.cards[round.idx];
    round.answered = false;
    round.choices = buildChoices(card);

    let html = '' +
      '<div class="link-row">' +
        '<button type="button" class="link-btn" id="exitRound">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
            'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>' +
          'Exit' +
        '</button>' +
      '</div>' +
      '<div class="round-top">' +
        '<div class="round-label">' + esc(round.label) + '</div>' +
        '<div class="round-count">' + (round.idx + 1) + ' / ' + round.cards.length + '</div>' +
      '</div>' +
      progressHTML() +
      '<div class="card question-card">' +
        '<div class="question"' + textAttrs(card.front) + '>' + esc(card.front) + '</div>' +
        '<div class="question-sub">Choose the meaning</div>' +
      '</div>' +
      '<div class="choices" role="group" aria-label="Answer choices">';

    round.choices.forEach(function (choice, i) {
      let displayChoice = choice;
      if (choice.indexOf('[') !== -1) {
        displayChoice = choice.split('[')[0].trim() + '...';
      }

      html += '<button type="button" class="btn btn-row opt" data-idx="' + i + '">' +
        '<span class="kbd" aria-hidden="true">' + (i + 1) + '</span>' +
        '<span class="opt-text"' + textAttrs(displayChoice) + '>' + esc(displayChoice) + '</span>' +
      '</button>';
    });

    html += '</div>';
    appEl.innerHTML = html;

    document.getElementById('exitRound').addEventListener('click', function () {
      round = null;
      showView('path');
    });

    appEl.querySelectorAll('.opt').forEach(function (btn) {
      btn.addEventListener('click', function () {
        answer(round.choices[Number(btn.dataset.idx)], btn);
      });
    });
  }

  function answer(choice, btn) {
    if (!round || round.answered) return;
    round.answered = true;

    const card = round.cards[round.idx];
    const ok = choice === card.back;
    const s = cardState(card.id);
    s.seen += 1;

    const wasDue = s.due <= Date.now();      // brand-new cards have due = 0, so they count as due
    if (ok) {
      s.correct += 1;
      round.correct += 1;
      // A correct answer only moves the card up when it was actually due. Practising a card early
      // (Study mode) is still counted in the stats but can't push it up the boxes.
      if (wasDue) {
        s.box = Math.min(s.box + 1, INTERVALS.length - 1);
        s.due = Date.now() + INTERVALS[s.box];
      }
    } else {
      s.wrong += 1;
      round.wrong += 1;
      s.box = Math.max(s.box - WRONG_DROP, 0);
      s.due = Date.now() + WRONG_DELAY;
    }
    round.results[round.idx] = ok;
    saveJSON(SKEY, store);

    appEl.querySelectorAll('.opt').forEach(function (b) {
      b.disabled = true;
      const val = round.choices[Number(b.dataset.idx)];
      if (val === card.back) {
        b.classList.add('btn-success');
      } else if (b === btn) {
        b.classList.add('btn-error');
      } else {
        b.classList.add('is-dim');
      }
    });

    showBand(ok, card);
  }

  /* ─────────────────────────────────────────────────────────────
     12. Feedback band
     ───────────────────────────────────────────────────────────── */
  function hideBand() {
    bandEl.classList.add('hidden');
    bandEl.classList.remove('band-enter', 'band-success', 'band-error');
    bandEl.innerHTML = '';
  }

  function showBand(ok, card) {
    let arabicLine = '';
    const backIsArabic = hasArabic(card.back);

    if (settings.arabic && !backIsArabic) {            // cards whose answer is already Arabic need no extra translation
      arabicLine = '<div class="band-arabic is-loading" id="dynamic-ar" dir="rtl" lang="ar" data-card="' + esc(card.id) + '">جاري الترجمة…</div>';
      fetchTranslation(card.front).then(function (translated) {
        const el = document.getElementById('dynamic-ar');
        if (!el || el.dataset.card !== card.id) return;   // band already moved on to another card
        el.classList.remove('is-loading');
        if (translated) el.textContent = translated;
        else el.classList.add('hidden');
      });
    }
    const exampleLine = card.example
      ? '<div class="band-example" dir="ltr" lang="de">' + esc(card.example) + '</div>'
      : '';

    let whyBox = '';
    if (card.ruleId && RULES[card.ruleId]) {
      whyBox = '<div class="why-box"><strong>Why?</strong>' + esc(RULES[card.ruleId].explanation || RULES[card.ruleId]) + '</div>';
    }

    bandEl.className = (ok ? 'band-success' : 'band-error') + ' band-enter';

    bandEl.innerHTML = '' +
      '<div class="band-inner">' +
        '<div class="band-title">' + (ok ? 'Correct!' : 'Not quite') + '</div>' +
        '<div class="band-answer"><strong' + textAttrs(card.front) + '>' + esc(card.front) + '</strong><br><br><span' + textAttrs(card.back) + '>' + esc(card.back) + '</span></div>' +
        exampleLine +
        arabicLine +
        whyBox +
        '<div class="band-actions">' +
          '<button type="button" class="btn band-btn" id="bandListen">' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
              'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
              '<path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>' +
            'Listen' +
          '</button>' +
          '<button type="button" class="btn btn-neutral" id="bandNext">Next</button>' +
        '</div>' +
      '</div>';

    bandEl.classList.remove('hidden');
    announce(ok ? 'Correct. ' + card.front : 'Not quite. ' + card.front);

    if (settings.autoTTS) speak(card.front);

    document.getElementById('bandListen').addEventListener('click', function () {
      speak(card.front);
    });
    document.getElementById('bandNext').addEventListener('click', function () {
      hideBand();
      if (!round) return;
      round.idx += 1;
      drawRound();
      window.scrollTo(0, 0);
    });
  }

  /* ─────────────────────────────────────────────────────────────
     13. Summary
     ───────────────────────────────────────────────────────────── */
  function drawSummary() {
    const total = round.cards.length;
    const pct = total ? Math.round((round.correct / total) * 100) : 0;
    const isReview = round.mode === 'review';

    appEl.innerHTML = '' +
      '<h2 class="view-title">' + (isReview ? 'Review complete' : 'Round complete') + '</h2>' +
      '<div class="card summary">' +
        '<div class="summary-big">' + pct + '%</div>' +
        '<div class="summary-sub">' + round.correct + ' correct · ' + round.wrong + ' not quite</div>' +
        '<button type="button" class="btn btn-primary btn-block" id="againBtn">Another round</button>' +
        '<button type="button" class="btn btn-outline btn-block" id="backBtn">Back to ' +
          (isReview ? 'review' : 'path') + '</button>' +
      '</div>';

    const src = round.source;
    const mode = round.mode;
    const label = round.label;

    document.getElementById('againBtn').addEventListener('click', function () {
      startRound(src, mode, label);
    });
    document.getElementById('backBtn').addEventListener('click', function () {
      showView(isReview ? 'review' : 'path');
    });
  }

  /* ─────────────────────────────────────────────────────────────
     14. Grammar view
     ───────────────────────────────────────────────────────────── */
  const grammarDecks = decks.filter(function (d) {
    return /grammar|function words/i.test(d.tier) || /^G\d/.test(d.name) || /chunking/i.test(d.tier);
  });

  let grammarFilter = '';

  function renderGrammar() {
    if (!grammarDecks.length) {
      appEl.innerHTML = '' +
        '<h2 class="view-title">Grammar</h2>' +
        '<div class="empty">No grammar packs found. Add decks whose tier contains “Grammar” ' +
        'or whose pack name starts with “G” (e.g. “G1 · Pronouns”).</div>';
      return;
    }

    appEl.innerHTML = '' +
      '<h2 class="view-title">Grammar</h2>' +
      '<div class="search-wrap">' +
        '<input id="grammarSearch" class="filter-input" type="search" placeholder="Search grammar…" ' +
          'aria-label="Search grammar topics" value="' + esc(grammarFilter) + '">' +
      '</div>' +
      '<div id="grammarBody"></div>';

    const input = document.getElementById('grammarSearch');
    input.addEventListener('input', function () {
      grammarFilter = input.value;
      renderGrammarBody();
    });

    renderGrammarBody();
  }

  function renderGrammarBody() {
    const body = document.getElementById('grammarBody');
    if (!body) return;
    const q = grammarFilter.trim().toLowerCase();

    let html = '';
    let any = false;

    grammarDecks.forEach(function (d) {
      const cards = q
        ? d.cards.filter(function (c) {
            return c.front.toLowerCase().indexOf(q) !== -1 || c.back.toLowerCase().indexOf(q) !== -1;
          })
        : d.cards;
      if (!cards.length) return;
      any = true;

      html += '<section class="card grammar-pack">' +
        '<div class="grammar-pack-head">' +
          '<div class="deck-row-main">' +
            '<div class="deck-name">' + esc(d.name) + '</div>' +
            '<div class="deck-meta">' + cards.length + ' entries</div>' +
          '</div>' +
        '</div>' +
        '<div class="grammar-list">';

      cards.forEach(function (c) {
        let ruleText = '';
        if (c.ruleId && RULES[c.ruleId]) {
          ruleText = '<div class="g-rule">' + esc(RULES[c.ruleId].explanation || RULES[c.ruleId]) + '</div>';
        }
        html += '<div class="grammar-item">' +
          '<div class="g-front"' + textAttrs(c.front) + '>' + esc(c.front) + '</div>' +
          '<div class="g-back"' + textAttrs(c.back) + '>' + esc(c.back) + ruleText + '</div>' +
        '</div>';
      });

      html += '</div></section>';
    });

    body.innerHTML = any ? html : '<div class="empty">No matches for “' + esc(grammarFilter) + '”.</div>';
  }

  /* ─────────────────────────────────────────────────────────────
     15. Stats view
     ───────────────────────────────────────────────────────────── */
  function renderStats() {
    const total = allCards.length;
    const seen = allCards.filter(function (c) {
      const s = store.cards[c.id];
      return s && s.seen > 0;
    }).length;

    let correct = 0, wrong = 0;
    allCards.forEach(function (c) {
      const s = store.cards[c.id];
      if (!s) return;
      correct += s.correct || 0;
      wrong += s.wrong || 0;
    });
    const answered = correct + wrong;
    const rate = answered ? Math.round((correct / answered) * 100) : 0;

    let mastered = 0;
    allCards.forEach(function (c) { const s = store.cards[c.id]; if (s && s.box >= MASTERED_BOX) mastered++; });
    const overall = total ? Math.round((mastered / total) * 100) : 0;

    let fresh = 0, learning = 0;
    allCards.forEach(function (c) {
      const s = store.cards[c.id];
      if (!s || !s.seen) fresh++;
      else if (s.box < MASTERED_BOX) learning++;
    });
    const pctOf = function (n) { return total ? Math.round((n / total) * 100) : 0; };
    const stageRow = function (label, n) {
      return '<div class="stat-row"><span class="stat-row-name">' + label + '</span>' + masteryBar(pctOf(n), label) +
        '<span class="stat-row-count">' + n + ' cards</span></div>';
    };
    const DAY = 86400000;
    const boxCount = INTERVALS.map(function () { return 0; });
    allCards.forEach(function (c) {
      const s = store.cards[c.id];
      if (s && s.seen > 0) boxCount[Math.min(s.box || 0, INTERVALS.length - 1)]++;
    });
    let boxRows = '';
    boxCount.forEach(function (n, b) {
      const gap = b === 0 ? 'repeat soon' : 'back after ' + INTERVALS[b] / DAY + (INTERVALS[b] / DAY === 1 ? ' day' : ' days');
      boxRows += '<div class="stat-row"><span class="stat-row-name">Box ' + b + (b >= MASTERED_BOX ? ' · mastered' : '') + ' <span class="stat-row-count">(' + gap + ')</span></span>' +
        masteryBar(pctOf(n), 'Box ' + b) + '<span class="stat-row-count">' + n + ' cards</span></div>';
    });
    const gapDays = INTERVALS[MASTERED_BOX] / DAY;
    let daysToMaster = 0;
    for (let b = 1; b <= MASTERED_BOX; b++) daysToMaster += INTERVALS[b] / DAY;
    const ladder = INTERVALS.slice(1, 8).map(function (v) { return v / DAY; }).join(', ');
    const howTo = '<div class="card stat-how">' +
      '<h3 class="stat-heading">When a word counts as mastered</h3>' +
      '<ul class="stat-list">' +
        '<li>A card is <strong>mastered</strong> when it reaches box ' + MASTERED_BOX + ': ' + MASTERED_BOX + ' correct answers in a row, or more if wrong answers pushed it back.</li>' +
        '<li>At that point it only comes back after ' + gapDays + ' days. Reaching it takes about ' + daysToMaster + ' days of reviewing (roughly 3 to 4 weeks).</li>' +
        '<li>Mastered is only a label for the mastery bars. The card keeps coming back, with gaps of ' + ladder + ' … up to ' + (INTERVALS[INTERVALS.length - 1] / DAY) + ' days.</li>' +
        '<li>A wrong answer moves the card down ' + WRONG_DROP + ' boxes and shows it again in 10 minutes.</li>' +
        '<li>A correct answer only moves a card up when it is due. Practising it early in Study mode does not advance it.</li>' +
      '</ul></div>';

    appEl.innerHTML = '' +
      '<h2 class="view-title">Stats</h2>' +
      '<div class="card stat-card stat-overall"><div class="stat-num">' + overall + '%</div>' +
        '<div class="stat-label">Overall mastery · ' + mastered + ' of ' + total + ' cards mastered</div>' +
        masteryBar(overall, 'Overall') + '</div>' +
      '<div class="stat-grid">' +
        '<div class="card stat-card"><div class="stat-num">' + mastered + '</div>' +
          '<div class="stat-label">Cards mastered</div></div>' +
        '<div class="card stat-card"><div class="stat-num">' + total + '</div>' +
          '<div class="stat-label">Total cards</div></div>' +
        '<div class="card stat-card"><div class="stat-num">' + seen + '</div>' +
          '<div class="stat-label">Cards seen</div></div>' +
        '<div class="card stat-card"><div class="stat-num">' + rate + '%</div>' +
          '<div class="stat-label">Accuracy (' + answered + ' answers)</div></div>' +
      '</div>' +
      '<h3 class="stat-heading">Progress by stage</h3>' +
      '<div class="card stat-tiers">' + stageRow('New (not seen yet)', fresh) + stageRow('Learning (boxes 1–' + (MASTERED_BOX - 1) + ')', learning) + stageRow('Mastered (box ' + MASTERED_BOX + '+)', mastered) + '</div>' +
      '<h3 class="stat-heading">Cards in each box</h3>' +
      '<div class="card stat-tiers">' + boxRows + '</div>' +
      howTo;
  }

  /* ─────────────────────────────────────────────────────────────
     16. Export / Import progress
     ───────────────────────────────────────────────────────────── */
  function exportProgress() {
    const payload = {
      app: 'treppenwitz',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: settings,
      cards: store.cards
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = 'treppenwitz-progress-' + stamp + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    announce('Progress exported.');
  }

  function importProgress(file) {
    const reader = new FileReader();
    reader.onload = function () {
      let data;
      try { data = JSON.parse(reader.result); }
      catch (e) {
        announce('Import failed: not valid JSON.');
        alert('Import failed: the file is not valid JSON.');
        return;
      }

      if (!data || data.app !== 'treppenwitz' || !data.cards || typeof data.cards !== 'object') {
        announce('Import failed: unrecognised file.');
        alert('Import failed: this does not look like a Treppenwitz progress file.');
        return;
      }

      const merge = confirm(
        'Import progress?\n\nOK = merge with current progress (newer wins per card)\nCancel = replace all current progress'
      );

      if (merge) {
        Object.keys(data.cards).forEach(function (id) {
          const incoming = data.cards[id];
          const existing = store.cards[id];
          if (!existing) { store.cards[id] = incoming; return; }
          if ((incoming.due || 0) > (existing.due || 0)) store.cards[id] = incoming;
        });
      } else {
        if (!confirm('This will erase your current progress. Continue?')) return;
        store.cards = data.cards;
      }

      if (data.settings && typeof data.settings === 'object') {
        settings = Object.assign({}, DEFAULT_SETTINGS, data.settings);
        settings.rounds = Number(settings.rounds) || 20;
        settings.autoTTS = !!settings.autoTTS;
        settings.arabic = !!settings.arabic;
        saveSettings();
      }

      saveJSON(SKEY, store);
      announce('Progress imported.');
      showView('stats');
    };
    reader.readAsText(file);
  }

  /* ─────────────────────────────────────────────────────────────
     17. Settings view
     ───────────────────────────────────────────────────────────── */
  function renderSettings() {
    const roundOptions = [5, 10, 20, 30, 50].map(function (n) {
      return '<option value="' + n + '"' + (settings.rounds === n ? ' selected' : '') + '>' + n + '</option>';
    }).join('');

    appEl.innerHTML = '' +
      '<h2 class="view-title">Settings</h2>' +
      '<div class="card settings-card">' +

        '<div class="field field-col">' +
          '<label class="field-label" for="setRounds">Rounds per session</label>' +
          '<div class="field-hint">How many cards each study or review round contains.</div>' +
          '<select id="setRounds" class="sel mt-2">' + roundOptions + '</select>' +
        '</div>' +

        '<div class="field">' +
          '<div>' +
            '<div class="field-label">Auto TTS</div>' +
            '<div class="field-hint">Play the answer aloud as soon as the feedback band appears.</div>' +
          '</div>' +
          '<label class="switch">' +
            '<input type="checkbox" id="setAutoTTS"' + (settings.autoTTS ? ' checked' : '') + '>' +
            '<span class="slider"></span>' +
          '</label>' +
        '</div>' +

        '<div class="field">' +
          '<div>' +
            '<div class="field-label">Arabic translation</div>' +
            '<div class="field-hint">Show an Arabic translation on the feedback band. Auto-translates if missing.</div>' +
          '</div>' +
          '<label class="switch">' +
            '<input type="checkbox" id="setArabic"' + (settings.arabic ? ' checked' : '') + '>' +
            '<span class="slider"></span>' +
          '</label>' +
        '</div>' +

        '<div class="field field-col">' +
          '<div class="field-label">Progress backup</div>' +
          '<div class="field-hint">Export saves your card schedule and settings as a JSON file. Import restores or merges it.</div>' +
          '<div class="btn-pair">' +
            '<button type="button" class="btn btn-outline" id="btnExport">Export</button>' +
            '<button type="button" class="btn btn-outline" id="btnImport">Import</button>' +
          '</div>' +
          '<input type="file" id="importFile" accept="application/json,.json" class="hidden">' +
        '</div>' +

      '</div>' +
      '<p class="field-hint mt-4">' +
        'Settings are saved automatically on this device.</p>';

    document.getElementById('setRounds').addEventListener('change', function (e) {
      const v = Number(e.target.value) || DEFAULT_SETTINGS.rounds;
      settings.rounds = v;
      saveSettings();
    });

    document.getElementById('setAutoTTS').addEventListener('change', function (e) {
      settings.autoTTS = e.target.checked;
      saveSettings();
    });

    document.getElementById('setArabic').addEventListener('change', function (e) {
      settings.arabic = e.target.checked;
      saveSettings();
    });

    document.getElementById('btnExport').addEventListener('click', exportProgress);
    document.getElementById('btnImport').addEventListener('click', function () {
      document.getElementById('importFile').click();
    });
    document.getElementById('importFile').addEventListener('change', function (e) {
      const f = e.target.files && e.target.files[0];
      if (f) importProgress(f);
      e.target.value = '';
    });
  }

  /* ─────────────────────────────────────────────────────────────
     18. Keyboard shortcuts
     ───────────────────────────────────────────────────────────── */
  document.addEventListener('keydown', function (e) {
    if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;

    if (round && !round.answered && /^[1-4]$/.test(e.key)) {
      const i = Number(e.key) - 1;
      const btn = appEl.querySelector('.opt[data-idx="' + i + '"]');
      if (btn) btn.click();
      return;
    }
    if (!bandEl.classList.contains('hidden') && (e.key === 'Enter' || e.key === ' ')) {
      const next = document.getElementById('bandNext');
      if (next) { e.preventDefault(); next.click(); }
    }
  });

  /* ─────────────────────────────────────────────────────────────
     19. Boot
     ───────────────────────────────────────────────────────────── */
  showView('path');
})();