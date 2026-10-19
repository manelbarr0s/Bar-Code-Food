# Bar Code Food

App web para iPhone que lê o código de barras de um produto e mostra os valores nutricionais, o peso, uma imagem e a validade.

## Como funciona

- **Leitura:** câmara do telemóvel (ou fotografia) com [barcode-detector](https://github.com/Sec-ant/barcode-detector) / ZXing, guardados em `web/vendor`. Lê EAN-13, EAN-8, UPC, QR, GS1 DataMatrix, GS1 DataBar Expanded e GS1-128.
- **Produto:** nome, marca, peso, imagem, Nutri-Score e declaração nutricional vêm da API do [Open Food Facts](https://world.openfoodfacts.org).
- **Validade:**
  1. **Exata** quando o código é 2D GS1 (QR GS1 Digital Link, DataMatrix, DataBar Expanded): lê os campos `17` (consumir até), `15` (consumir de preferência antes de) ou `16` (venda até). Também lê o lote (`10`) e o peso exato (`310n`).
  2. **Estimada** quando o código é um EAN normal: prazo típico do tipo de produto fechado (categoria do Open Food Facts + tabelas FoodKeeper do USDA), contado a partir do dia da leitura. Aparece sempre marcada como estimativa.
- **Despensa:** os produtos guardados ficam neste telemóvel (localStorage), ordenados pela validade.

Quando aparecem um EAN e um código 2D na mesma imagem, a app espera um instante e prefere o 2D, porque é esse que traz a validade.

## Estrutura

```
web/
  index.html, styles.css, manifest.webmanifest, ícones
  js/gs1.js          leitura de códigos GS1 (Digital Link, cadeias de elementos, datas)
  js/shelf-life.js   regras de estimativa por categoria
  js/app.js          câmara, Open Food Facts, interface e despensa
  vendor/            leitor de códigos (barcode-detector 3.2.2 + zxing-wasm 3.1.3)
  test/              testes do leitor GS1 e das estimativas
```

## Correr localmente

```
cd web
python3 -m http.server 8000
```

A câmara só funciona em `https://` ou em `localhost`.

Testes: `node --test web/test/*.test.js`

## Publicação

O workflow `.github/workflows/pages.yml` corre os testes e publica a pasta `web/` no GitHub Pages a cada push para `main`.
