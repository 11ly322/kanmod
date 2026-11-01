(function () {
  var KEY = 'kanmod-theme';
  function normalize(value) { return value === 'dark' ? 'dark' : 'light'; }
  function read() {
    try { return normalize(localStorage.getItem(KEY)); } catch (error) { return 'light'; }
  }
  function apply(value) {
    var next = normalize(value);
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem(KEY, next); } catch (error) { /* private mode */ }
    var meta = document.querySelector('meta[name="color-scheme"]');
    if (meta) meta.setAttribute('content', next === 'dark' ? 'dark' : 'light');
    var color = document.querySelector('meta[name="theme-color"]');
    if (color) color.setAttribute('content', next === 'dark' ? '#131011' : '#ffffff');
    return next;
  }
  apply(read());
  window.kanmodTheme = {
    get: function () { return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'; },
    set: apply,
    toggle: function () { return apply(window.kanmodTheme.get() === 'dark' ? 'light' : 'dark'); },
  };
})();
