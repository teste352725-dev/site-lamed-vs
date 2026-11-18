// Fotos leves da vitrine.
// O build (scripts/build-images.mjs) gera versoes WebP das fotos do catalogo e
// publica /img/manifest.json. Aqui a vitrine troca a foto original (que pode ter
// 14 MB) pela versao do tamanho certo. Sem manifesto, ou se a versao leve falhar,
// a foto original continua sendo usada.
(function () {
    'use strict';

    var WIDTHS = [480, 1080];
    var manifest = null;
    var MANIFEST_TIMEOUT_MS = 2500;

    function variantFor(key, width) {
        return 'img/p/' + key + '-' + width + '.webp';
    }

    function pickWidth(width) {
        var wanted = Number(width) || WIDTHS[WIDTHS.length - 1];
        for (var i = 0; i < WIDTHS.length; i += 1) {
            if (WIDTHS[i] >= wanted) return WIDTHS[i];
        }
        return WIDTHS[WIDTHS.length - 1];
    }

    function lookup(src) {
        if (!manifest || !manifest.items || typeof src !== 'string') return '';
        return manifest.items[src] || '';
    }

    var ready = new Promise(function (resolve) {
        var done = false;
        var finish = function () {
            if (done) return;
            done = true;
            resolve(manifest);
        };
        window.setTimeout(finish, MANIFEST_TIMEOUT_MS);
        try {
            fetch('img/manifest.json', { cache: 'no-cache' })
                .then(function (response) { return response.ok ? response.json() : null; })
                .then(function (payload) {
                    if (payload && payload.items && typeof payload.items === 'object') {
                        manifest = payload;
                        if (Array.isArray(payload.widths) && payload.widths.length) {
                            WIDTHS = payload.widths.map(Number).filter(Boolean).sort(function (a, b) { return a - b; });
                        }
                    }
                })
                .catch(function () {})
                .then(finish);
        } catch (error) {
            finish();
        }
    });

    // Se uma versao leve nao carregar (ex.: deploy antigo em cache), volta para a original.
    document.addEventListener('error', function (event) {
        var img = event.target;
        if (!img || img.tagName !== 'IMG') return;
        var original = img.getAttribute('data-original-src');
        if (!original || img.getAttribute('data-fallback-done') === '1') return;
        img.setAttribute('data-fallback-done', '1');
        img.removeAttribute('srcset');
        img.src = original;
    }, true);

    window.LamedImages = {
        ready: ready,
        // URL da versao leve mais proxima da largura pedida (em px de tela * densidade).
        url: function (src, width) {
            var key = lookup(src);
            return key ? variantFor(key, pickWidth(width)) : src;
        },
        srcset: function (src) {
            var key = lookup(src);
            if (!key) return '';
            return WIDTHS.map(function (w) { return variantFor(key, w) + ' ' + w + 'w'; }).join(', ');
        },
        has: function (src) {
            return !!lookup(src);
        }
    };
})();
