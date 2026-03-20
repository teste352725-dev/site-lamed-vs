(function enableEmbeddedAdminMode() {
    const params = new URLSearchParams(window.location.search);
    const embedded = window.self !== window.top || params.get("embedded") === "1";
    if (!embedded) return;

    const style = document.createElement("style");
    style.textContent = `
        html, body {
            height: 100%;
        }

        body.admin-embedded {
            padding-bottom: 0 !important;
            min-height: 100vh !important;
            background-color: #f8fafc !important;
        }

        body.admin-embedded > header:first-of-type {
            display: none !important;
        }

        body.admin-embedded main,
        body.admin-embedded .max-w-4xl,
        body.admin-embedded .max-w-7xl {
            max-width: none !important;
            width: 100% !important;
        }

        body.admin-embedded main {
            padding-top: 1rem !important;
            padding-bottom: 1.25rem !important;
        }

        body.admin-embedded .page-shell {
            max-width: none !important;
            padding: 0 0 1.25rem !important;
        }

        body.admin-embedded .hero-panel {
            position: static !important;
            top: auto !important;
            margin-bottom: 1rem !important;
        }

        body.admin-embedded .ghost-button {
            display: none !important;
        }

        body.admin-embedded .modal {
            padding: 0 !important;
        }

        body.admin-embedded .modal-shell,
        body.admin-embedded .gallery-shell {
            width: 100% !important;
            max-height: 100vh !important;
            min-height: 100vh !important;
            border-radius: 0 !important;
        }
    `;
    document.head.appendChild(style);

    let resizeFrameRequest = null;
    let resizeDebounceTimer = null;
    let lastPostedHeight = 0;

    const sendHeightToParent = () => {
        resizeFrameRequest = null;
        if (window.parent === window) return;

        const height = Math.max(
            document.documentElement.scrollHeight,
            document.body?.scrollHeight || 0,
            document.documentElement.offsetHeight,
            document.body?.offsetHeight || 0
        );

        if (Math.abs(height - lastPostedHeight) < 6) return;
        lastPostedHeight = height;

        window.parent.postMessage({
            type: "admin-embedded-size",
            page: window.location.pathname.split("/").pop(),
            height
        }, window.location.origin);
    };

    const scheduleResizeMessage = (immediate = false) => {
        if (resizeFrameRequest !== null) {
            cancelAnimationFrame(resizeFrameRequest);
        }
        if (resizeDebounceTimer !== null) {
            clearTimeout(resizeDebounceTimer);
        }

        const queue = () => {
            resizeDebounceTimer = null;
            resizeFrameRequest = requestAnimationFrame(sendHeightToParent);
        };

        if (immediate) {
            queue();
            return;
        }

        resizeDebounceTimer = window.setTimeout(queue, 90);
    };

    const activate = () => {
        if (!document.body) return;
        document.body.classList.add("admin-embedded");
        scheduleResizeMessage();
    };

    if (document.body) {
        activate();
    } else {
        document.addEventListener("DOMContentLoaded", activate, { once: true });
    }

    window.addEventListener("load", () => scheduleResizeMessage(true));
    window.addEventListener("resize", scheduleResizeMessage);
    window.addEventListener("orientationchange", () => scheduleResizeMessage(true));

    const startObservers = () => {
        if (!document.body) return;

        if ("ResizeObserver" in window) {
            const resizeObserver = new ResizeObserver(() => scheduleResizeMessage());
            resizeObserver.observe(document.body);
            resizeObserver.observe(document.documentElement);
        }

        const mutationObserver = new MutationObserver(() => scheduleResizeMessage());
        mutationObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", startObservers, { once: true });
    } else {
        startObservers();
    }
})();
