const test = require('node:test');
const assert = require('node:assert');
const GS1 = require('../js/gs1.js');
const ShelfLife = require('../js/shelf-life.js');

const today = new Date(Date.UTC(2026, 9, 19, 12));
const ymd = (d) => d.toISOString().slice(0, 10);

test('EAN-13 normal', () => {
  const r = GS1.parseScan('3017620422003', 'ean_13', today);
  assert.equal(r.kind, 'ean');
  assert.equal(r.code, '3017620422003');
  assert.equal(r.checksumOk, true);
  assert.equal(r.expiry, null);
});

test('EAN-13 de peso variável (prefixo 2)', () => {
  assert.equal(GS1.parseScan('2123450012343', 'ean_13', today).kind, 'in-store');
});

test('GS1 Digital Link com validade e lote', () => {
  const r = GS1.parseScan('https://id.gs1.org/01/05601234567896/10/L123?17=261231', 'qr_code', today);
  assert.equal(r.kind, 'digital-link');
  assert.equal(r.code, '5601234567896');
  assert.equal(r.lot, 'L123');
  assert.equal(r.expiry.type, 'use-by');
  assert.equal(ymd(r.expiry.date), '2026-12-31');
});

test('Digital Link com domínio da loja, prefixo no caminho e peso', () => {
  const r = GS1.parseScan('https://qr.loja.pt/produtos/01/05601234567896/10/A%2F7?15=261100&3103=000845', 'qr_code', today);
  assert.equal(r.lot, 'A/7');
  assert.equal(r.expiry.type, 'best-before');
  assert.equal(ymd(r.expiry.date), '2026-11-30'); // DD=00 => último dia do mês
  assert.equal(r.netWeightKg, 0.845);
});

test('DataMatrix em texto simples com separador GS', () => {
  const r = GS1.parseScan('0105601234567896' + '3103000512' + '17261024' + '10LOTE9\u001d' + '21ABC', 'data_matrix', today);
  assert.equal(r.code, '5601234567896');
  assert.equal(r.netWeightKg, 0.512);
  assert.equal(ymd(r.expiry.date), '2026-10-24');
  assert.equal(r.lot, 'LOTE9');
  assert.equal(r.serial, 'ABC');
});

test('Identificador de simbologia ]d2 e forma com parênteses', () => {
  const a = GS1.parseScan(']d20105601234567896' + '17270115', 'data_matrix', today);
  assert.equal(ymd(a.expiry.date), '2027-01-15');
  const b = GS1.parseScan('(01)05601234567896(17)270115(10)X1', 'databar_expanded', today);
  assert.equal(ymd(b.expiry.date), '2027-01-15');
  assert.equal(b.lot, 'X1');
});

test('Limite de consumo tem prioridade sobre data de embalamento', () => {
  const r = GS1.parseScan('0105601234567896' + '13261015' + '17261022', 'data_matrix', today);
  assert.equal(r.expiry.ai, '17');
  assert.equal(r.dates.length, 2);
});

test('Século pela regra GS1', () => {
  assert.equal(GS1.parseGs1Date('991231', today).getUTCFullYear(), 1999);
  assert.equal(GS1.parseGs1Date('751231', today).getUTCFullYear(), 2075);
  assert.equal(GS1.parseGs1Date('761231', today).getUTCFullYear(), 2076);
  assert.equal(GS1.parseGs1Date('771231', today).getUTCFullYear(), 1977);
  assert.equal(GS1.parseGs1Date('261331', today), null);
});

test('QR normal (não GS1) não rebenta', () => {
  assert.equal(GS1.parseScan('https://example.com/promo', 'qr_code', today).kind, 'other');
  assert.equal(GS1.parseScan('Olá', 'qr_code', today).kind, 'other');
});

test('Estimativa por categoria', () => {
  const base = new Date(2026, 9, 19);
  const y = ShelfLife.estimate(['en:dairies', 'en:fermented-milk-products', 'en:yogurts'], base);
  assert.equal(y.label, 'Iogurte');
  assert.equal(y.from.getDate(), 26);
  assert.equal(ShelfLife.estimate(['en:seafood', 'en:fishes', 'en:canned-fishes', 'en:canned-foods'], base).label, 'Conserva');
  assert.equal(ShelfLife.estimate(['en:meats', 'en:prepared-meats', 'en:hams', 'en:cooked-hams'], base).label, 'Fiambre e carnes fatiadas');
  assert.equal(ShelfLife.estimate(['en:fruits-based-foods', 'en:fruits', 'en:dried-fruits'], base).label, 'Frutos secos');
  assert.equal(ShelfLife.estimate(['en:wines'], base).none, true);
  assert.equal(ShelfLife.estimate(['en:unknown-thing'], base), null);
});
