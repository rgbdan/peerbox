// Theme toggle, loaded sync in <head> so it applies before first paint (CSP
// forbids inline scripts). Dark is default; only "light" changes the page.
(function () {
  'use strict';

  var KEY = 'peerbox-theme';
  var root = document.documentElement;

  // Marks that JS ran, which is what reveals the toggle button.
  root.className += (root.className ? ' ' : '') + 'js';

  function stored() {
    try {
      return localStorage.getItem(KEY);
    } catch (e) {
      // Private mode and blocked site data both throw here.
      return null;
    }
  }

  function apply(theme) {
    if (theme === 'light') {
      root.setAttribute('data-theme', 'light');
    } else {
      root.removeAttribute('data-theme');
    }
  }

  apply(stored());

  document.addEventListener('DOMContentLoaded', function () {
    var button = document.querySelector('[data-theme-toggle]');
    if (!button) {
      return;
    }

    function sync() {
      var dark = root.getAttribute('data-theme') !== 'light';
      button.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
      button.setAttribute('aria-pressed', dark ? 'true' : 'false');
    }

    sync();

    button.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      apply(next);
      try {
        localStorage.setItem(KEY, next);
      } catch (e) {
        // Choice will not persist; the page still switches for this visit.
      }
      sync();
    });
  });
})();
