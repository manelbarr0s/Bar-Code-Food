// Estimativa da validade quando o código não a traz.
// Prazos para produto fechado, contados a partir do dia da leitura, com base
// nas tabelas de conservação FoodKeeper (USDA/FSIS) e em prazos típicos de
// produtos embalados. As regras são lidas por ordem: a primeira que bate ganha,
// por isso as categorias mais específicas vêm primeiro.
(function (root) {
  'use strict';

  var FRIDGE = 'frigorífico', PANTRY = 'despensa', FREEZER = 'congelador';

  var RULES = [
    { tags: ['en:wines', 'en:spirits', 'en:salts'], label: 'Vinho, bebidas espirituosas ou sal', none: true },

    { tags: ['en:ice-creams'], label: 'Gelado', days: [60, 120], where: FREEZER },
    { tags: ['en:frozen-foods'], label: 'Congelado', days: [90, 180], where: FREEZER },

    { tags: ['en:canned-fishes', 'en:canned-foods', 'en:canned-vegetables', 'en:canned-legumes', 'en:canned-fruits', 'en:canned-meals'], label: 'Conserva', days: [365, 730], where: PANTRY },

    { tags: ['en:minced-meats', 'en:ground-meats', 'en:minced-beef'], label: 'Carne picada', days: [1, 2], where: FRIDGE },
    { tags: ['en:poultries', 'en:poultry-meats', 'en:chickens', 'en:chicken-meats', 'en:turkeys'], label: 'Aves frescas', days: [1, 2], where: FRIDGE },
    { tags: ['en:fresh-sausages'], label: 'Salsichas frescas', days: [1, 2], where: FRIDGE },
    { tags: ['en:smoked-salmons', 'en:smoked-fishes'], label: 'Peixe fumado', days: [10, 14], where: FRIDGE },
    { tags: ['en:fresh-fish', 'en:fresh-fishes', 'en:fresh-seafood', 'en:fishes', 'en:seafood'], label: 'Peixe ou marisco fresco', days: [1, 2], where: FRIDGE },
    { tags: ['en:cured-hams', 'en:dry-hams', 'en:dry-sausages', 'en:chorizos', 'en:salamis'], label: 'Enchidos e presunto curados', days: [30, 90], where: FRIDGE },
    { tags: ['en:cooked-hams', 'en:hams', 'en:cold-cuts', 'en:sliced-meats', 'en:sausages'], label: 'Fiambre e carnes fatiadas', days: [7, 14], where: FRIDGE },
    { tags: ['en:fresh-meats', 'en:meats', 'en:beef', 'en:porks', 'en:veal', 'en:lamb-meats'], label: 'Carne fresca', days: [3, 5], where: FRIDGE },

    { tags: ['en:sandwiches'], label: 'Sandes', days: [1, 3], where: FRIDGE },
    { tags: ['en:prepared-salads', 'en:salads'], label: 'Salada embalada', days: [3, 5], where: FRIDGE },
    { tags: ['en:meals', 'en:prepared-meals', 'en:fresh-pastas'], label: 'Refeição pronta ou massa fresca', days: [3, 5], where: FRIDGE },

    { tags: ['en:fresh-cheeses', 'en:cottage-cheeses', 'en:requeijao'], label: 'Queijo fresco ou requeijão', days: [5, 10], where: FRIDGE },
    { tags: ['en:soft-cheeses', 'en:spreadable-cheeses'], label: 'Queijo de pasta mole', days: [7, 14], where: FRIDGE },
    { tags: ['en:cheeses'], label: 'Queijo curado', days: [30, 180], where: FRIDGE },
    { tags: ['en:yogurts', 'en:fermented-milk-products'], label: 'Iogurte', days: [7, 21], where: FRIDGE },
    { tags: ['en:dairy-desserts'], label: 'Sobremesa láctea', days: [7, 21], where: FRIDGE },
    { tags: ['en:fresh-milks', 'en:pasteurised-milks', 'en:pasteurized-milks'], label: 'Leite pasteurizado', days: [5, 7], where: FRIDGE },
    { tags: ['en:plant-based-milks', 'en:plant-milks'], label: 'Bebida vegetal (fechada)', days: [180, 365], where: PANTRY },
    { tags: ['en:uht-milks', 'en:milks'], label: 'Leite UHT (fechado)', days: [90, 180], where: PANTRY },
    { tags: ['en:creams'], label: 'Natas', days: [30, 90], where: FRIDGE },
    { tags: ['en:butters'], label: 'Manteiga', days: [30, 90], where: FRIDGE },
    { tags: ['en:eggs'], label: 'Ovos', days: [21, 28], where: FRIDGE },

    { tags: ['en:refrigerated-juices', 'en:fresh-juices', 'en:squeezed-juices'], label: 'Sumo refrigerado', days: [5, 10], where: FRIDGE },
    { tags: ['en:fruit-juices', 'en:juices-and-nectars', 'en:nectars'], label: 'Sumo ou néctar (fechado)', days: [180, 365], where: PANTRY },
    { tags: ['en:waters'], label: 'Água', days: [365, 730], where: PANTRY },
    { tags: ['en:beers'], label: 'Cerveja', days: [120, 270], where: PANTRY },
    { tags: ['en:sodas', 'en:carbonated-drinks', 'en:soft-drinks'], label: 'Refrigerante', days: [180, 270], where: PANTRY },

    // Padaria seca: muitas vezes o Open Food Facts só lhe põe a categoria genérica "pão",
    // por isso também se reconhece pelo nome.
    { tags: ['en:rusks', 'en:crispbreads', 'en:toasts', 'en:melba-toasts', 'en:crackers', 'en:breadsticks', 'en:breadcrumbs', 'en:dry-breads', 'en:croutons'],
      names: /\b(mini[- ]?)?(tostas?|torradas?|tostadas?|crackers?|grissinos?|palitos de pao|pao ralado|croutons?|rusks?|crispbreads?)\b/,
      label: 'Tostas, torradas e crackers', days: [180, 365], where: PANTRY },
    { tags: ['en:sliced-breads', 'en:sandwich-breads'], label: 'Pão de forma', days: [5, 10], where: PANTRY },
    { tags: ['en:breads'], label: 'Pão', days: [2, 5], where: PANTRY },
    { tags: ['en:pastries', 'en:viennoiseries'], label: 'Bolos e pastelaria', days: [2, 5], where: PANTRY },
    { tags: ['en:cakes'], label: 'Bolo embalado', days: [14, 60], where: PANTRY },

    { tags: ['en:baby-foods'], label: 'Alimentação infantil', days: [180, 365], where: PANTRY },
    { tags: ['en:breakfast-cereals'], label: 'Cereais de pequeno-almoço', days: [180, 365], where: PANTRY },
    { tags: ['en:biscuits', 'en:cookies', 'en:biscuits-and-cakes'], label: 'Bolachas', days: [90, 270], where: PANTRY },
    { tags: ['en:chocolates', 'en:cocoa-and-its-products'], label: 'Chocolate', days: [180, 365], where: PANTRY },
    { tags: ['en:sweet-spreads', 'en:hazelnut-spreads'], label: 'Creme para barrar', days: [180, 365], where: PANTRY },
    { tags: ['en:honeys'], label: 'Mel', days: [365, 730], where: PANTRY },
    { tags: ['en:jams', 'en:fruit-preserves'], label: 'Compota', days: [180, 365], where: PANTRY },
    { tags: ['en:salty-snacks', 'en:chips-and-fries', 'en:crisps'], label: 'Snacks salgados', days: [60, 120], where: PANTRY },
    { tags: ['en:nuts', 'en:dried-fruits'], label: 'Frutos secos', days: [180, 365], where: PANTRY },
    { tags: ['en:pastas', 'en:dry-pastas'], label: 'Massa seca', days: [365, 730], where: PANTRY },
    { tags: ['en:rices'], label: 'Arroz', days: [365, 730], where: PANTRY },
    { tags: ['en:legumes', 'en:dried-legumes'], label: 'Leguminosas secas', days: [365, 730], where: PANTRY },
    { tags: ['en:flours'], label: 'Farinha', days: [180, 365], where: PANTRY },
    { tags: ['en:sugars'], label: 'Açúcar', days: [730, 1095], where: PANTRY },
    { tags: ['en:olive-oils', 'en:vegetable-oils', 'en:oils'], label: 'Azeite ou óleo', days: [365, 540], where: PANTRY },
    { tags: ['en:vinegars'], label: 'Vinagre', days: [730, 1095], where: PANTRY },
    { tags: ['en:sauces', 'en:condiments'], label: 'Molho ou condimento (fechado)', days: [180, 365], where: PANTRY },
    { tags: ['en:soups'], label: 'Sopa', days: [180, 365], where: PANTRY },
    { tags: ['en:coffees'], label: 'Café', days: [180, 365], where: PANTRY },
    { tags: ['en:teas', 'en:herbal-teas'], label: 'Chá', days: [365, 730], where: PANTRY },

    // Por último, porque muitos produtos transformados também levam estas etiquetas.
    { tags: ['en:fresh-fruits', 'en:fruits'], label: 'Fruta fresca', days: [3, 10], where: FRIDGE },
    { tags: ['en:fresh-vegetables', 'en:vegetables'], label: 'Legumes frescos', days: [3, 7], where: FRIDGE }
  ];

  function addDays(date, n) {
    var d = new Date(date.getTime());
    d.setDate(d.getDate() + n);
    return d;
  }

  // Devolve {label, where, from, to} ou {label, none:true} ou null.
  // As categorias decidem; o nome do produto só serve as regras que têm "names".
  function normalize(text) {
    return String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function estimate(categoriesTags, scannedAt, productName) {
    var tags = (categoriesTags || []).map(function (t) { return String(t).toLowerCase(); });
    var name = normalize(productName);
    if (!tags.length && !name) return null;
    var base = scannedAt || new Date();
    for (var i = 0; i < RULES.length; i++) {
      var rule = RULES[i];
      var byTag = rule.tags.some(function (t) { return tags.indexOf(t) !== -1; });
      var byName = rule.names && name && rule.names.test(name);
      if (byTag || byName) {
        if (rule.none) return { label: rule.label, none: true };
        return { label: rule.label, where: rule.where, from: addDays(base, rule.days[0]), to: addDays(base, rule.days[1]) };
      }
    }
    return null;
  }

  var api = { estimate: estimate, RULES: RULES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ShelfLife = api;
})(typeof self !== 'undefined' ? self : this);
