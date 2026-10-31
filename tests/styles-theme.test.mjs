/**
 * The smart-code colours follow the host theme (THEME-01 / THEME-02 / THEME-03).
 *
 * The completion popup, the hover card, the signature help and the reference
 * panel used to carry a hard-coded dark palette: a black code block and white
 * text in a light host theme. This file pins the fix down by scanning the
 * stylesheet and the editor for the values that must not come back, and for
 * the tokens that have to be there instead.
 *
 * The syntax palette is theme-relative: every token is a hue mixed with the
 * theme's own text colour. So the test has to resolve the mix itself, and to
 * measure the result on every surface the host can paint it on - the light
 * editor background, the dark editor background and the dark code layer.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const styles = await readFile(join(root, 'src/client/styles.js'), 'utf8')
const editor = await readFile(join(root, 'src/client/CodeEditor.jsx'), 'utf8')
const ui = await readFile(join(root, 'src/client/ui.jsx'), 'utf8')

/** The colours the smart-code widgets must not hard-code any more. */
const FORBIDDEN_IN_STYLES = [
  '#1b1e24', // the black code block of the hover card
  '#d8dce3', // its light text
  '#7fb8ff', // the active parameter of the signature help
  /rgba\(\s*255\s*,\s*255\s*,\s*255/i, // white text on a solid accent
]

/** The old syntax palette of the editor (THEME-03). */
const OLD_SYNTAX_PALETTE = [
  '#7a8596', '#5f8f3f', '#a15fb0', '#b57a2a', '#2f8f83',
  '#8a6a1f', '#3f6f9f', '#c05a63', '#3b7dd8',
]

/** The tokens that carry the smart-code surfaces; the host owns them. */
const SURFACE_TOKENS = [
  '--iwb-code-bg', '--iwb-code-fg', '--iwb-code-border', '--iwb-code-muted',
  '--iwb-on-accent', '--iwb-shadow',
]

/** The tokens that carry the syntax colours; the theme owns them. */
const SYNTAX_TOKENS = [
  '--iwb-syn-comment', '--iwb-syn-string', '--iwb-syn-keyword', '--iwb-syn-type',
  '--iwb-syn-number', '--iwb-syn-function', '--iwb-syn-property', '--iwb-syn-tag',
  '--iwb-syn-heading', '--iwb-syn-invalid',
]

/* ── the colour maths (CSS Color 4 / CSS Color 5) ───────────────────────────
   The palette is written as color-mix(in oklab, <hue> N%, var(--iwb-fg) N%),
   so a contrast can only be measured once the mix is resolved. The
   conversion below is checked against the published values in 'the oklab
   maths matches the CSS Color 4 reference' - a broken conversion would make
   every number in this file meaningless. */
const clamp = (value) => (value < 0 ? 0 : value > 1 ? 1 : value)

/** The sRGB transfer function (CSS Color 4 § 5). */
const toLinear = (channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
const toGamma = (channel) => (channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055)

const hexToRgb = (hex) => {
  const digits = hex.replace('#', '')
  return [0, 2, 4].map(index => parseInt(digits.slice(index, index + 2), 16) / 255)
}
const rgbToHex = (rgb) => '#' + rgb
  .map(channel => Math.round(clamp(channel) * 255).toString(16).padStart(2, '0'))
  .join('')

/** sRGB to oklab (CSS Color 4 § 9.2). */
const rgbToOklab = ([r, g, b]) => {
  const lr = toLinear(r), lg = toLinear(g), lb = toLinear(b)
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

/** oklab to sRGB (CSS Color 4 § 9.2). */
const oklabToRgb = ([L, a, b]) => {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    toGamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toGamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toGamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]
}

/**
 * color-mix(in oklab, a, b): oklab is a rectangular space, so the mix is a
 * plain interpolation of the three components (CSS Color 5 § 3.3).
 */
const mixInOklab = (a, b, shareA) => {
  const labA = rgbToOklab(hexToRgb(a))
  const labB = rgbToOklab(hexToRgb(b))
  const mixed = labA.map((value, index) => value * shareA + labB[index] * (1 - shareA))
  return rgbToHex(oklabToRgb(mixed))
}

/** The WCAG relative luminance of a colour. */
const relativeLuminance = (hex) => {
  const [r, g, b] = hexToRgb(hex).map(toLinear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * The WCAG contrast ratio. The general form (max over min) is the one that
 * holds for any pair of colours - the 1.05 / (L + 0.05) form is only valid
 * against white, and using it against a dark surface is what let the old
 * palette through.
 */
const contrastRatio = (a, b) => {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** The hue angle of a colour in oklch. */
const hueAngle = (hex) => {
  const [, a, b] = rgbToOklab(hexToRgb(hex))
  return (Math.atan2(b, a) * 180 / Math.PI + 360) % 360
}

/** The chroma of a colour in oklab. */
const chroma = (hex) => {
  const [, a, b] = rgbToOklab(hexToRgb(hex))
  return Math.hypot(a, b)
}

const closeTo = (actual, expected, tolerance = 0.0005) =>
  Math.abs(actual - expected) <= tolerance

/* ── the surfaces and the themes the syntax colours have to survive ──────── */

/** A light host theme paints its editor - and its code layer - white. */
const LIGHT_EDITOR = '#ffffff'
/** The fallback of --iwb-bg: the editor background. */
const DARK_EDITOR = '#15171c'
/** The fallback of --iwb-code-bg: the layer of the code blocks. */
const DARK_CODE_LAYER = '#232830'

/**
 * The foreground --iwb-fg resolves to. The two host values are the ones of
 * the harness design system (--dsw-alias-label-primary): the near-black of
 * the light theme and the near-white of the dark one.
 */
const HOST_LIGHT_FOREGROUND = '#0f1115'
const HOST_DARK_FOREGROUND = '#f9fafb'

/** The foreground of a host that brings no palette at all: the fallback. */
const fallbackForeground = () => {
  const match = /--iwb-fg:\s*var\(--dsw-alias-label-primary,\s*(#[0-9a-f]{6})\);/i.exec(styles)
  assert.ok(match !== null, '--iwb-fg has a hex fallback')
  return match[1].toLowerCase()
}

/**
 * The situations the syntax colours have to survive: the light host theme
 * (its editor is white), the dark host theme (its editor and its code layer
 * are dark) and a host without any palette (the fallbacks of the stylesheet,
 * which are dark as well).
 */
const scenarios = () => [
  {
    name: 'the light host theme',
    foreground: HOST_LIGHT_FOREGROUND,
    backgrounds: [LIGHT_EDITOR],
  },
  {
    name: 'the dark host theme',
    foreground: HOST_DARK_FOREGROUND,
    backgrounds: [DARK_EDITOR, DARK_CODE_LAYER],
  },
  {
    name: 'a host without a palette',
    foreground: fallbackForeground(),
    backgrounds: [DARK_EDITOR, DARK_CODE_LAYER],
  },
]

/**
 * The declaration of a syntax token: the hue it is built from and the share
 * of that hue in the mix with the theme text colour.
 */
const readSyntaxToken = (token) => {
  const match = new RegExp(
    `${token}:\\s*color-mix\\(in oklab,\\s*(#[0-9a-f]{6})\\s+(\\d+(?:\\.\\d+)?)%,\\s*var\\(--iwb-fg\\)\\s+(\\d+(?:\\.\\d+)?)%\\)\\s*;`,
    'i',
  ).exec(styles)
  assert.ok(match !== null, `${token} is a colour mixed with the theme text colour`)
  const hueShare = Number(match[2])
  const textShare = Number(match[3])
  assert.ok(Math.abs(hueShare + textShare - 100) < 1e-9, `${token} mixes its two parts to 100%`)
  return { hue: match[1].toLowerCase(), hueShare: hueShare / 100 }
}

test('the stylesheet has no hard-coded smart-code colours left', () => {
  for (const value of FORBIDDEN_IN_STYLES) {
    const pattern = typeof value === 'string' ? value : value.source
    assert.doesNotMatch(styles, new RegExp(pattern, 'i'), `styles.js must not contain ${pattern}`)
  }
})

test('the stylesheet has no hard-coded syntax palette left', () => {
  for (const value of OLD_SYNTAX_PALETTE) {
    assert.ok(!styles.includes(value), `styles.js must not contain ${value}`)
  }
})

test('every smart-code surface token is defined through a host alias', () => {
  for (const token of SURFACE_TOKENS) {
    const declaration = new RegExp(`${token}:\\s*var\\(--dsw-alias-[a-z0-9-]+,[^;]+;`)
    assert.match(styles, declaration, `${token} must come from a --dsw-alias-* token`)
  }
})

test('every syntax token is derived from the theme text colour', () => {
  // The palette must not wait for the host: it has no syntax aliases, and
  // the fallback has to stand on its own.
  for (const token of SYNTAX_TOKENS) {
    const { hue } = readSyntaxToken(token)
    assert.match(hue, /^#[0-9a-f]{6}$/, `${token} is built from a hue of its own`)
  }
  assert.doesNotMatch(styles, /--dsw-alias-code-/, 'the palette must not depend on a host syntax alias')
  // The host theme is not the system theme, so nothing may switch on it.
  assert.doesNotMatch(styles, /@media[^{]*prefers-color-scheme/, 'the palette must not switch on the system theme')
})

test('the text on the accent colour falls back to a dark colour', () => {
  // A light brand colour with white text is unreadable, so the fallback has
  // to be dark - the host decides the real value when it knows its brand.
  const declaration = /--iwb-on-accent:\s*var\(--dsw-alias-[a-z0-9-]+,\s*([^)]+)\);/
  const match = declaration.exec(styles)
  assert.ok(match !== null, '--iwb-on-accent is declared')
  const fallback = match[1].trim().toLowerCase()
  assert.match(fallback, /^#[0-9a-f]{6}$/, 'the fallback is a hex colour')
  const red = parseInt(fallback.slice(1, 3), 16)
  const green = parseInt(fallback.slice(3, 5), 16)
  const blue = parseInt(fallback.slice(5, 7), 16)
  assert.ok((red + green + blue) / 3 < 128, `the fallback ${fallback} is a dark colour`)
})

test('the oklab maths matches the CSS Color 4 reference', () => {
  // The conversion of the primaries (CSS Color 4 § 9.2).
  const red = rgbToOklab(hexToRgb('#ff0000'))
  assert.ok(closeTo(red[0], 0.62796), `red lightness is ${red[0]}`)
  assert.ok(closeTo(red[1], 0.22486), `red a is ${red[1]}`)
  assert.ok(closeTo(red[2], 0.12585), `red b is ${red[2]}`)
  const blue = rgbToOklab(hexToRgb('#0000ff'))
  assert.ok(closeTo(blue[0], 0.45201), `blue lightness is ${blue[0]}`)
  assert.ok(closeTo(blue[1], -0.03245), `blue a is ${blue[1]}`)
  assert.ok(closeTo(blue[2], -0.31153), `blue b is ${blue[2]}`)
  const white = rgbToOklab(hexToRgb('#ffffff'))
  assert.ok(closeTo(white[0], 1) && closeTo(white[1], 0) && closeTo(white[2], 0), 'white is oklab(1 0 0)')

  // CSS Color 5 § 3.3 works the mix of teal, olive and blue out and
  // publishes the coordinates of the three colours and of the result.
  const teal = rgbToOklab(hexToRgb('#008080'))
  assert.ok(closeTo(teal[0], 0.5431), `teal lightness is ${teal[0]}`)
  assert.ok(closeTo(teal[1], -0.0896), `teal a is ${teal[1]}`)
  assert.ok(closeTo(teal[2], -0.0236), `teal b is ${teal[2]}`)
  const olive = rgbToOklab(hexToRgb('#808000'))
  assert.ok(closeTo(olive[0], 0.5807), `olive lightness is ${olive[0]}`)
  const threeWay = [0, 1, 2].map(index => (teal[index] + olive[index] + blue[index]) / 3)
  assert.ok(closeTo(threeWay[0], 0.5253), `the mix lightness is ${threeWay[0]}`)
  assert.ok(closeTo(threeWay[1], -0.055), `the mix a is ${threeWay[1]}`)
  assert.ok(closeTo(threeWay[2], -0.072), `the mix b is ${threeWay[2]}`)

  // The half-and-half mix of the two primaries: the components are
  // averaged, so #ff0000 and #0000ff give oklab(0.53998 0.0962 -0.09284),
  // which is rgb(140 83 162).
  assert.equal(mixInOklab('#ff0000', '#0000ff', 0.5), '#8c53a2')
})

test('every syntax token is readable on the light and on the dark surfaces', () => {
  // Every token has to clear 4.5:1 on every surface of every theme. One
  // fixed colour cannot do that - it would need a relative luminance of
  // 0.183 or less for white and 0.269 or more for the dark code layer -
  // which is why the palette is mixed with the theme text colour.
  for (const token of SYNTAX_TOKENS) {
    const { hue, hueShare } = readSyntaxToken(token)
    for (const scenario of scenarios()) {
      const resolved = mixInOklab(hue, scenario.foreground, hueShare)
      for (const background of scenario.backgrounds) {
        const ratio = contrastRatio(resolved, background)
        assert.ok(
          ratio >= 4.5,
          `${token} (${hue}) is ${resolved} on ${background} in ${scenario.name}: ` +
          `${ratio.toFixed(2)}:1, it needs 4.5:1`,
        )
      }
    }
  }
})

test('the syntax palette keeps a margin over the 4.5:1 bar', () => {
  // The bar is 4.5:1; the palette is tuned to stay at 5:1 or better, so a
  // later change of a hue cannot quietly eat the margin.
  let worst = Infinity
  for (const token of SYNTAX_TOKENS) {
    const { hue, hueShare } = readSyntaxToken(token)
    for (const scenario of scenarios()) {
      const resolved = mixInOklab(hue, scenario.foreground, hueShare)
      for (const background of scenario.backgrounds) {
        worst = Math.min(worst, contrastRatio(resolved, background))
      }
    }
  }
  assert.ok(worst >= 5, `the worst token of the palette is ${worst.toFixed(2)}:1, it needs 5:1`)
})

test('the syntax palette keeps its hues', () => {
  // Mixing with the text colour may change the lightness of a token, but
  // not its identity: the hue angle may hardly move and the colour has to
  // keep a good part of the chroma of its hue.
  for (const token of SYNTAX_TOKENS) {
    const { hue, hueShare } = readSyntaxToken(token)
    for (const scenario of scenarios()) {
      const resolved = mixInOklab(hue, scenario.foreground, hueShare)
      const shift = Math.abs(hueAngle(resolved) - hueAngle(hue))
      assert.ok(
        Math.min(shift, 360 - shift) <= 8,
        `${token} (${hue}) is ${resolved} in ${scenario.name}: the hue moved by ${shift.toFixed(1)}°`,
      )
      assert.ok(
        chroma(resolved) >= chroma(hue) * 0.4,
        `${token} (${hue}) is ${resolved} in ${scenario.name}: the colour lost its chroma`,
      )
      assert.ok(hueShare > 0 && hueShare < 1, `${token} mixes both of its parts`)
    }
  }
})

test('the tooltip widgets clear their own background', () => {
  // A library element with a background of its own would leak a white block
  // into a dark card (and a black one into a light card).
  assert.match(styles, /\.iwb-codemirror \.cm-tooltip \* \{[^}]*background: transparent/)
})

test('the popups take their shadow from a token', () => {
  const shadows = styles.match(/box-shadow: 0 8px 24px [^;]+;/g) ?? []
  assert.ok(shadows.length >= 3, 'the three popup shadows are still there')
  for (const shadow of shadows) {
    assert.match(shadow, /var\(--iwb-shadow\)/, `${shadow} comes from the token`)
  }
})

test('the editor syntax palette comes from the tokens', () => {
  for (const value of OLD_SYNTAX_PALETTE) {
    assert.ok(!editor.includes(value), `CodeEditor.jsx must not contain ${value}`)
  }
  assert.doesNotMatch(editor, /rgba\(\s*76\s*,\s*154\s*,\s*255/i, 'the fixed accent rgba values are gone')
  for (const token of SYNTAX_TOKENS) {
    assert.match(editor, new RegExp(`var\\(${token}\\)`), `the editor uses ${token}`)
  }
})

test('the editor selection and the search hits are mixed from the tokens', () => {
  assert.match(editor, /\.cm-selectionBackground[^{]*\{[^}]*color-mix\(in srgb, var\(--iwb-accent\)/)
  assert.match(editor, /\.cm-matchingBracket[^{]*\{[^}]*color-mix\(in srgb, var\(--iwb-accent\)/)
  assert.match(editor, /\.cm-searchMatch[^{]*\{[^}]*color-mix\(in srgb, var\(--iwb-warn\)/)
  // The host theme is not the system theme.
  assert.doesNotMatch(editor, /@media[^{]*prefers-color-scheme/)
})

test('the blocking confirmation sits above the dialog it answers', () => {
  assert.match(styles, /\.iwb-modal-backdrop\.iwb-confirm-backdrop \{[^}]*z-index: 55;/)
  assert.match(styles, /\.iwb-modal-backdrop\.iwb-confirm-backdrop \{[^}]*background: rgba\(0, 0, 0, \.6\);/)
  // The default scope of the confirmation uses the deeper backdrop, the
  // editor scope keeps its own class.
  assert.match(ui, /'iwb-modal-backdrop iwb-confirm-backdrop'/)
  assert.match(ui, /'iwb-modal-backdrop iwb-editor-scoped-backdrop'/)
})
