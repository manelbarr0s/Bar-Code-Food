(function () {
  'use strict';

  var OFF_FIELDS = [
    'code', 'product_name', 'product_name_pt', 'generic_name_pt', 'brands', 'quantity',
    'product_quantity', 'product_quantity_unit', 'image_front_url', 'image_front_small_url',
    'image_url', 'nutriments', 'nutriscore_grade', 'categories_tags'
  ].join(',');
  var SCAN_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'qr_code', 'data_matrix', 'databar_expanded', 'databar_expanded_stacked', 'code_128'];
  var TWO_D = ['qr_code', 'data_matrix', 'databar_expanded', 'databar_expanded_stacked', 'code_128'];
  // Depois de ver um EAN, continua a procurar um código 2D na mesma imagem durante este tempo.
  var WAIT_FOR_2D_MS = 700;
  var PANTRY_KEY = 'bcf.pantry.v1';

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    tabScan: $('tab-scan'), tabPantry: $('tab-pantry'), count: $('pantry-count'),
    viewScan: $('view-scan'), viewPantry: $('view-pantry'),
    scanner: $('scanner'), viewfinder: $('viewfinder'), video: $('video'),
    btnCamera: $('btn-camera'), btnTorch: $('btn-torch'), btnStop: $('btn-stop'),
    photo: $('photo-input'), status: $('status'), result: $('result'),
    examples: $('examples'), manualForm: $('manual-form'), manualCode: $('manual-code'),
    tryPanel: $('try-panel'), pantryList: $('pantry-list'), pantryEmpty: $('pantry-empty'),
    goScan: $('btn-go-scan')
  };

  // ---------- utilidades ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function startOfDay(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  // As datas GS1 vêm em UTC; usa o dia do calendário, não a hora.
  function calendarDay(d) { return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); }
  function daysUntil(d) { return Math.round((startOfDay(d) - startOfDay(new Date())) / 86400000); }
  function fmtDate(d) {
    var dd = String(d.getDate()).padStart(2, '0'), mm = String(d.getMonth() + 1).padStart(2, '0');
    return dd + '.' + mm + '.' + d.getFullYear();
  }
  var MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  function fmtShort(d) {
    var s = d.getDate() + ' ' + MONTHS[d.getMonth()];
    return d.getFullYear() !== new Date().getFullYear() ? s + ' ' + d.getFullYear() : s;
  }
  function fmtNum(n, digits) { return Number(n).toLocaleString('pt-PT', { maximumFractionDigits: digits == null ? 1 : digits }); }
  function fmtWeight(kg) { return kg < 1 ? fmtNum(kg * 1000, 0) + ' g' : fmtNum(kg, 3) + ' kg'; }
  function yymmdd(d) {
    return String(d.getFullYear() % 100).padStart(2, '0') + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  }
  function addDays(n) { var d = new Date(); d.setDate(d.getDate() + n); return d; }
  function placeholder() { return $('tpl-placeholder').innerHTML; }

  function stateFor(days) {
    if (days < 0) return { cls: 'state-bad', text: days === -1 ? 'Expirou ontem' : 'Expirou há ' + (-days) + ' dias' };
    if (days === 0) return { cls: 'state-bad', text: 'Termina hoje' };
    if (days === 1) return { cls: 'state-warn', text: 'Termina amanhã' };
    if (days <= 7) return { cls: 'state-warn', text: 'Faltam ' + days + ' dias' };
    return { cls: 'state-ok', text: 'Faltam ' + days + ' dias' };
  }

  function setStatus(text, isError) {
    els.status.textContent = text;
    els.status.classList.toggle('error', !!isError);
  }

  // ---------- leitor ----------
  var detectorPromise = null;
  function getDetector() {
    if (detectorPromise) return detectorPromise;
    var api = window.BarcodeDetectionAPI;
    if (!api) return Promise.reject(new Error('Leitor não carregou.'));
    api.prepareZXingModule({
      overrides: {
        locateFile: function (path, prefix) {
          return path.endsWith('.wasm') ? new URL('vendor/zxing_reader.wasm', document.baseURI).href : prefix + path;
        }
      },
      fireImmediately: true
    });
    detectorPromise = api.BarcodeDetector.getSupportedFormats().then(function (supported) {
      var formats = SCAN_FORMATS.filter(function (f) { return supported.indexOf(f) !== -1; });
      return new api.BarcodeDetector({ formats: formats });
    });
    return detectorPromise;
  }

  var stream = null, scanning = false, loopTimer = null, torchOn = false;
  var pending = null; // { code, at } do primeiro código linear visto
  var canvas = document.createElement('canvas');
  var ctx = canvas.getContext('2d', { willReadFrequently: true });

  function pickBest(codes) {
    var parsed = codes.map(function (c) {
      return { raw: c.rawValue, format: c.format, info: GS1.parseScan(c.rawValue, c.format) };
    }).filter(function (c) { return c.info && c.info.kind !== 'other'; });
    if (!parsed.length) return null;
    parsed.sort(function (a, b) {
      var sa = (a.info.expiry ? 4 : 0) + (TWO_D.indexOf(a.format) !== -1 ? 2 : 0) + (a.info.code ? 1 : 0);
      var sb = (b.info.expiry ? 4 : 0) + (TWO_D.indexOf(b.format) !== -1 ? 2 : 0) + (b.info.code ? 1 : 0);
      return sb - sa;
    });
    return parsed[0];
  }

  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus('Este browser não dá acesso à câmara. Usa "Fotografar código".', true);
      return;
    }
    els.btnCamera.disabled = true;
    setStatus('A pedir acesso à câmara…');
    try {
      var detectorReady = getDetector();
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
      });
      els.video.srcObject = stream;
      await els.video.play();
      await detectorReady;
      els.viewfinder.classList.add('live');
      els.btnStop.hidden = false;
      var track = stream.getVideoTracks()[0];
      var caps = track && track.getCapabilities ? track.getCapabilities() : {};
      els.btnTorch.hidden = !caps.torch;
      scanning = true;
      pending = null;
      setStatus('À procura de um código…');
      scanLoop();
    } catch (err) {
      stopCamera();
      var denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
      setStatus(denied
        ? 'Sem permissão para a câmara. Em Definições > Safari > Câmara, escolhe "Permitir", ou usa "Fotografar código".'
        : 'Não foi possível ligar a câmara (' + (err && err.message || err) + ').', true);
    } finally {
      els.btnCamera.disabled = false;
    }
  }

  function stopCamera() {
    scanning = false;
    clearTimeout(loopTimer);
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    stream = null;
    torchOn = false;
    els.video.srcObject = null;
    els.viewfinder.classList.remove('live', 'hit');
    els.btnStop.hidden = true;
    els.btnTorch.hidden = true;
  }

  async function scanLoop() {
    if (!scanning) return;
    var v = els.video;
    try {
      if (v.readyState >= 2 && v.videoWidth) {
        // Lê só a zona central, que é onde está a mira.
        var sw = Math.round(v.videoWidth * 0.8), sh = Math.round(v.videoHeight * 0.8);
        var sx = Math.round((v.videoWidth - sw) / 2), sy = Math.round((v.videoHeight - sh) / 2);
        canvas.width = sw; canvas.height = sh;
        ctx.drawImage(v, sx, sy, sw, sh, 0, 0, sw, sh);
        var detector = await getDetector();
        var codes = await detector.detect(canvas);
        var best = codes.length ? pickBest(codes) : null;
        if (best) {
          var is2D = TWO_D.indexOf(best.format) !== -1;
          if (is2D || best.info.expiry) return onCode(best);
          if (!pending) {
            pending = { code: best, at: Date.now() };
            setStatus('Código de barras encontrado. A ver se há um QR ou DataMatrix com a validade…');
          }
        }
        if (pending && Date.now() - pending.at > WAIT_FOR_2D_MS) return onCode(pending.code);
      }
    } catch (err) {
      console.error(err);
    }
    if (scanning) loopTimer = setTimeout(scanLoop, 120);
  }

  function onCode(hit) {
    els.viewfinder.classList.add('hit');
    if (navigator.vibrate) navigator.vibrate(60);
    stopCamera();
    showResult(hit.raw, hit.format);
  }

  async function scanPhoto(file) {
    if (!file) return;
    setStatus('A ler a fotografia…');
    try {
      var detector = await getDetector();
      var codes = await detector.detect(file);
      var best = codes.length ? pickBest(codes) : null;
      if (!best) {
        setStatus('Não encontrei nenhum código na fotografia. Tenta mais perto e com o código direito.', true);
        return;
      }
      showResult(best.raw, best.format);
    } catch (err) {
      setStatus('Não consegui ler a fotografia (' + (err && err.message || err) + ').', true);
    } finally {
      els.photo.value = '';
    }
  }

  // ---------- Open Food Facts ----------
  var productCache = {};
  async function fetchProduct(code) {
    if (productCache[code] !== undefined) return productCache[code];
    var url = 'https://world.openfoodfacts.org/api/v2/product/' + encodeURIComponent(code) + '.json?lc=pt&fields=' + OFF_FIELDS;
    var res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (res.status === 404) { productCache[code] = null; return null; }
    if (!res.ok) throw new Error('Open Food Facts respondeu ' + res.status);
    var json = await res.json();
    var product = json && json.status === 1 && json.product ? json.product : null;
    productCache[code] = product;
    return product;
  }

  function productName(p) {
    return (p && (p.product_name_pt || p.product_name || p.generic_name_pt)) || 'Produto sem nome';
  }
  function productImage(p, small) {
    if (!p) return null;
    return (small && p.image_front_small_url) || p.image_front_url || p.image_url || null;
  }

  // ---------- validade ----------
  var TYPE_LABEL = {
    'use-by': 'Consumir até',
    'best-before': 'Consumir de preferência antes de',
    'sell-by': 'Data limite de venda'
  };

  function buildExpiry(info, product, scannedAt) {
    if (info.expiry) {
      return { kind: 'exact', date: calendarDay(info.expiry.date), typeLabel: TYPE_LABEL[info.expiry.type] || 'Validade' };
    }
    var est = ShelfLife.estimate(product && product.categories_tags, scannedAt);
    if (!est) return { kind: 'unknown' };
    if (est.none) return { kind: 'none', label: est.label };
    return { kind: 'estimate', date: est.from, to: est.to, label: est.label, where: est.where };
  }

  function expiryHtml(exp, info) {
    if (exp.kind === 'exact') {
      var st = stateFor(daysUntil(exp.date));
      return '<div class="label">' +
        '<span class="label-kicker">' + esc(exp.typeLabel) + '</span>' +
        '<span class="label-date">' + fmtDate(exp.date) + '</span>' +
        '<div class="label-row"><span class="state ' + st.cls + '">' + st.text + '</span>' +
        '<span class="src">EXATA · LIDA DO CÓDIGO 2D GS1</span></div></div>';
    }
    if (exp.kind === 'estimate') {
      var st2 = stateFor(daysUntil(exp.date));
      var same = fmtShort(exp.date) === fmtShort(exp.to);
      return '<div class="label">' +
        '<span class="label-kicker">Validade estimada</span>' +
        '<span class="label-date range">' + (same ? fmtShort(exp.date) : 'entre ' + fmtShort(exp.date) + ' e ' + fmtShort(exp.to)) + '</span>' +
        '<div class="label-row"><span class="state ' + st2.cls + '">' + st2.text + '</span>' +
        '<span class="src">ESTIMATIVA · ' + esc(exp.label.toUpperCase()) + ' · ' + esc(exp.where.toUpperCase()) + '</span></div>' +
        '<p class="label-note">Este código não traz a validade. É o prazo típico deste tipo de produto fechado, contado a partir de hoje. A data impressa na embalagem é a que conta.</p></div>';
    }
    if (exp.kind === 'none') {
      return '<div class="label"><span class="label-kicker">Validade</span>' +
        '<div class="label-row"><span class="state state-none">Normalmente sem validade</span></div>' +
        '<p class="label-note">' + esc(exp.label) + ' não costuma ter data de validade obrigatória.</p></div>';
    }
    var why = info.kind === 'other' ? '' : 'O código não traz a validade e o Open Food Facts não tem a categoria deste produto, por isso não há estimativa.';
    return '<div class="label"><span class="label-kicker">Validade</span>' +
      '<div class="label-row"><span class="state state-none">Sem informação</span></div>' +
      (why ? '<p class="label-note">' + why + '</p>' : '') + '</div>';
  }

  // ---------- nutrição ----------
  var NUTRIENTS = [
    { key: 'fat', label: 'Lípidos', unit: 'g' },
    { key: 'saturated-fat', label: 'dos quais saturados', unit: 'g', sub: true },
    { key: 'carbohydrates', label: 'Hidratos de carbono', unit: 'g' },
    { key: 'sugars', label: 'dos quais açúcares', unit: 'g', sub: true },
    { key: 'fiber', label: 'Fibra', unit: 'g' },
    { key: 'proteins', label: 'Proteínas', unit: 'g' },
    { key: 'salt', label: 'Sal', unit: 'g', digits: 2 }
  ];

  function nutritionHtml(p) {
    var n = (p && p.nutriments) || {};
    var hasAny = ['energy-kcal_100g', 'energy-kj_100g', 'energy_100g'].concat(NUTRIENTS.map(function (x) { return x.key + '_100g'; }))
      .some(function (k) { return n[k] != null && n[k] !== ''; });
    if (!hasAny) return '<div class="notice"><p>O Open Food Facts ainda não tem a tabela nutricional deste produto.</p></div>';
    var per = p.product_quantity_unit === 'ml' || /\bml\b|\bcl\b|\bl\b/i.test(p.quantity || '') ? '100 ml' : '100 g';
    var kj = n['energy-kj_100g'] != null ? n['energy-kj_100g'] : n['energy_100g'];
    var kcal = n['energy-kcal_100g'];
    var energy = [kj != null ? fmtNum(kj, 0) + ' kJ' : null, kcal != null ? fmtNum(kcal, 0) + ' kcal' : null].filter(Boolean).join(' / ');
    var rows = '<tr><th scope="row">Energia</th><td' + (energy ? '' : ' class="missing"') + '>' + (energy || '—') + '</td></tr>';
    NUTRIENTS.forEach(function (x) {
      var v = n[x.key + '_100g'];
      var has = v != null && v !== '';
      rows += '<tr' + (x.sub ? ' class="sub"' : '') + '><th scope="row">' + x.label + '</th><td' + (has ? '' : ' class="missing"') + '>' +
        (has ? fmtNum(v, x.digits || 1) + ' ' + x.unit : '—') + '</td></tr>';
    });
    return '<div class="facts"><h3>Declaração nutricional</h3><table>' +
      '<caption>Valores médios. Fonte: Open Food Facts.</caption>' +
      '<thead><tr><th scope="col"></th><th scope="col" style="text-align:right">por ' + per + '</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';
  }

  // ---------- resultado ----------
  var current = null;

  async function showResult(raw, format) {
    var scannedAt = new Date();
    var info = GS1.parseScan(raw, format);
    els.scanner.hidden = true;
    els.tryPanel.hidden = true;
    els.result.hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });

    var top = '<div class="result-top"><span class="code-read">' + esc(labelForFormat(format, info)) + ' · ' + esc(raw.replace(/\u001d/g, '␝')) + '</span>' +
      '<button type="button" class="btn btn-primary" data-act="again">Ler outro</button></div>';

    if (!info || info.kind === 'other') {
      els.result.innerHTML = top + '<div class="notice"><p>Este código não identifica um produto alimentar (não é EAN nem GS1).</p></div>';
      return;
    }
    if (info.kind === 'in-store') {
      els.result.innerHTML = top + '<div class="notice"><p>Este é um código interno da loja (começa por 2), usado em produtos pesados ao balcão. Cada cadeia codifica-o à sua maneira e não existe em bases de dados públicas.</p>' +
        '<p>Se a etiqueta tiver um QR ou DataMatrix, lê esse: costuma trazer a validade e o peso exato.</p></div>';
      return;
    }

    els.result.innerHTML = top + '<div class="skeleton" aria-label="A carregar"></div>';
    setStatus('A procurar o produto…');

    var product = null, fetchError = null;
    if (info.code) {
      try { product = await fetchProduct(info.code); } catch (e) { fetchError = e; }
    }
    var expiry = buildExpiry(info, product, scannedAt);
    current = { info: info, product: product, expiry: expiry, raw: raw, format: format, scannedAt: scannedAt };
    renderResult(top, fetchError);
    setStatus('');
  }

  function labelForFormat(format, info) {
    var map = { ean_13: 'EAN-13', ean_8: 'EAN-8', upc_a: 'UPC-A', upc_e: 'UPC-E', qr_code: 'QR', data_matrix: 'DataMatrix', databar_expanded: 'DataBar Expanded', databar_expanded_stacked: 'DataBar Expanded', code_128: 'GS1-128', manual: 'Escrito' };
    var name = map[format] || format || 'Código';
    if (info && info.kind === 'digital-link') name += ' GS1 Digital Link';
    return name;
  }

  function renderResult(top, fetchError) {
    var c = current, p = c.product, info = c.info;
    var img = productImage(p, false);
    var weight = info.netWeightKg != null ? fmtWeight(info.netWeightKg) : (p && p.quantity) || null;
    var chips = '';
    if (weight) chips += '<span class="chip">' + (info.netWeightKg != null ? 'Peso exato ' : 'Peso ') + '<span class="mono">' + esc(weight) + '</span></span>';
    if (p && /^[a-e]$/.test(p.nutriscore_grade || '')) chips += '<span class="chip nutri nutri-' + p.nutriscore_grade + '">Nutri-Score ' + p.nutriscore_grade.toUpperCase() + '</span>';

    var html = top;
    html += '<div class="product"><div class="product-img">' +
      (img ? '<img src="' + esc(img) + '" alt="Embalagem de ' + esc(productName(p)) + '" loading="lazy">' : placeholder()) +
      '</div><div class="product-info">' +
      '<h2 class="product-name">' + esc(p ? productName(p) : 'Produto não encontrado') + '</h2>' +
      (p && p.brands ? '<p class="product-brand">' + esc(p.brands) + '</p>' : '') +
      (chips ? '<div class="chips">' + chips + '</div>' : '') +
      '</div></div>';

    html += expiryHtml(c.expiry, info);

    if (fetchError) {
      html += '<div class="notice"><p>Não consegui falar com o Open Food Facts (' + esc(fetchError.message) + '). Verifica a ligação à internet.</p>' +
        '<p><button type="button" class="btn btn-ghost" data-act="retry">Tentar outra vez</button></p></div>';
    } else if (!p && info.code) {
      html += '<div class="notice"><p>Este produto ainda não está no Open Food Facts, por isso não há nutrição nem imagem.' +
        (info.expiry || info.netWeightKg != null ? ' A validade e o peso vieram do próprio código.' : '') + '</p>' +
        '<p><a href="https://world.openfoodfacts.org/cgi/product.pl?type=add&code=' + encodeURIComponent(info.code) + '" target="_blank" rel="noopener">Adicionar ao Open Food Facts</a></p></div>';
    } else if (p) {
      html += nutritionHtml(p);
    }

    var meta = '';
    if (info.code) meta += '<dt>Código</dt><dd>' + esc(info.code) + '</dd>';
    if (info.lot) meta += '<dt>Lote</dt><dd>' + esc(info.lot) + '</dd>';
    c.info.dates.forEach(function (d) {
      if (c.info.expiry && d === c.info.expiry) return;
      var names = { packed: 'Embalado em', produced: 'Produzido em', 'sell-by': 'Venda até', 'best-before': 'Pref. antes de', 'use-by': 'Consumir até', due: 'Data' };
      meta += '<dt>' + (names[d.type] || 'Data') + '</dt><dd>' + fmtDate(calendarDay(d.date)) + '</dd>';
    });
    if (meta) html += '<dl class="meta">' + meta + '</dl>';

    html += '<div class="result-actions">' +
      '<button type="button" class="btn btn-primary" data-act="save">Guardar na despensa</button>' +
      (p ? '<a class="btn btn-ghost" href="https://world.openfoodfacts.org/product/' + encodeURIComponent(info.code) + '" target="_blank" rel="noopener">Ver no Open Food Facts</a>' : '') +
      '</div>';

    els.result.innerHTML = html;
  }

  function resetToScanner(autostart) {
    els.result.hidden = true;
    els.result.innerHTML = '';
    els.scanner.hidden = false;
    els.tryPanel.hidden = false;
    current = null;
    setStatus(autostart ? '' : 'A câmara está desligada.');
    if (autostart) startCamera();
  }

  els.result.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    var act = btn.getAttribute('data-act');
    if (act === 'again') resetToScanner(true);
    if (act === 'retry' && current) { delete productCache[current.info.code]; showResult(current.raw, current.format); }
    if (act === 'save' && current) {
      saveCurrent();
      btn.textContent = 'Guardado';
      btn.disabled = true;
    }
  });

  // ---------- despensa ----------
  function loadPantry() {
    try { return JSON.parse(localStorage.getItem(PANTRY_KEY) || '[]'); } catch (e) { return []; }
  }
  function savePantry(items) {
    try { localStorage.setItem(PANTRY_KEY, JSON.stringify(items)); } catch (e) { setStatus('Não foi possível guardar neste browser.', true); }
  }

  function saveCurrent() {
    var c = current, p = c.product, exp = c.expiry;
    var item = {
      id: [c.info.code || c.raw, c.info.lot || '', exp.date ? exp.date.toISOString() : ''].join('|'),
      code: c.info.code, name: p ? productName(p) : 'Produto ' + (c.info.code || ''),
      brand: p && p.brands || '', image: productImage(p, true),
      weight: c.info.netWeightKg != null ? fmtWeight(c.info.netWeightKg) : (p && p.quantity) || '',
      lot: c.info.lot || '',
      expiry: { kind: exp.kind, date: exp.date ? exp.date.toISOString() : null, to: exp.to ? exp.to.toISOString() : null, typeLabel: exp.typeLabel || '', label: exp.label || '' },
      addedAt: new Date().toISOString()
    };
    var items = loadPantry().filter(function (x) { return x.id !== item.id; });
    items.push(item);
    savePantry(items);
    renderPantry();
  }

  function renderPantry() {
    var items = loadPantry();
    els.count.textContent = items.length;
    els.pantryEmpty.hidden = items.length > 0;
    items.sort(function (a, b) {
      var da = a.expiry.date ? Date.parse(a.expiry.date) : Infinity;
      var db = b.expiry.date ? Date.parse(b.expiry.date) : Infinity;
      return da - db;
    });
    if (!items.length) { els.pantryList.innerHTML = ''; return; }
    var html = '<div class="pantry-head"><h2 class="eyebrow">Por ordem de validade</h2><span class="src">' + items.length + ' produto' + (items.length === 1 ? '' : 's') + '</span></div>';
    items.forEach(function (it) {
      var side = '<span class="state state-none">Sem data</span>';
      var sub = it.weight ? esc(it.weight) : '';
      if (it.expiry.date) {
        var d = new Date(it.expiry.date);
        var st = stateFor(daysUntil(d));
        side = '<span class="state ' + st.cls + '">' + st.text + '</span>';
        var when = it.expiry.kind === 'exact' ? fmtDate(d) : '≈ ' + fmtShort(d) + (it.expiry.to ? '–' + fmtShort(new Date(it.expiry.to)) : '');
        sub = (it.expiry.kind === 'exact' ? 'Validade ' : 'Estimada ') + when + (sub ? ' · ' + sub : '');
      }
      html += '<article class="item"><div class="thumb">' +
        (it.image ? '<img src="' + esc(it.image) + '" alt="" loading="lazy">' : placeholder()) +
        '</div><div class="item-body"><span class="item-name">' + esc(it.name) + '</span>' +
        '<span class="item-sub">' + sub + '</span></div>' +
        '<div class="item-side">' + side + '<button type="button" class="icon-btn" data-remove="' + esc(it.id) + '">Remover</button></div></article>';
    });
    els.pantryList.innerHTML = html;
  }

  els.pantryList.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-remove]');
    if (!btn) return;
    var id = btn.getAttribute('data-remove');
    savePantry(loadPantry().filter(function (x) { return x.id !== id; }));
    renderPantry();
  });

  // ---------- separadores ----------
  function showView(name) {
    var scan = name === 'scan';
    els.viewScan.hidden = !scan;
    els.viewPantry.hidden = scan;
    els.tabScan.setAttribute('aria-pressed', String(scan));
    els.tabPantry.setAttribute('aria-pressed', String(!scan));
    if (!scan) { stopCamera(); renderPantry(); if (!current) setStatus('A câmara está desligada.'); }
  }
  els.tabScan.addEventListener('click', function () { showView('scan'); });
  els.tabPantry.addEventListener('click', function () { showView('pantry'); });
  els.goScan.addEventListener('click', function () { showView('scan'); });

  // ---------- exemplos ----------
  function buildExamples() {
    return [
      { kind: 'EAN-13', title: 'Nutella 400 g', sub: 'Código normal: nutrição e validade estimada', raw: '3017620422003', format: 'ean_13' },
      { kind: 'QR GS1', title: 'O mesmo produto com QR GS1', sub: 'A validade vem do código', raw: 'https://id.gs1.org/01/03017620422003/10/L' + yymmdd(new Date()) + '?15=' + yymmdd(addDays(150)), format: 'qr_code' },
      { kind: 'DataMatrix', title: 'Carne picada do talho (fictício)', sub: 'Validade, lote e peso exato no código', raw: '01056012345678963103000512' + '17' + yymmdd(addDays(2)) + '10LT' + yymmdd(new Date()), format: 'data_matrix' }
    ];
  }
  var examples = buildExamples();
  els.examples.innerHTML = examples.map(function (x, i) {
    return '<button type="button" class="example" data-ex="' + i + '"><span class="kind">' + x.kind + '</span>' +
      '<strong>' + esc(x.title) + '</strong><small>' + esc(x.sub) + '</small></button>';
  }).join('');
  els.examples.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-ex]');
    if (!btn) return;
    var x = examples[+btn.getAttribute('data-ex')];
    stopCamera();
    showResult(x.raw, x.format);
  });

  els.manualForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var v = els.manualCode.value.trim();
    if (!v) { els.manualCode.focus(); return; }
    stopCamera();
    showResult(v, 'manual');
  });

  // ---------- câmara ----------
  els.btnCamera.addEventListener('click', startCamera);
  els.btnStop.addEventListener('click', function () { stopCamera(); setStatus('A câmara está desligada.'); });
  els.btnTorch.addEventListener('click', async function () {
    var track = stream && stream.getVideoTracks()[0];
    if (!track) return;
    try {
      torchOn = !torchOn;
      await track.applyConstraints({ advanced: [{ torch: torchOn }] });
      els.btnTorch.textContent = torchOn ? 'Desligar lanterna' : 'Lanterna';
    } catch (err) { els.btnTorch.hidden = true; }
  });
  els.photo.addEventListener('change', function () { stopCamera(); scanPhoto(els.photo.files && els.photo.files[0]); });
  document.addEventListener('visibilitychange', function () { if (document.hidden && scanning) { stopCamera(); setStatus('A câmara foi desligada. Carrega em "Ligar câmara" para continuar.'); } });

  // Prepara o leitor em segundo plano para a primeira leitura ser rápida.
  getDetector().catch(function (err) { setStatus('O leitor de códigos não carregou (' + err.message + ').', true); });
  renderPantry();
})();
