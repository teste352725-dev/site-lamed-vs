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
