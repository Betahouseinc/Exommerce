/* Google Analytics 4 — loaded only after the visitor accepts analytics cookies.
   Shares one property with leadgenai.exommerce.online so a visit that moves from
   the marketing site to the app stays a single session. Split reporting by
   hostname in GA. Included on every page via <script defer src="/analytics.js">. */
(function () {
  var KEY = 'exommerce_cookie_consent';
  var GA_ID = 'G-6Y7V342NV8';

  function stored() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function remember(choice) {
    try { localStorage.setItem(KEY, choice); } catch (e) {}
  }

  window.loadGA = function () {
    if (window.__gaLoaded) return;
    window.__gaLoaded = true;
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    function gtag() { dataLayer.push(arguments); }
    window.gtag = gtag;
    gtag('js', new Date());
    gtag('config', GA_ID);
  };

  if (stored() === 'accepted') {
    window.loadGA();
    return;
  }
  if (stored() === 'declined') return;

  function banner() {
    var style = document.createElement('style');
    style.textContent = [
      '.ck-bar{position:fixed;left:0;right:0;bottom:0;z-index:9999;',
      'display:flex;align-items:center;justify-content:center;gap:16px;flex-wrap:wrap;',
      'padding:14px 24px;background:var(--surface,#fff);',
      'border-top:1px solid var(--border,#DDE8E0);box-shadow:0 -2px 16px rgba(11,13,12,.08);',
      'font-family:var(--ff-body,Inter,system-ui,sans-serif)}',
      '.ck-bar p{margin:0;flex:1 1 320px;max-width:880px;font-size:14px;line-height:1.6;color:var(--text2,#4B5560)}',
      '.ck-bar a{color:var(--brand-green,#109840);font-weight:500}',
      '.ck-btns{display:flex;gap:8px;flex-shrink:0}',
      '.ck-bar button{padding:9px 18px;border-radius:8px;font-size:14px;font-weight:500;cursor:pointer;',
      'font-family:inherit;line-height:1.2}',
      '.ck-no{background:none;border:1px solid var(--border,#DDE8E0);color:var(--text2,#4B5560)}',
      '.ck-no:hover{border-color:var(--border-strong,#C9D9CE)}',
      '.ck-yes{background:var(--brand-green,#109840);border:1px solid var(--brand-green,#109840);color:#fff;font-weight:600}',
      '.ck-yes:hover{background:var(--brand-green-dark,#087A32);border-color:var(--brand-green-dark,#087A32)}'
    ].join('');
    document.head.appendChild(style);

    var bar = document.createElement('div');
    bar.className = 'ck-bar';
    bar.setAttribute('role', 'dialog');
    bar.setAttribute('aria-label', 'Cookie consent');
    bar.innerHTML =
      '<p>We use analytics cookies to understand how visitors use this site — no advertising ' +
      'or cross-site tracking. See our <a href="/privacy.html">Privacy Policy</a>.</p>' +
      '<div class="ck-btns">' +
      '<button type="button" class="ck-no">Decline</button>' +
      '<button type="button" class="ck-yes">Accept analytics</button>' +
      '</div>';

    bar.querySelector('.ck-yes').addEventListener('click', function () {
      remember('accepted');
      window.loadGA();
      bar.remove();
    });
    bar.querySelector('.ck-no').addEventListener('click', function () {
      remember('declined');
      bar.remove();
    });

    document.body.appendChild(bar);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', banner);
  } else {
    banner();
  }
})();
