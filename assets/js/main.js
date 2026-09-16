/* ============================================================
   LANGUAGE SYSTEM
   ============================================================ */
function setLang(lang) {
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === lang);
  });
  document.documentElement.lang = lang === 'pt' ? 'pt-BR' : 'en';
  document.querySelectorAll('[data-en]').forEach(el => {
    const text = el.getAttribute('data-' + lang);
    if (text) el.innerHTML = text;
  });
  localStorage.setItem('lang', lang);
}

function initLang() {
  const forced = document.body.dataset.forceLang;
  if (forced) { setLang(forced); return; }
  const saved = localStorage.getItem('lang');
  const browser = navigator.language.startsWith('pt') ? 'pt' : 'en';
  setLang(saved || browser);
}

/* ============================================================
   NAV SCROLL BEHAVIOR
   ============================================================ */
function initNav() {
  const nav = document.querySelector('.nav');
  if (!nav) return;
  const onScroll = () => {
    nav.classList.toggle('scrolled', window.scrollY > 20);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Mobile toggle
  const toggle = document.querySelector('.nav-mobile-toggle');
  if (toggle) {
    toggle.addEventListener('click', () => nav.classList.toggle('mobile-open'));
  }

  // Active link highlighting
  const links = document.querySelectorAll('.nav-links a[data-page]');
  const currentPage = document.body.dataset.page;
  links.forEach(link => {
    if (link.dataset.page === currentPage) link.classList.add('active');
  });
}

/* ============================================================
   SCROLL REVEAL
   ============================================================ */
function initReveal() {
  const els = document.querySelectorAll('.reveal');
  if (!els.length) return;
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('visible');
        obs.unobserve(e.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  els.forEach(el => obs.observe(el));
}

/* ============================================================
   HERO VISUAL PARALLAX
   Scroll-linked, not a looping animation: the hero illustration
   drifts slightly slower than the page as you scroll past it, so
   it feels alive without competing with the H1 for attention.
   Respects prefers-reduced-motion. Only runs while the hero is
   near the viewport, for performance.
   ============================================================ */
function initHeroParallax() {
  const visual = document.getElementById('hero-visual');
  if (!visual) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const heroSection = visual.closest('.hero');
  if (!heroSection) return;

  const speedFactor = 0.18; // visual moves at 18% of scroll distance
  let ticking = false;

  const update = () => {
    const rect = heroSection.getBoundingClientRect();
    // Only animate while the hero is at least partly on screen
    if (rect.bottom > 0 && rect.top < window.innerHeight) {
      const offset = rect.top * speedFactor * -1;
      visual.style.transform = `translateY(${offset}px)`;
    }
    ticking = false;
  };

  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(update);
      ticking = true;
    }
  }, { passive: true });

  update();
}

/* ============================================================
   HERO COUNTER ANIMATION
   ============================================================ */
function animateCounter(el, target, duration, prefix, suffix) {
  const start = performance.now();
  const step = (now) => {
    const progress = Math.min((now - start) / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3);
    const value = Math.floor(ease * target);
    el.textContent = prefix + value.toLocaleString() + suffix;
    if (progress < 1) requestAnimationFrame(step);
    else el.textContent = prefix + target.toLocaleString() + suffix;
  };
  requestAnimationFrame(step);
}

function initCounters() {
  const counters = document.querySelectorAll('[data-count]');
  if (!counters.length) return;
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        const el = e.target;
        animateCounter(
          el,
          parseInt(el.dataset.count),
          1400,
          el.dataset.prefix || '',
          el.dataset.suffix || ''
        );
        obs.unobserve(el);
      }
    });
  }, { threshold: 0.5 });
  counters.forEach(el => obs.observe(el));
}

/* ============================================================
   CONTACT EMAIL (built at runtime, not present in page source)
   ============================================================ */
function initContactEmail() {
  const slot = document.getElementById('contact-email-slot');
  if (!slot) return;
  const user = 'jose';
  const domain = 'bozelli' + '.' + 'ca';
  const at = String.fromCharCode(64); // '@'
  const address = user + at + domain;
  const link = document.createElement('a');
  link.href = 'mailto:' + address;
  link.className = 'contact-link';
  link.textContent = '→ ' + address;
  slot.replaceWith(link);
}

/* ============================================================
   INIT
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  initLang();
  initNav();
  initReveal();
  initHeroParallax();
  initContactEmail();
  initCounters();
});