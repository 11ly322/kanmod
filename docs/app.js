(function () {
  'use strict';

  const header = document.querySelector('.site-header');
  const menuButton = document.querySelector('.menu-btn');
  const nav = document.querySelector('.site-nav');

  function setMenu(open) {
    if (!menuButton || !nav) return;
    menuButton.setAttribute('aria-expanded', String(open));
    nav.classList.toggle('open', open);
  }

  menuButton?.addEventListener('click', () => {
    setMenu(menuButton.getAttribute('aria-expanded') !== 'true');
  });

  nav?.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => setMenu(false));
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setMenu(false);
  });

  window.addEventListener('scroll', () => {
    header?.classList.toggle('scrolled', window.scrollY > 16);
  }, { passive: true });
  header?.classList.toggle('scrolled', window.scrollY > 16);

  const revealItems = [...document.querySelectorAll('.reveal')];
  if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    revealItems.forEach((item) => {
      item.classList.add('reveal-ready');
      observer.observe(item);
    });
  }

  const sections = [...document.querySelectorAll('main section[id]')];
  const navAnchors = [...document.querySelectorAll('.site-nav a[href^="#"]')];
  if ('IntersectionObserver' in window && sections.length) {
    const spy = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        navAnchors.forEach((link) => {
          link.classList.toggle('active', link.getAttribute('href') === '#' + entry.target.id);
        });
      });
    }, { rootMargin: '-35% 0px -55% 0px' });
    sections.forEach((section) => spy.observe(section));
  }

  const dialog = document.createElement('dialog');
  dialog.className = 'lightbox';
  dialog.innerHTML = '<button type="button" class="lightbox-close" aria-label="关闭大图">×</button><img alt="">';
  document.body.appendChild(dialog);
  const dialogImage = dialog.querySelector('img');
  const closeButton = dialog.querySelector('.lightbox-close');

  document.querySelectorAll('.shot-main img, .shot-side img').forEach((image) => {
    image.tabIndex = 0;
    image.setAttribute('role', 'button');
    image.setAttribute('aria-label', '放大查看界面截图');
    image.addEventListener('click', () => {
      dialogImage.src = image.currentSrc || image.src;
      dialogImage.alt = image.alt;
      dialog.showModal();
    });
    image.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      image.click();
    });
  });

  closeButton.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  const toast = document.createElement('div');
  toast.className = 'site-toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  document.body.appendChild(toast);

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 2200);
  }

  const hash = document.querySelector('.download-foot code');
  if (hash) {
    hash.tabIndex = 0;
    hash.setAttribute('role', 'button');
    hash.setAttribute('aria-label', '复制安装包 SHA256 校验值');
    hash.style.cursor = 'copy';
    const copyHash = async () => {
      try {
        await navigator.clipboard.writeText(hash.textContent.trim());
        showToast('SHA256 已复制');
      } catch {
        showToast('复制失败，请手动选择');
      }
    };
    hash.addEventListener('click', copyHash);
    hash.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        copyHash();
      }
    });
  }
})();
