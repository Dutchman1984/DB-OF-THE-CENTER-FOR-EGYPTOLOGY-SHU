const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = __dirname;

global.window = {};
vm.runInThisContext(fs.readFileSync(path.join(root, "images/glyphs/sizes.js"), "utf8"));

class FakeElement {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.attributes = {};
    this.textContent = "";
    this.transform = { baseVal: { appendItem() {} } };
  }

  get firstChild() {
    return this.children[0] || null;
  }

  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  insertBefore(child, before) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    const index = this.children.indexOf(before);
    if (index >= 0) this.children.splice(index, 0, child);
    else this.children.push(child);
    return child;
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  setAttributeNS(ns, name, value) {
    this.attributes[name] = value;
  }

  getAttribute(name) {
    return this.attributes[name] || "";
  }

  createSVGTransform() {
    return {
      setTranslate() {},
      setScale() {},
      setRotate() {}
    };
  }
}

global.document = {
  createElement(tag) {
    if (tag === "img") {
      const image = { naturalWidth: 0, naturalHeight: 0, onload: null, onerror: null };
      Object.defineProperty(image, "src", {
        set() {
          queueMicrotask(() => {
            if (image.onerror) image.onerror();
            else if (image.onload) image.onload();
          });
        }
      });
      return image;
    }
    return new FakeElement(tag);
  },
  createElementNS(ns, tag) {
    return new FakeElement(tag);
  }
};

const jsesh = require(path.join(root, "jsesh.umd.js"));

