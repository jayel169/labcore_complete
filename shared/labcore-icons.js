// shared/labcore-icons.js
// LabCore SVG icon module — professional 1.75px stroke line icons
// Usage:  lcIcon('patients')          → returns SVG string (24×24)
//         lcIcon('patients', 20)      → custom size
//         lcIconSvg('patients', 20, 'lc-icon')  → with class
//         lcIconNames()               → array of available names
//
// All icons share a 24×24 viewBox, use currentColor, and fit inside
// a 1em box. Drop-in replacement for emoji in nav, buttons, headers.
(function () {
  'use strict';

  if (window.__lcIconsLoaded) return;
  window.__lcIconsLoaded = true;

  /* ---------- ICON LIBRARY ----------
     Each entry is the inner SVG markup. Stroke is handled by the
     wrapper so all icons render consistently. Add new icons by
     dropping a new entry here — no other changes needed. */
  var ICONS = {

    /* --- Navigation / core --- */
    dashboard:
      '<rect x="3" y="3" width="7" height="9" rx="1"/>' +
      '<rect x="14" y="3" width="7" height="5" rx="1"/>' +
      '<rect x="14" y="12" width="7" height="9" rx="1"/>' +
      '<rect x="3" y="16" width="7" height="5" rx="1"/>',

    patients:
      '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>' +
      '<circle cx="9" cy="7" r="4"/>' +
      '<path d="M22 21v-2a4 4 0 0 0-3-3.87"/>' +
      '<path d="M16 3.13a4 4 0 0 1 0 7.75"/>',

    patient: // single person (used inside lists)
      '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>' +
      '<circle cx="12" cy="7" r="4"/>',

    consultation:
      '<path d="M20 21v-2a4 4 0 0 0-3-3.87"/>' +
      '<path d="M4 21v-2a4 4 0 0 1 3-3.87"/>' +
      '<circle cx="12" cy="7" r="4"/>' +
      '<path d="M12 11v2M12 15h.01"/>',

    nursing:
      '<path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6v0a6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3"/>' +
      '<path d="M8 15v1a6 6 0 0 0 6 6v0a6 6 0 0 0 6-6v-4"/>' +
      '<circle cx="20" cy="10" r="2"/>',

    ward:
      '<path d="M3 21V8l9-5 9 5v13"/>' +
      '<path d="M9 21v-6h6v6"/>' +
      '<path d="M9 10h6"/>',

    triage:
      '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/>' +
      '<line x1="12" y1="9" x2="12" y2="13"/>' +
      '<line x1="12" y1="17" x2="12.01" y2="17"/>',

    billing:
      '<rect x="2" y="5" width="20" height="14" rx="2"/>' +
      '<line x1="2" y1="10" x2="22" y2="10"/>' +
      '<path d="M6 15h2M11 15h2"/>',

    receipts:
      '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/>' +
      '<path d="M8 7h8M8 11h8M8 15h5"/>',

    /* --- Laboratory --- */
    requests:
      '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
      '<polyline points="14 2 14 8 20 8"/>' +
      '<line x1="9" y1="13" x2="15" y2="13"/>' +
      '<line x1="9" y1="17" x2="13" y2="17"/>',

    specimens:
      '<path d="M9 2v6.5a4 4 0 0 0 0 .5l-3 6a2 2 0 0 0 1.8 3h8.4a2 2 0 0 0 1.8-3l-3-6a4 4 0 0 0 0-.5V2"/>' +
      '<path d="M8 2h8"/>' +
      '<path d="M7 15h10"/>',

    results:
      '<path d="M9 11l3 3L22 4"/>' +
      '<path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',

    reports:
      '<path d="M3 3v18h18"/>' +
      '<path d="M7 14l4-4 3 3 5-6"/>',

    imaging:
      '<rect x="3" y="4" width="18" height="16" rx="2"/>' +
      '<circle cx="12" cy="12" r="3"/>' +
      '<path d="M12 2v2M12 20v2M4 12H2M22 12h-2"/>',

    /* --- Configuration --- */
    testPanels:
      '<path d="M9 3v6l-5 8.5A2 2 0 0 0 5.7 21h12.6a2 2 0 0 0 1.7-3.5L15 9V3"/>' +
      '<path d="M9 3h6"/>' +
      '<path d="M7 15h10"/>',

    prices:
      '<circle cx="12" cy="12" r="9"/>' +
      '<path d="M9 8h6M9 12h6M9 16h6"/>' +
      '<path d="M12 6v12"/>',

    labels:
      '<path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V4a2 2 0 0 1 2-2h8l8.59 8.59a2 2 0 0 1 0 2.82Z"/>' +
      '<line x1="7" y1="7" x2="7.01" y2="7"/>',

    /* --- Administration --- */
    staff:
      '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>' +
      '<circle cx="9" cy="7" r="4"/>' +
      '<path d="M23 21v-2a4 4 0 0 0-3-3.87"/>' +
      '<path d="M16 3.13a4 4 0 0 1 0 7.75"/>' +
      '<path d="M12 11v4M10 13h4"/>',

    settings:
      '<circle cx="12" cy="12" r="3"/>' +
      '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>',

    /* --- Action icons (buttons, tables) --- */
    plus:
      '<line x1="12" y1="5" x2="12" y2="19"/>' +
      '<line x1="5" y1="12" x2="19" y2="12"/>',

    edit:
      '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>' +
      '<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5Z"/>',

    trash:
      '<polyline points="3 6 5 6 21 6"/>' +
      '<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>' +
      '<line x1="10" y1="11" x2="10" y2="17"/>' +
      '<line x1="14" y1="11" x2="14" y2="17"/>',

    search:
      '<circle cx="11" cy="11" r="8"/>' +
      '<line x1="21" y1="21" x2="16.65" y2="16.65"/>',

    filter:
      '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',

    download:
      '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
      '<polyline points="7 10 12 15 17 10"/>' +
      '<line x1="12" y1="15" x2="12" y2="3"/>',

    upload:
      '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
      '<polyline points="17 8 12 3 7 8"/>' +
      '<line x1="12" y1="3" x2="12" y2="15"/>',

    refresh:
      '<polyline points="23 4 23 10 17 10"/>' +
      '<polyline points="1 20 1 14 7 14"/>' +
      '<path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',

    print:
      '<polyline points="6 9 6 2 18 2 18 9"/>' +
      '<path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>' +
      '<rect x="6" y="14" width="12" height="8"/>',

    logout:
      '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>' +
      '<polyline points="16 17 21 12 16 7"/>' +
      '<line x1="21" y1="12" x2="9" y2="12"/>',

    account:
      '<circle cx="12" cy="8" r="4"/>' +
      '<path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>',

    merge:
      '<circle cx="6" cy="6" r="2.5"/>' +
      '<circle cx="6" cy="18" r="2.5"/>' +
      '<circle cx="18" cy="12" r="2.5"/>' +
      '<path d="M6 8.5v1c0 2 1.5 2.5 3 2.5h6.5M6 15.5v-1c0-2 1.5-2.5 3-2.5"/>',

    camera:
      '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>' +
      '<circle cx="12" cy="13" r="4"/>',

    save:
      '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>' +
      '<polyline points="17 21 17 13 7 13 7 21"/>' +
      '<polyline points="7 3 7 8 15 8"/>',

    link:
      '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/>' +
      '<path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',

    mail:
      '<rect x="3" y="5" width="18" height="14" rx="2"/>' +
      '<polyline points="3 7 12 13 21 7"/>',

    bell:
      '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>' +
      '<path d="M13.73 21a2 2 0 0 1-3.46 0"/>',

    check:
      '<polyline points="20 6 9 17 4 12"/>',

    close:
      '<line x1="18" y1="6" x2="6" y2="18"/>' +
      '<line x1="6" y1="6" x2="18" y2="18"/>',

    chevronDown:
      '<polyline points="6 9 12 15 18 9"/>',

    chevronRight:
      '<polyline points="9 18 15 12 9 6"/>',

    alert:
      '<circle cx="12" cy="12" r="10"/>' +
      '<line x1="12" y1="8" x2="12" y2="12"/>' +
      '<line x1="12" y1="16" x2="12.01" y2="16"/>',

    info:
      '<circle cx="12" cy="12" r="10"/>' +
      '<line x1="12" y1="16" x2="12" y2="12"/>' +
      '<line x1="12" y1="8" x2="12.01" y2="8"/>',

    clock:
      '<circle cx="12" cy="12" r="10"/>' +
      '<polyline points="12 6 12 12 16 14"/>',

    lock:
      '<rect x="3" y="11" width="18" height="11" rx="2"/>' +
      '<path d="M7 11V7a5 5 0 0 1 10 0v4"/>',

    unlock:
      '<rect x="3" y="11" width="18" height="11" rx="2"/>' +
      '<path d="M7 11V7a5 5 0 0 1 9.9-1"/>',

    key:
      '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>',

    userPlus:
      '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>' +
      '<circle cx="8.5" cy="7" r="4"/>' +
      '<line x1="20" y1="8" x2="20" y2="14"/>' +
      '<line x1="23" y1="11" x2="17" y2="11"/>',

    userCheck:
      '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>' +
      '<circle cx="8.5" cy="7" r="4"/>' +
      '<polyline points="17 11 19 13 23 9"/>',

    activity:
      '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',

    trendUp:
      '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>' +
      '<polyline points="17 6 23 6 23 12"/>',

    trendDown:
      '<polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/>' +
      '<polyline points="17 18 23 18 23 12"/>',

    logo:
      '<path d="M9 3v6l-5 8.5A2 2 0 0 0 5.7 21h12.6a2 2 0 0 0 1.7-3.5L15 9V3"/>' +
      '<path d="M9 3h6"/>' +
      '<path d="M7 15h10"/>'
  };

  /* ---------- PUBLIC API ---------- */

  /**
   * Returns the inner SVG markup for a named icon.
   * You normally won't call this — use lcIcon() instead.
   */
  window.lcIconPath = function (name) {
    return ICONS[name] || ICONS.info;
  };

  /**
   * Returns a complete <svg> element as a string.
   * @param {string} name    Icon name (see lcIconNames())
   * @param {number} size    Optional pixel size (default 18)
   * @param {string} cls     Optional class attribute
   */
  window.lcIcon = function (name, size, cls) {
    size = size || 18;
    cls = cls || 'lc-icon';
    return '<svg xmlns="http://www.w3.org/2000/svg" ' +
      'width="' + size + '" height="' + size + '" ' +
      'viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.75" ' +
      'stroke-linecap="round" stroke-linejoin="round" ' +
      'class="' + cls + '" aria-hidden="true">' +
      (ICONS[name] || ICONS.info) +
      '</svg>';
  };

  /**
   * Inject an SVG into an existing DOM element, replacing its contents.
   * Handy for building sidebars where you already have a container.
   */
  window.lcIconInto = function (el, name, size, cls) {
    if (!el) return;
    el.innerHTML = window.lcIcon(name, size, cls);
  };

  /** List of available icon names (useful for a designer / picker page). */
  window.lcIconNames = function () {
    return Object.keys(ICONS);
  };

  /* =========================================================
     EMOJI → SVG
     Pages were written with emoji as button/tab/heading icons.
     Swap the common ones for the SVG set at runtime so controls
     look consistent on every device and stay in the theme colour.
     Only text inside controls and headings is touched; data
     (patient names, category icons, notes) is left alone.
  ========================================================= */
  var EMOJI_MAP = {
    '📊': 'reports', '📈': 'trendUp', '📋': 'requests', '🚨': 'alert', '⚠': 'alert', '⚠️': 'alert',
    '✅': 'check', '🔍': 'search', '🔎': 'search', '🖨️': 'print', '🖨': 'print', '💰': 'prices',
    '🔄': 'refresh', '📤': 'upload', '📥': 'download', '💾': 'save', '✏️': 'edit', '✎': 'edit', '📝': 'edit',
    '🗑️': 'trash', '🗑': 'trash', '⚙️': 'settings', '⚙': 'settings', '🔒': 'lock', '🔐': 'lock', '🔓': 'unlock',
    '🔑': 'key', '🏷️': 'labels', '🏷': 'labels', '🧪': 'specimens', '🩺': 'nursing', '🏥': 'ward',
    '👥': 'patients', '👤': 'account', '🔗': 'link', '📄': 'receipts', '🧾': 'receipts', '💡': 'info',
    '❌': 'close', '🚫': 'close', '🔔': 'bell', '📧': 'mail', '🔀': 'merge', '📷': 'camera'
  };
  var EMOJI_RE = new RegExp(Object.keys(EMOJI_MAP).sort(function (a, b) { return b.length - a.length; })
    .map(function (k) { return k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|'), 'g');
  var CONTROL_SEL = 'button, .btn, [class*="btn-"], .lc-tab, .tab, [role="tab"], th, h1, h2, h3, h4, label, .section-title, .lc-card-head, .lc-modal-head, .modal-header';
  var SKIP_TAGS = { INPUT: 1, TEXTAREA: 1, SELECT: 1, OPTION: 1, SCRIPT: 1, STYLE: 1, TITLE: 1, CODE: 1, PRE: 1, svg: 1 };

  function swapEmoji(root) {
    if (!root || !document.createTreeWalker) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var hits = [], n;
    while ((n = walker.nextNode())) {
      if (!n.nodeValue || !EMOJI_RE.test(n.nodeValue)) { EMOJI_RE.lastIndex = 0; continue; }
      EMOJI_RE.lastIndex = 0;
      var el = n.parentElement;
      if (!el || SKIP_TAGS[el.tagName] || el.closest('[data-keep-emoji], [contenteditable], option, textarea')) continue;
      if (!el.closest(CONTROL_SEL)) continue;
      hits.push(n);
    }
    hits.forEach(function (node) {
      var text = node.nodeValue, frag = document.createDocumentFragment(), last = 0, m;
      var onlyIcon = text.replace(EMOJI_RE, '').trim() === '';
      EMOJI_RE.lastIndex = 0;
      while ((m = EMOJI_RE.exec(text))) {
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        var span = document.createElement('span');
        span.className = 'lc-ico' + (onlyIcon ? ' lc-ico--solo' : '');
        span.setAttribute('aria-hidden', 'true');
        span.innerHTML = window.lcIcon(EMOJI_MAP[m[0]], 16, 'lc-ico-svg');
        frag.appendChild(span);
        last = m.index + m[0].length;
        // swallow the space that followed the emoji; the icon carries its own margin
        if (text.charAt(last) === ' ') last++;
      }
      EMOJI_RE.lastIndex = 0;
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      if (node.parentNode) node.parentNode.replaceChild(frag, node);
    });
  }

  function startEmojiSwap() {
    if (!document.body) return;
    swapEmoji(document.body);
    var queued = false;
    new MutationObserver(function () {
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () { queued = false; swapEmoji(document.body); });
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startEmojiSwap);
  else startEmojiSwap();

  console.log('🎨 LabCore Icons loaded —', Object.keys(ICONS).length, 'icons');
})();