/* Published installers only. Keep these versioned URLs in sync with the page. */
const thingaryDownloads = Object.freeze({
  mac: 'https://github.com/CoderJackZhu/Thingary/releases/download/v0.0.7/Thingary-0.0.7-universal.dmg',
  windows: 'https://github.com/CoderJackZhu/Thingary/releases/download/v0.0.7/Thingary_0.0.7_x64-setup.exe',
});

function detectThingaryPlatform(browser) {
  const ua = browser.userAgent || '';
  const platform = browser.userAgentData?.platform || browser.platform || '';
  // iPadOS may advertise a Mac desktop user agent. Do not suggest a DMG for it.
  if (/Android|iPhone|iPad|iPod|Windows Phone/i.test(ua)
      || /Android|iOS/i.test(platform)
      || (/Mac/i.test(platform) && browser.maxTouchPoints > 1)) return '';
  if (/Windows|Win32|Win64/i.test(platform) || /Windows NT/i.test(ua)) return 'windows';
  if (/Mac/i.test(platform) || /Macintosh|Mac OS X/i.test(ua)) return 'mac';
  return '';
}

function defaultThingaryPlatform(browser) {
  return detectThingaryPlatform(browser) || 'mac';
}

function initializeThingaryDownloads(root, browser) {
  const controls = [...root.querySelectorAll('[data-download-control]')];
  if (!controls.length) return;
  const suggestedPlatform = defaultThingaryPlatform(browser);

  const descriptions = {
    zh: {
      mac: 'Mac 通用版 · Apple Silicon / Intel · DMG · 未签名公开测试版',
      windows: 'Windows 10 1809+ / 11 · x64 · EXE · 未签名公开测试版',
    },
    en: {
      mac: 'Universal Mac · Apple Silicon / Intel · DMG · Unsigned public beta',
      windows: 'Windows 10 1809+ / 11 · x64 · EXE · Unsigned public beta',
    },
  };

  function selectPlatform(platform) {
    for (const control of controls) {
      const language = control.dataset.downloadLanguage;
      const selected = Object.hasOwn(thingaryDownloads, platform) ? platform : 'mac';
      const link = control.querySelector('[data-download-link]');
      const label = selected === 'mac' ? (language === 'zh' ? 'Mac 通用版' : 'Mac Universal') : 'Windows x64';
      control.querySelector('[data-platform-label]').textContent = label;
      control.querySelector('[data-platform-trigger]').setAttribute('aria-label', `${language === 'zh' ? '下载平台' : 'Download platform'}: ${label}`);
      for (const option of control.querySelectorAll('[data-platform-option]')) {
        const active = option.dataset.platformOption === selected;
        option.setAttribute('aria-selected', String(active));
        option.tabIndex = active ? 0 : -1;
      }
      link.href = thingaryDownloads[selected];
      link.querySelector('[data-download-label]').textContent = language === 'zh' ? '下载物谱' : 'Download';
      root.querySelector(`#${control.dataset.downloadDescription}`).textContent = descriptions[language][selected];
    }
  }

  function closeMenu(control, focusTrigger = false) {
    control.querySelector('[role="listbox"]').hidden = true;
    const trigger = control.querySelector('[data-platform-trigger]');
    trigger.setAttribute('aria-expanded', 'false');
    if (focusTrigger) trigger.focus();
  }

  function openMenu(control) {
    for (const other of controls) closeMenu(other);
    control.querySelector('[role="listbox"]').hidden = false;
    control.querySelector('[data-platform-trigger]').setAttribute('aria-expanded', 'true');
    control.querySelector('[aria-selected="true"]').focus();
  }

  for (const control of controls) {
    const trigger = control.querySelector('[data-platform-trigger]');
    const menu = control.querySelector('[role="listbox"]');
    const options = [...control.querySelectorAll('[data-platform-option]')];
    control.querySelector('[data-platform-switch]').hidden = false;
    trigger.addEventListener('click', () => menu.hidden ? openMenu(control) : closeMenu(control));
    trigger.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        openMenu(control);
      } else if (event.key === 'Escape') closeMenu(control);
    });
    for (const option of options) option.addEventListener('click', () => {
      selectPlatform(option.dataset.platformOption);
      closeMenu(control, true);
    });
    menu.addEventListener('keydown', event => {
      const index = options.indexOf(root.activeElement);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
        options[next].focus();
      } else if (event.key === 'Escape' || event.key === 'Tab') {
        if (event.key === 'Escape') event.preventDefault();
        closeMenu(control, true);
      }
    });
    control.addEventListener('focusout', event => {
      if (!control.contains(event.relatedTarget)) closeMenu(control);
    });
  }

  root.addEventListener('pointerdown', event => {
    for (const control of controls) if (!control.contains(event.target)) closeMenu(control);
  });
  for (const radio of root.querySelectorAll('input[name="language"]')) {
    radio.addEventListener('change', () => { for (const control of controls) closeMenu(control); });
  }

  selectPlatform(suggestedPlatform);
  for (const control of controls) control.querySelector('[data-download-fallback]').hidden = true;
}

if (typeof document !== 'undefined') initializeThingaryDownloads(document, navigator);
