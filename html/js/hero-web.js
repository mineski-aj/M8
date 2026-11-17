/* Hero KOTAK portraits: assets/hero/web/HERO_<id>_KOTAK.webp (512px WebP, ~25KB each — the 1000px PNG originals were removed). Include right after theme-apply.js. */
function heroWebUrl(id, prefix) {
  return (prefix === undefined ? '' : prefix) + 'assets/hero/web/HERO_' + id + '_KOTAK.webp';
}
