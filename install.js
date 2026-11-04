// GRIT: "Install the app?" banner. On Chrome/Edge/Samsung (Android + desktop) it uses the browser's own
// install prompt; on iPhone/iPad Safari (no prompt API) it shows the Add to Home Screen steps.
(function () {
  const KEY = 'grit-install-dismissed';
  const SNOOZE_DAYS = 14;
  let deferred = null, shown = false;
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true || !!window.Capacitor;
  const snoozed = () => { try { const t = +localStorage.getItem(KEY); return t && Date.now() - t < SNOOZE_DAYS * 864e5; } catch (_) { return false; } };
  const snooze = () => { try { localStorage.setItem(KEY, String(Date.now())); } catch (_) { /* private mode */ } };
  const ua = navigator.userAgent;
  const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isIOSSafari = isIOS && /safari/i.test(ua) && !/crios|fxios|edgios|gsa\//i.test(ua);

  function hide() {
    const el = document.getElementById('install-banner'); if (!el) return;
    el.classList.remove('show'); setTimeout(() => el.remove(), 300);
  }
  function show(ios) {
    if (shown || standalone() || snoozed()) return;
    shown = true;
    const el = document.createElement('div');
    el.id = 'install-banner'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Install GRIT');
    el.innerHTML = `<img src="icon-192.png" alt="" width="44" height="44">
      <div class="ib-text"><strong>Install GRIT</strong>
        <span>${ios ? 'Tap <b>Share</b> <svg aria-hidden="true" width="14" height="16" viewBox="0 0 14 18" style="vertical-align:-2px"><path d="M7 1v11M3.5 4.5 7 1l3.5 3.5M4.5 7.5H2v9.5h10V7.5H9.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg> then <b>Add to Home Screen</b> for the full app and notifications.' : 'Add it to your home screen. Opens like an app, works offline, gets notifications.'}</span></div>
      <div class="ib-btns">${ios ? '' : '<button class="btn small primary" data-ib="install">Install</button>'}
        <button class="btn small" data-ib="later">${ios ? 'Got it' : 'Not now'}</button></div>`;
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-ib]'); if (!b) return;
      if (b.dataset.ib === 'install' && deferred) {
        deferred.prompt();
        const { outcome } = await deferred.userChoice.catch(() => ({ outcome: 'dismissed' }));
        deferred = null;
        if (outcome !== 'accepted') snooze();
      } else snooze();
      hide();
    });
    document.body.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // use our banner instead of Chrome's small bar
    deferred = e;
    setTimeout(() => show(false), 1500);
  });
  window.addEventListener('appinstalled', () => { deferred = null; hide(); });
  if (isIOSSafari && !standalone()) window.addEventListener('load', () => setTimeout(() => show(true), 2500));

  window.Install = { canPrompt: () => !!deferred, prompt: () => { shown = false; try { localStorage.removeItem(KEY); } catch (_) {} if (deferred) show(false); else if (isIOS) show(true); } };
})();
