// Applied before the page draws, so the saved theme never flashes. A file, not inline, so the CSP needs no exception.
(() => {
  let saved;
  try { saved = localStorage.getItem("kedu-theme"); } catch {}
  document.documentElement.dataset.theme = saved === "dark" || (saved !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
})();
