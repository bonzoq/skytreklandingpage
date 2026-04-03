// SkyTrek — Interactions
(function () {
  'use strict';

  var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // --- Hero word animation ---
  if (!prefersReducedMotion) {
    requestAnimationFrame(function () {
      document.body.classList.add('loaded');
    });
  } else {
    document.body.classList.add('loaded');
  }

  // --- Scroll reveal (standard .reveal elements) ---
  var revealEls = document.querySelectorAll('.reveal');
  var featureCards = document.querySelectorAll('.feature-grid__card');

  if ('IntersectionObserver' in window && !prefersReducedMotion) {
    var revealObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );

    revealEls.forEach(function (el) { revealObserver.observe(el); });
    featureCards.forEach(function (el) { revealObserver.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add('visible'); });
    featureCards.forEach(function (el) { el.classList.add('visible'); });
  }

  // --- Sticky nav background ---
  var nav = document.getElementById('nav');

  function updateNav() {
    if (window.scrollY > 40) {
      nav.classList.add('scrolled');
    } else {
      nav.classList.remove('scrolled');
    }
  }

  window.addEventListener('scroll', updateNav, { passive: true });
  updateNav();

  // --- Active nav link tracking ---
  var navLinks = document.querySelectorAll('.nav__link[data-section]');
  var sections = [];

  navLinks.forEach(function (link) {
    var href = link.getAttribute('href');
    if (href && href.startsWith('#')) {
      var section = document.querySelector(href);
      if (section) {
        sections.push({ el: section, link: link });
      }
    }
  });

  if ('IntersectionObserver' in window && sections.length > 0) {
    var visibleSections = new Set();
    var activeObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          var match = sections.find(function (s) { return s.el === entry.target; });
          if (match) {
            if (entry.isIntersecting) {
              visibleSections.add(match.el);
              navLinks.forEach(function (l) { l.classList.remove('active'); });
              match.link.classList.add('active');
            } else {
              visibleSections.delete(match.el);
              if (visibleSections.size === 0) {
                navLinks.forEach(function (l) { l.classList.remove('active'); });
              }
            }
          }
        });
      },
      { threshold: 0.2, rootMargin: '-80px 0px -40% 0px' }
    );

    sections.forEach(function (s) { activeObserver.observe(s.el); });
  }

  // --- Mobile navigation ---
  var navToggle = document.getElementById('navToggle');
  var navMenu = document.getElementById('navMenu');

  navToggle.addEventListener('click', function () {
    var isOpen = navMenu.classList.toggle('open');
    navToggle.classList.toggle('active');
    navToggle.setAttribute('aria-expanded', isOpen);
    document.body.style.overflow = isOpen ? 'hidden' : '';
  });

  navMenu.querySelectorAll('a').forEach(function (link) {
    link.addEventListener('click', function () {
      navMenu.classList.remove('open');
      navToggle.classList.remove('active');
      navToggle.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
    });
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && navMenu.classList.contains('open')) {
      navMenu.classList.remove('open');
      navToggle.classList.remove('active');
      navToggle.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
    }
  });
})();