function expandShadingToggles(mdc) {
  let shading = false;
  return mdc.split(/(#b\b|#e\b)/g).map(part => {
    if (part === "#b") { shading = true; return " "; }
    if (part === "#e") { shading = false; return " "; }
    if (!shading) return part;
    return part.replace(/([^\s-]+)(?=\s|-|$)/g, token => {
      if (!token || /^#/.test(token) || /#[1-4]+$/.test(token)) return token;
      return `${token}#1234`;
    });
  }).join("");
}

function normalizeShadeSymbols(mdc) {
  return mdc
    .replace(/(^|[\s\-:*()])v\//g, "$1//")
    .replace(/(^|[\s\-:*()])h\//g, "$1//")
    .replace(/(^|[\s\-:*()])\/(?!\/)/g, "$1//");
}

function normalizeShadeCodes(mdc) {
  return mdc.replace(/#([1-4]+)/g, (_, digits) => {
    const normalized = Array.from(new Set(digits.split("").sort())).join("");
    return normalized ? `#${normalized}` : "";
  });
}

function normalizeGlyphVariants(mdc) {
  return mdc.replace(/[A-Za-z][A-Za-z0-9@]*/g, token => {
    if (/^LACUNA$/i.test(token)) return "//";
    if (!window.signsSizes || window.signsSizes[token]) return token;
    let base = token;
    while (base.length > 1 && !window.signsSizes[base] && /[A-Z]$/.test(base)) {
      base = base.slice(0, -1);
    }
    return window.signsSizes[base] ? base : token;
  }).replace(/(?<!#)\b[1-9]\b/g, digit => {
    const code = `Z${digit}`;
    return window.signsSizes && window.signsSizes[code] ? code : digit;
  });
}

function preprocessMdC(mdc) {
  if (!mdc) return "";
  let s = mdc;
  s = s.replace(/\|[^\s-]+(?:\s*-\s*)?/g, "");
  s = s.replace(/\{\{[^}]*\}\}/g, "");
  s = s.replace(/_?\*\*/g, "*");
  s = s.replace(/\\[A-Za-z]+[0-9]*/g, "");
  s = s.replace(/\\[0-9]+/g, "");
  s = expandShadingToggles(s);
  s = s.replace(/-?#b\b/g, "");
  s = s.replace(/-?#e\b/g, "");
  s = normalizeShadeSymbols(s);
  s = normalizeShadeCodes(s);
  s = s.replace(/\$[rb]?/g, "");
  s = s.replace(/\?+/g, "//");
  s = normalizeGlyphVariants(s);
  s = s.replace(/<(?!-)/g, "<-");
  s = s.replace(/(?<!-)>/g, "->");
  s = s.replace(/\s+/g, "-");
  s = s.replace(/-{2,}/g, "-");
  s = s.replace(/<-+-/g, "<-");
  s = s.replace(/-+->/g, "->");
  s = s.replace(/^-+|-+$/g, "");
  return s;
}

function gardinerToMdC(searchGardiner) {
  const normalizeToken = (token) => {
    let code = token.replace(/[^A-Za-z0-9_]/g, "");
    if (/^LACUNA$/i.test(code)) return "//";
    if (/^[1-9]$/.test(code) && window.signsSizes?.[`Z${code}`]) return `Z${code}`;
    if (!code || !window.signsSizes || window.signsSizes[code]) return code;
    let base = code;
    while (base.length > 1 && !window.signsSizes[base] && /[A-Z]$/.test(base)) {
      base = base.slice(0, -1);
    }
    return window.signsSizes[base] ? base : code;
  };
  return (searchGardiner || "")
    .split(/\s+/)
    .map(g => g.trim())
    .filter(g => g && g !== "\\t")
    .map(normalizeToken)
    .filter(Boolean)
    .map(g => g.includes("_") ? g.split("_").filter(Boolean).join("&") : g)
    .join("-");
}

function walkSvgTree(node, visit) {
  if (!node) return;
  visit(node);
  for (const child of node.children || []) walkSvgTree(child, visit);
}

function tagNameOf(node) {
  return String(node.tagName || node.nodeName || "").toLowerCase();
}

function getSvgAttr(node, name) {
  return node.getAttribute ? node.getAttribute(name) : node.attributes?.[name];
}

function setSvgAttr(node, name, value) {
  if (node.setAttribute) node.setAttribute(name, value);
  else if (node.attributes) node.attributes[name] = value;
}

function applyHieroglyphicSvgEnhancements(root) {
  const svgs = [];
  walkSvgTree(root, node => {
    if (tagNameOf(node) === "svg") svgs.push(node);
  });
  svgs.forEach(svg => {
    const shadeRects = [];
    walkSvgTree(svg, node => {
      if (tagNameOf(node) !== "rect") return;
      const style = getSvgAttr(node, "style") || "";
      const fill = getSvgAttr(node, "fill") || "";
      const isShade = /fill\s*:\s*rgb\(100,\s*100,\s*100\)/i.test(style)
        || /rgb\(100,\s*100,\s*100\)/i.test(fill)
        || getSvgAttr(node, "data-jsesh-shade");
      if (isShade) shadeRects.push(node);
    });
    shadeRects.forEach(node => {
      const parent = node.parentNode;
      if (parent && parent.firstChild !== node) parent.insertBefore(node, parent.firstChild);
      setSvgAttr(node, "fill", "#CFC8BF");
      setSvgAttr(node, "style", "fill:#CFC8BF;opacity:0.55;stroke:none");
      setSvgAttr(node, "data-jsesh-shade", "true");
    });
  });
}

async function renderWithFallback(mdc, gardiner) {
  const el = new FakeElement("div");
  const cleaned = preprocessMdC(mdc);
  const fallback = gardinerToMdC(gardiner);
  const render = async (code) => {
    el.textContent = code;
    await jsesh.replaceTextWithHieroglyphs(el, { scale: 1.7 });
    applyHieroglyphicSvgEnhancements(el);
  };

  try {
    await render(cleaned || fallback);
    return { mode: cleaned ? "mdc" : "gardiner", el };
  } catch (err) {
    if (!fallback || fallback === cleaned) throw err;
    await render(fallback);
    return { mode: "gardiner", el };
  }
}

function countTags(node, tagName) {
  let total = node.tagName === tagName ? 1 : 0;
  for (const child of node.children || []) total += countTags(child, tagName);
  return total;
}

function countShadedRects(node) {
  let total = tagNameOf(node) === "rect" && getSvgAttr(node, "data-jsesh-shade") ? 1 : 0;
  for (const child of node.children || []) total += countShadedRects(child);
  return total;
}

const tests = [
  {
    label: "basic Gardiner codes",
    mdc: "A1-G17-M17-N35"
  },
  {
    label: "extended signs O64/O229/T42",
    mdc: "O64-O229-T42"
  },
  {
    label: "cartouche and stacking",
    mdc: "<-M17-Y5:N35->"
  },
  {
    label: "full and quadrant gray shading",
    mdc: "A1#1234-G17-//",
    expectShade: true
  },
  {
    label: "shade toggles and partial shade symbols",
    mdc: "#b A1 G17 #e M17-v/-h/-/",
    expectShade: true
  },
  {
    label: "desktop line marker and lacuna pattern from screenshot",
    mdc: "|x+3 - .. .. G17#34 tA:1*N21:p:N35#134 r:S29*(Htp:t*p) 1{{119,534,100}}**nTr\\97 N33AV r:S29*(h:r) i i t:ib*1:n N10:t N33AV{{47,374,52}}**nTr\\97 r:S29*q*A28 /{{193,276,75}}**n\\86**i{{405,314,69}}**pr{{0,678,68}}**1{{811,728,68}} Z3#1234 niwt:3#3 r:x:D43:t*w O7 t{{0,484,100}}**w{{448,5,98}}**pr{{1183,0,68}}**3{{1330,696,91}} O34:n:N33A tp*1:tA:1*N21 r:S29*(Dsr:r) Y1v E9 w n:n:pr*1 O34:N35:3 #b .. .. .. #e",
    gardiner: "G17 N16 Z15 N21 Q3 N35 D21 S29 R4 X1 Q3 Z15 R8 N33AV D21 S29 O4 D21 M17 M17 X1 F34 Z15 N35 N10 X1 N33AV R8 D21 S29 N29 A28 LACUNA D21 Z15 O1 Z15 Z3 O49 Z15B D21 Aa1 D43 X1 Z7 O7 X1 G43 O1 Z15B O34 N35 N33A D1 Z15 N16 Z15 N21 D21 S29",
    expectShade: true
  },
  {
    label: "desktop rotation command from screenshot",
    mdc: ".. .. N-i-mn:N35-A40-.. .. .:f-.. ..:3-tA:1*N21-b*a-H-G32-N35-U7:r-G43-t:f-Aa11\\R270:t-C10A-ii-i-Z4:D54-V13-..-Xnm-m-Y1:N35:O34-i-m-f-..-..-..-..-..-..-X:r:d-G43-Xrd-3-G24:tx3-Hr:1",
    gardiner: "S3 M17 Y5 N35 A40 I9 Z15B N16 Z15 N21 D58 D36 V28 G32 N35 U7 D21 G43 X1 I9 Aa11 X1 C10A M18 M17 Z4 D54 V13 W9 G17 Y1 N35 O34 M17 G17 I9 F32 D21 D46 G43 A17 Z15B G24 X1 Z15B D2 Z15"
  },
  {
    label: "nested groups plus rotation from screenshot",
    mdc: ".. .. (Aa11\\R270:t)*C10A-n-i*(t:f:A40)-i*(mn:n:ra)-nb:g:g*g-tA:tA:N21*N21",
    gardiner: "Aa11 X1 C10A N35 M17 X1 I9 A40 M17 Y5 N35 N5 V30 W11 W11 W11 N16 N16 N21 N21"
  },
  {
    label: "forced invalid MdC falls back to Gardiner",
    mdc: "A1-{broken",
    gardiner: "A1 G17 M17 N35"
  }
];

(async () => {
  for (const test of tests) {
    const result = await renderWithFallback(test.mdc, test.gardiner);
    const svgCount = countTags(result.el, "svg");
    const imageCount = countTags(result.el, "image");
    if (svgCount < 1 || imageCount < 1) {
      throw new Error(`${test.label} produced no SVG glyphs`);
    }
    if (test.expectShade && countShadedRects(result.el) < 5) {
      throw new Error(`${test.label} did not produce expected gray shade rectangles`);
    }
    console.log(`OK ${test.label}: ${result.mode}, ${svgCount} svg, ${imageCount} image`);
  }
  console.log(`PASS ${tests.length} JSesh rendering cases`);
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
