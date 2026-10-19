// Leitura de códigos GS1: EAN/UPC simples, GS1 Digital Link (QR) e
// cadeias de elementos GS1 (DataMatrix, GS1-128, DataBar Expanded).
(function (root) {
  'use strict';

  var GS = '\u001d';

  // Comprimento fixo dos dados, indexado pelos dois primeiros dígitos do AI
  // (tabela de comprimentos predefinidos da especificação GS1).
  var FIXED_DATA_LENGTH = {
    '00': 18, '01': 14, '02': 14, '03': 14, '04': 16,
    '11': 6, '12': 6, '13': 6, '14': 6, '15': 6, '16': 6, '17': 6, '18': 6, '19': 6,
    '20': 2,
    '31': 6, '32': 6, '33': 6, '34': 6, '35': 6, '36': 6,
    '41': 13
  };

  var DATE_AIS = {
    '17': 'use-by',      // Data limite de consumo / validade
    '15': 'best-before', // Consumir de preferência antes de
    '16': 'sell-by',     // Data limite de venda
    '12': 'due',
    '13': 'packed',      // Data de embalamento
    '11': 'produced'     // Data de produção
  };

  // Atalhos antigos do Digital Link que ainda aparecem em alguns códigos.
  var DL_ALIASES = {
    gtin: '01', itip: '8006', cpv: '22', lot: '10', ser: '21',
    exp: '17', bestBefore: '15', sellBy: '16', prodDate: '11', packDate: '13'
  };

  var DL_PRIMARY_KEYS = ['01', '8006', '8013', '8010', '414', '417', '00', '253', '255', '401', '402', '8003', '8004', '8017', '8018'];

  function aiLength(digits) {
    var p = digits.slice(0, 2);
    var n = parseInt(p, 10);
    if (p === '23' || p === '24' || p === '25' || p === '40' || p === '41' || p === '42' || p === '71') return 3;
    if ((n >= 31 && n <= 36) || p === '39' || p === '43' || p === '70' || p === '72' ||
        p === '80' || p === '81' || p === '82') return 4;
    return 2;
  }

  function gtinCheckDigitOk(code) {
    if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
    var digits = code.split('').map(Number);
    var check = digits.pop();
    var sum = 0;
    for (var i = digits.length - 1, w = 3; i >= 0; i--, w = 4 - w) sum += digits[i] * w;
    return (10 - (sum % 10)) % 10 === check;
  }

  // GTIN-14 com zeros à esquerda -> código que o Open Food Facts usa (EAN-13 ou EAN-8).
  function gtinToLookupCode(gtin) {
    var g = String(gtin).replace(/^0+/, '');
    if (g.length <= 8) return g.padStart(8, '0');
    if (g.length <= 13) return g.padStart(13, '0');
    return g;
  }

  // YYMMDD -> Date (UTC ao meio-dia). DD = 00 significa o último dia do mês.
  function parseGs1Date(yymmdd, today) {
    if (!/^\d{6}$/.test(yymmdd)) return null;
    var yy = +yymmdd.slice(0, 2), mm = +yymmdd.slice(2, 4), dd = +yymmdd.slice(4, 6);
    if (mm < 1 || mm > 12) return null;
    var now = today || new Date();
    var cur = now.getFullYear();
    var century = Math.floor(cur / 100) * 100;
    var diff = yy - (cur % 100);
    if (diff >= 51) century -= 100;
    else if (diff <= -50) century += 100;
    var year = century + yy;
    if (dd === 0) dd = new Date(Date.UTC(year, mm, 0)).getUTCDate();
    var d = new Date(Date.UTC(year, mm - 1, dd, 12));
    if (d.getUTCMonth() !== mm - 1) return null;
    return d;
  }

  // Cadeia de elementos "simples", com separador GS entre campos variáveis.
  function parseElementString(text) {
    var s = text.replace(/^\][A-Za-z]\d/, '').replace(/^\u001d+/, '');
    var out = [];
    var i = 0;
    while (i < s.length) {
      if (s[i] === GS) { i++; continue; }
      var head = s.slice(i, i + 4);
      if (!/^\d{2}/.test(head)) return null;
      var alen = aiLength(head);
      var ai = s.slice(i, i + alen);
      if (!/^\d+$/.test(ai) || ai.length !== alen) return null;
      i += alen;
      var fixed = FIXED_DATA_LENGTH[ai.slice(0, 2)];
      var value;
      if (fixed) {
        value = s.slice(i, i + fixed);
        if (value.length !== fixed) return null;
        i += fixed;
      } else {
        var end = s.indexOf(GS, i);
        if (end === -1) end = s.length;
        value = s.slice(i, end);
        i = end;
      }
      out.push([ai, value]);
    }
    return out.length ? out : null;
  }

  // Forma legível "(01)05601234567890(17)261231(10)L12".
  function parseHri(text) {
    var re = /\((\d{2,4})\)([^(]*)/g;
    var out = [], m;
    while ((m = re.exec(text))) out.push([m[1], m[2].trim()]);
    return out.length && text.trim().charAt(0) === '(' ? out : null;
  }

  function parseDigitalLink(text) {
    var url;
    try { url = new URL(text.trim()); } catch (e) { return null; }
    if (!/^https?:$/.test(url.protocol)) return null;
    var segs = url.pathname.split('/').filter(Boolean).map(function (x) {
      try { return decodeURIComponent(x); } catch (e) { return x; }
    }).map(function (x) { return DL_ALIASES[x] || x; });
    var start = -1;
    for (var k = 0; k < segs.length - 1; k++) {
      if (DL_PRIMARY_KEYS.indexOf(segs[k]) !== -1) { start = k; break; }
    }
    if (start === -1) return null;
    var out = [];
    for (var j = start; j + 1 < segs.length; j += 2) {
      if (!/^\d{2,4}$/.test(segs[j])) break;
      out.push([segs[j], segs[j + 1]]);
    }
    url.searchParams.forEach(function (v, key) {
      var ai = DL_ALIASES[key] || key;
      if (/^\d{2,4}$/.test(ai)) out.push([ai, v]);
    });
    return out;
  }

  function fromAis(pairs, kind, today) {
    var r = { kind: kind, ais: pairs, gtin: null, code: null, lot: null, serial: null, dates: [], expiry: null, netWeightKg: null };
    pairs.forEach(function (p) {
      var ai = p[0], v = p[1];
      if (ai === '01' || ai === '02') {
        r.gtin = v.padStart(14, '0');
        r.code = gtinToLookupCode(r.gtin);
      } else if (ai === '10') {
        r.lot = v;
      } else if (ai === '21') {
        r.serial = v;
      } else if (DATE_AIS[ai]) {
        var d = parseGs1Date(v, today);
        if (d) r.dates.push({ type: DATE_AIS[ai], ai: ai, date: d });
      } else if (/^310[0-5]$/.test(ai)) {
        r.netWeightKg = parseInt(v, 10) / Math.pow(10, +ai[3]);
      } else if (/^320[0-5]$/.test(ai) && r.netWeightKg == null) {
        r.netWeightKg = (parseInt(v, 10) / Math.pow(10, +ai[3])) * 0.45359237;
      }
    });
    // A validade é a data mais forte disponível: limite de consumo > preferência > venda.
    ['use-by', 'best-before', 'sell-by'].some(function (t) {
      var hit = r.dates.filter(function (x) { return x.type === t; })[0];
      if (hit) { r.expiry = hit; return true; }
      return false;
    });
    return r;
  }

  // Ponto de entrada: recebe o texto lido e o formato devolvido pelo leitor.
  function parseScan(rawValue, format, today) {
    var text = String(rawValue || '').trim();
    if (!text) return null;

    if (/^\d{8}$|^\d{12,14}$/.test(text) && !/^(data_matrix|qr_code|databar_expanded)/.test(format || '')) {
      var lookup = gtinToLookupCode(text);
      var inStore = lookup.length === 13 && lookup.charAt(0) === '2';
      return {
        kind: inStore ? 'in-store' : 'ean',
        ais: [], gtin: text.padStart(14, '0'), code: lookup,
        checksumOk: gtinCheckDigitOk(text),
        lot: null, serial: null, dates: [], expiry: null, netWeightKg: null
      };
    }

    var pairs = parseDigitalLink(text);
    if (pairs && pairs.length) return fromAis(pairs, 'digital-link', today);

    pairs = parseHri(text);
    if (pairs) return fromAis(pairs, 'gs1', today);

    pairs = parseElementString(text);
    if (pairs && pairs.some(function (p) { return p[0] === '01' || p[0] === '02' || DATE_AIS[p[0]]; })) {
      return fromAis(pairs, 'gs1', today);
    }

    return { kind: 'other', raw: text, ais: [], gtin: null, code: null, lot: null, serial: null, dates: [], expiry: null, netWeightKg: null };
  }

  var api = {
    parseScan: parseScan,
    parseGs1Date: parseGs1Date,
    parseElementString: parseElementString,
    parseDigitalLink: parseDigitalLink,
    gtinCheckDigitOk: gtinCheckDigitOk,
    gtinToLookupCode: gtinToLookupCode
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GS1 = api;
})(typeof self !== 'undefined' ? self : this);
