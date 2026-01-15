// ===============================
// GA4 TRACKING (MOBILE SAFE MODE)
// ===============================

(function () {

  function track(event, params = {}) {
    if (typeof window.gtag === "function") {
      window.gtag("event", event, params);
    }
  }

  // --- PAGE VIEW (SPA HASH CHANGE)
  window.addEventListener("hashchange", () => {
    track("page_view", {
      page_location: window.location.href,
      page_path: window.location.hash || "/"
    });
  });

  // --- FIRST LOAD
  track("page_view", {
    page_location: window.location.href,
    page_path: window.location.hash || "/"
  });

  // --- CLICK TRACKING (CART, FAVORITE, WHATSAPP)
  document.addEventListener("click", (e) => {

    // ADD TO CART
    if (e.target.closest("#add-to-cart-button")) {
      track("add_to_cart");
    }

    // FAVORITE
    if (e.target.closest("#btn-favorite")) {
      track("add_to_favorites");
    }

    // FINALIZAR PEDIDO
    if (e.target.closest("#finalizar-pedido-btn")) {
      track("begin_checkout");
    }

    // WHATSAPP
    if (e.target.closest("a[href*='wa.me'], a[href*='whatsapp']")) {
      track("click_whatsapp");
    }

  });

})();
