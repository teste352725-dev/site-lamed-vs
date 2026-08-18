(function enableEmbeddedAdminMode() {
    const params = new URLSearchParams(window.location.search);
    const embedded = window.self !== window.top || params.get("embedded") === "1";
    if (!embedded) return;

    const style = document.createElement("style");
    style.textContent = `
        html, body {
            height: auto !important;
            min-height: 100% !important;
            overflow-x: hidden !important;
            overflow-y: auto !important;
            overscroll-behavior: contain;
        }

        body.admin-embedded {
            padding-bottom: 0 !important;
            min-height: 100% !important;
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

        body.admin-embedded .hero-panel .hero-subtitle,
        body.admin-embedded .hero-panel .summary-strip,
        body.admin-embedded .control-panel > .section-kicker,
        body.admin-embedded .control-panel > .section-title,
        body.admin-embedded .control-panel > .section-subtitle,
        body.admin-embedded .control-panel > .modal-panel {
            display: none !important;
        }

        body.admin-embedded .hero-panel,
        body.admin-embedded .control-panel {
            padding: 1rem !important;
        }

        body.admin-embedded .filters-grid {
            margin-top: 0 !important;
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
            max-height: 100dvh !important;
            min-height: 100dvh !important;
            border-radius: 0 !important;
        }
    `;
    document.head.appendChild(style);

    const activate = () => {
        if (!document.body) return;
        document.body.classList.add("admin-embedded");
    };

    if (document.body) {
        activate();
    } else {
        document.addEventListener("DOMContentLoaded", activate, { once: true });
    }

})();
