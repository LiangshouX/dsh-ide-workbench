window.__ModuleLoader__.load({
  id: "dsh-ide-codeintel",
  factory: function(require) {
    var module = { exports: {} };
    var exports = module.exports;
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/vendor/cm-runtime.js
function cmRuntime() {
  const runtime = globalThis[CM_RUNTIME_KEY];
  if (runtime === void 0 || runtime === null) {
    throw new Error("The CodeMirror runtime is not bound - the IDE workbench plugin (dsh-ide-workbench) is not installed.");
  }
  return runtime;
}
function lazyProxy(namespace, name2) {
  const target = function() {
  };
  const resolve = () => cmRuntime()[namespace][name2];
  return new Proxy(target, {
    get(_target, key) {
      return resolve()[key];
    },
    apply(_target, _thisArg, args) {
      return Reflect.apply(resolve(), void 0, args);
    },
    construct(_target, args) {
      return Reflect.construct(resolve(), args);
    }
  });
}
var CM_RUNTIME_KEY;
var init_cm_runtime = __esm({
  "src/client/vendor/cm-runtime.js"() {
    CM_RUNTIME_KEY = /* @__PURE__ */ Symbol.for("dsh.ide-workbench.codemirror");
  }
});

// src/client/vendor/cm-autocomplete.js
var CompletionContext, acceptCompletion, autocompletion, clearSnippet, closeBrackets, closeBracketsKeymap, closeCompletion, completeAnyWord, completeFromList, completionKeymap, completionStatus, currentCompletions, deleteBracketPair, hasNextSnippetField, hasPrevSnippetField, ifIn, ifNotIn, insertBracket, insertCompletionText, moveCompletionSelection, nextSnippetField, pickedCompletion, prevSnippetField, selectedCompletion, selectedCompletionIndex, setSelectedCompletion, snippet, snippetCompletion, snippetKeymap, startCompletion;
var init_cm_autocomplete = __esm({
  "src/client/vendor/cm-autocomplete.js"() {
    init_cm_runtime();
    CompletionContext = lazyProxy("autocomplete", "CompletionContext");
    acceptCompletion = lazyProxy("autocomplete", "acceptCompletion");
    autocompletion = lazyProxy("autocomplete", "autocompletion");
    clearSnippet = lazyProxy("autocomplete", "clearSnippet");
    closeBrackets = lazyProxy("autocomplete", "closeBrackets");
    closeBracketsKeymap = lazyProxy("autocomplete", "closeBracketsKeymap");
    closeCompletion = lazyProxy("autocomplete", "closeCompletion");
    completeAnyWord = lazyProxy("autocomplete", "completeAnyWord");
    completeFromList = lazyProxy("autocomplete", "completeFromList");
    completionKeymap = lazyProxy("autocomplete", "completionKeymap");
    completionStatus = lazyProxy("autocomplete", "completionStatus");
    currentCompletions = lazyProxy("autocomplete", "currentCompletions");
    deleteBracketPair = lazyProxy("autocomplete", "deleteBracketPair");
    hasNextSnippetField = lazyProxy("autocomplete", "hasNextSnippetField");
    hasPrevSnippetField = lazyProxy("autocomplete", "hasPrevSnippetField");
    ifIn = lazyProxy("autocomplete", "ifIn");
    ifNotIn = lazyProxy("autocomplete", "ifNotIn");
    insertBracket = lazyProxy("autocomplete", "insertBracket");
    insertCompletionText = lazyProxy("autocomplete", "insertCompletionText");
    moveCompletionSelection = lazyProxy("autocomplete", "moveCompletionSelection");
    nextSnippetField = lazyProxy("autocomplete", "nextSnippetField");
    pickedCompletion = lazyProxy("autocomplete", "pickedCompletion");
    prevSnippetField = lazyProxy("autocomplete", "prevSnippetField");
    selectedCompletion = lazyProxy("autocomplete", "selectedCompletion");
    selectedCompletionIndex = lazyProxy("autocomplete", "selectedCompletionIndex");
    setSelectedCompletion = lazyProxy("autocomplete", "setSelectedCompletion");
    snippet = lazyProxy("autocomplete", "snippet");
    snippetCompletion = lazyProxy("autocomplete", "snippetCompletion");
    snippetKeymap = lazyProxy("autocomplete", "snippetKeymap");
    startCompletion = lazyProxy("autocomplete", "startCompletion");
  }
});

// src/client/vendor/cm-view.js
var BidiSpan, BlockInfo, BlockType, BlockWrapper, Decoration, Direction, EditorView, GutterMarker, MatchDecorator, RectangleMarker, ViewPlugin, ViewUpdate, WidgetType, activateHover, closeHoverTooltip, closeHoverTooltips, crosshairCursor, drawSelection, dropCursor, getDialog, getDrawSelectionConfig, getPanel, getTooltip, gutter, gutterLineClass, gutterWidgetClass, gutters, hasHoverTooltips, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, highlightTrailingWhitespace, highlightWhitespace, hoverTooltip, keymap, layer, lineNumberMarkers, lineNumberWidgetMarker, lineNumbers, logException, panels, placeholder, rectangularSelection, repositionTooltips, runScopeHandlers, scrollPastEnd, showDialog, showPanel, showTooltip, tooltips;
var init_cm_view = __esm({
  "src/client/vendor/cm-view.js"() {
    init_cm_runtime();
    BidiSpan = lazyProxy("view", "BidiSpan");
    BlockInfo = lazyProxy("view", "BlockInfo");
    BlockType = lazyProxy("view", "BlockType");
    BlockWrapper = lazyProxy("view", "BlockWrapper");
    Decoration = lazyProxy("view", "Decoration");
    Direction = lazyProxy("view", "Direction");
    EditorView = lazyProxy("view", "EditorView");
    GutterMarker = lazyProxy("view", "GutterMarker");
    MatchDecorator = lazyProxy("view", "MatchDecorator");
    RectangleMarker = lazyProxy("view", "RectangleMarker");
    ViewPlugin = lazyProxy("view", "ViewPlugin");
    ViewUpdate = lazyProxy("view", "ViewUpdate");
    WidgetType = lazyProxy("view", "WidgetType");
    activateHover = lazyProxy("view", "activateHover");
    closeHoverTooltip = lazyProxy("view", "closeHoverTooltip");
    closeHoverTooltips = lazyProxy("view", "closeHoverTooltips");
    crosshairCursor = lazyProxy("view", "crosshairCursor");
    drawSelection = lazyProxy("view", "drawSelection");
    dropCursor = lazyProxy("view", "dropCursor");
    getDialog = lazyProxy("view", "getDialog");
    getDrawSelectionConfig = lazyProxy("view", "getDrawSelectionConfig");
    getPanel = lazyProxy("view", "getPanel");
    getTooltip = lazyProxy("view", "getTooltip");
    gutter = lazyProxy("view", "gutter");
    gutterLineClass = lazyProxy("view", "gutterLineClass");
    gutterWidgetClass = lazyProxy("view", "gutterWidgetClass");
    gutters = lazyProxy("view", "gutters");
    hasHoverTooltips = lazyProxy("view", "hasHoverTooltips");
    highlightActiveLine = lazyProxy("view", "highlightActiveLine");
    highlightActiveLineGutter = lazyProxy("view", "highlightActiveLineGutter");
    highlightSpecialChars = lazyProxy("view", "highlightSpecialChars");
    highlightTrailingWhitespace = lazyProxy("view", "highlightTrailingWhitespace");
    highlightWhitespace = lazyProxy("view", "highlightWhitespace");
    hoverTooltip = lazyProxy("view", "hoverTooltip");
    keymap = lazyProxy("view", "keymap");
    layer = lazyProxy("view", "layer");
    lineNumberMarkers = lazyProxy("view", "lineNumberMarkers");
    lineNumberWidgetMarker = lazyProxy("view", "lineNumberWidgetMarker");
    lineNumbers = lazyProxy("view", "lineNumbers");
    logException = lazyProxy("view", "logException");
    panels = lazyProxy("view", "panels");
    placeholder = lazyProxy("view", "placeholder");
    rectangularSelection = lazyProxy("view", "rectangularSelection");
    repositionTooltips = lazyProxy("view", "repositionTooltips");
    runScopeHandlers = lazyProxy("view", "runScopeHandlers");
    scrollPastEnd = lazyProxy("view", "scrollPastEnd");
    showDialog = lazyProxy("view", "showDialog");
    showPanel = lazyProxy("view", "showPanel");
    showTooltip = lazyProxy("view", "showTooltip");
    tooltips = lazyProxy("view", "tooltips");
  }
});

// src/client/vendor/cm-state.js
var Annotation, AnnotationType, ChangeDesc, ChangeSet, CharCategory, Compartment, EditorSelection, EditorState, Facet, Line, MapMode, Prec, Range, RangeSet, RangeSetBuilder, RangeValue, SelectionRange, StateEffect, StateEffectType, StateField, Text, Transaction, codePointAt, codePointSize, combineConfig, countColumn, findClusterBreak, findColumn, fromCodePoint;
var init_cm_state = __esm({
  "src/client/vendor/cm-state.js"() {
    init_cm_runtime();
    Annotation = lazyProxy("state", "Annotation");
    AnnotationType = lazyProxy("state", "AnnotationType");
    ChangeDesc = lazyProxy("state", "ChangeDesc");
    ChangeSet = lazyProxy("state", "ChangeSet");
    CharCategory = lazyProxy("state", "CharCategory");
    Compartment = lazyProxy("state", "Compartment");
    EditorSelection = lazyProxy("state", "EditorSelection");
    EditorState = lazyProxy("state", "EditorState");
    Facet = lazyProxy("state", "Facet");
    Line = lazyProxy("state", "Line");
    MapMode = lazyProxy("state", "MapMode");
    Prec = lazyProxy("state", "Prec");
    Range = lazyProxy("state", "Range");
    RangeSet = lazyProxy("state", "RangeSet");
    RangeSetBuilder = lazyProxy("state", "RangeSetBuilder");
    RangeValue = lazyProxy("state", "RangeValue");
    SelectionRange = lazyProxy("state", "SelectionRange");
    StateEffect = lazyProxy("state", "StateEffect");
    StateEffectType = lazyProxy("state", "StateEffectType");
    StateField = lazyProxy("state", "StateField");
    Text = lazyProxy("state", "Text");
    Transaction = lazyProxy("state", "Transaction");
    codePointAt = lazyProxy("state", "codePointAt");
    codePointSize = lazyProxy("state", "codePointSize");
    combineConfig = lazyProxy("state", "combineConfig");
    countColumn = lazyProxy("state", "countColumn");
    findClusterBreak = lazyProxy("state", "findClusterBreak");
    findColumn = lazyProxy("state", "findColumn");
    fromCodePoint = lazyProxy("state", "fromCodePoint");
  }
});

// src/client/vendor/cm-language.js
var DocInput, HighlightStyle, IndentContext, LRLanguage, Language, LanguageDescription, LanguageSupport, ParseContext, StreamLanguage, StringStream, TreeIndentContext, bidiIsolates, bracketMatching, bracketMatchingHandle, codeFolding, continuedIndent, defaultHighlightStyle, defineLanguageFacet, delimitedIndent, ensureSyntaxTree, flatIndent, foldAll, foldCode, foldEffect, foldGutter, foldInside, foldKeymap, foldNodeProp, foldService, foldState, foldable, foldedRanges, forceParsing, getIndentUnit, getIndentation, highlightingFor, indentNodeProp, indentOnInput, indentRange, indentService, indentString, indentUnit, language, languageDataProp, matchBrackets, sublanguageProp, syntaxHighlighting, syntaxParserRunning, syntaxTree, syntaxTreeAvailable, toggleFold, unfoldAll, unfoldCode, unfoldEffect;
var init_cm_language = __esm({
  "src/client/vendor/cm-language.js"() {
    init_cm_runtime();
    DocInput = lazyProxy("language", "DocInput");
    HighlightStyle = lazyProxy("language", "HighlightStyle");
    IndentContext = lazyProxy("language", "IndentContext");
    LRLanguage = lazyProxy("language", "LRLanguage");
    Language = lazyProxy("language", "Language");
    LanguageDescription = lazyProxy("language", "LanguageDescription");
    LanguageSupport = lazyProxy("language", "LanguageSupport");
    ParseContext = lazyProxy("language", "ParseContext");
    StreamLanguage = lazyProxy("language", "StreamLanguage");
    StringStream = lazyProxy("language", "StringStream");
    TreeIndentContext = lazyProxy("language", "TreeIndentContext");
    bidiIsolates = lazyProxy("language", "bidiIsolates");
    bracketMatching = lazyProxy("language", "bracketMatching");
    bracketMatchingHandle = lazyProxy("language", "bracketMatchingHandle");
    codeFolding = lazyProxy("language", "codeFolding");
    continuedIndent = lazyProxy("language", "continuedIndent");
    defaultHighlightStyle = lazyProxy("language", "defaultHighlightStyle");
    defineLanguageFacet = lazyProxy("language", "defineLanguageFacet");
    delimitedIndent = lazyProxy("language", "delimitedIndent");
    ensureSyntaxTree = lazyProxy("language", "ensureSyntaxTree");
    flatIndent = lazyProxy("language", "flatIndent");
    foldAll = lazyProxy("language", "foldAll");
    foldCode = lazyProxy("language", "foldCode");
    foldEffect = lazyProxy("language", "foldEffect");
    foldGutter = lazyProxy("language", "foldGutter");
    foldInside = lazyProxy("language", "foldInside");
    foldKeymap = lazyProxy("language", "foldKeymap");
    foldNodeProp = lazyProxy("language", "foldNodeProp");
    foldService = lazyProxy("language", "foldService");
    foldState = lazyProxy("language", "foldState");
    foldable = lazyProxy("language", "foldable");
    foldedRanges = lazyProxy("language", "foldedRanges");
    forceParsing = lazyProxy("language", "forceParsing");
    getIndentUnit = lazyProxy("language", "getIndentUnit");
    getIndentation = lazyProxy("language", "getIndentation");
    highlightingFor = lazyProxy("language", "highlightingFor");
    indentNodeProp = lazyProxy("language", "indentNodeProp");
    indentOnInput = lazyProxy("language", "indentOnInput");
    indentRange = lazyProxy("language", "indentRange");
    indentService = lazyProxy("language", "indentService");
    indentString = lazyProxy("language", "indentString");
    indentUnit = lazyProxy("language", "indentUnit");
    language = lazyProxy("language", "language");
    languageDataProp = lazyProxy("language", "languageDataProp");
    matchBrackets = lazyProxy("language", "matchBrackets");
    sublanguageProp = lazyProxy("language", "sublanguageProp");
    syntaxHighlighting = lazyProxy("language", "syntaxHighlighting");
    syntaxParserRunning = lazyProxy("language", "syntaxParserRunning");
    syntaxTree = lazyProxy("language", "syntaxTree");
    syntaxTreeAvailable = lazyProxy("language", "syntaxTreeAvailable");
    toggleFold = lazyProxy("language", "toggleFold");
    unfoldAll = lazyProxy("language", "unfoldAll");
    unfoldCode = lazyProxy("language", "unfoldCode");
    unfoldEffect = lazyProxy("language", "unfoldEffect");
  }
});

// ../../node_modules/marked/lib/marked.esm.js
function _getDefaults() {
  return {
    async: false,
    breaks: false,
    extensions: null,
    gfm: true,
    hooks: null,
    pedantic: false,
    renderer: null,
    silent: false,
    tokenizer: null,
    walkTokens: null
  };
}
function changeDefaults(newDefaults) {
  _defaults = newDefaults;
}
function edit(regex, opt = "") {
  let source = typeof regex === "string" ? regex : regex.source;
  const obj = {
    replace: (name2, val) => {
      let valSource = typeof val === "string" ? val : val.source;
      valSource = valSource.replace(other.caret, "$1");
      source = source.replace(name2, valSource);
      return obj;
    },
    getRegex: () => {
      return new RegExp(source, opt);
    }
  };
  return obj;
}
function escape2(html2, encode) {
  if (encode) {
    if (other.escapeTest.test(html2)) {
      return html2.replace(other.escapeReplace, getEscapeReplacement);
    }
  } else {
    if (other.escapeTestNoEncode.test(html2)) {
      return html2.replace(other.escapeReplaceNoEncode, getEscapeReplacement);
    }
  }
  return html2;
}
function cleanUrl(href) {
  try {
    href = encodeURI(href).replace(other.percentDecode, "%");
  } catch {
    return null;
  }
  return href;
}
function splitCells(tableRow, count) {
  const row = tableRow.replace(other.findPipe, (match, offset, str) => {
    let escaped = false;
    let curr = offset;
    while (--curr >= 0 && str[curr] === "\\") escaped = !escaped;
    if (escaped) {
      return "|";
    } else {
      return " |";
    }
  }), cells = row.split(other.splitPipe);
  let i = 0;
  if (!cells[0].trim()) {
    cells.shift();
  }
  if (cells.length > 0 && !cells.at(-1)?.trim()) {
    cells.pop();
  }
  if (count) {
    if (cells.length > count) {
      cells.splice(count);
    } else {
      while (cells.length < count) cells.push("");
    }
  }
  for (; i < cells.length; i++) {
    cells[i] = cells[i].trim().replace(other.slashPipe, "|");
  }
  return cells;
}
function rtrim(str, c, invert) {
  const l = str.length;
  if (l === 0) {
    return "";
  }
  let suffLen = 0;
  while (suffLen < l) {
    const currChar = str.charAt(l - suffLen - 1);
    if (currChar === c && !invert) {
      suffLen++;
    } else if (currChar !== c && invert) {
      suffLen++;
    } else {
      break;
    }
  }
  return str.slice(0, l - suffLen);
}
function findClosingBracket(str, b) {
  if (str.indexOf(b[1]) === -1) {
    return -1;
  }
  let level = 0;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === "\\") {
      i++;
    } else if (str[i] === b[0]) {
      level++;
    } else if (str[i] === b[1]) {
      level--;
      if (level < 0) {
        return i;
      }
    }
  }
  if (level > 0) {
    return -2;
  }
  return -1;
}
function outputLink(cap, link2, raw, lexer2, rules) {
  const href = link2.href;
  const title = link2.title || null;
  const text = cap[1].replace(rules.other.outputLinkReplace, "$1");
  lexer2.state.inLink = true;
  const token = {
    type: cap[0].charAt(0) === "!" ? "image" : "link",
    raw,
    href,
    title,
    text,
    tokens: lexer2.inlineTokens(text)
  };
  lexer2.state.inLink = false;
  return token;
}
function indentCodeCompensation(raw, text, rules) {
  const matchIndentToCode = raw.match(rules.other.indentCodeCompensation);
  if (matchIndentToCode === null) {
    return text;
  }
  const indentToCode = matchIndentToCode[1];
  return text.split("\n").map((node) => {
    const matchIndentInNode = node.match(rules.other.beginningSpace);
    if (matchIndentInNode === null) {
      return node;
    }
    const [indentInNode] = matchIndentInNode;
    if (indentInNode.length >= indentToCode.length) {
      return node.slice(indentToCode.length);
    }
    return node;
  }).join("\n");
}
function marked(src, opt) {
  return markedInstance.parse(src, opt);
}
var _defaults, noopTest, other, newline, blockCode, fences, hr, heading, bullet, lheadingCore, lheading, lheadingGfm, _paragraph, blockText, _blockLabel, def, list, _tag, _comment, html, paragraph, blockquote, blockNormal, gfmTable, blockGfm, blockPedantic, escape, inlineCode, br, inlineText, _punctuation, _punctuationOrSpace, _notPunctuationOrSpace, punctuation, _punctuationGfmStrongEm, _punctuationOrSpaceGfmStrongEm, _notPunctuationOrSpaceGfmStrongEm, blockSkip, emStrongLDelimCore, emStrongLDelim, emStrongLDelimGfm, emStrongRDelimAstCore, emStrongRDelimAst, emStrongRDelimAstGfm, emStrongRDelimUnd, anyPunctuation, autolink, _inlineComment, tag, _inlineLabel, link, reflink, nolink, reflinkSearch, inlineNormal, inlinePedantic, inlineGfm, inlineBreaks, block, inline, escapeReplacements, getEscapeReplacement, _Tokenizer, _Lexer, _Renderer, _TextRenderer, _Parser, _Hooks, Marked, markedInstance, options, setOptions, use, walkTokens, parseInline, parser, lexer;
var init_marked_esm = __esm({
  "../../node_modules/marked/lib/marked.esm.js"() {
    _defaults = _getDefaults();
    noopTest = { exec: () => null };
    other = {
      codeRemoveIndent: /^(?: {1,4}| {0,3}\t)/gm,
      outputLinkReplace: /\\([\[\]])/g,
      indentCodeCompensation: /^(\s+)(?:```)/,
      beginningSpace: /^\s+/,
      endingHash: /#$/,
      startingSpaceChar: /^ /,
      endingSpaceChar: / $/,
      nonSpaceChar: /[^ ]/,
      newLineCharGlobal: /\n/g,
      tabCharGlobal: /\t/g,
      multipleSpaceGlobal: /\s+/g,
      blankLine: /^[ \t]*$/,
      doubleBlankLine: /\n[ \t]*\n[ \t]*$/,
      blockquoteStart: /^ {0,3}>/,
      blockquoteSetextReplace: /\n {0,3}((?:=+|-+) *)(?=\n|$)/g,
      blockquoteSetextReplace2: /^ {0,3}>[ \t]?/gm,
      listReplaceTabs: /^\t+/,
      listReplaceNesting: /^ {1,4}(?=( {4})*[^ ])/g,
      listIsTask: /^\[[ xX]\] /,
      listReplaceTask: /^\[[ xX]\] +/,
      anyLine: /\n.*\n/,
      hrefBrackets: /^<(.*)>$/,
      tableDelimiter: /[:|]/,
      tableAlignChars: /^\||\| *$/g,
      tableRowBlankLine: /\n[ \t]*$/,
      tableAlignRight: /^ *-+: *$/,
      tableAlignCenter: /^ *:-+: *$/,
      tableAlignLeft: /^ *:-+ *$/,
      startATag: /^<a /i,
      endATag: /^<\/a>/i,
      startPreScriptTag: /^<(pre|code|kbd|script)(\s|>)/i,
      endPreScriptTag: /^<\/(pre|code|kbd|script)(\s|>)/i,
      startAngleBracket: /^</,
      endAngleBracket: />$/,
      pedanticHrefTitle: /^([^'"]*[^\s])\s+(['"])(.*)\2/,
      unicodeAlphaNumeric: /[\p{L}\p{N}]/u,
      escapeTest: /[&<>"']/,
      escapeReplace: /[&<>"']/g,
      escapeTestNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/,
      escapeReplaceNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g,
      unescapeTest: /&(#(?:\d+)|(?:#x[0-9A-Fa-f]+)|(?:\w+));?/ig,
      caret: /(^|[^\[])\^/g,
      percentDecode: /%25/g,
      findPipe: /\|/g,
      splitPipe: / \|/,
      slashPipe: /\\\|/g,
      carriageReturn: /\r\n|\r/g,
      spaceLine: /^ +$/gm,
      notSpaceStart: /^\S*/,
      endingNewline: /\n$/,
      listItemRegex: (bull) => new RegExp(`^( {0,3}${bull})((?:[	 ][^\\n]*)?(?:\\n|$))`),
      nextBulletRegex: (indent) => new RegExp(`^ {0,${Math.min(3, indent - 1)}}(?:[*+-]|\\d{1,9}[.)])((?:[ 	][^\\n]*)?(?:\\n|$))`),
      hrRegex: (indent) => new RegExp(`^ {0,${Math.min(3, indent - 1)}}((?:- *){3,}|(?:_ *){3,}|(?:\\* *){3,})(?:\\n+|$)`),
      fencesBeginRegex: (indent) => new RegExp(`^ {0,${Math.min(3, indent - 1)}}(?:\`\`\`|~~~)`),
      headingBeginRegex: (indent) => new RegExp(`^ {0,${Math.min(3, indent - 1)}}#`),
      htmlBeginRegex: (indent) => new RegExp(`^ {0,${Math.min(3, indent - 1)}}<(?:[a-z].*>|!--)`, "i")
    };
    newline = /^(?:[ \t]*(?:\n|$))+/;
    blockCode = /^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/;
    fences = /^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}\1[~`]* *(?=\n|$)|$)/;
    hr = /^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/;
    heading = /^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/;
    bullet = /(?:[*+-]|\d{1,9}[.)])/;
    lheadingCore = /^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\n(?!\s*?\n|bull |blockCode|fences|blockquote|heading|html|table))+?)\n {0,3}(=+|-+) *(?:\n+|$)/;
    lheading = edit(lheadingCore).replace(/bull/g, bullet).replace(/blockCode/g, /(?: {4}| {0,3}\t)/).replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g, / {0,3}>/).replace(/heading/g, / {0,3}#{1,6}/).replace(/html/g, / {0,3}<[^\n>]+>\n/).replace(/\|table/g, "").getRegex();
    lheadingGfm = edit(lheadingCore).replace(/bull/g, bullet).replace(/blockCode/g, /(?: {4}| {0,3}\t)/).replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g, / {0,3}>/).replace(/heading/g, / {0,3}#{1,6}/).replace(/html/g, / {0,3}<[^\n>]+>\n/).replace(/table/g, / {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n/).getRegex();
    _paragraph = /^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table| +\n)[^\n]+)*)/;
    blockText = /^[^\n]+/;
    _blockLabel = /(?!\s*\])(?:\\.|[^\[\]\\])+/;
    def = edit(/^ {0,3}\[(label)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)(title))? *(?:\n+|$)/).replace("label", _blockLabel).replace("title", /(?:"(?:\\"?|[^"\\])*"|'[^'\n]*(?:\n[^'\n]+)*\n?'|\([^()]*\))/).getRegex();
    list = edit(/^( {0,3}bull)([ \t][^\n]+?)?(?:\n|$)/).replace(/bull/g, bullet).getRegex();
    _tag = "address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul";
    _comment = /<!--(?:-?>|[\s\S]*?(?:-->|$))/;
    html = edit(
      "^ {0,3}(?:<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n+|$)|comment[^\\n]*(\\n+|$)|<\\?[\\s\\S]*?(?:\\?>\\n*|$)|<![A-Z][\\s\\S]*?(?:>\\n*|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>\\n*|$)|</?(tag)(?: +|\\n|/?>)[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|<(?!script|pre|style|textarea)([a-z][\\w-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|</(?!script|pre|style|textarea)[a-z][\\w-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$))",
      "i"
    ).replace("comment", _comment).replace("tag", _tag).replace("attribute", / +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/).getRegex();
    paragraph = edit(_paragraph).replace("hr", hr).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("|lheading", "").replace("|table", "").replace("blockquote", " {0,3}>").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list", " {0,3}(?:[*+-]|1[.)]) ").replace("html", "</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag", _tag).getRegex();
    blockquote = edit(/^( {0,3}> ?(paragraph|[^\n]*)(?:\n|$))+/).replace("paragraph", paragraph).getRegex();
    blockNormal = {
      blockquote,
      code: blockCode,
      def,
      fences,
      heading,
      hr,
      html,
      lheading,
      list,
      newline,
      paragraph,
      table: noopTest,
      text: blockText
    };
    gfmTable = edit(
      "^ *([^\\n ].*)\\n {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)"
    ).replace("hr", hr).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("blockquote", " {0,3}>").replace("code", "(?: {4}| {0,3}	)[^\\n]").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list", " {0,3}(?:[*+-]|1[.)]) ").replace("html", "</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag", _tag).getRegex();
    blockGfm = {
      ...blockNormal,
      lheading: lheadingGfm,
      table: gfmTable,
      paragraph: edit(_paragraph).replace("hr", hr).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("|lheading", "").replace("table", gfmTable).replace("blockquote", " {0,3}>").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list", " {0,3}(?:[*+-]|1[.)]) ").replace("html", "</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag", _tag).getRegex()
    };
    blockPedantic = {
      ...blockNormal,
      html: edit(
        `^ *(?:comment *(?:\\n|\\s*$)|<(tag)[\\s\\S]+?</\\1> *(?:\\n{2,}|\\s*$)|<tag(?:"[^"]*"|'[^']*'|\\s[^'"/>\\s]*)*?/?> *(?:\\n{2,}|\\s*$))`
      ).replace("comment", _comment).replace(/tag/g, "(?!(?:a|em|strong|small|s|cite|q|dfn|abbr|data|time|code|var|samp|kbd|sub|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo|span|br|wbr|ins|del|img)\\b)\\w+(?!:|[^\\w\\s@]*@)\\b").getRegex(),
      def: /^ *\[([^\]]+)\]: *<?([^\s>]+)>?(?: +(["(][^\n]+[")]))? *(?:\n+|$)/,
      heading: /^(#{1,6})(.*)(?:\n+|$)/,
      fences: noopTest,
      // fences not supported
      lheading: /^(.+?)\n {0,3}(=+|-+) *(?:\n+|$)/,
      paragraph: edit(_paragraph).replace("hr", hr).replace("heading", " *#{1,6} *[^\n]").replace("lheading", lheading).replace("|table", "").replace("blockquote", " {0,3}>").replace("|fences", "").replace("|list", "").replace("|html", "").replace("|tag", "").getRegex()
    };
    escape = /^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/;
    inlineCode = /^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/;
    br = /^( {2,}|\\)\n(?!\s*$)/;
    inlineText = /^(`+|[^`])(?:(?= {2,}\n)|[\s\S]*?(?:(?=[\\<!\[`*_]|\b_|$)|[^ ](?= {2,}\n)))/;
    _punctuation = /[\p{P}\p{S}]/u;
    _punctuationOrSpace = /[\s\p{P}\p{S}]/u;
    _notPunctuationOrSpace = /[^\s\p{P}\p{S}]/u;
    punctuation = edit(/^((?![*_])punctSpace)/, "u").replace(/punctSpace/g, _punctuationOrSpace).getRegex();
    _punctuationGfmStrongEm = /(?!~)[\p{P}\p{S}]/u;
    _punctuationOrSpaceGfmStrongEm = /(?!~)[\s\p{P}\p{S}]/u;
    _notPunctuationOrSpaceGfmStrongEm = /(?:[^\s\p{P}\p{S}]|~)/u;
    blockSkip = /\[[^[\]]*?\]\((?:\\.|[^\\\(\)]|\((?:\\.|[^\\\(\)])*\))*\)|`[^`]*?`|<[^<>]*?>/g;
    emStrongLDelimCore = /^(?:\*+(?:((?!\*)punct)|[^\s*]))|^_+(?:((?!_)punct)|([^\s_]))/;
    emStrongLDelim = edit(emStrongLDelimCore, "u").replace(/punct/g, _punctuation).getRegex();
    emStrongLDelimGfm = edit(emStrongLDelimCore, "u").replace(/punct/g, _punctuationGfmStrongEm).getRegex();
    emStrongRDelimAstCore = "^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)punctSpace(\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|notPunctSpace(\\*+)(?=notPunctSpace)";
    emStrongRDelimAst = edit(emStrongRDelimAstCore, "gu").replace(/notPunctSpace/g, _notPunctuationOrSpace).replace(/punctSpace/g, _punctuationOrSpace).replace(/punct/g, _punctuation).getRegex();
    emStrongRDelimAstGfm = edit(emStrongRDelimAstCore, "gu").replace(/notPunctSpace/g, _notPunctuationOrSpaceGfmStrongEm).replace(/punctSpace/g, _punctuationOrSpaceGfmStrongEm).replace(/punct/g, _punctuationGfmStrongEm).getRegex();
    emStrongRDelimUnd = edit(
      "^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)punctSpace(_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)",
      "gu"
    ).replace(/notPunctSpace/g, _notPunctuationOrSpace).replace(/punctSpace/g, _punctuationOrSpace).replace(/punct/g, _punctuation).getRegex();
    anyPunctuation = edit(/\\(punct)/, "gu").replace(/punct/g, _punctuation).getRegex();
    autolink = edit(/^<(scheme:[^\s\x00-\x1f<>]*|email)>/).replace("scheme", /[a-zA-Z][a-zA-Z0-9+.-]{1,31}/).replace("email", /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/).getRegex();
    _inlineComment = edit(_comment).replace("(?:-->|$)", "-->").getRegex();
    tag = edit(
      "^comment|^</[a-zA-Z][\\w:-]*\\s*>|^<[a-zA-Z][\\w-]*(?:attribute)*?\\s*/?>|^<\\?[\\s\\S]*?\\?>|^<![a-zA-Z]+\\s[\\s\\S]*?>|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>"
    ).replace("comment", _inlineComment).replace("attribute", /\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/).getRegex();
    _inlineLabel = /(?:\[(?:\\.|[^\[\]\\])*\]|\\.|`[^`]*`|[^\[\]\\`])*?/;
    link = edit(/^!?\[(label)\]\(\s*(href)(?:(?:[ \t]*(?:\n[ \t]*)?)(title))?\s*\)/).replace("label", _inlineLabel).replace("href", /<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]*/).replace("title", /"(?:\\"?|[^"\\])*"|'(?:\\'?|[^'\\])*'|\((?:\\\)?|[^)\\])*\)/).getRegex();
    reflink = edit(/^!?\[(label)\]\[(ref)\]/).replace("label", _inlineLabel).replace("ref", _blockLabel).getRegex();
    nolink = edit(/^!?\[(ref)\](?:\[\])?/).replace("ref", _blockLabel).getRegex();
    reflinkSearch = edit("reflink|nolink(?!\\()", "g").replace("reflink", reflink).replace("nolink", nolink).getRegex();
    inlineNormal = {
      _backpedal: noopTest,
      // only used for GFM url
      anyPunctuation,
      autolink,
      blockSkip,
      br,
      code: inlineCode,
      del: noopTest,
      emStrongLDelim,
      emStrongRDelimAst,
      emStrongRDelimUnd,
      escape,
      link,
      nolink,
      punctuation,
      reflink,
      reflinkSearch,
      tag,
      text: inlineText,
      url: noopTest
    };
    inlinePedantic = {
      ...inlineNormal,
      link: edit(/^!?\[(label)\]\((.*?)\)/).replace("label", _inlineLabel).getRegex(),
      reflink: edit(/^!?\[(label)\]\s*\[([^\]]*)\]/).replace("label", _inlineLabel).getRegex()
    };
    inlineGfm = {
      ...inlineNormal,
      emStrongRDelimAst: emStrongRDelimAstGfm,
      emStrongLDelim: emStrongLDelimGfm,
      url: edit(/^((?:ftp|https?):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/, "i").replace("email", /[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![-_])/).getRegex(),
      _backpedal: /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/,
      del: /^(~~?)(?=[^\s~])((?:\\.|[^\\])*?(?:\\.|[^\s~\\]))\1(?=[^~]|$)/,
      text: /^([`~]+|[^`~])(?:(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|https?:\/\/|ftp:\/\/|www\.|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)))/
    };
    inlineBreaks = {
      ...inlineGfm,
      br: edit(br).replace("{2,}", "*").getRegex(),
      text: edit(inlineGfm.text).replace("\\b_", "\\b_| {2,}\\n").replace(/\{2,\}/g, "*").getRegex()
    };
    block = {
      normal: blockNormal,
      gfm: blockGfm,
      pedantic: blockPedantic
    };
    inline = {
      normal: inlineNormal,
      gfm: inlineGfm,
      breaks: inlineBreaks,
      pedantic: inlinePedantic
    };
    escapeReplacements = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };
    getEscapeReplacement = (ch) => escapeReplacements[ch];
    _Tokenizer = class {
      options;
      rules;
      // set by the lexer
      lexer;
      // set by the lexer
      constructor(options2) {
        this.options = options2 || _defaults;
      }
      space(src) {
        const cap = this.rules.block.newline.exec(src);
        if (cap && cap[0].length > 0) {
          return {
            type: "space",
            raw: cap[0]
          };
        }
      }
      code(src) {
        const cap = this.rules.block.code.exec(src);
        if (cap) {
          const text = cap[0].replace(this.rules.other.codeRemoveIndent, "");
          return {
            type: "code",
            raw: cap[0],
            codeBlockStyle: "indented",
            text: !this.options.pedantic ? rtrim(text, "\n") : text
          };
        }
      }
      fences(src) {
        const cap = this.rules.block.fences.exec(src);
        if (cap) {
          const raw = cap[0];
          const text = indentCodeCompensation(raw, cap[3] || "", this.rules);
          return {
            type: "code",
            raw,
            lang: cap[2] ? cap[2].trim().replace(this.rules.inline.anyPunctuation, "$1") : cap[2],
            text
          };
        }
      }
      heading(src) {
        const cap = this.rules.block.heading.exec(src);
        if (cap) {
          let text = cap[2].trim();
          if (this.rules.other.endingHash.test(text)) {
            const trimmed = rtrim(text, "#");
            if (this.options.pedantic) {
              text = trimmed.trim();
            } else if (!trimmed || this.rules.other.endingSpaceChar.test(trimmed)) {
              text = trimmed.trim();
            }
          }
          return {
            type: "heading",
            raw: cap[0],
            depth: cap[1].length,
            text,
            tokens: this.lexer.inline(text)
          };
        }
      }
      hr(src) {
        const cap = this.rules.block.hr.exec(src);
        if (cap) {
          return {
            type: "hr",
            raw: rtrim(cap[0], "\n")
          };
        }
      }
      blockquote(src) {
        const cap = this.rules.block.blockquote.exec(src);
        if (cap) {
          let lines = rtrim(cap[0], "\n").split("\n");
          let raw = "";
          let text = "";
          const tokens = [];
          while (lines.length > 0) {
            let inBlockquote = false;
            const currentLines = [];
            let i;
            for (i = 0; i < lines.length; i++) {
              if (this.rules.other.blockquoteStart.test(lines[i])) {
                currentLines.push(lines[i]);
                inBlockquote = true;
              } else if (!inBlockquote) {
                currentLines.push(lines[i]);
              } else {
                break;
              }
            }
            lines = lines.slice(i);
            const currentRaw = currentLines.join("\n");
            const currentText = currentRaw.replace(this.rules.other.blockquoteSetextReplace, "\n    $1").replace(this.rules.other.blockquoteSetextReplace2, "");
            raw = raw ? `${raw}
${currentRaw}` : currentRaw;
            text = text ? `${text}
${currentText}` : currentText;
            const top = this.lexer.state.top;
            this.lexer.state.top = true;
            this.lexer.blockTokens(currentText, tokens, true);
            this.lexer.state.top = top;
            if (lines.length === 0) {
              break;
            }
            const lastToken = tokens.at(-1);
            if (lastToken?.type === "code") {
              break;
            } else if (lastToken?.type === "blockquote") {
              const oldToken = lastToken;
              const newText = oldToken.raw + "\n" + lines.join("\n");
              const newToken = this.blockquote(newText);
              tokens[tokens.length - 1] = newToken;
              raw = raw.substring(0, raw.length - oldToken.raw.length) + newToken.raw;
              text = text.substring(0, text.length - oldToken.text.length) + newToken.text;
              break;
            } else if (lastToken?.type === "list") {
              const oldToken = lastToken;
              const newText = oldToken.raw + "\n" + lines.join("\n");
              const newToken = this.list(newText);
              tokens[tokens.length - 1] = newToken;
              raw = raw.substring(0, raw.length - lastToken.raw.length) + newToken.raw;
              text = text.substring(0, text.length - oldToken.raw.length) + newToken.raw;
              lines = newText.substring(tokens.at(-1).raw.length).split("\n");
              continue;
            }
          }
          return {
            type: "blockquote",
            raw,
            tokens,
            text
          };
        }
      }
      list(src) {
        let cap = this.rules.block.list.exec(src);
        if (cap) {
          let bull = cap[1].trim();
          const isordered = bull.length > 1;
          const list2 = {
            type: "list",
            raw: "",
            ordered: isordered,
            start: isordered ? +bull.slice(0, -1) : "",
            loose: false,
            items: []
          };
          bull = isordered ? `\\d{1,9}\\${bull.slice(-1)}` : `\\${bull}`;
          if (this.options.pedantic) {
            bull = isordered ? bull : "[*+-]";
          }
          const itemRegex = this.rules.other.listItemRegex(bull);
          let endsWithBlankLine = false;
          while (src) {
            let endEarly = false;
            let raw = "";
            let itemContents = "";
            if (!(cap = itemRegex.exec(src))) {
              break;
            }
            if (this.rules.block.hr.test(src)) {
              break;
            }
            raw = cap[0];
            src = src.substring(raw.length);
            let line = cap[2].split("\n", 1)[0].replace(this.rules.other.listReplaceTabs, (t2) => " ".repeat(3 * t2.length));
            let nextLine = src.split("\n", 1)[0];
            let blankLine = !line.trim();
            let indent = 0;
            if (this.options.pedantic) {
              indent = 2;
              itemContents = line.trimStart();
            } else if (blankLine) {
              indent = cap[1].length + 1;
            } else {
              indent = cap[2].search(this.rules.other.nonSpaceChar);
              indent = indent > 4 ? 1 : indent;
              itemContents = line.slice(indent);
              indent += cap[1].length;
            }
            if (blankLine && this.rules.other.blankLine.test(nextLine)) {
              raw += nextLine + "\n";
              src = src.substring(nextLine.length + 1);
              endEarly = true;
            }
            if (!endEarly) {
              const nextBulletRegex = this.rules.other.nextBulletRegex(indent);
              const hrRegex = this.rules.other.hrRegex(indent);
              const fencesBeginRegex = this.rules.other.fencesBeginRegex(indent);
              const headingBeginRegex = this.rules.other.headingBeginRegex(indent);
              const htmlBeginRegex = this.rules.other.htmlBeginRegex(indent);
              while (src) {
                const rawLine = src.split("\n", 1)[0];
                let nextLineWithoutTabs;
                nextLine = rawLine;
                if (this.options.pedantic) {
                  nextLine = nextLine.replace(this.rules.other.listReplaceNesting, "  ");
                  nextLineWithoutTabs = nextLine;
                } else {
                  nextLineWithoutTabs = nextLine.replace(this.rules.other.tabCharGlobal, "    ");
                }
                if (fencesBeginRegex.test(nextLine)) {
                  break;
                }
                if (headingBeginRegex.test(nextLine)) {
                  break;
                }
                if (htmlBeginRegex.test(nextLine)) {
                  break;
                }
                if (nextBulletRegex.test(nextLine)) {
                  break;
                }
                if (hrRegex.test(nextLine)) {
                  break;
                }
                if (nextLineWithoutTabs.search(this.rules.other.nonSpaceChar) >= indent || !nextLine.trim()) {
                  itemContents += "\n" + nextLineWithoutTabs.slice(indent);
                } else {
                  if (blankLine) {
                    break;
                  }
                  if (line.replace(this.rules.other.tabCharGlobal, "    ").search(this.rules.other.nonSpaceChar) >= 4) {
                    break;
                  }
                  if (fencesBeginRegex.test(line)) {
                    break;
                  }
                  if (headingBeginRegex.test(line)) {
                    break;
                  }
                  if (hrRegex.test(line)) {
                    break;
                  }
                  itemContents += "\n" + nextLine;
                }
                if (!blankLine && !nextLine.trim()) {
                  blankLine = true;
                }
                raw += rawLine + "\n";
                src = src.substring(rawLine.length + 1);
                line = nextLineWithoutTabs.slice(indent);
              }
            }
            if (!list2.loose) {
              if (endsWithBlankLine) {
                list2.loose = true;
              } else if (this.rules.other.doubleBlankLine.test(raw)) {
                endsWithBlankLine = true;
              }
            }
            let istask = null;
            let ischecked;
            if (this.options.gfm) {
              istask = this.rules.other.listIsTask.exec(itemContents);
              if (istask) {
                ischecked = istask[0] !== "[ ] ";
                itemContents = itemContents.replace(this.rules.other.listReplaceTask, "");
              }
            }
            list2.items.push({
              type: "list_item",
              raw,
              task: !!istask,
              checked: ischecked,
              loose: false,
              text: itemContents,
              tokens: []
            });
            list2.raw += raw;
          }
          const lastItem = list2.items.at(-1);
          if (lastItem) {
            lastItem.raw = lastItem.raw.trimEnd();
            lastItem.text = lastItem.text.trimEnd();
          } else {
            return;
          }
          list2.raw = list2.raw.trimEnd();
          for (let i = 0; i < list2.items.length; i++) {
            this.lexer.state.top = false;
            list2.items[i].tokens = this.lexer.blockTokens(list2.items[i].text, []);
            if (!list2.loose) {
              const spacers = list2.items[i].tokens.filter((t2) => t2.type === "space");
              const hasMultipleLineBreaks = spacers.length > 0 && spacers.some((t2) => this.rules.other.anyLine.test(t2.raw));
              list2.loose = hasMultipleLineBreaks;
            }
          }
          if (list2.loose) {
            for (let i = 0; i < list2.items.length; i++) {
              list2.items[i].loose = true;
            }
          }
          return list2;
        }
      }
      html(src) {
        const cap = this.rules.block.html.exec(src);
        if (cap) {
          const token = {
            type: "html",
            block: true,
            raw: cap[0],
            pre: cap[1] === "pre" || cap[1] === "script" || cap[1] === "style",
            text: cap[0]
          };
          return token;
        }
      }
      def(src) {
        const cap = this.rules.block.def.exec(src);
        if (cap) {
          const tag2 = cap[1].toLowerCase().replace(this.rules.other.multipleSpaceGlobal, " ");
          const href = cap[2] ? cap[2].replace(this.rules.other.hrefBrackets, "$1").replace(this.rules.inline.anyPunctuation, "$1") : "";
          const title = cap[3] ? cap[3].substring(1, cap[3].length - 1).replace(this.rules.inline.anyPunctuation, "$1") : cap[3];
          return {
            type: "def",
            tag: tag2,
            raw: cap[0],
            href,
            title
          };
        }
      }
      table(src) {
        const cap = this.rules.block.table.exec(src);
        if (!cap) {
          return;
        }
        if (!this.rules.other.tableDelimiter.test(cap[2])) {
          return;
        }
        const headers = splitCells(cap[1]);
        const aligns = cap[2].replace(this.rules.other.tableAlignChars, "").split("|");
        const rows = cap[3]?.trim() ? cap[3].replace(this.rules.other.tableRowBlankLine, "").split("\n") : [];
        const item = {
          type: "table",
          raw: cap[0],
          header: [],
          align: [],
          rows: []
        };
        if (headers.length !== aligns.length) {
          return;
        }
        for (const align of aligns) {
          if (this.rules.other.tableAlignRight.test(align)) {
            item.align.push("right");
          } else if (this.rules.other.tableAlignCenter.test(align)) {
            item.align.push("center");
          } else if (this.rules.other.tableAlignLeft.test(align)) {
            item.align.push("left");
          } else {
            item.align.push(null);
          }
        }
        for (let i = 0; i < headers.length; i++) {
          item.header.push({
            text: headers[i],
            tokens: this.lexer.inline(headers[i]),
            header: true,
            align: item.align[i]
          });
        }
        for (const row of rows) {
          item.rows.push(splitCells(row, item.header.length).map((cell, i) => {
            return {
              text: cell,
              tokens: this.lexer.inline(cell),
              header: false,
              align: item.align[i]
            };
          }));
        }
        return item;
      }
      lheading(src) {
        const cap = this.rules.block.lheading.exec(src);
        if (cap) {
          return {
            type: "heading",
            raw: cap[0],
            depth: cap[2].charAt(0) === "=" ? 1 : 2,
            text: cap[1],
            tokens: this.lexer.inline(cap[1])
          };
        }
      }
      paragraph(src) {
        const cap = this.rules.block.paragraph.exec(src);
        if (cap) {
          const text = cap[1].charAt(cap[1].length - 1) === "\n" ? cap[1].slice(0, -1) : cap[1];
          return {
            type: "paragraph",
            raw: cap[0],
            text,
            tokens: this.lexer.inline(text)
          };
        }
      }
      text(src) {
        const cap = this.rules.block.text.exec(src);
        if (cap) {
          return {
            type: "text",
            raw: cap[0],
            text: cap[0],
            tokens: this.lexer.inline(cap[0])
          };
        }
      }
      escape(src) {
        const cap = this.rules.inline.escape.exec(src);
        if (cap) {
          return {
            type: "escape",
            raw: cap[0],
            text: cap[1]
          };
        }
      }
      tag(src) {
        const cap = this.rules.inline.tag.exec(src);
        if (cap) {
          if (!this.lexer.state.inLink && this.rules.other.startATag.test(cap[0])) {
            this.lexer.state.inLink = true;
          } else if (this.lexer.state.inLink && this.rules.other.endATag.test(cap[0])) {
            this.lexer.state.inLink = false;
          }
          if (!this.lexer.state.inRawBlock && this.rules.other.startPreScriptTag.test(cap[0])) {
            this.lexer.state.inRawBlock = true;
          } else if (this.lexer.state.inRawBlock && this.rules.other.endPreScriptTag.test(cap[0])) {
            this.lexer.state.inRawBlock = false;
          }
          return {
            type: "html",
            raw: cap[0],
            inLink: this.lexer.state.inLink,
            inRawBlock: this.lexer.state.inRawBlock,
            block: false,
            text: cap[0]
          };
        }
      }
      link(src) {
        const cap = this.rules.inline.link.exec(src);
        if (cap) {
          const trimmedUrl = cap[2].trim();
          if (!this.options.pedantic && this.rules.other.startAngleBracket.test(trimmedUrl)) {
            if (!this.rules.other.endAngleBracket.test(trimmedUrl)) {
              return;
            }
            const rtrimSlash = rtrim(trimmedUrl.slice(0, -1), "\\");
            if ((trimmedUrl.length - rtrimSlash.length) % 2 === 0) {
              return;
            }
          } else {
            const lastParenIndex = findClosingBracket(cap[2], "()");
            if (lastParenIndex === -2) {
              return;
            }
            if (lastParenIndex > -1) {
              const start = cap[0].indexOf("!") === 0 ? 5 : 4;
              const linkLen = start + cap[1].length + lastParenIndex;
              cap[2] = cap[2].substring(0, lastParenIndex);
              cap[0] = cap[0].substring(0, linkLen).trim();
              cap[3] = "";
            }
          }
          let href = cap[2];
          let title = "";
          if (this.options.pedantic) {
            const link2 = this.rules.other.pedanticHrefTitle.exec(href);
            if (link2) {
              href = link2[1];
              title = link2[3];
            }
          } else {
            title = cap[3] ? cap[3].slice(1, -1) : "";
          }
          href = href.trim();
          if (this.rules.other.startAngleBracket.test(href)) {
            if (this.options.pedantic && !this.rules.other.endAngleBracket.test(trimmedUrl)) {
              href = href.slice(1);
            } else {
              href = href.slice(1, -1);
            }
          }
          return outputLink(cap, {
            href: href ? href.replace(this.rules.inline.anyPunctuation, "$1") : href,
            title: title ? title.replace(this.rules.inline.anyPunctuation, "$1") : title
          }, cap[0], this.lexer, this.rules);
        }
      }
      reflink(src, links) {
        let cap;
        if ((cap = this.rules.inline.reflink.exec(src)) || (cap = this.rules.inline.nolink.exec(src))) {
          const linkString = (cap[2] || cap[1]).replace(this.rules.other.multipleSpaceGlobal, " ");
          const link2 = links[linkString.toLowerCase()];
          if (!link2) {
            const text = cap[0].charAt(0);
            return {
              type: "text",
              raw: text,
              text
            };
          }
          return outputLink(cap, link2, cap[0], this.lexer, this.rules);
        }
      }
      emStrong(src, maskedSrc, prevChar = "") {
        let match = this.rules.inline.emStrongLDelim.exec(src);
        if (!match) return;
        if (match[3] && prevChar.match(this.rules.other.unicodeAlphaNumeric)) return;
        const nextChar = match[1] || match[2] || "";
        if (!nextChar || !prevChar || this.rules.inline.punctuation.exec(prevChar)) {
          const lLength = [...match[0]].length - 1;
          let rDelim, rLength, delimTotal = lLength, midDelimTotal = 0;
          const endReg = match[0][0] === "*" ? this.rules.inline.emStrongRDelimAst : this.rules.inline.emStrongRDelimUnd;
          endReg.lastIndex = 0;
          maskedSrc = maskedSrc.slice(-1 * src.length + lLength);
          while ((match = endReg.exec(maskedSrc)) != null) {
            rDelim = match[1] || match[2] || match[3] || match[4] || match[5] || match[6];
            if (!rDelim) continue;
            rLength = [...rDelim].length;
            if (match[3] || match[4]) {
              delimTotal += rLength;
              continue;
            } else if (match[5] || match[6]) {
              if (lLength % 3 && !((lLength + rLength) % 3)) {
                midDelimTotal += rLength;
                continue;
              }
            }
            delimTotal -= rLength;
            if (delimTotal > 0) continue;
            rLength = Math.min(rLength, rLength + delimTotal + midDelimTotal);
            const lastCharLength = [...match[0]][0].length;
            const raw = src.slice(0, lLength + match.index + lastCharLength + rLength);
            if (Math.min(lLength, rLength) % 2) {
              const text2 = raw.slice(1, -1);
              return {
                type: "em",
                raw,
                text: text2,
                tokens: this.lexer.inlineTokens(text2)
              };
            }
            const text = raw.slice(2, -2);
            return {
              type: "strong",
              raw,
              text,
              tokens: this.lexer.inlineTokens(text)
            };
          }
        }
      }
      codespan(src) {
        const cap = this.rules.inline.code.exec(src);
        if (cap) {
          let text = cap[2].replace(this.rules.other.newLineCharGlobal, " ");
          const hasNonSpaceChars = this.rules.other.nonSpaceChar.test(text);
          const hasSpaceCharsOnBothEnds = this.rules.other.startingSpaceChar.test(text) && this.rules.other.endingSpaceChar.test(text);
          if (hasNonSpaceChars && hasSpaceCharsOnBothEnds) {
            text = text.substring(1, text.length - 1);
          }
          return {
            type: "codespan",
            raw: cap[0],
            text
          };
        }
      }
      br(src) {
        const cap = this.rules.inline.br.exec(src);
        if (cap) {
          return {
            type: "br",
            raw: cap[0]
          };
        }
      }
      del(src) {
        const cap = this.rules.inline.del.exec(src);
        if (cap) {
          return {
            type: "del",
            raw: cap[0],
            text: cap[2],
            tokens: this.lexer.inlineTokens(cap[2])
          };
        }
      }
      autolink(src) {
        const cap = this.rules.inline.autolink.exec(src);
        if (cap) {
          let text, href;
          if (cap[2] === "@") {
            text = cap[1];
            href = "mailto:" + text;
          } else {
            text = cap[1];
            href = text;
          }
          return {
            type: "link",
            raw: cap[0],
            text,
            href,
            tokens: [
              {
                type: "text",
                raw: text,
                text
              }
            ]
          };
        }
      }
      url(src) {
        let cap;
        if (cap = this.rules.inline.url.exec(src)) {
          let text, href;
          if (cap[2] === "@") {
            text = cap[0];
            href = "mailto:" + text;
          } else {
            let prevCapZero;
            do {
              prevCapZero = cap[0];
              cap[0] = this.rules.inline._backpedal.exec(cap[0])?.[0] ?? "";
            } while (prevCapZero !== cap[0]);
            text = cap[0];
            if (cap[1] === "www.") {
              href = "http://" + cap[0];
            } else {
              href = cap[0];
            }
          }
          return {
            type: "link",
            raw: cap[0],
            text,
            href,
            tokens: [
              {
                type: "text",
                raw: text,
                text
              }
            ]
          };
        }
      }
      inlineText(src) {
        const cap = this.rules.inline.text.exec(src);
        if (cap) {
          const escaped = this.lexer.state.inRawBlock;
          return {
            type: "text",
            raw: cap[0],
            text: cap[0],
            escaped
          };
        }
      }
    };
    _Lexer = class __Lexer {
      tokens;
      options;
      state;
      tokenizer;
      inlineQueue;
      constructor(options2) {
        this.tokens = [];
        this.tokens.links = /* @__PURE__ */ Object.create(null);
        this.options = options2 || _defaults;
        this.options.tokenizer = this.options.tokenizer || new _Tokenizer();
        this.tokenizer = this.options.tokenizer;
        this.tokenizer.options = this.options;
        this.tokenizer.lexer = this;
        this.inlineQueue = [];
        this.state = {
          inLink: false,
          inRawBlock: false,
          top: true
        };
        const rules = {
          other,
          block: block.normal,
          inline: inline.normal
        };
        if (this.options.pedantic) {
          rules.block = block.pedantic;
          rules.inline = inline.pedantic;
        } else if (this.options.gfm) {
          rules.block = block.gfm;
          if (this.options.breaks) {
            rules.inline = inline.breaks;
          } else {
            rules.inline = inline.gfm;
          }
        }
        this.tokenizer.rules = rules;
      }
      /**
       * Expose Rules
       */
      static get rules() {
        return {
          block,
          inline
        };
      }
      /**
       * Static Lex Method
       */
      static lex(src, options2) {
        const lexer2 = new __Lexer(options2);
        return lexer2.lex(src);
      }
      /**
       * Static Lex Inline Method
       */
      static lexInline(src, options2) {
        const lexer2 = new __Lexer(options2);
        return lexer2.inlineTokens(src);
      }
      /**
       * Preprocessing
       */
      lex(src) {
        src = src.replace(other.carriageReturn, "\n");
        this.blockTokens(src, this.tokens);
        for (let i = 0; i < this.inlineQueue.length; i++) {
          const next = this.inlineQueue[i];
          this.inlineTokens(next.src, next.tokens);
        }
        this.inlineQueue = [];
        return this.tokens;
      }
      blockTokens(src, tokens = [], lastParagraphClipped = false) {
        if (this.options.pedantic) {
          src = src.replace(other.tabCharGlobal, "    ").replace(other.spaceLine, "");
        }
        while (src) {
          let token;
          if (this.options.extensions?.block?.some((extTokenizer) => {
            if (token = extTokenizer.call({ lexer: this }, src, tokens)) {
              src = src.substring(token.raw.length);
              tokens.push(token);
              return true;
            }
            return false;
          })) {
            continue;
          }
          if (token = this.tokenizer.space(src)) {
            src = src.substring(token.raw.length);
            const lastToken = tokens.at(-1);
            if (token.raw.length === 1 && lastToken !== void 0) {
              lastToken.raw += "\n";
            } else {
              tokens.push(token);
            }
            continue;
          }
          if (token = this.tokenizer.code(src)) {
            src = src.substring(token.raw.length);
            const lastToken = tokens.at(-1);
            if (lastToken?.type === "paragraph" || lastToken?.type === "text") {
              lastToken.raw += "\n" + token.raw;
              lastToken.text += "\n" + token.text;
              this.inlineQueue.at(-1).src = lastToken.text;
            } else {
              tokens.push(token);
            }
            continue;
          }
          if (token = this.tokenizer.fences(src)) {
            src = src.substring(token.raw.length);
            tokens.push(token);
            continue;
          }
          if (token = this.tokenizer.heading(src)) {
            src = src.substring(token.raw.length);
            tokens.push(token);
            continue;
          }
          if (token = this.tokenizer.hr(src)) {
            src = src.substring(token.raw.length);
            tokens.push(token);
            continue;
          }
          if (token = this.tokenizer.blockquote(src)) {
            src = src.substring(token.raw.length);
            tokens.push(token);
            continue;
          }
          if (token = this.tokenizer.list(src)) {
            src = src.substring(token.raw.length);
            tokens.push(token);
            continue;
          }
          if (token = this.tokenizer.html(src)) {
            src = src.substring(token.raw.length);
            tokens.push(token);
            continue;
          }
          if (token = this.tokenizer.def(src)) {
            src = src.substring(token.raw.length);
            const lastToken = tokens.at(-1);
            if (lastToken?.type === "paragraph" || lastToken?.type === "text") {
              lastToken.raw += "\n" + token.raw;
              lastToken.text += "\n" + token.raw;
              this.inlineQueue.at(-1).src = lastToken.text;
            } else if (!this.tokens.links[token.tag]) {
              this.tokens.links[token.tag] = {
                href: token.href,
                title: token.title
              };
            }
            continue;
          }
          if (token = this.tokenizer.table(src)) {
            src = src.substring(token.raw.length);
            tokens.push(token);
            continue;
          }
          if (token = this.tokenizer.lheading(src)) {
            src = src.substring(token.raw.length);
            tokens.push(token);
            continue;
          }
          let cutSrc = src;
          if (this.options.extensions?.startBlock) {
            let startIndex = Infinity;
            const tempSrc = src.slice(1);
            let tempStart;
            this.options.extensions.startBlock.forEach((getStartIndex) => {
              tempStart = getStartIndex.call({ lexer: this }, tempSrc);
              if (typeof tempStart === "number" && tempStart >= 0) {
                startIndex = Math.min(startIndex, tempStart);
              }
            });
            if (startIndex < Infinity && startIndex >= 0) {
              cutSrc = src.substring(0, startIndex + 1);
            }
          }
          if (this.state.top && (token = this.tokenizer.paragraph(cutSrc))) {
            const lastToken = tokens.at(-1);
            if (lastParagraphClipped && lastToken?.type === "paragraph") {
              lastToken.raw += "\n" + token.raw;
              lastToken.text += "\n" + token.text;
              this.inlineQueue.pop();
              this.inlineQueue.at(-1).src = lastToken.text;
            } else {
              tokens.push(token);
            }
            lastParagraphClipped = cutSrc.length !== src.length;
            src = src.substring(token.raw.length);
            continue;
          }
          if (token = this.tokenizer.text(src)) {
            src = src.substring(token.raw.length);
            const lastToken = tokens.at(-1);
            if (lastToken?.type === "text") {
              lastToken.raw += "\n" + token.raw;
              lastToken.text += "\n" + token.text;
              this.inlineQueue.pop();
              this.inlineQueue.at(-1).src = lastToken.text;
            } else {
              tokens.push(token);
            }
            continue;
          }
          if (src) {
            const errMsg = "Infinite loop on byte: " + src.charCodeAt(0);
            if (this.options.silent) {
              console.error(errMsg);
              break;
            } else {
              throw new Error(errMsg);
            }
          }
        }
        this.state.top = true;
        return tokens;
      }
      inline(src, tokens = []) {
        this.inlineQueue.push({ src, tokens });
        return tokens;
      }
      /**
       * Lexing/Compiling
       */
      inlineTokens(src, tokens = []) {
        let maskedSrc = src;
        let match = null;
        if (this.tokens.links) {
          const links = Object.keys(this.tokens.links);
          if (links.length > 0) {
            while ((match = this.tokenizer.rules.inline.reflinkSearch.exec(maskedSrc)) != null) {
              if (links.includes(match[0].slice(match[0].lastIndexOf("[") + 1, -1))) {
                maskedSrc = maskedSrc.slice(0, match.index) + "[" + "a".repeat(match[0].length - 2) + "]" + maskedSrc.slice(this.tokenizer.rules.inline.reflinkSearch.lastIndex);
              }
            }
          }
        }
        while ((match = this.tokenizer.rules.inline.anyPunctuation.exec(maskedSrc)) != null) {
          maskedSrc = maskedSrc.slice(0, match.index) + "++" + maskedSrc.slice(this.tokenizer.rules.inline.anyPunctuation.lastIndex);
        }
        while ((match = this.tokenizer.rules.inline.blockSkip.exec(maskedSrc)) != null) {
          maskedSrc = maskedSrc.slice(0, match.index) + "[" + "a".repeat(match[0].length - 2) + "]" + maskedSrc.slice(this.tokenizer.rules.inline.blockSkip.lastIndex);
        }
        let keepPrevChar = false;
        let prevChar = "";
        while (src) {
          if (!keepPrevChar) {
            prevChar = "";
          }
          keepPrevChar = false;
          let token;
          if (this.options.extensions?.inline?.some((extTokenizer) => {
            if (token = extTokenizer.call({ lexer: this }, src, tokens)) {
              src = src.substring(token.raw.length);
              tokens.push(token);
              return true;
            }
            return false;
          })) {
            continue;
          }
          if (token = this.tokenizer.escape(src)) {
            src = src.substring(token.raw.length);
            tokens.push(token);
            continue;
          }
          if (token = this.tokenizer.tag(src)) {
            src = src.substring(token.raw.length);
            tokens.push(token);
            continue;
          }
          if (token = this.tokenizer.link(src)) {
            src = src.substring(token.raw.length);
            tokens.push(token);
            continue;
          }
          if (token = this.tokenizer.reflink(src, this.tokens.links)) {
            src = src.substring(token.raw.length);
            const lastToken = tokens.at(-1);
            if (token.type === "text" && lastToken?.type === "text") {
              lastToken.raw += token.raw;
              lastToken.text += token.text;
            } else {
              tokens.push(token);
            }
            continue;
          }
          if (token = this.tokenizer.emStrong(src, maskedSrc, prevChar)) {
            src = src.substring(token.raw.length);
            tokens.push(token);
            continue;
          }
          if (token = this.tokenizer.codespan(src)) {
            src = src.substring(token.raw.length);
            tokens.push(token);
            continue;
          }
          if (token = this.tokenizer.br(src)) {
            src = src.substring(token.raw.length);
            tokens.push(token);
            continue;
          }
          if (token = this.tokenizer.del(src)) {
            src = src.substring(token.raw.length);
            tokens.push(token);
            continue;
          }
          if (token = this.tokenizer.autolink(src)) {
            src = src.substring(token.raw.length);
            tokens.push(token);
            continue;
          }
          if (!this.state.inLink && (token = this.tokenizer.url(src))) {
            src = src.substring(token.raw.length);
            tokens.push(token);
            continue;
          }
          let cutSrc = src;
          if (this.options.extensions?.startInline) {
            let startIndex = Infinity;
            const tempSrc = src.slice(1);
            let tempStart;
            this.options.extensions.startInline.forEach((getStartIndex) => {
              tempStart = getStartIndex.call({ lexer: this }, tempSrc);
              if (typeof tempStart === "number" && tempStart >= 0) {
                startIndex = Math.min(startIndex, tempStart);
              }
            });
            if (startIndex < Infinity && startIndex >= 0) {
              cutSrc = src.substring(0, startIndex + 1);
            }
          }
          if (token = this.tokenizer.inlineText(cutSrc)) {
            src = src.substring(token.raw.length);
            if (token.raw.slice(-1) !== "_") {
              prevChar = token.raw.slice(-1);
            }
            keepPrevChar = true;
            const lastToken = tokens.at(-1);
            if (lastToken?.type === "text") {
              lastToken.raw += token.raw;
              lastToken.text += token.text;
            } else {
              tokens.push(token);
            }
            continue;
          }
          if (src) {
            const errMsg = "Infinite loop on byte: " + src.charCodeAt(0);
            if (this.options.silent) {
              console.error(errMsg);
              break;
            } else {
              throw new Error(errMsg);
            }
          }
        }
        return tokens;
      }
    };
    _Renderer = class {
      options;
      parser;
      // set by the parser
      constructor(options2) {
        this.options = options2 || _defaults;
      }
      space(token) {
        return "";
      }
      code({ text, lang, escaped }) {
        const langString = (lang || "").match(other.notSpaceStart)?.[0];
        const code = text.replace(other.endingNewline, "") + "\n";
        if (!langString) {
          return "<pre><code>" + (escaped ? code : escape2(code, true)) + "</code></pre>\n";
        }
        return '<pre><code class="language-' + escape2(langString) + '">' + (escaped ? code : escape2(code, true)) + "</code></pre>\n";
      }
      blockquote({ tokens }) {
        const body = this.parser.parse(tokens);
        return `<blockquote>
${body}</blockquote>
`;
      }
      html({ text }) {
        return text;
      }
      heading({ tokens, depth }) {
        return `<h${depth}>${this.parser.parseInline(tokens)}</h${depth}>
`;
      }
      hr(token) {
        return "<hr>\n";
      }
      list(token) {
        const ordered = token.ordered;
        const start = token.start;
        let body = "";
        for (let j = 0; j < token.items.length; j++) {
          const item = token.items[j];
          body += this.listitem(item);
        }
        const type = ordered ? "ol" : "ul";
        const startAttr = ordered && start !== 1 ? ' start="' + start + '"' : "";
        return "<" + type + startAttr + ">\n" + body + "</" + type + ">\n";
      }
      listitem(item) {
        let itemBody = "";
        if (item.task) {
          const checkbox = this.checkbox({ checked: !!item.checked });
          if (item.loose) {
            if (item.tokens[0]?.type === "paragraph") {
              item.tokens[0].text = checkbox + " " + item.tokens[0].text;
              if (item.tokens[0].tokens && item.tokens[0].tokens.length > 0 && item.tokens[0].tokens[0].type === "text") {
                item.tokens[0].tokens[0].text = checkbox + " " + escape2(item.tokens[0].tokens[0].text);
                item.tokens[0].tokens[0].escaped = true;
              }
            } else {
              item.tokens.unshift({
                type: "text",
                raw: checkbox + " ",
                text: checkbox + " ",
                escaped: true
              });
            }
          } else {
            itemBody += checkbox + " ";
          }
        }
        itemBody += this.parser.parse(item.tokens, !!item.loose);
        return `<li>${itemBody}</li>
`;
      }
      checkbox({ checked }) {
        return "<input " + (checked ? 'checked="" ' : "") + 'disabled="" type="checkbox">';
      }
      paragraph({ tokens }) {
        return `<p>${this.parser.parseInline(tokens)}</p>
`;
      }
      table(token) {
        let header = "";
        let cell = "";
        for (let j = 0; j < token.header.length; j++) {
          cell += this.tablecell(token.header[j]);
        }
        header += this.tablerow({ text: cell });
        let body = "";
        for (let j = 0; j < token.rows.length; j++) {
          const row = token.rows[j];
          cell = "";
          for (let k = 0; k < row.length; k++) {
            cell += this.tablecell(row[k]);
          }
          body += this.tablerow({ text: cell });
        }
        if (body) body = `<tbody>${body}</tbody>`;
        return "<table>\n<thead>\n" + header + "</thead>\n" + body + "</table>\n";
      }
      tablerow({ text }) {
        return `<tr>
${text}</tr>
`;
      }
      tablecell(token) {
        const content2 = this.parser.parseInline(token.tokens);
        const type = token.header ? "th" : "td";
        const tag2 = token.align ? `<${type} align="${token.align}">` : `<${type}>`;
        return tag2 + content2 + `</${type}>
`;
      }
      /**
       * span level renderer
       */
      strong({ tokens }) {
        return `<strong>${this.parser.parseInline(tokens)}</strong>`;
      }
      em({ tokens }) {
        return `<em>${this.parser.parseInline(tokens)}</em>`;
      }
      codespan({ text }) {
        return `<code>${escape2(text, true)}</code>`;
      }
      br(token) {
        return "<br>";
      }
      del({ tokens }) {
        return `<del>${this.parser.parseInline(tokens)}</del>`;
      }
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        const cleanHref = cleanUrl(href);
        if (cleanHref === null) {
          return text;
        }
        href = cleanHref;
        let out = '<a href="' + href + '"';
        if (title) {
          out += ' title="' + escape2(title) + '"';
        }
        out += ">" + text + "</a>";
        return out;
      }
      image({ href, title, text, tokens }) {
        if (tokens) {
          text = this.parser.parseInline(tokens, this.parser.textRenderer);
        }
        const cleanHref = cleanUrl(href);
        if (cleanHref === null) {
          return escape2(text);
        }
        href = cleanHref;
        let out = `<img src="${href}" alt="${text}"`;
        if (title) {
          out += ` title="${escape2(title)}"`;
        }
        out += ">";
        return out;
      }
      text(token) {
        return "tokens" in token && token.tokens ? this.parser.parseInline(token.tokens) : "escaped" in token && token.escaped ? token.text : escape2(token.text);
      }
    };
    _TextRenderer = class {
      // no need for block level renderers
      strong({ text }) {
        return text;
      }
      em({ text }) {
        return text;
      }
      codespan({ text }) {
        return text;
      }
      del({ text }) {
        return text;
      }
      html({ text }) {
        return text;
      }
      text({ text }) {
        return text;
      }
      link({ text }) {
        return "" + text;
      }
      image({ text }) {
        return "" + text;
      }
      br() {
        return "";
      }
    };
    _Parser = class __Parser {
      options;
      renderer;
      textRenderer;
      constructor(options2) {
        this.options = options2 || _defaults;
        this.options.renderer = this.options.renderer || new _Renderer();
        this.renderer = this.options.renderer;
        this.renderer.options = this.options;
        this.renderer.parser = this;
        this.textRenderer = new _TextRenderer();
      }
      /**
       * Static Parse Method
       */
      static parse(tokens, options2) {
        const parser2 = new __Parser(options2);
        return parser2.parse(tokens);
      }
      /**
       * Static Parse Inline Method
       */
      static parseInline(tokens, options2) {
        const parser2 = new __Parser(options2);
        return parser2.parseInline(tokens);
      }
      /**
       * Parse Loop
       */
      parse(tokens, top = true) {
        let out = "";
        for (let i = 0; i < tokens.length; i++) {
          const anyToken = tokens[i];
          if (this.options.extensions?.renderers?.[anyToken.type]) {
            const genericToken = anyToken;
            const ret = this.options.extensions.renderers[genericToken.type].call({ parser: this }, genericToken);
            if (ret !== false || !["space", "hr", "heading", "code", "table", "blockquote", "list", "html", "paragraph", "text"].includes(genericToken.type)) {
              out += ret || "";
              continue;
            }
          }
          const token = anyToken;
          switch (token.type) {
            case "space": {
              out += this.renderer.space(token);
              continue;
            }
            case "hr": {
              out += this.renderer.hr(token);
              continue;
            }
            case "heading": {
              out += this.renderer.heading(token);
              continue;
            }
            case "code": {
              out += this.renderer.code(token);
              continue;
            }
            case "table": {
              out += this.renderer.table(token);
              continue;
            }
            case "blockquote": {
              out += this.renderer.blockquote(token);
              continue;
            }
            case "list": {
              out += this.renderer.list(token);
              continue;
            }
            case "html": {
              out += this.renderer.html(token);
              continue;
            }
            case "paragraph": {
              out += this.renderer.paragraph(token);
              continue;
            }
            case "text": {
              let textToken = token;
              let body = this.renderer.text(textToken);
              while (i + 1 < tokens.length && tokens[i + 1].type === "text") {
                textToken = tokens[++i];
                body += "\n" + this.renderer.text(textToken);
              }
              if (top) {
                out += this.renderer.paragraph({
                  type: "paragraph",
                  raw: body,
                  text: body,
                  tokens: [{ type: "text", raw: body, text: body, escaped: true }]
                });
              } else {
                out += body;
              }
              continue;
            }
            default: {
              const errMsg = 'Token with "' + token.type + '" type was not found.';
              if (this.options.silent) {
                console.error(errMsg);
                return "";
              } else {
                throw new Error(errMsg);
              }
            }
          }
        }
        return out;
      }
      /**
       * Parse Inline Tokens
       */
      parseInline(tokens, renderer = this.renderer) {
        let out = "";
        for (let i = 0; i < tokens.length; i++) {
          const anyToken = tokens[i];
          if (this.options.extensions?.renderers?.[anyToken.type]) {
            const ret = this.options.extensions.renderers[anyToken.type].call({ parser: this }, anyToken);
            if (ret !== false || !["escape", "html", "link", "image", "strong", "em", "codespan", "br", "del", "text"].includes(anyToken.type)) {
              out += ret || "";
              continue;
            }
          }
          const token = anyToken;
          switch (token.type) {
            case "escape": {
              out += renderer.text(token);
              break;
            }
            case "html": {
              out += renderer.html(token);
              break;
            }
            case "link": {
              out += renderer.link(token);
              break;
            }
            case "image": {
              out += renderer.image(token);
              break;
            }
            case "strong": {
              out += renderer.strong(token);
              break;
            }
            case "em": {
              out += renderer.em(token);
              break;
            }
            case "codespan": {
              out += renderer.codespan(token);
              break;
            }
            case "br": {
              out += renderer.br(token);
              break;
            }
            case "del": {
              out += renderer.del(token);
              break;
            }
            case "text": {
              out += renderer.text(token);
              break;
            }
            default: {
              const errMsg = 'Token with "' + token.type + '" type was not found.';
              if (this.options.silent) {
                console.error(errMsg);
                return "";
              } else {
                throw new Error(errMsg);
              }
            }
          }
        }
        return out;
      }
    };
    _Hooks = class {
      options;
      block;
      constructor(options2) {
        this.options = options2 || _defaults;
      }
      static passThroughHooks = /* @__PURE__ */ new Set([
        "preprocess",
        "postprocess",
        "processAllTokens"
      ]);
      /**
       * Process markdown before marked
       */
      preprocess(markdown) {
        return markdown;
      }
      /**
       * Process HTML after marked is finished
       */
      postprocess(html2) {
        return html2;
      }
      /**
       * Process all tokens before walk tokens
       */
      processAllTokens(tokens) {
        return tokens;
      }
      /**
       * Provide function to tokenize markdown
       */
      provideLexer() {
        return this.block ? _Lexer.lex : _Lexer.lexInline;
      }
      /**
       * Provide function to parse tokens
       */
      provideParser() {
        return this.block ? _Parser.parse : _Parser.parseInline;
      }
    };
    Marked = class {
      defaults = _getDefaults();
      options = this.setOptions;
      parse = this.parseMarkdown(true);
      parseInline = this.parseMarkdown(false);
      Parser = _Parser;
      Renderer = _Renderer;
      TextRenderer = _TextRenderer;
      Lexer = _Lexer;
      Tokenizer = _Tokenizer;
      Hooks = _Hooks;
      constructor(...args) {
        this.use(...args);
      }
      /**
       * Run callback for every token
       */
      walkTokens(tokens, callback) {
        let values = [];
        for (const token of tokens) {
          values = values.concat(callback.call(this, token));
          switch (token.type) {
            case "table": {
              const tableToken = token;
              for (const cell of tableToken.header) {
                values = values.concat(this.walkTokens(cell.tokens, callback));
              }
              for (const row of tableToken.rows) {
                for (const cell of row) {
                  values = values.concat(this.walkTokens(cell.tokens, callback));
                }
              }
              break;
            }
            case "list": {
              const listToken = token;
              values = values.concat(this.walkTokens(listToken.items, callback));
              break;
            }
            default: {
              const genericToken = token;
              if (this.defaults.extensions?.childTokens?.[genericToken.type]) {
                this.defaults.extensions.childTokens[genericToken.type].forEach((childTokens) => {
                  const tokens2 = genericToken[childTokens].flat(Infinity);
                  values = values.concat(this.walkTokens(tokens2, callback));
                });
              } else if (genericToken.tokens) {
                values = values.concat(this.walkTokens(genericToken.tokens, callback));
              }
            }
          }
        }
        return values;
      }
      use(...args) {
        const extensions = this.defaults.extensions || { renderers: {}, childTokens: {} };
        args.forEach((pack) => {
          const opts = { ...pack };
          opts.async = this.defaults.async || opts.async || false;
          if (pack.extensions) {
            pack.extensions.forEach((ext) => {
              if (!ext.name) {
                throw new Error("extension name required");
              }
              if ("renderer" in ext) {
                const prevRenderer = extensions.renderers[ext.name];
                if (prevRenderer) {
                  extensions.renderers[ext.name] = function(...args2) {
                    let ret = ext.renderer.apply(this, args2);
                    if (ret === false) {
                      ret = prevRenderer.apply(this, args2);
                    }
                    return ret;
                  };
                } else {
                  extensions.renderers[ext.name] = ext.renderer;
                }
              }
              if ("tokenizer" in ext) {
                if (!ext.level || ext.level !== "block" && ext.level !== "inline") {
                  throw new Error("extension level must be 'block' or 'inline'");
                }
                const extLevel = extensions[ext.level];
                if (extLevel) {
                  extLevel.unshift(ext.tokenizer);
                } else {
                  extensions[ext.level] = [ext.tokenizer];
                }
                if (ext.start) {
                  if (ext.level === "block") {
                    if (extensions.startBlock) {
                      extensions.startBlock.push(ext.start);
                    } else {
                      extensions.startBlock = [ext.start];
                    }
                  } else if (ext.level === "inline") {
                    if (extensions.startInline) {
                      extensions.startInline.push(ext.start);
                    } else {
                      extensions.startInline = [ext.start];
                    }
                  }
                }
              }
              if ("childTokens" in ext && ext.childTokens) {
                extensions.childTokens[ext.name] = ext.childTokens;
              }
            });
            opts.extensions = extensions;
          }
          if (pack.renderer) {
            const renderer = this.defaults.renderer || new _Renderer(this.defaults);
            for (const prop in pack.renderer) {
              if (!(prop in renderer)) {
                throw new Error(`renderer '${prop}' does not exist`);
              }
              if (["options", "parser"].includes(prop)) {
                continue;
              }
              const rendererProp = prop;
              const rendererFunc = pack.renderer[rendererProp];
              const prevRenderer = renderer[rendererProp];
              renderer[rendererProp] = (...args2) => {
                let ret = rendererFunc.apply(renderer, args2);
                if (ret === false) {
                  ret = prevRenderer.apply(renderer, args2);
                }
                return ret || "";
              };
            }
            opts.renderer = renderer;
          }
          if (pack.tokenizer) {
            const tokenizer = this.defaults.tokenizer || new _Tokenizer(this.defaults);
            for (const prop in pack.tokenizer) {
              if (!(prop in tokenizer)) {
                throw new Error(`tokenizer '${prop}' does not exist`);
              }
              if (["options", "rules", "lexer"].includes(prop)) {
                continue;
              }
              const tokenizerProp = prop;
              const tokenizerFunc = pack.tokenizer[tokenizerProp];
              const prevTokenizer = tokenizer[tokenizerProp];
              tokenizer[tokenizerProp] = (...args2) => {
                let ret = tokenizerFunc.apply(tokenizer, args2);
                if (ret === false) {
                  ret = prevTokenizer.apply(tokenizer, args2);
                }
                return ret;
              };
            }
            opts.tokenizer = tokenizer;
          }
          if (pack.hooks) {
            const hooks = this.defaults.hooks || new _Hooks();
            for (const prop in pack.hooks) {
              if (!(prop in hooks)) {
                throw new Error(`hook '${prop}' does not exist`);
              }
              if (["options", "block"].includes(prop)) {
                continue;
              }
              const hooksProp = prop;
              const hooksFunc = pack.hooks[hooksProp];
              const prevHook = hooks[hooksProp];
              if (_Hooks.passThroughHooks.has(prop)) {
                hooks[hooksProp] = (arg) => {
                  if (this.defaults.async) {
                    return Promise.resolve(hooksFunc.call(hooks, arg)).then((ret2) => {
                      return prevHook.call(hooks, ret2);
                    });
                  }
                  const ret = hooksFunc.call(hooks, arg);
                  return prevHook.call(hooks, ret);
                };
              } else {
                hooks[hooksProp] = (...args2) => {
                  let ret = hooksFunc.apply(hooks, args2);
                  if (ret === false) {
                    ret = prevHook.apply(hooks, args2);
                  }
                  return ret;
                };
              }
            }
            opts.hooks = hooks;
          }
          if (pack.walkTokens) {
            const walkTokens2 = this.defaults.walkTokens;
            const packWalktokens = pack.walkTokens;
            opts.walkTokens = function(token) {
              let values = [];
              values.push(packWalktokens.call(this, token));
              if (walkTokens2) {
                values = values.concat(walkTokens2.call(this, token));
              }
              return values;
            };
          }
          this.defaults = { ...this.defaults, ...opts };
        });
        return this;
      }
      setOptions(opt) {
        this.defaults = { ...this.defaults, ...opt };
        return this;
      }
      lexer(src, options2) {
        return _Lexer.lex(src, options2 ?? this.defaults);
      }
      parser(tokens, options2) {
        return _Parser.parse(tokens, options2 ?? this.defaults);
      }
      parseMarkdown(blockType) {
        const parse2 = (src, options2) => {
          const origOpt = { ...options2 };
          const opt = { ...this.defaults, ...origOpt };
          const throwError = this.onError(!!opt.silent, !!opt.async);
          if (this.defaults.async === true && origOpt.async === false) {
            return throwError(new Error("marked(): The async option was set to true by an extension. Remove async: false from the parse options object to return a Promise."));
          }
          if (typeof src === "undefined" || src === null) {
            return throwError(new Error("marked(): input parameter is undefined or null"));
          }
          if (typeof src !== "string") {
            return throwError(new Error("marked(): input parameter is of type " + Object.prototype.toString.call(src) + ", string expected"));
          }
          if (opt.hooks) {
            opt.hooks.options = opt;
            opt.hooks.block = blockType;
          }
          const lexer2 = opt.hooks ? opt.hooks.provideLexer() : blockType ? _Lexer.lex : _Lexer.lexInline;
          const parser2 = opt.hooks ? opt.hooks.provideParser() : blockType ? _Parser.parse : _Parser.parseInline;
          if (opt.async) {
            return Promise.resolve(opt.hooks ? opt.hooks.preprocess(src) : src).then((src2) => lexer2(src2, opt)).then((tokens) => opt.hooks ? opt.hooks.processAllTokens(tokens) : tokens).then((tokens) => opt.walkTokens ? Promise.all(this.walkTokens(tokens, opt.walkTokens)).then(() => tokens) : tokens).then((tokens) => parser2(tokens, opt)).then((html2) => opt.hooks ? opt.hooks.postprocess(html2) : html2).catch(throwError);
          }
          try {
            if (opt.hooks) {
              src = opt.hooks.preprocess(src);
            }
            let tokens = lexer2(src, opt);
            if (opt.hooks) {
              tokens = opt.hooks.processAllTokens(tokens);
            }
            if (opt.walkTokens) {
              this.walkTokens(tokens, opt.walkTokens);
            }
            let html2 = parser2(tokens, opt);
            if (opt.hooks) {
              html2 = opt.hooks.postprocess(html2);
            }
            return html2;
          } catch (e) {
            return throwError(e);
          }
        };
        return parse2;
      }
      onError(silent, async) {
        return (e) => {
          e.message += "\nPlease report this to https://github.com/markedjs/marked.";
          if (silent) {
            const msg = "<p>An error occurred:</p><pre>" + escape2(e.message + "", true) + "</pre>";
            if (async) {
              return Promise.resolve(msg);
            }
            return msg;
          }
          if (async) {
            return Promise.reject(e);
          }
          throw e;
        };
      }
    };
    markedInstance = new Marked();
    marked.options = marked.setOptions = function(options2) {
      markedInstance.setOptions(options2);
      marked.defaults = markedInstance.defaults;
      changeDefaults(marked.defaults);
      return marked;
    };
    marked.getDefaults = _getDefaults;
    marked.defaults = _defaults;
    marked.use = function(...args) {
      markedInstance.use(...args);
      marked.defaults = markedInstance.defaults;
      changeDefaults(marked.defaults);
      return marked;
    };
    marked.walkTokens = function(tokens, callback) {
      return markedInstance.walkTokens(tokens, callback);
    };
    marked.parseInline = markedInstance.parseInline;
    marked.Parser = _Parser;
    marked.parser = _Parser.parse;
    marked.Renderer = _Renderer;
    marked.TextRenderer = _TextRenderer;
    marked.Lexer = _Lexer;
    marked.lexer = _Lexer.lex;
    marked.Tokenizer = _Tokenizer;
    marked.Hooks = _Hooks;
    marked.parse = marked;
    options = marked.options;
    setOptions = marked.setOptions;
    use = marked.use;
    walkTokens = marked.walkTokens;
    parseInline = marked.parseInline;
    parser = _Parser.parse;
    lexer = _Lexer.lex;
  }
});

// ../../node_modules/@lezer/common/dist/index.js
function checkSide(side, pos, from, to) {
  switch (side) {
    case -2:
      return from < pos;
    case -1:
      return to >= pos && from < pos;
    case 0:
      return from < pos && to > pos;
    case 1:
      return from <= pos && to > pos;
    case 2:
      return to > pos;
    case 4:
      return true;
  }
}
function resolveNode(node, pos, side, overlays) {
  var _a;
  while (node.from == node.to || (side < 1 ? node.from >= pos : node.from > pos) || (side > -1 ? node.to <= pos : node.to < pos)) {
    let parent = !overlays && node instanceof TreeNode && node.index < 0 ? null : node.parent;
    if (!parent)
      return node;
    node = parent;
  }
  let mode = overlays ? 0 : IterMode.IgnoreOverlays;
  if (overlays)
    for (let scan = node, parent = scan.parent; parent; scan = parent, parent = scan.parent) {
      if (scan instanceof TreeNode && scan.index < 0 && ((_a = parent.enter(pos, side, mode)) === null || _a === void 0 ? void 0 : _a.from) != scan.from)
        node = parent;
    }
  for (; ; ) {
    let inner = node.enter(pos, side, mode);
    if (!inner)
      return node;
    node = inner;
  }
}
function getChildren(node, type, before, after) {
  let cur = node.cursor(), result = [];
  if (!cur.firstChild())
    return result;
  if (before != null)
    for (let found = false; !found; ) {
      found = cur.type.is(before);
      if (!cur.nextSibling())
        return result;
    }
  for (; ; ) {
    if (after != null && cur.type.is(after))
      return result;
    if (cur.type.is(type))
      result.push(cur.node);
    if (!cur.nextSibling())
      return after == null ? result : [];
  }
}
function matchNodeContext(node, context2, i = context2.length - 1) {
  for (let p = node; i >= 0; p = p.parent) {
    if (!p)
      return false;
    if (!p.type.isAnonymous) {
      if (context2[i] && context2[i] != p.name)
        return false;
      i--;
    }
  }
  return true;
}
function iterStack(heads) {
  if (!heads.length)
    return null;
  let pick = 0, picked = heads[0];
  for (let i = 1; i < heads.length; i++) {
    let node = heads[i];
    if (node.from > picked.from || node.to < picked.to) {
      picked = node;
      pick = i;
    }
  }
  let next = picked instanceof TreeNode && picked.index < 0 ? null : picked.parent;
  let newHeads = heads.slice();
  if (next)
    newHeads[pick] = next;
  else
    newHeads.splice(pick, 1);
  return new StackIterator(newHeads, picked);
}
function stackIterator(tree, pos, side) {
  let inner = tree.resolveInner(pos, side), layers = null;
  for (let scan = inner instanceof TreeNode ? inner : inner.context.parent; scan; scan = scan.parent) {
    if (scan.index < 0) {
      let parent = scan.parent;
      (layers || (layers = [inner])).push(parent.resolve(pos, side));
      scan = parent;
    } else {
      let mount = MountedTree.get(scan.tree);
      if (mount && mount.overlay && mount.overlay[0].from <= pos && mount.overlay[mount.overlay.length - 1].to >= pos) {
        let root = new TreeNode(mount.tree, mount.overlay[0].from + scan.from, -1, scan);
        (layers || (layers = [inner])).push(resolveNode(root, pos, side, false));
      }
    }
  }
  return layers ? iterStack(layers) : inner;
}
function hasChild(tree) {
  return tree.children.some((ch) => ch instanceof TreeBuffer || !ch.type.isAnonymous || hasChild(ch));
}
function buildTree(data) {
  var _a;
  let { buffer, nodeSet, maxBufferLength = DefaultBufferLength, reused = [], minRepeatType = nodeSet.types.length } = data;
  let cursor = Array.isArray(buffer) ? new FlatBufferCursor(buffer, buffer.length) : buffer;
  let types = nodeSet.types;
  let contextHash = 0, lookAhead = 0;
  function takeNode(parentStart, minPos, children2, positions2, inRepeat, depth) {
    let { id, start, end, size } = cursor;
    let lookAheadAtStart = lookAhead, contextAtStart = contextHash;
    if (size < 0) {
      cursor.next();
      if (size == -1) {
        let node2 = reused[id];
        children2.push(node2);
        positions2.push(start - parentStart);
        return;
      } else if (size == -3) {
        contextHash = id;
        return;
      } else if (size == -4) {
        lookAhead = id;
        return;
      } else {
        throw new RangeError(`Unrecognized record size: ${size}`);
      }
    }
    let type = types[id], node, buffer2;
    let startPos = start - parentStart;
    if (end - start <= maxBufferLength && (buffer2 = findBufferSize(cursor.pos - minPos, inRepeat))) {
      let data2 = new Uint16Array(buffer2.size - buffer2.skip);
      let endPos = cursor.pos - buffer2.size, index = data2.length;
      while (cursor.pos > endPos)
        index = copyToBuffer(buffer2.start, data2, index);
      node = new TreeBuffer(data2, end - buffer2.start, nodeSet);
      startPos = buffer2.start - parentStart;
    } else {
      let endPos = cursor.pos - size;
      cursor.next();
      let localChildren = [], localPositions = [];
      let localInRepeat = id >= minRepeatType ? id : -1;
      let lastGroup = 0, lastEnd = end;
      while (cursor.pos > endPos) {
        if (localInRepeat >= 0 && cursor.id == localInRepeat && cursor.size >= 0) {
          if (cursor.end <= lastEnd - maxBufferLength) {
            makeRepeatLeaf(localChildren, localPositions, start, lastGroup, cursor.end, lastEnd, localInRepeat, lookAheadAtStart, contextAtStart);
            lastGroup = localChildren.length;
            lastEnd = cursor.end;
          }
          cursor.next();
        } else if (depth > 2500) {
          takeFlatNode(start, endPos, localChildren, localPositions);
        } else {
          takeNode(start, endPos, localChildren, localPositions, localInRepeat, depth + 1);
        }
      }
      if (localInRepeat >= 0 && lastGroup > 0 && lastGroup < localChildren.length)
        makeRepeatLeaf(localChildren, localPositions, start, lastGroup, start, lastEnd, localInRepeat, lookAheadAtStart, contextAtStart);
      localChildren.reverse();
      localPositions.reverse();
      if (localInRepeat > -1 && lastGroup > 0) {
        let make = makeBalanced(type, contextAtStart);
        node = balanceRange(type, localChildren, localPositions, 0, localChildren.length, 0, end - start, make, make);
      } else {
        node = makeTree(type, localChildren, localPositions, end - start, lookAheadAtStart - end, contextAtStart);
      }
    }
    children2.push(node);
    positions2.push(startPos);
  }
  function takeFlatNode(parentStart, minPos, children2, positions2) {
    let nodes = [];
    let nodeCount = 0, stopAt = -1;
    while (cursor.pos > minPos) {
      let { id, start, end, size } = cursor;
      if (size > 4) {
        cursor.next();
      } else if (stopAt > -1 && start < stopAt) {
        break;
      } else {
        if (stopAt < 0)
          stopAt = end - maxBufferLength;
        nodes.push(id, start, end);
        nodeCount++;
        cursor.next();
      }
    }
    if (nodeCount) {
      let buffer2 = new Uint16Array(nodeCount * 4);
      let start = nodes[nodes.length - 2];
      for (let i = nodes.length - 3, j = 0; i >= 0; i -= 3) {
        buffer2[j++] = nodes[i];
        buffer2[j++] = nodes[i + 1] - start;
        buffer2[j++] = nodes[i + 2] - start;
        buffer2[j++] = j;
      }
      children2.push(new TreeBuffer(buffer2, nodes[2] - start, nodeSet));
      positions2.push(start - parentStart);
    }
  }
  function makeBalanced(type, contextHash2) {
    return (children2, positions2, length2) => {
      let lookAhead2 = 0, lastI = children2.length - 1, last, lookAheadProp;
      if (lastI >= 0 && (last = children2[lastI]) instanceof Tree) {
        if (!lastI && last.type == type && last.length == length2)
          return last;
        if (lookAheadProp = last.prop(NodeProp.lookAhead))
          lookAhead2 = positions2[lastI] + last.length + lookAheadProp;
      }
      return makeTree(type, children2, positions2, length2, lookAhead2, contextHash2);
    };
  }
  function makeRepeatLeaf(children2, positions2, base, i, from, to, type, lookAhead2, contextHash2) {
    let localChildren = [], localPositions = [];
    while (children2.length > i) {
      localChildren.push(children2.pop());
      localPositions.push(positions2.pop() + base - from);
    }
    children2.push(makeTree(nodeSet.types[type], localChildren, localPositions, to - from, lookAhead2 - to, contextHash2));
    positions2.push(from - base);
  }
  function makeTree(type, children2, positions2, length2, lookAhead2, contextHash2, props) {
    if (contextHash2) {
      let pair = [NodeProp.contextHash, contextHash2];
      props = props ? [pair].concat(props) : [pair];
    }
    if (lookAhead2 > 25) {
      let pair = [NodeProp.lookAhead, lookAhead2];
      props = props ? [pair].concat(props) : [pair];
    }
    return new Tree(type, children2, positions2, length2, props);
  }
  function findBufferSize(maxSize, inRepeat) {
    let fork = cursor.fork();
    let size = 0, start = 0, skip = 0, minStart = fork.end - maxBufferLength;
    let result = { size: 0, start: 0, skip: 0 };
    scan: for (let minPos = fork.pos - maxSize; fork.pos > minPos; ) {
      let nodeSize2 = fork.size;
      if (fork.id == inRepeat && nodeSize2 >= 0) {
        result.size = size;
        result.start = start;
        result.skip = skip;
        skip += 4;
        size += 4;
        fork.next();
        continue;
      }
      let startPos = fork.pos - nodeSize2;
      if (nodeSize2 < 0 || startPos < minPos || fork.start < minStart)
        break;
      let localSkipped = fork.id >= minRepeatType ? 4 : 0;
      let nodeStart = fork.start;
      fork.next();
      while (fork.pos > startPos) {
        if (fork.size < 0) {
          if (fork.size == -3 || fork.size == -4)
            localSkipped += 4;
          else
            break scan;
        } else if (fork.id >= minRepeatType) {
          localSkipped += 4;
        }
        fork.next();
      }
      start = nodeStart;
      size += nodeSize2;
      skip += localSkipped;
    }
    if (inRepeat < 0 || size == maxSize) {
      result.size = size;
      result.start = start;
      result.skip = skip;
    }
    return result.size > 4 ? result : void 0;
  }
  function copyToBuffer(bufferStart, buffer2, index) {
    let { id, start, end, size } = cursor;
    cursor.next();
    if (size >= 0 && id < minRepeatType) {
      let startIndex = index;
      if (size > 4) {
        let endPos = cursor.pos - (size - 4);
        while (cursor.pos > endPos)
          index = copyToBuffer(bufferStart, buffer2, index);
      }
      buffer2[--index] = startIndex;
      buffer2[--index] = end - bufferStart;
      buffer2[--index] = start - bufferStart;
      buffer2[--index] = id;
    } else if (size == -3) {
      contextHash = id;
    } else if (size == -4) {
      lookAhead = id;
    }
    return index;
  }
  let children = [], positions = [];
  while (cursor.pos > 0)
    takeNode(data.start || 0, data.bufferStart || 0, children, positions, -1, 0);
  let length = (_a = data.length) !== null && _a !== void 0 ? _a : children.length ? positions[0] + children[0].length : 0;
  return new Tree(types[data.topID], children.reverse(), positions.reverse(), length);
}
function nodeSize(balanceType, node) {
  if (!balanceType.isAnonymous || node instanceof TreeBuffer || node.type != balanceType)
    return 1;
  let size = nodeSizeCache.get(node);
  if (size == null) {
    size = 1;
    for (let child of node.children) {
      if (child.type != balanceType || !(child instanceof Tree)) {
        size = 1;
        break;
      }
      size += nodeSize(balanceType, child);
    }
    nodeSizeCache.set(node, size);
  }
  return size;
}
function balanceRange(balanceType, children, positions, from, to, start, length, mkTop, mkTree) {
  let total = 0;
  for (let i = from; i < to; i++)
    total += nodeSize(balanceType, children[i]);
  let maxChild = Math.ceil(
    total * 1.5 / 8
    /* Balance.BranchFactor */
  );
  let localChildren = [], localPositions = [];
  function divide(children2, positions2, from2, to2, offset) {
    for (let i = from2; i < to2; ) {
      let groupFrom = i, groupStart = positions2[i], groupSize = nodeSize(balanceType, children2[i]);
      i++;
      for (; i < to2; i++) {
        let nextSize = nodeSize(balanceType, children2[i]);
        if (groupSize + nextSize >= maxChild)
          break;
        groupSize += nextSize;
      }
      if (i == groupFrom + 1) {
        if (groupSize > maxChild) {
          let only = children2[groupFrom];
          divide(only.children, only.positions, 0, only.children.length, positions2[groupFrom] + offset);
          continue;
        }
        localChildren.push(children2[groupFrom]);
      } else {
        let length2 = positions2[i - 1] + children2[i - 1].length - groupStart;
        localChildren.push(balanceRange(balanceType, children2, positions2, groupFrom, i, groupStart, length2, null, mkTree));
      }
      localPositions.push(groupStart + offset - start);
    }
  }
  divide(children, positions, from, to, 0);
  return (mkTop || mkTree)(localChildren, localPositions, length);
}
var DefaultBufferLength, nextPropID, NodeProp, MountedTree, noProps, NodeType, CachedNode, CachedInnerNode, IterMode, Tree, FlatBufferCursor, TreeBuffer, BaseNode, TreeNode, BufferContext, BufferNode, StackIterator, TreeCursor, nodeSizeCache, stoppedInner;
var init_dist = __esm({
  "../../node_modules/@lezer/common/dist/index.js"() {
    DefaultBufferLength = 1024;
    nextPropID = 0;
    NodeProp = class {
      /**
      Create a new node prop type.
      */
      constructor(config = {}) {
        this.id = nextPropID++;
        this.perNode = !!config.perNode;
        this.deserialize = config.deserialize || (() => {
          throw new Error("This node type doesn't define a deserialize function");
        });
        this.combine = config.combine || null;
      }
      /**
      This is meant to be used with
      [`NodeSet.extend`](#common.NodeSet.extend) or
      [`LRParser.configure`](#lr.ParserConfig.props) to compute
      prop values for each node type in the set. Takes a [match
      object](#common.NodeType^match) or function that returns undefined
      if the node type doesn't get this prop, and the prop's value if
      it does.
      */
      add(match) {
        if (this.perNode)
          throw new RangeError("Can't add per-node props to node types");
        if (typeof match != "function")
          match = NodeType.match(match);
        return (type) => {
          let result = match(type);
          return result === void 0 ? null : [this, result];
        };
      }
    };
    NodeProp.closedBy = new NodeProp({ deserialize: (str) => str.split(" ") });
    NodeProp.openedBy = new NodeProp({ deserialize: (str) => str.split(" ") });
    NodeProp.group = new NodeProp({ deserialize: (str) => str.split(" ") });
    NodeProp.isolate = new NodeProp({ deserialize: (value) => {
      if (value && value != "rtl" && value != "ltr" && value != "auto")
        throw new RangeError("Invalid value for isolate: " + value);
      return value || "auto";
    } });
    NodeProp.contextHash = new NodeProp({ perNode: true });
    NodeProp.lookAhead = new NodeProp({ perNode: true });
    NodeProp.mounted = new NodeProp({ perNode: true });
    MountedTree = class {
      constructor(tree, overlay, parser2, bracketed = false) {
        this.tree = tree;
        this.overlay = overlay;
        this.parser = parser2;
        this.bracketed = bracketed;
      }
      /**
      @internal
      */
      static get(tree) {
        return tree && tree.props && tree.props[NodeProp.mounted.id];
      }
    };
    noProps = /* @__PURE__ */ Object.create(null);
    NodeType = class _NodeType {
      /**
      @internal
      */
      constructor(name2, props, id, flags = 0) {
        this.name = name2;
        this.props = props;
        this.id = id;
        this.flags = flags;
      }
      /**
      Define a node type.
      */
      static define(spec) {
        let props = spec.props && spec.props.length ? /* @__PURE__ */ Object.create(null) : noProps;
        let flags = (spec.top ? 1 : 0) | (spec.skipped ? 2 : 0) | (spec.error ? 4 : 0) | (spec.name == null ? 8 : 0);
        let type = new _NodeType(spec.name || "", props, spec.id, flags);
        if (spec.props)
          for (let src of spec.props) {
            if (!Array.isArray(src))
              src = src(type);
            if (src) {
              if (src[0].perNode)
                throw new RangeError("Can't store a per-node prop on a node type");
              props[src[0].id] = src[1];
            }
          }
        return type;
      }
      /**
      Retrieves a node prop for this type. Will return `undefined` if
      the prop isn't present on this node.
      */
      prop(prop) {
        return this.props[prop.id];
      }
      /**
      True when this is the top node of a grammar.
      */
      get isTop() {
        return (this.flags & 1) > 0;
      }
      /**
      True when this node is produced by a skip rule.
      */
      get isSkipped() {
        return (this.flags & 2) > 0;
      }
      /**
      Indicates whether this is an error node.
      */
      get isError() {
        return (this.flags & 4) > 0;
      }
      /**
      When true, this node type doesn't correspond to a user-declared
      named node, for example because it is used to cache repetition.
      */
      get isAnonymous() {
        return (this.flags & 8) > 0;
      }
      /**
      Returns true when this node's name or one of its
      [groups](#common.NodeProp^group) matches the given string.
      */
      is(name2) {
        if (typeof name2 == "string") {
          if (this.name == name2)
            return true;
          let group = this.prop(NodeProp.group);
          return group ? group.indexOf(name2) > -1 : false;
        }
        return this.id == name2;
      }
      /**
      Create a function from node types to arbitrary values by
      specifying an object whose property names are node or
      [group](#common.NodeProp^group) names. Often useful with
      [`NodeProp.add`](#common.NodeProp.add). You can put multiple
      names, separated by spaces, in a single property name to map
      multiple node names to a single value.
      */
      static match(map) {
        let direct = /* @__PURE__ */ Object.create(null);
        for (let prop in map)
          for (let name2 of prop.split(" "))
            direct[name2] = map[prop];
        return (node) => {
          for (let groups = node.prop(NodeProp.group), i = -1; i < (groups ? groups.length : 0); i++) {
            let found = direct[i < 0 ? node.name : groups[i]];
            if (found)
              return found;
          }
        };
      }
    };
    NodeType.none = new NodeType(
      "",
      /* @__PURE__ */ Object.create(null),
      0,
      8
      /* NodeFlag.Anonymous */
    );
    CachedNode = /* @__PURE__ */ new WeakMap();
    CachedInnerNode = /* @__PURE__ */ new WeakMap();
    (function(IterMode2) {
      IterMode2[IterMode2["ExcludeBuffers"] = 1] = "ExcludeBuffers";
      IterMode2[IterMode2["IncludeAnonymous"] = 2] = "IncludeAnonymous";
      IterMode2[IterMode2["IgnoreMounts"] = 4] = "IgnoreMounts";
      IterMode2[IterMode2["IgnoreOverlays"] = 8] = "IgnoreOverlays";
      IterMode2[IterMode2["EnterBracketed"] = 16] = "EnterBracketed";
    })(IterMode || (IterMode = {}));
    Tree = class _Tree {
      /**
      Construct a new tree. See also [`Tree.build`](#common.Tree^build).
      */
      constructor(type, children, positions, length, props) {
        this.type = type;
        this.children = children;
        this.positions = positions;
        this.length = length;
        this.props = null;
        if (props && props.length) {
          this.props = /* @__PURE__ */ Object.create(null);
          for (let [prop, value] of props)
            this.props[typeof prop == "number" ? prop : prop.id] = value;
        }
      }
      /**
      @internal
      */
      toString() {
        let mounted = MountedTree.get(this);
        if (mounted && !mounted.overlay)
          return mounted.tree.toString();
        let children = "";
        for (let ch of this.children) {
          let str = ch.toString();
          if (str) {
            if (children)
              children += ",";
            children += str;
          }
        }
        return !this.type.name ? children : (/\W/.test(this.type.name) && !this.type.isError ? JSON.stringify(this.type.name) : this.type.name) + (children.length ? "(" + children + ")" : "");
      }
      /**
      Get a [tree cursor](#common.TreeCursor) positioned at the top of
      the tree. Mode can be used to [control](#common.IterMode) which
      nodes the cursor visits.
      */
      cursor(mode = 0) {
        return new TreeCursor(this.topNode, mode);
      }
      /**
      Get a [tree cursor](#common.TreeCursor) pointing into this tree
      at the given position and side (see
      [`moveTo`](#common.TreeCursor.moveTo).
      */
      cursorAt(pos, side = 0, mode = 0) {
        let scope = CachedNode.get(this) || this.topNode;
        let cursor = new TreeCursor(scope);
        cursor.moveTo(pos, side);
        CachedNode.set(this, cursor._tree);
        return cursor;
      }
      /**
      Get a [syntax node](#common.SyntaxNode) object for the top of the
      tree.
      */
      get topNode() {
        return new TreeNode(this, 0, 0, null);
      }
      /**
      Get the [syntax node](#common.SyntaxNode) at the given position.
      If `side` is -1, this will move into nodes that end at the
      position. If 1, it'll move into nodes that start at the
      position. With 0, it'll only enter nodes that cover the position
      from both sides.
      
      Note that this will not enter
      [overlays](#common.MountedTree.overlay), and you often want
      [`resolveInner`](#common.Tree.resolveInner) instead.
      */
      resolve(pos, side = 0) {
        let node = resolveNode(CachedNode.get(this) || this.topNode, pos, side, false);
        CachedNode.set(this, node);
        return node;
      }
      /**
      Like [`resolve`](#common.Tree.resolve), but will enter
      [overlaid](#common.MountedTree.overlay) nodes, producing a syntax node
      pointing into the innermost overlaid tree at the given position
      (with parent links going through all parent structure, including
      the host trees).
      */
      resolveInner(pos, side = 0) {
        let node = resolveNode(CachedInnerNode.get(this) || this.topNode, pos, side, true);
        CachedInnerNode.set(this, node);
        return node;
      }
      /**
      In some situations, it can be useful to iterate through all
      nodes around a position, including those in overlays that don't
      directly cover the position. This method gives you an iterator
      that will produce all nodes, from small to big, around the given
      position.
      */
      resolveStack(pos, side = 0) {
        return stackIterator(this, pos, side);
      }
      /**
      Iterate over the tree and its children, calling `enter` for any
      node that touches the `from`/`to` region (if given) before
      running over such a node's children, and `leave` (if given) when
      leaving the node. When `enter` returns `false`, that node will
      not have its children iterated over (or `leave` called).
      */
      iterate(spec) {
        let { enter, leave, from = 0, to = this.length } = spec;
        let mode = spec.mode || 0, anon = (mode & IterMode.IncludeAnonymous) > 0;
        for (let c = this.cursor(mode | IterMode.IncludeAnonymous); ; ) {
          let entered = false;
          if (c.from <= to && c.to >= from && (!anon && c.type.isAnonymous || enter(c) !== false)) {
            if (c.firstChild())
              continue;
            entered = true;
          }
          for (; ; ) {
            if (entered && leave && (anon || !c.type.isAnonymous))
              leave(c);
            if (c.nextSibling())
              break;
            if (!c.parent())
              return;
            entered = true;
          }
        }
      }
      /**
      Get the value of the given [node prop](#common.NodeProp) for this
      node. Works with both per-node and per-type props.
      */
      prop(prop) {
        return !prop.perNode ? this.type.prop(prop) : this.props ? this.props[prop.id] : void 0;
      }
      /**
      Returns the node's [per-node props](#common.NodeProp.perNode) in a
      format that can be passed to the [`Tree`](#common.Tree)
      constructor.
      */
      get propValues() {
        let result = [];
        if (this.props)
          for (let id in this.props)
            result.push([+id, this.props[id]]);
        return result;
      }
      /**
      Balance the direct children of this tree, producing a copy of
      which may have children grouped into subtrees with type
      [`NodeType.none`](#common.NodeType^none).
      */
      balance(config = {}) {
        return this.children.length <= 8 ? this : balanceRange(NodeType.none, this.children, this.positions, 0, this.children.length, 0, this.length, (children, positions, length) => new _Tree(this.type, children, positions, length, this.propValues), config.makeTree || ((children, positions, length) => new _Tree(NodeType.none, children, positions, length)));
      }
      /**
      Build a tree from a postfix-ordered buffer of node information,
      or a cursor over such a buffer.
      */
      static build(data) {
        return buildTree(data);
      }
    };
    Tree.empty = new Tree(NodeType.none, [], [], 0);
    FlatBufferCursor = class _FlatBufferCursor {
      constructor(buffer, index) {
        this.buffer = buffer;
        this.index = index;
      }
      get id() {
        return this.buffer[this.index - 4];
      }
      get start() {
        return this.buffer[this.index - 3];
      }
      get end() {
        return this.buffer[this.index - 2];
      }
      get size() {
        return this.buffer[this.index - 1];
      }
      get pos() {
        return this.index;
      }
      next() {
        this.index -= 4;
      }
      fork() {
        return new _FlatBufferCursor(this.buffer, this.index);
      }
    };
    TreeBuffer = class _TreeBuffer {
      /**
      Create a tree buffer.
      */
      constructor(buffer, length, set) {
        this.buffer = buffer;
        this.length = length;
        this.set = set;
      }
      /**
      @internal
      */
      get type() {
        return NodeType.none;
      }
      /**
      @internal
      */
      toString() {
        let result = [];
        for (let index = 0; index < this.buffer.length; ) {
          result.push(this.childString(index));
          index = this.buffer[index + 3];
        }
        return result.join(",");
      }
      /**
      @internal
      */
      childString(index) {
        let id = this.buffer[index], endIndex = this.buffer[index + 3];
        let type = this.set.types[id], result = type.name;
        if (/\W/.test(result) && !type.isError)
          result = JSON.stringify(result);
        index += 4;
        if (endIndex == index)
          return result;
        let children = [];
        while (index < endIndex) {
          children.push(this.childString(index));
          index = this.buffer[index + 3];
        }
        return result + "(" + children.join(",") + ")";
      }
      /**
      @internal
      */
      findChild(startIndex, endIndex, dir, pos, side) {
        let { buffer } = this, pick = -1;
        for (let i = startIndex; i != endIndex; i = buffer[i + 3]) {
          if (checkSide(side, pos, buffer[i + 1], buffer[i + 2])) {
            pick = i;
            if (dir > 0)
              break;
          }
        }
        return pick;
      }
      /**
      @internal
      */
      slice(startI, endI, from) {
        let b = this.buffer;
        let copy = new Uint16Array(endI - startI), len = 0;
        for (let i = startI, j = 0; i < endI; ) {
          copy[j++] = b[i++];
          copy[j++] = b[i++] - from;
          let to = copy[j++] = b[i++] - from;
          copy[j++] = b[i++] - startI;
          len = Math.max(len, to);
        }
        return new _TreeBuffer(copy, len, this.set);
      }
    };
    BaseNode = class {
      cursor(mode = 0) {
        return new TreeCursor(this, mode);
      }
      getChild(type, before = null, after = null) {
        let r = getChildren(this, type, before, after);
        return r.length ? r[0] : null;
      }
      getChildren(type, before = null, after = null) {
        return getChildren(this, type, before, after);
      }
      resolve(pos, side = 0) {
        return resolveNode(this, pos, side, false);
      }
      resolveInner(pos, side = 0) {
        return resolveNode(this, pos, side, true);
      }
      matchContext(context2) {
        return matchNodeContext(this.parent, context2);
      }
      enterUnfinishedNodesBefore(pos) {
        let scan = this.childBefore(pos), node = this;
        while (scan) {
          let last = scan.lastChild;
          if (!last || last.to != scan.to)
            break;
          if (last.type.isError && last.from == last.to) {
            node = scan;
            scan = last.prevSibling;
          } else {
            scan = last;
          }
        }
        return node;
      }
      get node() {
        return this;
      }
      get next() {
        return this.parent;
      }
    };
    TreeNode = class _TreeNode extends BaseNode {
      constructor(_tree, from, index, _parent) {
        super();
        this._tree = _tree;
        this.from = from;
        this.index = index;
        this._parent = _parent;
      }
      get type() {
        return this._tree.type;
      }
      get name() {
        return this._tree.type.name;
      }
      get to() {
        return this.from + this._tree.length;
      }
      nextChild(i, dir, pos, side, mode = 0) {
        for (let parent = this; ; ) {
          for (let { children, positions } = parent._tree, e = dir > 0 ? children.length : -1; i != e; i += dir) {
            let next = children[i], start = positions[i] + parent.from, mounted;
            if (!(mode & IterMode.EnterBracketed && next instanceof Tree && (mounted = MountedTree.get(next)) && !mounted.overlay && mounted.bracketed && pos >= start && pos <= start + next.length) && !checkSide(side, pos, start, start + next.length))
              continue;
            if (next instanceof TreeBuffer) {
              if (mode & IterMode.ExcludeBuffers)
                continue;
              let index = next.findChild(0, next.buffer.length, dir, pos - start, side);
              if (index > -1)
                return new BufferNode(new BufferContext(parent, next, i, start), null, index);
            } else if (mode & IterMode.IncludeAnonymous || (!next.type.isAnonymous || hasChild(next))) {
              let mounted2;
              if (!(mode & IterMode.IgnoreMounts) && (mounted2 = MountedTree.get(next)) && !mounted2.overlay)
                return new _TreeNode(mounted2.tree, start, i, parent);
              let inner = new _TreeNode(next, start, i, parent);
              return mode & IterMode.IncludeAnonymous || !inner.type.isAnonymous ? inner : inner.nextChild(dir < 0 ? next.children.length - 1 : 0, dir, pos, side, mode);
            }
          }
          if (mode & IterMode.IncludeAnonymous || !parent.type.isAnonymous)
            return null;
          if (parent.index >= 0)
            i = parent.index + dir;
          else
            i = dir < 0 ? -1 : parent._parent._tree.children.length;
          parent = parent._parent;
          if (!parent)
            return null;
        }
      }
      get firstChild() {
        return this.nextChild(
          0,
          1,
          0,
          4
          /* Side.DontCare */
        );
      }
      get lastChild() {
        return this.nextChild(
          this._tree.children.length - 1,
          -1,
          0,
          4
          /* Side.DontCare */
        );
      }
      childAfter(pos) {
        return this.nextChild(
          0,
          1,
          pos,
          2
          /* Side.After */
        );
      }
      childBefore(pos) {
        return this.nextChild(
          this._tree.children.length - 1,
          -1,
          pos,
          -2
          /* Side.Before */
        );
      }
      prop(prop) {
        return this._tree.prop(prop);
      }
      enter(pos, side, mode = 0) {
        let mounted;
        if (!(mode & IterMode.IgnoreOverlays) && (mounted = MountedTree.get(this._tree)) && mounted.overlay) {
          let rPos = pos - this.from, enterBracketed = mode & IterMode.EnterBracketed && mounted.bracketed;
          for (let { from, to } of mounted.overlay) {
            if ((side > 0 || enterBracketed ? from <= rPos : from < rPos) && (side < 0 || enterBracketed ? to >= rPos : to > rPos))
              return new _TreeNode(mounted.tree, mounted.overlay[0].from + this.from, -1, this);
          }
        }
        return this.nextChild(0, 1, pos, side, mode);
      }
      nextSignificantParent() {
        let val = this;
        while (val.type.isAnonymous && val._parent)
          val = val._parent;
        return val;
      }
      get parent() {
        return this._parent ? this._parent.nextSignificantParent() : null;
      }
      get nextSibling() {
        return this._parent && this.index >= 0 ? this._parent.nextChild(
          this.index + 1,
          1,
          0,
          4
          /* Side.DontCare */
        ) : null;
      }
      get prevSibling() {
        return this._parent && this.index >= 0 ? this._parent.nextChild(
          this.index - 1,
          -1,
          0,
          4
          /* Side.DontCare */
        ) : null;
      }
      get tree() {
        return this._tree;
      }
      toTree() {
        return this._tree;
      }
      /**
      @internal
      */
      toString() {
        return this._tree.toString();
      }
    };
    BufferContext = class {
      constructor(parent, buffer, index, start) {
        this.parent = parent;
        this.buffer = buffer;
        this.index = index;
        this.start = start;
      }
    };
    BufferNode = class _BufferNode extends BaseNode {
      get name() {
        return this.type.name;
      }
      get from() {
        return this.context.start + this.context.buffer.buffer[this.index + 1];
      }
      get to() {
        return this.context.start + this.context.buffer.buffer[this.index + 2];
      }
      constructor(context2, _parent, index) {
        super();
        this.context = context2;
        this._parent = _parent;
        this.index = index;
        this.type = context2.buffer.set.types[context2.buffer.buffer[index]];
      }
      child(dir, pos, side) {
        let { buffer } = this.context;
        let index = buffer.findChild(this.index + 4, buffer.buffer[this.index + 3], dir, pos - this.context.start, side);
        return index < 0 ? null : new _BufferNode(this.context, this, index);
      }
      get firstChild() {
        return this.child(
          1,
          0,
          4
          /* Side.DontCare */
        );
      }
      get lastChild() {
        return this.child(
          -1,
          0,
          4
          /* Side.DontCare */
        );
      }
      childAfter(pos) {
        return this.child(
          1,
          pos,
          2
          /* Side.After */
        );
      }
      childBefore(pos) {
        return this.child(
          -1,
          pos,
          -2
          /* Side.Before */
        );
      }
      prop(prop) {
        return this.type.prop(prop);
      }
      enter(pos, side, mode = 0) {
        if (mode & IterMode.ExcludeBuffers)
          return null;
        let { buffer } = this.context;
        let index = buffer.findChild(this.index + 4, buffer.buffer[this.index + 3], side > 0 ? 1 : -1, pos - this.context.start, side);
        return index < 0 ? null : new _BufferNode(this.context, this, index);
      }
      get parent() {
        return this._parent || this.context.parent.nextSignificantParent();
      }
      externalSibling(dir) {
        return this._parent ? null : this.context.parent.nextChild(
          this.context.index + dir,
          dir,
          0,
          4
          /* Side.DontCare */
        );
      }
      get nextSibling() {
        let { buffer } = this.context;
        let after = buffer.buffer[this.index + 3];
        if (after < (this._parent ? buffer.buffer[this._parent.index + 3] : buffer.buffer.length))
          return new _BufferNode(this.context, this._parent, after);
        return this.externalSibling(1);
      }
      get prevSibling() {
        let { buffer } = this.context;
        let parentStart = this._parent ? this._parent.index + 4 : 0;
        if (this.index == parentStart)
          return this.externalSibling(-1);
        return new _BufferNode(this.context, this._parent, buffer.findChild(
          parentStart,
          this.index,
          -1,
          0,
          4
          /* Side.DontCare */
        ));
      }
      get tree() {
        return null;
      }
      toTree() {
        let children = [], positions = [];
        let { buffer } = this.context;
        let startI = this.index + 4, endI = buffer.buffer[this.index + 3];
        if (endI > startI) {
          let from = buffer.buffer[this.index + 1];
          children.push(buffer.slice(startI, endI, from));
          positions.push(0);
        }
        return new Tree(this.type, children, positions, this.to - this.from);
      }
      /**
      @internal
      */
      toString() {
        return this.context.buffer.childString(this.index);
      }
    };
    StackIterator = class {
      constructor(heads, node) {
        this.heads = heads;
        this.node = node;
      }
      get next() {
        return iterStack(this.heads);
      }
    };
    TreeCursor = class {
      /**
      Shorthand for `.type.name`.
      */
      get name() {
        return this.type.name;
      }
      /**
      @internal
      */
      constructor(node, mode = 0) {
        this.buffer = null;
        this.stack = [];
        this.index = 0;
        this.bufferNode = null;
        this.mode = mode & ~IterMode.EnterBracketed;
        if (node instanceof TreeNode) {
          this.yieldNode(node);
        } else {
          this._tree = node.context.parent;
          this.buffer = node.context;
          for (let n = node._parent; n; n = n._parent)
            this.stack.unshift(n.index);
          this.bufferNode = node;
          this.yieldBuf(node.index);
        }
      }
      yieldNode(node) {
        if (!node)
          return false;
        this._tree = node;
        this.type = node.type;
        this.from = node.from;
        this.to = node.to;
        return true;
      }
      yieldBuf(index, type) {
        this.index = index;
        let { start, buffer } = this.buffer;
        this.type = type || buffer.set.types[buffer.buffer[index]];
        this.from = start + buffer.buffer[index + 1];
        this.to = start + buffer.buffer[index + 2];
        return true;
      }
      /**
      @internal
      */
      yield(node) {
        if (!node)
          return false;
        if (node instanceof TreeNode) {
          this.buffer = null;
          return this.yieldNode(node);
        }
        this.buffer = node.context;
        return this.yieldBuf(node.index, node.type);
      }
      /**
      @internal
      */
      toString() {
        return this.buffer ? this.buffer.buffer.childString(this.index) : this._tree.toString();
      }
      /**
      @internal
      */
      enterChild(dir, pos, side) {
        if (!this.buffer)
          return this.yield(this._tree.nextChild(dir < 0 ? this._tree._tree.children.length - 1 : 0, dir, pos, side, this.mode));
        let { buffer } = this.buffer;
        let index = buffer.findChild(this.index + 4, buffer.buffer[this.index + 3], dir, pos - this.buffer.start, side);
        if (index < 0)
          return false;
        this.stack.push(this.index);
        return this.yieldBuf(index);
      }
      /**
      Move the cursor to this node's first child. When this returns
      false, the node has no child, and the cursor has not been moved.
      */
      firstChild() {
        return this.enterChild(
          1,
          0,
          4
          /* Side.DontCare */
        );
      }
      /**
      Move the cursor to this node's last child.
      */
      lastChild() {
        return this.enterChild(
          -1,
          0,
          4
          /* Side.DontCare */
        );
      }
      /**
      Move the cursor to the first child that ends after `pos`.
      */
      childAfter(pos) {
        return this.enterChild(
          1,
          pos,
          2
          /* Side.After */
        );
      }
      /**
      Move to the last child that starts before `pos`.
      */
      childBefore(pos) {
        return this.enterChild(
          -1,
          pos,
          -2
          /* Side.Before */
        );
      }
      /**
      Move the cursor to the child around `pos`. If side is -1 the
      child may end at that position, when 1 it may start there. This
      will also enter [overlaid](#common.MountedTree.overlay)
      [mounted](#common.NodeProp^mounted) trees unless `overlays` is
      set to false.
      */
      enter(pos, side, mode = this.mode) {
        if (!this.buffer)
          return this.yield(this._tree.enter(pos, side, mode));
        return mode & IterMode.ExcludeBuffers ? false : this.enterChild(1, pos, side);
      }
      /**
      Move to the node's parent node, if this isn't the top node.
      */
      parent() {
        if (!this.buffer)
          return this.yieldNode(this.mode & IterMode.IncludeAnonymous ? this._tree._parent : this._tree.parent);
        if (this.stack.length)
          return this.yieldBuf(this.stack.pop());
        let parent = this.mode & IterMode.IncludeAnonymous ? this.buffer.parent : this.buffer.parent.nextSignificantParent();
        this.buffer = null;
        return this.yieldNode(parent);
      }
      /**
      @internal
      */
      sibling(dir) {
        if (!this.buffer)
          return !this._tree._parent ? false : this.yield(this._tree.index < 0 ? null : this._tree._parent.nextChild(this._tree.index + dir, dir, 0, 4, this.mode));
        let { buffer } = this.buffer, d = this.stack.length - 1;
        if (dir < 0) {
          let parentStart = d < 0 ? 0 : this.stack[d] + 4;
          if (this.index != parentStart)
            return this.yieldBuf(buffer.findChild(
              parentStart,
              this.index,
              -1,
              0,
              4
              /* Side.DontCare */
            ));
        } else {
          let after = buffer.buffer[this.index + 3];
          if (after < (d < 0 ? buffer.buffer.length : buffer.buffer[this.stack[d] + 3]))
            return this.yieldBuf(after);
        }
        return d < 0 ? this.yield(this.buffer.parent.nextChild(this.buffer.index + dir, dir, 0, 4, this.mode)) : false;
      }
      /**
      Move to this node's next sibling, if any.
      */
      nextSibling() {
        return this.sibling(1);
      }
      /**
      Move to this node's previous sibling, if any.
      */
      prevSibling() {
        return this.sibling(-1);
      }
      atLastNode(dir) {
        let index, parent, { buffer } = this;
        if (buffer) {
          if (dir > 0) {
            if (this.index < buffer.buffer.buffer.length)
              return false;
          } else {
            for (let i = 0; i < this.index; i++)
              if (buffer.buffer.buffer[i + 3] < this.index)
                return false;
          }
          ({ index, parent } = buffer);
        } else {
          ({ index, _parent: parent } = this._tree);
        }
        for (; parent; { index, _parent: parent } = parent) {
          if (index > -1)
            for (let i = index + dir, e = dir < 0 ? -1 : parent._tree.children.length; i != e; i += dir) {
              let child = parent._tree.children[i];
              if (this.mode & IterMode.IncludeAnonymous || child instanceof TreeBuffer || !child.type.isAnonymous || hasChild(child))
                return false;
            }
        }
        return true;
      }
      move(dir, enter) {
        if (enter && this.enterChild(
          dir,
          0,
          4
          /* Side.DontCare */
        ))
          return true;
        for (; ; ) {
          if (this.sibling(dir))
            return true;
          if (this.atLastNode(dir) || !this.parent())
            return false;
        }
      }
      /**
      Move to the next node in a
      [pre-order](https://en.wikipedia.org/wiki/Tree_traversal#Pre-order,_NLR)
      traversal, going from a node to its first child or, if the
      current node is empty or `enter` is false, its next sibling or
      the next sibling of the first parent node that has one.
      */
      next(enter = true) {
        return this.move(1, enter);
      }
      /**
      Move to the next node in a last-to-first pre-order traversal. A
      node is followed by its last child or, if it has none, its
      previous sibling or the previous sibling of the first parent
      node that has one.
      */
      prev(enter = true) {
        return this.move(-1, enter);
      }
      /**
      Move the cursor to the innermost node that covers `pos`. If
      `side` is -1, it will enter nodes that end at `pos`. If it is 1,
      it will enter nodes that start at `pos`.
      */
      moveTo(pos, side = 0) {
        while (this.from == this.to || (side < 1 ? this.from >= pos : this.from > pos) || (side > -1 ? this.to <= pos : this.to < pos))
          if (!this.parent())
            break;
        while (this.enterChild(1, pos, side)) {
        }
        return this;
      }
      /**
      Get a [syntax node](#common.SyntaxNode) at the cursor's current
      position.
      */
      get node() {
        if (!this.buffer)
          return this._tree;
        let cache = this.bufferNode, result = null, depth = 0;
        if (cache && cache.context == this.buffer) {
          scan: for (let index = this.index, d = this.stack.length; d >= 0; ) {
            for (let c = cache; c; c = c._parent)
              if (c.index == index) {
                if (index == this.index)
                  return c;
                result = c;
                depth = d + 1;
                break scan;
              }
            index = this.stack[--d];
          }
        }
        for (let i = depth; i < this.stack.length; i++)
          result = new BufferNode(this.buffer, result, this.stack[i]);
        return this.bufferNode = new BufferNode(this.buffer, result, this.index);
      }
      /**
      Get the [tree](#common.Tree) that represents the current node, if
      any. Will return null when the node is in a [tree
      buffer](#common.TreeBuffer).
      */
      get tree() {
        return this.buffer ? null : this._tree._tree;
      }
      /**
      Iterate over the current node and all its descendants, calling
      `enter` when entering a node and `leave`, if given, when leaving
      one. When `enter` returns `false`, any children of that node are
      skipped, and `leave` isn't called for it.
      */
      iterate(enter, leave) {
        for (let depth = 0; ; ) {
          let mustLeave = false;
          if (this.type.isAnonymous || enter(this) !== false) {
            if (this.firstChild()) {
              depth++;
              continue;
            }
            if (!this.type.isAnonymous)
              mustLeave = true;
          }
          for (; ; ) {
            if (mustLeave && leave)
              leave(this);
            mustLeave = this.type.isAnonymous;
            if (!depth)
              return;
            if (this.nextSibling())
              break;
            this.parent();
            depth--;
            mustLeave = true;
          }
        }
      }
      /**
      Test whether the current node matches a given context—a sequence
      of direct parent node names. Empty strings in the context array
      are treated as wildcards.
      */
      matchContext(context2) {
        if (!this.buffer)
          return matchNodeContext(this.node.parent, context2);
        let { buffer } = this.buffer, { types } = buffer.set;
        for (let i = context2.length - 1, d = this.stack.length - 1; i >= 0; d--) {
          if (d < 0)
            return matchNodeContext(this._tree, context2, i);
          let type = types[buffer.buffer[this.stack[d]]];
          if (!type.isAnonymous) {
            if (context2[i] && context2[i] != type.name)
              return false;
            i--;
          }
        }
        return true;
      }
    };
    nodeSizeCache = /* @__PURE__ */ new WeakMap();
    stoppedInner = new NodeProp({ perNode: true });
  }
});

// ../../node_modules/@lezer/highlight/dist/index.js
function sameArray(a, b) {
  return a.length == b.length && a.every((x, i) => x == b[i]);
}
function powerSet(array) {
  let sets = [[]];
  for (let i = 0; i < array.length; i++) {
    for (let j = 0, e = sets.length; j < e; j++) {
      sets.push(sets[j].concat(array[i]));
    }
  }
  return sets.sort((a, b) => b.length - a.length);
}
function tagHighlighter(tags2, options2) {
  let map = /* @__PURE__ */ Object.create(null);
  for (let style of tags2) {
    if (!Array.isArray(style.tag))
      map[style.tag.id] = style.class;
    else
      for (let tag2 of style.tag)
        map[tag2.id] = style.class;
  }
  let { scope, all = null } = options2 || {};
  return {
    style: (tags3) => {
      let cls = all;
      for (let tag2 of tags3) {
        for (let sub of tag2.set) {
          let tagClass = map[sub.id];
          if (tagClass) {
            cls = cls ? cls + " " + tagClass : tagClass;
            break;
          }
        }
      }
      return cls;
    },
    scope
  };
}
function highlightTags(highlighters, tags2) {
  let result = null;
  for (let highlighter of highlighters) {
    let value = highlighter.style(tags2);
    if (value)
      result = result ? result + " " + value : value;
  }
  return result;
}
function highlightTree(tree, highlighter, putStyle, from = 0, to = tree.length) {
  let builder = new HighlightBuilder(from, Array.isArray(highlighter) ? highlighter : [highlighter], putStyle);
  builder.highlightRange(tree.cursor(), from, to, "", builder.highlighters);
  builder.flush(to);
}
function highlightCode(code, tree, highlighter, putText, putBreak, from = 0, to = code.length) {
  let pos = from;
  function writeTo(p, classes) {
    if (p <= pos)
      return;
    for (let text = code.slice(pos, p), i = 0; ; ) {
      let nextBreak = text.indexOf("\n", i);
      let upto = nextBreak < 0 ? text.length : nextBreak;
      if (upto > i)
        putText(text.slice(i, upto), classes);
      if (nextBreak < 0)
        break;
      putBreak();
      i = nextBreak + 1;
    }
    pos = p;
  }
  highlightTree(tree, highlighter, (from2, to2, classes) => {
    writeTo(from2, "");
    writeTo(to2, classes);
  }, from, to);
  writeTo(to, "");
}
function getStyleTags(node) {
  let rule = node.type.prop(ruleNodeProp);
  while (rule && rule.context && !node.matchContext(rule.context))
    rule = rule.next;
  return rule || null;
}
var nextTagID, Tag, nextModifierID, Modifier, ruleNodeProp, Rule, HighlightBuilder, t, comment, name, typeName, propertyName, literal, string, number, content, heading2, keyword, operator, punctuation2, bracket, meta, tags, classHighlighter;
var init_dist2 = __esm({
  "../../node_modules/@lezer/highlight/dist/index.js"() {
    init_dist();
    nextTagID = 0;
    Tag = class _Tag {
      /**
      @internal
      */
      constructor(name2, set, base, modified) {
        this.name = name2;
        this.set = set;
        this.base = base;
        this.modified = modified;
        this.id = nextTagID++;
      }
      toString() {
        let { name: name2 } = this;
        for (let mod of this.modified)
          if (mod.name)
            name2 = `${mod.name}(${name2})`;
        return name2;
      }
      static define(nameOrParent, parent) {
        let name2 = typeof nameOrParent == "string" ? nameOrParent : "?";
        if (nameOrParent instanceof _Tag)
          parent = nameOrParent;
        if (parent === null || parent === void 0 ? void 0 : parent.base)
          throw new Error("Can not derive from a modified tag");
        let tag2 = new _Tag(name2, [], null, []);
        tag2.set.push(tag2);
        if (parent)
          for (let t2 of parent.set)
            tag2.set.push(t2);
        return tag2;
      }
      /**
      Define a tag _modifier_, which is a function that, given a tag,
      will return a tag that is a subtag of the original. Applying the
      same modifier to a twice tag will return the same value (`m1(t1)
      == m1(t1)`) and applying multiple modifiers will, regardless or
      order, produce the same tag (`m1(m2(t1)) == m2(m1(t1))`).
      
      When multiple modifiers are applied to a given base tag, each
      smaller set of modifiers is registered as a parent, so that for
      example `m1(m2(m3(t1)))` is a subtype of `m1(m2(t1))`,
      `m1(m3(t1)`, and so on.
      */
      static defineModifier(name2) {
        let mod = new Modifier(name2);
        return (tag2) => {
          if (tag2.modified.indexOf(mod) > -1)
            return tag2;
          return Modifier.get(tag2.base || tag2, tag2.modified.concat(mod).sort((a, b) => a.id - b.id));
        };
      }
    };
    nextModifierID = 0;
    Modifier = class _Modifier {
      constructor(name2) {
        this.name = name2;
        this.instances = [];
        this.id = nextModifierID++;
      }
      static get(base, mods) {
        if (!mods.length)
          return base;
        let exists = mods[0].instances.find((t2) => t2.base == base && sameArray(mods, t2.modified));
        if (exists)
          return exists;
        let set = [], tag2 = new Tag(base.name, set, base, mods);
        for (let m of mods)
          m.instances.push(tag2);
        let configs = powerSet(mods);
        for (let parent of base.set)
          if (!parent.modified.length)
            for (let config of configs)
              set.push(_Modifier.get(parent, config));
        return tag2;
      }
    };
    ruleNodeProp = new NodeProp({
      combine(a, b) {
        let cur, root, take;
        while (a || b) {
          if (!a || b && a.depth <= b.depth) {
            take = b;
            b = b.next;
          } else {
            take = a;
            a = a.next;
          }
          if (cur && cur.mode == take.mode && !take.context && !cur.context)
            continue;
          let copy = new Rule(take.tags, take.mode, take.context);
          if (cur)
            cur.next = copy;
          else
            root = copy;
          cur = copy;
        }
        return root;
      }
    });
    Rule = class {
      constructor(tags2, mode, context2, next) {
        this.tags = tags2;
        this.mode = mode;
        this.context = context2;
        this.next = next;
      }
      get opaque() {
        return this.mode == 0;
      }
      get inherit() {
        return this.mode == 1;
      }
      sort(other2) {
        if (!other2 || other2.depth < this.depth) {
          this.next = other2;
          return this;
        }
        other2.next = this.sort(other2.next);
        return other2;
      }
      get depth() {
        return this.context ? this.context.length : 0;
      }
    };
    Rule.empty = new Rule([], 2, null);
    HighlightBuilder = class {
      constructor(at, highlighters, span) {
        this.at = at;
        this.highlighters = highlighters;
        this.span = span;
        this.class = "";
      }
      startSpan(at, cls) {
        if (cls != this.class) {
          this.flush(at);
          if (at > this.at)
            this.at = at;
          this.class = cls;
        }
      }
      flush(to) {
        if (to > this.at && this.class)
          this.span(this.at, to, this.class);
      }
      highlightRange(cursor, from, to, inheritedClass, highlighters) {
        let { type, from: start, to: end } = cursor;
        if (start >= to || end <= from)
          return;
        if (type.isTop)
          highlighters = this.highlighters.filter((h) => !h.scope || h.scope(type));
        let cls = inheritedClass;
        let rule = getStyleTags(cursor) || Rule.empty;
        let tagCls = highlightTags(highlighters, rule.tags);
        if (tagCls) {
          if (cls)
            cls += " ";
          cls += tagCls;
          if (rule.mode == 1)
            inheritedClass += (inheritedClass ? " " : "") + tagCls;
        }
        this.startSpan(Math.max(from, start), cls);
        if (rule.opaque)
          return;
        let mounted = cursor.tree && cursor.tree.prop(NodeProp.mounted);
        if (mounted && mounted.overlay) {
          let inner = cursor.node.enter(mounted.overlay[0].from + start, 1);
          let innerHighlighters = this.highlighters.filter((h) => !h.scope || h.scope(mounted.tree.type));
          let hasChild2 = cursor.firstChild();
          for (let i = 0, pos = start; ; i++) {
            let next = i < mounted.overlay.length ? mounted.overlay[i] : null;
            let nextPos = next ? next.from + start : end;
            let rangeFrom = Math.max(from, pos), rangeTo = Math.min(to, nextPos);
            if (rangeFrom < rangeTo && hasChild2) {
              while (cursor.from < rangeTo) {
                this.highlightRange(cursor, rangeFrom, rangeTo, inheritedClass, highlighters);
                this.startSpan(Math.min(rangeTo, cursor.to), cls);
                if (cursor.to >= nextPos || !cursor.nextSibling())
                  break;
              }
            }
            if (!next || nextPos > to)
              break;
            pos = next.to + start;
            if (pos > from) {
              this.highlightRange(inner.cursor(), Math.max(from, next.from + start), Math.min(to, pos), "", innerHighlighters);
              this.startSpan(Math.min(to, pos), cls);
            }
          }
          if (hasChild2)
            cursor.parent();
        } else if (cursor.firstChild()) {
          if (mounted)
            inheritedClass = "";
          do {
            if (cursor.to <= from)
              continue;
            if (cursor.from >= to)
              break;
            this.highlightRange(cursor, from, to, inheritedClass, highlighters);
            this.startSpan(Math.min(to, cursor.to), cls);
          } while (cursor.nextSibling());
          cursor.parent();
        }
      }
    };
    t = Tag.define;
    comment = t();
    name = t();
    typeName = t(name);
    propertyName = t(name);
    literal = t();
    string = t(literal);
    number = t(literal);
    content = t();
    heading2 = t(content);
    keyword = t();
    operator = t();
    punctuation2 = t();
    bracket = t(punctuation2);
    meta = t();
    tags = {
      /**
      A comment.
      */
      comment,
      /**
      A line [comment](#highlight.tags.comment).
      */
      lineComment: t(comment),
      /**
      A block [comment](#highlight.tags.comment).
      */
      blockComment: t(comment),
      /**
      A documentation [comment](#highlight.tags.comment).
      */
      docComment: t(comment),
      /**
      Any kind of identifier.
      */
      name,
      /**
      The [name](#highlight.tags.name) of a variable.
      */
      variableName: t(name),
      /**
      A type [name](#highlight.tags.name).
      */
      typeName,
      /**
      A tag name (subtag of [`typeName`](#highlight.tags.typeName)).
      */
      tagName: t(typeName),
      /**
      A property or field [name](#highlight.tags.name).
      */
      propertyName,
      /**
      An attribute name (subtag of [`propertyName`](#highlight.tags.propertyName)).
      */
      attributeName: t(propertyName),
      /**
      The [name](#highlight.tags.name) of a class.
      */
      className: t(name),
      /**
      A label [name](#highlight.tags.name).
      */
      labelName: t(name),
      /**
      A namespace [name](#highlight.tags.name).
      */
      namespace: t(name),
      /**
      The [name](#highlight.tags.name) of a macro.
      */
      macroName: t(name),
      /**
      A literal value.
      */
      literal,
      /**
      A string [literal](#highlight.tags.literal).
      */
      string,
      /**
      A documentation [string](#highlight.tags.string).
      */
      docString: t(string),
      /**
      A character literal (subtag of [string](#highlight.tags.string)).
      */
      character: t(string),
      /**
      An attribute value (subtag of [string](#highlight.tags.string)).
      */
      attributeValue: t(string),
      /**
      A number [literal](#highlight.tags.literal).
      */
      number,
      /**
      An integer [number](#highlight.tags.number) literal.
      */
      integer: t(number),
      /**
      A floating-point [number](#highlight.tags.number) literal.
      */
      float: t(number),
      /**
      A boolean [literal](#highlight.tags.literal).
      */
      bool: t(literal),
      /**
      Regular expression [literal](#highlight.tags.literal).
      */
      regexp: t(literal),
      /**
      An escape [literal](#highlight.tags.literal), for example a
      backslash escape in a string.
      */
      escape: t(literal),
      /**
      A color [literal](#highlight.tags.literal).
      */
      color: t(literal),
      /**
      A URL [literal](#highlight.tags.literal).
      */
      url: t(literal),
      /**
      A language keyword.
      */
      keyword,
      /**
      The [keyword](#highlight.tags.keyword) for the self or this
      object.
      */
      self: t(keyword),
      /**
      The [keyword](#highlight.tags.keyword) for null.
      */
      null: t(keyword),
      /**
      A [keyword](#highlight.tags.keyword) denoting some atomic value.
      */
      atom: t(keyword),
      /**
      A [keyword](#highlight.tags.keyword) that represents a unit.
      */
      unit: t(keyword),
      /**
      A modifier [keyword](#highlight.tags.keyword).
      */
      modifier: t(keyword),
      /**
      A [keyword](#highlight.tags.keyword) that acts as an operator.
      */
      operatorKeyword: t(keyword),
      /**
      A control-flow related [keyword](#highlight.tags.keyword).
      */
      controlKeyword: t(keyword),
      /**
      A [keyword](#highlight.tags.keyword) that defines something.
      */
      definitionKeyword: t(keyword),
      /**
      A [keyword](#highlight.tags.keyword) related to defining or
      interfacing with modules.
      */
      moduleKeyword: t(keyword),
      /**
      An operator.
      */
      operator,
      /**
      An [operator](#highlight.tags.operator) that dereferences something.
      */
      derefOperator: t(operator),
      /**
      Arithmetic-related [operator](#highlight.tags.operator).
      */
      arithmeticOperator: t(operator),
      /**
      Logical [operator](#highlight.tags.operator).
      */
      logicOperator: t(operator),
      /**
      Bit [operator](#highlight.tags.operator).
      */
      bitwiseOperator: t(operator),
      /**
      Comparison [operator](#highlight.tags.operator).
      */
      compareOperator: t(operator),
      /**
      [Operator](#highlight.tags.operator) that updates its operand.
      */
      updateOperator: t(operator),
      /**
      [Operator](#highlight.tags.operator) that defines something.
      */
      definitionOperator: t(operator),
      /**
      Type-related [operator](#highlight.tags.operator).
      */
      typeOperator: t(operator),
      /**
      Control-flow [operator](#highlight.tags.operator).
      */
      controlOperator: t(operator),
      /**
      Program or markup punctuation.
      */
      punctuation: punctuation2,
      /**
      [Punctuation](#highlight.tags.punctuation) that separates
      things.
      */
      separator: t(punctuation2),
      /**
      Bracket-style [punctuation](#highlight.tags.punctuation).
      */
      bracket,
      /**
      Angle [brackets](#highlight.tags.bracket) (usually `<` and `>`
      tokens).
      */
      angleBracket: t(bracket),
      /**
      Square [brackets](#highlight.tags.bracket) (usually `[` and `]`
      tokens).
      */
      squareBracket: t(bracket),
      /**
      Parentheses (usually `(` and `)` tokens). Subtag of
      [bracket](#highlight.tags.bracket).
      */
      paren: t(bracket),
      /**
      Braces (usually `{` and `}` tokens). Subtag of
      [bracket](#highlight.tags.bracket).
      */
      brace: t(bracket),
      /**
      Content, for example plain text in XML or markup documents.
      */
      content,
      /**
      [Content](#highlight.tags.content) that represents a heading.
      */
      heading: heading2,
      /**
      A level 1 [heading](#highlight.tags.heading).
      */
      heading1: t(heading2),
      /**
      A level 2 [heading](#highlight.tags.heading).
      */
      heading2: t(heading2),
      /**
      A level 3 [heading](#highlight.tags.heading).
      */
      heading3: t(heading2),
      /**
      A level 4 [heading](#highlight.tags.heading).
      */
      heading4: t(heading2),
      /**
      A level 5 [heading](#highlight.tags.heading).
      */
      heading5: t(heading2),
      /**
      A level 6 [heading](#highlight.tags.heading).
      */
      heading6: t(heading2),
      /**
      A prose [content](#highlight.tags.content) separator (such as a horizontal rule).
      */
      contentSeparator: t(content),
      /**
      [Content](#highlight.tags.content) that represents a list.
      */
      list: t(content),
      /**
      [Content](#highlight.tags.content) that represents a quote.
      */
      quote: t(content),
      /**
      [Content](#highlight.tags.content) that is emphasized.
      */
      emphasis: t(content),
      /**
      [Content](#highlight.tags.content) that is styled strong.
      */
      strong: t(content),
      /**
      [Content](#highlight.tags.content) that is part of a link.
      */
      link: t(content),
      /**
      [Content](#highlight.tags.content) that is styled as code or
      monospace.
      */
      monospace: t(content),
      /**
      [Content](#highlight.tags.content) that has a strike-through
      style.
      */
      strikethrough: t(content),
      /**
      Inserted text in a change-tracking format.
      */
      inserted: t(),
      /**
      Deleted text.
      */
      deleted: t(),
      /**
      Changed text.
      */
      changed: t(),
      /**
      An invalid or unsyntactic element.
      */
      invalid: t(),
      /**
      Metadata or meta-instruction.
      */
      meta,
      /**
      [Metadata](#highlight.tags.meta) that applies to the entire
      document.
      */
      documentMeta: t(meta),
      /**
      [Metadata](#highlight.tags.meta) that annotates or adds
      attributes to a given syntactic element.
      */
      annotation: t(meta),
      /**
      Processing instruction or preprocessor directive. Subtag of
      [meta](#highlight.tags.meta).
      */
      processingInstruction: t(meta),
      /**
      [Modifier](#highlight.Tag^defineModifier) that indicates that a
      given element is being defined. Expected to be used with the
      various [name](#highlight.tags.name) tags.
      */
      definition: Tag.defineModifier("definition"),
      /**
      [Modifier](#highlight.Tag^defineModifier) that indicates that
      something is constant. Mostly expected to be used with
      [variable names](#highlight.tags.variableName).
      */
      constant: Tag.defineModifier("constant"),
      /**
      [Modifier](#highlight.Tag^defineModifier) used to indicate that
      a [variable](#highlight.tags.variableName) or [property
      name](#highlight.tags.propertyName) is being called or defined
      as a function.
      */
      function: Tag.defineModifier("function"),
      /**
      [Modifier](#highlight.Tag^defineModifier) that can be applied to
      [names](#highlight.tags.name) to indicate that they belong to
      the language's standard environment.
      */
      standard: Tag.defineModifier("standard"),
      /**
      [Modifier](#highlight.Tag^defineModifier) that indicates a given
      [names](#highlight.tags.name) is local to some scope.
      */
      local: Tag.defineModifier("local"),
      /**
      A generic variant [modifier](#highlight.Tag^defineModifier) that
      can be used to tag language-specific alternative variants of
      some common tag. It is recommended for themes to define special
      forms of at least the [string](#highlight.tags.string) and
      [variable name](#highlight.tags.variableName) tags, since those
      come up a lot.
      */
      special: Tag.defineModifier("special")
    };
    for (let name2 in tags) {
      let val = tags[name2];
      if (val instanceof Tag)
        val.name = name2;
    }
    classHighlighter = tagHighlighter([
      { tag: tags.link, class: "tok-link" },
      { tag: tags.heading, class: "tok-heading" },
      { tag: tags.emphasis, class: "tok-emphasis" },
      { tag: tags.strong, class: "tok-strong" },
      { tag: tags.keyword, class: "tok-keyword" },
      { tag: tags.atom, class: "tok-atom" },
      { tag: tags.bool, class: "tok-bool" },
      { tag: tags.url, class: "tok-url" },
      { tag: tags.labelName, class: "tok-labelName" },
      { tag: tags.inserted, class: "tok-inserted" },
      { tag: tags.deleted, class: "tok-deleted" },
      { tag: tags.literal, class: "tok-literal" },
      { tag: tags.string, class: "tok-string" },
      { tag: tags.number, class: "tok-number" },
      { tag: [tags.regexp, tags.escape, tags.special(tags.string)], class: "tok-string2" },
      { tag: tags.variableName, class: "tok-variableName" },
      { tag: tags.local(tags.variableName), class: "tok-variableName tok-local" },
      { tag: tags.definition(tags.variableName), class: "tok-variableName tok-definition" },
      { tag: tags.special(tags.variableName), class: "tok-variableName2" },
      { tag: tags.definition(tags.propertyName), class: "tok-propertyName tok-definition" },
      { tag: tags.typeName, class: "tok-typeName" },
      { tag: tags.namespace, class: "tok-namespace" },
      { tag: tags.className, class: "tok-className" },
      { tag: tags.macroName, class: "tok-macroName" },
      { tag: tags.propertyName, class: "tok-propertyName" },
      { tag: tags.operator, class: "tok-operator" },
      { tag: tags.comment, class: "tok-comment" },
      { tag: tags.meta, class: "tok-meta" },
      { tag: tags.invalid, class: "tok-invalid" },
      { tag: tags.punctuation, class: "tok-punctuation" }
    ]);
  }
});

// src/client/vendor/cm-lint.js
var closeLintPanel, diagnosticCount, forEachDiagnostic, forceLinting, lintGutter, lintKeymap, linter, nextDiagnostic, openLintPanel, previousDiagnostic, setDiagnostics, setDiagnosticsEffect;
var init_cm_lint = __esm({
  "src/client/vendor/cm-lint.js"() {
    init_cm_runtime();
    closeLintPanel = lazyProxy("lint", "closeLintPanel");
    diagnosticCount = lazyProxy("lint", "diagnosticCount");
    forEachDiagnostic = lazyProxy("lint", "forEachDiagnostic");
    forceLinting = lazyProxy("lint", "forceLinting");
    lintGutter = lazyProxy("lint", "lintGutter");
    lintKeymap = lazyProxy("lint", "lintKeymap");
    linter = lazyProxy("lint", "linter");
    nextDiagnostic = lazyProxy("lint", "nextDiagnostic");
    openLintPanel = lazyProxy("lint", "openLintPanel");
    previousDiagnostic = lazyProxy("lint", "previousDiagnostic");
    setDiagnostics = lazyProxy("lint", "setDiagnostics");
    setDiagnosticsEffect = lazyProxy("lint", "setDiagnosticsEffect");
  }
});

// ../../node_modules/@codemirror/lsp-client/dist/index.js
var dist_exports = {};
__export(dist_exports, {
  LSPClient: () => LSPClient,
  LSPPlugin: () => LSPPlugin,
  Workspace: () => Workspace,
  WorkspaceMapping: () => WorkspaceMapping,
  closeReferencePanel: () => closeReferencePanel,
  findReferences: () => findReferences,
  findReferencesKeymap: () => findReferencesKeymap,
  formatDocument: () => formatDocument,
  formatKeymap: () => formatKeymap,
  hoverTooltips: () => hoverTooltips,
  jumpToDeclaration: () => jumpToDeclaration,
  jumpToDefinition: () => jumpToDefinition,
  jumpToDefinitionKeymap: () => jumpToDefinitionKeymap,
  jumpToImplementation: () => jumpToImplementation,
  jumpToTypeDefinition: () => jumpToTypeDefinition,
  languageServerExtensions: () => languageServerExtensions,
  languageServerSupport: () => languageServerSupport,
  nextSignature: () => nextSignature,
  prevSignature: () => prevSignature,
  renameKeymap: () => renameKeymap,
  renameSymbol: () => renameSymbol,
  serverCompletion: () => serverCompletion,
  serverCompletionSource: () => serverCompletionSource,
  serverDiagnostics: () => serverDiagnostics,
  showSignatureHelp: () => showSignatureHelp,
  signatureHelp: () => signatureHelp,
  signatureKeymap: () => signatureKeymap
});
function withContext(view, language2, f) {
  let prev = context;
  try {
    context = { view, language: language2 };
    return f();
  } finally {
    context = prev;
  }
}
function escHTML(text) {
  return text.replace(/[\n<&]/g, (ch) => ch == "\n" ? "<br>" : ch == "<" ? "&lt;" : "&amp;");
}
function docToHTML(value, defaultKind) {
  let kind = defaultKind, text = value;
  if (typeof text != "string") {
    kind = text.kind;
    text = text.value;
  }
  if (kind == "plaintext") {
    return escHTML(text);
  } else {
    return marked2.parse(text, { async: false });
  }
}
function toPosition(doc, pos) {
  let line = doc.lineAt(pos);
  return { line: line.number - 1, character: pos - line.from };
}
function fromPosition(doc, pos) {
  let line = doc.line(pos.line + 1);
  return line.from + pos.character;
}
function fromPositionChecked(doc, pos) {
  if (pos.line < 0 || pos.line >= doc.lines)
    return null;
  let line = doc.line(pos.line + 1);
  if (pos.character < 0 || pos.character > line.length)
    return null;
  return line.from + pos.character;
}
function contentChangesFor(file, startDoc, changes, supportInc) {
  if (!supportInc || file.doc.length < 1024)
    return [{ text: file.doc.toString() }];
  let events = [];
  changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
    events.push({
      range: { start: toPosition(startDoc, fromA), end: toPosition(startDoc, toA) },
      text: inserted.toString()
    });
  });
  return events.reverse();
}
function mergeCapabilities(base, add) {
  if (add == null)
    return base;
  if (typeof base != "object" || typeof add != "object")
    return add;
  let result = {};
  let baseProps = Object.keys(base), addProps = Object.keys(add);
  for (let prop of baseProps)
    result[prop] = addProps.indexOf(prop) > -1 ? mergeCapabilities(base[prop], add[prop]) : base[prop];
  for (let prop of addProps)
    if (baseProps.indexOf(prop) < 0)
      result[prop] = add[prop];
  return result;
}
function lspToSnippet(text) {
  return text.replace(/\\([$}\\])|\$(\d+)/g, (_m, esc, field) => esc || `\${${field}}`);
}
function serverCompletion(config = {}) {
  let result;
  if (config.override) {
    result = [autocompletion({ override: [serverCompletionSource] })];
  } else {
    let data = [{ autocomplete: serverCompletionSource }];
    result = [autocompletion(), EditorState.languageData.of(() => data)];
  }
  if (config.validFor)
    result.push(completionConfig.of({ validFor: config.validFor }));
  return result;
}
function getCompletions(plugin, pos, context2, abort) {
  if (plugin.client.hasCapability("completionProvider") === false)
    return Promise.resolve(null);
  plugin.client.sync();
  let params = {
    position: plugin.toPosition(pos),
    textDocument: { uri: plugin.uri },
    context: context2
  };
  if (abort)
    abort.addEventListener("abort", () => plugin.client.cancelRequest(params));
  return plugin.client.request("textDocument/completion", params);
}
function prefixRegexp(items) {
  var _a;
  let step = Math.ceil(items.length / 50), prefixes = [];
  for (let i = 0; i < items.length; i += step) {
    let item = items[i], text = ((_a = item.textEdit) === null || _a === void 0 ? void 0 : _a.newText) || item.textEditText || item.insertText || item.label;
    if (!/^\w/.test(text)) {
      let prefix = /^[^\w]*/.exec(text)[0];
      if (prefixes.indexOf(prefix) < 0)
        prefixes.push(prefix);
    }
  }
  if (!prefixes.length)
    return /^\w*$/;
  return new RegExp("^(?:" + prefixes.map(RegExp.escape || ((s) => s.replace(/[^\w\s]/g, "\\$&"))).join("|") + ")?\\w*$");
}
function shouldTriggerCompletion(plugin, character) {
  var _a, _b;
  let triggers = (_b = (_a = plugin.client.serverCapabilities) === null || _a === void 0 ? void 0 : _a.completionProvider) === null || _b === void 0 ? void 0 : _b.triggerCharacters;
  if (triggers && triggers.indexOf(character) > -1)
    return "triggerCharacter";
  if (/[a-zA-Z_]/.test(character))
    return "identifier";
  return null;
}
function resultMapper(changes, extraEdits) {
  return (result, newChanges) => {
    changes = changes ? changes.composeDesc(newChanges) : newChanges;
    let options2 = result.options.slice();
    for (let { index, edits, text } of extraEdits)
      options2[index] = { ...options2[index], apply: applyEdits(edits, text, changes) };
    return {
      ...result,
      options: options2,
      map: resultMapper(changes, extraEdits)
    };
  };
}
function applyEdits(edits, text, mapped) {
  return (view, completion, from, to) => {
    let base = insertCompletionText(view.state, text, from, to);
    let changes = [];
    for (let { from: from2, to: to2, text: text2 } of edits) {
      if (mapped) {
        if (mapped.touchesRange(from2, to2))
          continue;
        let len = to2 - from2;
        from2 = mapped.mapPos(from2, 1);
        to2 = from2 + len;
      }
      changes.push({ from: from2, to: to2, insert: text2 });
    }
    view.dispatch(base, { changes });
  };
}
function completionResultRange(cx, result) {
  var _a;
  if (!result.items.length)
    return { from: cx.pos, to: cx.pos };
  let defaultRange = (_a = result.itemDefaults) === null || _a === void 0 ? void 0 : _a.editRange, item0 = result.items[0];
  let range = defaultRange ? "insert" in defaultRange ? defaultRange.insert : defaultRange : item0.textEdit ? "range" in item0.textEdit ? item0.textEdit.range : item0.textEdit.insert : null;
  if (!range)
    return cx.state.wordAt(cx.pos) || { from: cx.pos, to: cx.pos };
  let line = cx.state.doc.lineAt(cx.pos);
  return { from: line.from + range.start.character, to: line.from + range.end.character };
}
function renderDocInfo(plugin, doc) {
  let elt = document.createElement("div");
  elt.className = "cm-lsp-documentation cm-lsp-completion-documentation";
  elt.innerHTML = plugin.docToHTML(doc);
  return elt;
}
function hoverTooltips(config = {}) {
  return hoverTooltip(lspTooltipSource, {
    hideOn: (tr) => tr.docChanged,
    hoverTime: config.hoverTime
  });
}
function hoverRequest(plugin, pos) {
  if (plugin.client.hasCapability("hoverProvider") === false)
    return Promise.resolve(null);
  plugin.client.sync();
  return plugin.client.request("textDocument/hover", {
    position: plugin.toPosition(pos),
    textDocument: { uri: plugin.uri }
  });
}
function lspTooltipSource(view, pos) {
  const plugin = LSPPlugin.get(view);
  if (!plugin)
    return Promise.resolve(null);
  return hoverRequest(plugin, pos).then((result) => {
    if (!result)
      return null;
    return {
      pos: result.range ? fromPosition(view.state.doc, result.range.start) : pos,
      end: result.range ? fromPosition(view.state.doc, result.range.end) : pos,
      create() {
        let elt = document.createElement("div");
        elt.className = "cm-lsp-hover-tooltip cm-lsp-documentation";
        elt.innerHTML = renderTooltipContent(plugin, result.contents);
        return { dom: elt };
      },
      above: true
    };
  });
}
function renderTooltipContent(plugin, value) {
  if (Array.isArray(value))
    return value.map((m) => renderCode(plugin, m)).join("<br>");
  if (typeof value == "string" || typeof value == "object" && "language" in value)
    return renderCode(plugin, value);
  return plugin.docToHTML(value);
}
function renderCode(plugin, code) {
  if (typeof code == "string")
    return plugin.docToHTML(code, "markdown");
  let { language: language$1, value } = code;
  let lang = plugin.client.config.highlightLanguage && plugin.client.config.highlightLanguage(language$1 || "");
  if (!lang) {
    let viewLang = plugin.view.state.facet(language);
    if (viewLang && (!language$1 || viewLang.name == language$1))
      lang = viewLang;
  }
  if (!lang)
    return escHTML(value);
  let result = "";
  highlightCode(value, lang.parser.parse(value), { style: (tags2) => highlightingFor(plugin.view.state, tags2) }, (text, cls) => {
    result += cls ? `<span class="${cls}">${escHTML(text)}</span>` : escHTML(text);
  }, () => {
    result += "<br>";
  });
  return result;
}
function getFormatting(plugin, options2) {
  return plugin.client.request("textDocument/formatting", {
    options: options2,
    textDocument: { uri: plugin.uri }
  });
}
function getRename(plugin, pos, newName) {
  return plugin.client.request("textDocument/rename", {
    newName,
    position: plugin.toPosition(pos),
    textDocument: { uri: plugin.uri }
  });
}
function doRename(view, newName) {
  const plugin = LSPPlugin.get(view);
  const word = view.state.wordAt(view.state.selection.main.head);
  if (!plugin || !word)
    return false;
  plugin.client.sync();
  plugin.client.withMapping((mapping) => getRename(plugin, word.from, newName).then((response) => {
    if (!response)
      return;
    for (let uri in response.changes) {
      let lspChanges = response.changes[uri], file = plugin.client.workspace.getFile(uri);
      if (!lspChanges.length || !file)
        continue;
      plugin.client.workspace.updateFile(uri, {
        changes: lspChanges.map((change) => ({
          from: mapping.mapPosition(uri, change.range.start),
          to: mapping.mapPosition(uri, change.range.end),
          insert: change.newText
        })),
        userEvent: "rename"
      });
    }
  }, (err) => {
    plugin.reportError("Rename request failed", err);
  }));
}
function getSignatureHelp(plugin, pos, context2) {
  if (plugin.client.hasCapability("signatureHelpProvider") === false)
    return Promise.resolve(null);
  plugin.client.sync();
  return plugin.client.request("textDocument/signatureHelp", {
    context: context2,
    position: plugin.toPosition(pos),
    textDocument: { uri: plugin.uri }
  });
}
function sameSignatures(a, b) {
  if (a.signatures.length != b.signatures.length)
    return false;
  return a.signatures.every((s, i) => s.label == b.signatures[i].label);
}
function sameActiveParam(a, b, active) {
  var _a, _b;
  return ((_a = a.signatures[active].activeParameter) !== null && _a !== void 0 ? _a : a.activeParameter) == ((_b = b.signatures[active].activeParameter) !== null && _b !== void 0 ? _b : b.activeParameter);
}
function signatureTooltip(data, active, pos) {
  return {
    pos,
    above: true,
    create: (view) => drawSignatureTooltip(view, data, active)
  };
}
function drawSignatureTooltip(view, data, active) {
  var _a;
  let dom = document.createElement("div");
  dom.className = "cm-lsp-signature-tooltip";
  if (data.signatures.length > 1) {
    dom.classList.add("cm-lsp-signature-multiple");
    let num = dom.appendChild(document.createElement("div"));
    num.className = "cm-lsp-signature-num";
    num.textContent = `${active + 1}/${data.signatures.length}`;
  }
  let signature = data.signatures[active];
  let sig = dom.appendChild(document.createElement("div"));
  sig.className = "cm-lsp-signature";
  let activeFrom = 0, activeTo = 0;
  let activeN = (_a = signature.activeParameter) !== null && _a !== void 0 ? _a : data.activeParameter;
  let activeParam = activeN != null && signature.parameters ? signature.parameters[activeN] : null;
  if (activeParam && Array.isArray(activeParam.label)) {
    [activeFrom, activeTo] = activeParam.label;
  } else if (activeParam) {
    let found = signature.label.indexOf(activeParam.label);
    if (found > -1) {
      activeFrom = found;
      activeTo = found + activeParam.label.length;
    }
  }
  if (activeTo) {
    sig.appendChild(document.createTextNode(signature.label.slice(0, activeFrom)));
    let activeElt = sig.appendChild(document.createElement("span"));
    activeElt.className = "cm-lsp-active-parameter";
    activeElt.textContent = signature.label.slice(activeFrom, activeTo);
    sig.appendChild(document.createTextNode(signature.label.slice(activeTo)));
  } else {
    sig.textContent = signature.label;
  }
  if (signature.documentation) {
    let plugin = LSPPlugin.get(view);
    if (plugin) {
      let docs = dom.appendChild(document.createElement("div"));
      docs.className = "cm-lsp-signature-documentation cm-lsp-documentation";
      docs.innerHTML = plugin.docToHTML(signature.documentation);
    }
  }
  return { dom };
}
function signatureHelp(config = {}) {
  return [
    signatureState,
    signaturePlugin,
    config.keymap === false ? [] : Prec.high(keymap.of(signatureKeymap))
  ];
}
function getDefinition(plugin, pos) {
  return plugin.client.request("textDocument/definition", {
    textDocument: { uri: plugin.uri },
    position: plugin.toPosition(pos)
  });
}
function getDeclaration(plugin, pos) {
  return plugin.client.request("textDocument/declaration", {
    textDocument: { uri: plugin.uri },
    position: plugin.toPosition(pos)
  });
}
function getTypeDefinition(plugin, pos) {
  return plugin.client.request("textDocument/typeDefinition", {
    textDocument: { uri: plugin.uri },
    position: plugin.toPosition(pos)
  });
}
function getImplementation(plugin, pos) {
  return plugin.client.request("textDocument/implementation", {
    textDocument: { uri: plugin.uri },
    position: plugin.toPosition(pos)
  });
}
function jumpToOrigin(view, type) {
  const plugin = LSPPlugin.get(view);
  if (!plugin || plugin.client.hasCapability(type.capability) === false)
    return false;
  plugin.client.sync();
  plugin.client.withMapping((mapping) => type.get(plugin, view.state.selection.main.head).then((response) => {
    let loc = Array.isArray(response) ? response[0] : response;
    if (!loc)
      return;
    return (loc.uri == plugin.uri ? Promise.resolve(view) : plugin.client.workspace.displayFile(loc.uri)).then((target) => {
      if (!target)
        return;
      let pos = mapping.getMapping(loc.uri) ? mapping.mapPosition(loc.uri, loc.range.start) : plugin.fromPosition(loc.range.start, target.state.doc);
      target.dispatch({ selection: { anchor: pos }, scrollIntoView: true, userEvent: "select.definition" });
    });
  }, (error) => plugin.reportError("Find definition failed", error)));
  return true;
}
function getReferences(plugin, pos) {
  return plugin.client.request("textDocument/references", {
    textDocument: { uri: plugin.uri },
    position: plugin.toPosition(pos),
    context: { includeDeclaration: true }
  });
}
function displayReferences(view, locs, mapping) {
  let panel = createReferencePanel(locs, mapping);
  let effect = view.state.field(referencePanel, false) === void 0 ? StateEffect.appendConfig.of(referencePanel.init(() => panel)) : setReferencePanel.of(panel);
  view.dispatch({ effects: effect });
}
function createReferencePanel(locs, mapping) {
  let created = false;
  setTimeout(() => {
    if (!created)
      mapping.destroy();
  }, 500);
  return (view) => {
    created = true;
    let prefixLen = findCommonPrefix(locs.map((l) => l.file.uri));
    let panel = document.createElement("div"), curFile = null;
    panel.className = "cm-lsp-reference-panel";
    panel.tabIndex = 0;
    panel.role = "listbox";
    panel.setAttribute("aria-label", view.state.phrase("Reference list"));
    let options2 = [];
    for (let { file, range } of locs) {
      let fileName = file.uri.slice(prefixLen);
      if (fileName != curFile) {
        curFile = fileName;
        let header = panel.appendChild(document.createElement("div"));
        header.className = "cm-lsp-reference-file";
        header.textContent = fileName;
      }
      let entry = panel.appendChild(document.createElement("div"));
      entry.className = "cm-lsp-reference";
      entry.role = "option";
      let from = mapping.mapPosition(file.uri, range.start, 1), to = mapping.mapPosition(file.uri, range.end, -1);
      let view2 = file.getView(), line = (view2 ? view2.state.doc : file.doc).lineAt(from);
      let lineNumber = entry.appendChild(document.createElement("span"));
      lineNumber.className = "cm-lsp-reference-line";
      lineNumber.textContent = (line.number + ": ").padStart(5, " ");
      let textBefore = line.text.slice(Math.max(0, from - line.from - 50), from - line.from);
      if (textBefore)
        entry.appendChild(document.createTextNode(textBefore));
      entry.appendChild(document.createElement("strong")).textContent = line.text.slice(from - line.from, to - line.from);
      let textAfter = line.text.slice(to - line.from, Math.min(line.length, 100 - textBefore.length));
      if (textAfter)
        entry.appendChild(document.createTextNode(textAfter));
      if (!options2.length)
        entry.setAttribute("aria-selected", "true");
      options2.push(entry);
    }
    function curSelection() {
      for (let i = 0; i < options2.length; i++) {
        if (options2[i].hasAttribute("aria-selected"))
          return i;
      }
      return 0;
    }
    function setSelection(index) {
      for (let i = 0; i < options2.length; i++) {
        if (i == index)
          options2[i].setAttribute("aria-selected", "true");
        else
          options2[i].removeAttribute("aria-selected");
      }
    }
    function showReference(index) {
      let { file, range } = locs[index];
      let plugin = LSPPlugin.get(view);
      if (!plugin)
        return;
      Promise.resolve(file.uri == plugin.uri ? view : plugin.client.workspace.displayFile(file.uri)).then((view2) => {
        if (!view2)
          return;
        let pos = mapping.mapPosition(file.uri, range.start, 1);
        view2.focus();
        view2.dispatch({
          selection: { anchor: pos },
          scrollIntoView: true
        });
      });
    }
    panel.addEventListener("keydown", (event) => {
      if (event.keyCode == 27) {
        closeReferencePanel(view);
        view.focus();
      } else if (event.keyCode == 38 || event.keyCode == 33) {
        setSelection((curSelection() - 1 + locs.length) % locs.length);
      } else if (event.keyCode == 40 || event.keyCode == 34) {
        setSelection((curSelection() + 1) % locs.length);
      } else if (event.keyCode == 36) {
        setSelection(0);
      } else if (event.keyCode == 35) {
        setSelection(options2.length - 1);
      } else if (event.keyCode == 13 || event.keyCode == 10) {
        showReference(curSelection());
      } else {
        return;
      }
      event.preventDefault();
    });
    panel.addEventListener("click", (event) => {
      for (let i = 0; i < options2.length; i++) {
        if (options2[i].contains(event.target)) {
          setSelection(i);
          showReference(i);
          event.preventDefault();
        }
      }
    });
    let dom = document.createElement("div");
    dom.appendChild(panel);
    let close = dom.appendChild(document.createElement("button"));
    close.className = "cm-dialog-close";
    close.textContent = "\xD7";
    close.addEventListener("click", () => closeReferencePanel(view));
    close.setAttribute("aria-label", view.state.phrase("close"));
    return {
      dom,
      destroy: () => mapping.destroy(),
      mount: () => panel.focus()
    };
  };
}
function findCommonPrefix(uris) {
  let first = uris[0], prefix = first.length;
  for (let i = 1; i < uris.length; i++) {
    let uri = uris[i], j = 0;
    for (let e = Math.min(prefix, uri.length); j < e && first[j] == uri[j]; j++) {
    }
    prefix = j;
  }
  while (prefix && first[prefix - 1] != "/")
    prefix--;
  return prefix;
}
function toSeverity(sev) {
  return sev == 1 ? "error" : sev == 2 ? "warning" : sev == 3 ? "info" : "hint";
}
function serverDiagnostics() {
  return {
    clientCapabilities: { textDocument: { publishDiagnostics: { versionSupport: true } } },
    notificationHandlers: {
      "textDocument/publishDiagnostics": (client, params) => {
        let file = client.workspace.getFile(params.uri);
        if (!file || params.version != null && params.version != file.version)
          return false;
        const view = file.getView(), plugin = view && LSPPlugin.get(view);
        if (!view || !plugin)
          return false;
        view.dispatch(setDiagnostics(view.state, params.diagnostics.map((item) => {
          var _a;
          return {
            from: plugin.unsyncedChanges.mapPos(plugin.fromPosition(item.range.start, plugin.syncedDoc)),
            to: plugin.unsyncedChanges.mapPos(plugin.fromPosition(item.range.end, plugin.syncedDoc)),
            severity: toSeverity((_a = item.severity) !== null && _a !== void 0 ? _a : 1),
            message: item.message
          };
        })));
        return true;
      }
    },
    editorExtension: autoSync
  };
}
function languageServerSupport(client, uri, languageID) {
  return [
    LSPPlugin.create(client, uri, languageID),
    serverCompletion(),
    hoverTooltips(),
    keymap.of([...formatKeymap, ...renameKeymap, ...jumpToDefinitionKeymap, ...findReferencesKeymap]),
    signatureHelp()
  ];
}
function languageServerExtensions() {
  return [
    serverCompletion(),
    hoverTooltips(),
    keymap.of([...formatKeymap, ...renameKeymap, ...jumpToDefinitionKeymap, ...findReferencesKeymap]),
    signatureHelp(),
    serverDiagnostics()
  ];
}
var context, marked2, LSPPlugin, lspPlugin, Workspace, DefaultWorkspaceFile, DefaultWorkspace, lspTheme, Request, clientCapabilities, WorkspaceMapping, defaultNotificationHandlers, LSPClient, completionConfig, serverCompletionSource, kindToType, formatDocument, formatKeymap, renameSymbol, renameKeymap, signaturePlugin, SignatureState, signatureState, signatureEffect, showSignatureHelp, nextSignature, prevSignature, signatureKeymap, jumpToDefinition, jumpToDeclaration, jumpToTypeDefinition, jumpToImplementation, jumpToDefinitionKeymap, findReferences, closeReferencePanel, referencePanel, setReferencePanel, findReferencesKeymap, autoSync;
var init_dist3 = __esm({
  "../../node_modules/@codemirror/lsp-client/dist/index.js"() {
    init_cm_view();
    init_cm_state();
    init_cm_language();
    init_marked_esm();
    init_dist2();
    init_cm_autocomplete();
    init_cm_lint();
    context = null;
    marked2 = /* @__PURE__ */ new Marked({
      walkTokens(token) {
        if (!context || token.type != "code")
          return;
        let lang = context.language && context.language(token.lang);
        if (!lang) {
          let viewLang = context.view.state.facet(language);
          if (viewLang && viewLang.name == token.lang)
            lang = viewLang;
        }
        if (!lang)
          return;
        let highlighter = { style: (tags2) => highlightingFor(context.view.state, tags2) };
        let result = "";
        highlightCode(token.text, lang.parser.parse(token.text), highlighter, (text, cls) => {
          result += cls ? `<span class="${cls}">${escHTML(text)}</span>` : escHTML(text);
        }, () => {
          result += "<br>";
        });
        token.escaped = true;
        token.text = result;
      }
    });
    LSPPlugin = class {
      /**
      @internal
      */
      constructor(view, { client, uri, languageID }) {
        this.view = view;
        this.client = client;
        this.uri = uri;
        if (!languageID) {
          let lang = view.state.facet(language);
          languageID = lang ? lang.name : "";
        }
        client.workspace.openFile(uri, languageID, view);
        this.syncedDoc = view.state.doc;
        this.unsyncedChanges = ChangeSet.empty(view.state.doc.length);
      }
      /**
      Render a doc string from the server to HTML.
      */
      docToHTML(value, defaultKind = "plaintext") {
        let html2 = withContext(this.view, this.client.config.highlightLanguage, () => docToHTML(value, defaultKind));
        return this.client.config.sanitizeHTML ? this.client.config.sanitizeHTML(html2) : html2;
      }
      /**
      Convert a CodeMirror document offset into an LSP `{line,
      character}` object. Defaults to using the view's current
      document, but can be given another one.
      */
      toPosition(pos, doc = this.view.state.doc) {
        return toPosition(doc, pos);
      }
      /**
      Convert an LSP `{line, character}` object to a CodeMirror
      document offset.
      */
      fromPosition(pos, doc = this.view.state.doc) {
        return fromPosition(doc, pos);
      }
      /**
      Display an error in this plugin's editor.
      */
      reportError(message, err) {
        showDialog(this.view, {
          label: this.view.state.phrase(message) + ": " + (err.message || err),
          class: "cm-lsp-message cm-lsp-message-error",
          top: true
        });
      }
      /**
      Reset the [unsynced
      changes](https://codemirror.net/6/docs/ref/#lsp-client.LSPPlugin.unsyncedChanges). Should probably
      only be called by a [workspace](https://codemirror.net/6/docs/ref/#lsp-client.Workspace).
      */
      clear() {
        this.syncedDoc = this.view.state.doc;
        this.unsyncedChanges = ChangeSet.empty(this.view.state.doc.length);
      }
      /**
      @internal
      */
      update(update) {
        if (update.docChanged)
          this.unsyncedChanges = this.unsyncedChanges.compose(update.changes);
      }
      /**
      @internal
      */
      destroy() {
        this.client.workspace.closeFile(this.uri, this.view);
      }
      /**
      Get the LSP plugin associated with an editor, if any.
      */
      static get(view) {
        return view.plugin(lspPlugin);
      }
      /**
      Deprecated. Use
      [`LSPClient.plugin`](https://codemirror.net/6/docs/ref/#lsp-client.LSPClient.plugin) instead.
      */
      static create(client, fileURI, languageID) {
        return client.plugin(fileURI, languageID);
      }
    };
    lspPlugin = /* @__PURE__ */ ViewPlugin.fromClass(LSPPlugin);
    Workspace = class {
      /**
      The constructor, as called by the client when creating a
      workspace.
      */
      constructor(client) {
        this.client = client;
      }
      /**
      Find the open file with the given URI, if it exists. The default
      implementation just looks it up in `this.files`.
      */
      getFile(uri) {
        return this.files.find((f) => f.uri == uri) || null;
      }
      /**
      Called to request that the workspace open a file. The default
      implementation simply returns the file if it is open, null
      otherwise.
      */
      requestFile(uri) {
        return Promise.resolve(this.getFile(uri));
      }
      /**
      Called when the client for this workspace is connected. The
      default implementation calls
      [`LSPClient.didOpen`](https://codemirror.net/6/docs/ref/#lsp-client.LSPClient.didOpen) on all open
      files.
      */
      connected() {
        for (let file of this.files)
          this.client.didOpen(file);
      }
      /**
      Called when the client for this workspace is disconnected. The
      default implementation does nothing.
      */
      disconnected() {
      }
      /**
      Called when a server-initiated change to a file is applied. The
      default implementation simply dispatches the update to the
      file's view, if the file is open and has a view.
      */
      updateFile(uri, update) {
        var _a;
        let file = this.getFile(uri);
        if (file)
          (_a = file.getView()) === null || _a === void 0 ? void 0 : _a.dispatch(update);
      }
      /**
      When the client needs to put a file other than the one loaded in
      the current editor in front of the user, for example in
      [`jumpToDefinition`](https://codemirror.net/6/docs/ref/#lsp-client.jumpToDefinition), it will call
      this function. It should make sure to create or find an editor
      with the file and make it visible to the user, or return null if
      this isn't possible.
      */
      displayFile(uri) {
        let file = this.getFile(uri);
        return Promise.resolve(file ? file.getView() : null);
      }
    };
    DefaultWorkspaceFile = class {
      constructor(uri, languageId, version, doc, view) {
        this.uri = uri;
        this.languageId = languageId;
        this.version = version;
        this.doc = doc;
        this.view = view;
      }
      getView() {
        return this.view;
      }
    };
    DefaultWorkspace = class extends Workspace {
      constructor() {
        super(...arguments);
        this.files = [];
        this.fileVersions = /* @__PURE__ */ Object.create(null);
      }
      nextFileVersion(uri) {
        var _a;
        return this.fileVersions[uri] = ((_a = this.fileVersions[uri]) !== null && _a !== void 0 ? _a : -1) + 1;
      }
      syncFiles() {
        let result = [];
        for (let file of this.files) {
          let plugin = LSPPlugin.get(file.view);
          if (!plugin)
            continue;
          let changes = plugin.unsyncedChanges;
          if (!changes.empty) {
            result.push({ changes, file, prevDoc: file.doc });
            file.doc = file.view.state.doc;
            file.version = this.nextFileVersion(file.uri);
            plugin.clear();
          }
        }
        return result;
      }
      openFile(uri, languageId, view) {
        if (this.getFile(uri))
          throw new Error("Default workspace implementation doesn't support multiple views on the same file");
        let file = new DefaultWorkspaceFile(uri, languageId, this.nextFileVersion(uri), view.state.doc, view);
        this.files.push(file);
        this.client.didOpen(file);
      }
      closeFile(uri) {
        let file = this.getFile(uri);
        if (file) {
          this.files = this.files.filter((f) => f != file);
          this.client.didClose(uri);
        }
      }
    };
    lspTheme = /* @__PURE__ */ EditorView.baseTheme({
      ".cm-lsp-documentation": {
        padding: "0 7px",
        "& p, & pre": {
          margin: "2px 0"
        }
      },
      ".cm-lsp-signature-tooltip": {
        padding: "2px 6px",
        borderRadius: "2.5px",
        position: "relative",
        maxWidth: "30em",
        maxHeight: "10em",
        overflowY: "scroll",
        "& .cm-lsp-documentation": {
          padding: "0",
          fontSize: "80%"
        },
        "& .cm-lsp-signature-num": {
          fontFamily: "monospace",
          position: "absolute",
          left: "2px",
          top: "4px",
          fontSize: "70%",
          lineHeight: "1.3"
        },
        "& .cm-lsp-signature": {
          fontFamily: "monospace",
          textIndent: "1em hanging"
        },
        "& .cm-lsp-active-parameter": {
          fontWeight: "bold"
        }
      },
      ".cm-lsp-signature-multiple": {
        paddingLeft: "1.5em"
      },
      ".cm-panel.cm-lsp-rename-panel": {
        padding: "2px 6px 4px",
        position: "relative",
        "& label": { fontSize: "80%" },
        "& [name=close]": {
          position: "absolute",
          top: "0",
          bottom: "0",
          right: "4px",
          backgroundColor: "inherit",
          border: "none",
          font: "inherit",
          padding: "0"
        }
      },
      ".cm-lsp-message button[type=submit]": {
        display: "block"
      },
      ".cm-lsp-reference-panel": {
        fontFamily: "monospace",
        whiteSpace: "pre",
        padding: "3px 6px",
        maxHeight: "120px",
        overflow: "auto",
        "& .cm-lsp-reference-file": {
          fontWeight: "bold"
        },
        "& .cm-lsp-reference": {
          cursor: "pointer",
          "&[aria-selected]": {
            backgroundColor: "#0077ee44"
          }
        },
        "& .cm-lsp-reference-line": {
          opacity: "0.7"
        }
      }
    });
    Request = class {
      constructor(id, params, timeout) {
        this.id = id;
        this.params = params;
        this.timeout = timeout;
        this.promise = new Promise((resolve, reject) => {
          this.resolve = resolve;
          this.reject = reject;
        });
      }
    };
    clientCapabilities = {
      general: {
        markdown: {
          parser: "marked"
        }
      },
      textDocument: {
        completion: {
          completionItem: {
            snippetSupport: true,
            documentationFormat: ["markdown", "plaintext"],
            insertReplaceSupport: false
          },
          completionList: {
            itemDefaults: ["commitCharacters", "editRange", "insertTextFormat"]
          },
          completionItemKind: { valueSet: [] },
          contextSupport: true
        },
        hover: {
          contentFormat: ["markdown", "plaintext"]
        },
        formatting: {},
        rename: {},
        signatureHelp: {
          contextSupport: true,
          signatureInformation: {
            documentationFormat: ["markdown", "plaintext"],
            parameterInformation: { labelOffsetSupport: true },
            activeParameterSupport: true
          }
        },
        definition: {},
        declaration: {},
        implementation: {},
        typeDefinition: {},
        references: {},
        diagnostic: {}
      },
      window: {
        showMessage: {}
      }
    };
    WorkspaceMapping = class {
      /**
      @internal
      */
      constructor(client) {
        this.client = client;
        this.mappings = /* @__PURE__ */ new Map();
        this.startDocs = /* @__PURE__ */ new Map();
        for (let file of client.workspace.files) {
          this.mappings.set(file.uri, ChangeSet.empty(file.doc.length));
          this.startDocs.set(file.uri, file.doc);
        }
      }
      /**
      @internal
      */
      addChanges(uri, changes) {
        let known = this.mappings.get(uri);
        if (known)
          this.mappings.set(uri, known.composeDesc(changes));
      }
      /**
      Get the changes made to the document with the given URI since
      the mapping was created. Returns null for documents that aren't
      open.
      */
      getMapping(uri) {
        let known = this.mappings.get(uri);
        if (!known)
          return null;
        let file = this.client.workspace.getFile(uri), view = file === null || file === void 0 ? void 0 : file.getView(), plugin = view && LSPPlugin.get(view);
        return plugin ? known.composeDesc(plugin.unsyncedChanges) : known;
      }
      mapPos(uri, pos, assoc = -1, mode = MapMode.Simple) {
        let changes = this.getMapping(uri);
        return changes ? changes.mapPos(pos, assoc, mode) : pos;
      }
      mapPosition(uri, pos, assoc = -1, mode = MapMode.Simple) {
        let start = this.startDocs.get(uri);
        if (!start)
          throw new Error("Cannot map from a file that's not in the workspace");
        let off = fromPosition(start, pos);
        let changes = this.getMapping(uri);
        return changes ? changes.mapPos(off, assoc, mode) : off;
      }
      /**
      Disconnect this mapping from the client so that it will no
      longer be notified of new changes. You must make sure to call
      this on every mapping you create, except when you use
      [`withMapping`](https://codemirror.net/6/docs/ref/#lsp-client.LSPClient.withMapping), which will
      automatically schedule a disconnect when the given promise
      resolves or aborts.
      */
      destroy() {
        this.client.activeMappings = this.client.activeMappings.filter((m) => m != this);
      }
    };
    defaultNotificationHandlers = {
      "window/logMessage": (client, params) => {
        if (params.type == 1)
          console.error("[lsp] " + params.message);
        else if (params.type == 2)
          console.warn("[lsp] " + params.message);
      },
      "window/showMessage": (client, params) => {
        if (params.type > 3)
          return;
        let view;
        for (let f of client.workspace.files)
          if (view = f.getView())
            break;
        if (view)
          showDialog(view, {
            label: params.message,
            class: "cm-lsp-message cm-lsp-message-" + (params.type == 1 ? "error" : params.type == 2 ? "warning" : "info"),
            top: true
          });
      }
    };
    LSPClient = class {
      /**
      Create a client object.
      */
      constructor(config = {}) {
        var _a;
        this.config = config;
        this.transport = null;
        this.nextReqID = 0;
        this.requests = [];
        this.activeMappings = [];
        this.serverCapabilities = null;
        this.supportSync = -1;
        this.extensions = [];
        this.receiveMessage = this.receiveMessage.bind(this);
        this.initializing = new Promise((resolve, reject) => this.init = { resolve, reject });
        this.timeout = (_a = config.timeout) !== null && _a !== void 0 ? _a : 3e3;
        this.workspace = config.workspace ? config.workspace(this) : new DefaultWorkspace(this);
        if (config.extensions)
          for (let ext of config.extensions) {
            if (Array.isArray(ext) || ext.extension)
              this.extensions.push(ext);
            else if (ext.editorExtension)
              this.extensions.push(ext.editorExtension);
          }
      }
      /**
      Whether this client is connected (has a transport).
      */
      get connected() {
        return !!this.transport;
      }
      /**
      Connect this client to a server over the given transport. Will
      immediately start the initialization exchange with the server,
      and resolve `this.initializing` (which it also returns) when
      successful.
      */
      connect(transport) {
        if (this.transport)
          this.transport.unsubscribe(this.receiveMessage);
        this.transport = transport;
        transport.subscribe(this.receiveMessage);
        let capabilities = clientCapabilities;
        if (this.config.extensions)
          for (let ext of this.config.extensions) {
            let { clientCapabilities: clientCapabilities2 } = ext;
            if (clientCapabilities2)
              capabilities = mergeCapabilities(capabilities, clientCapabilities2);
          }
        this.requestInner("initialize", {
          processId: null,
          clientInfo: { name: "@codemirror/lsp-client" },
          rootUri: this.config.rootUri || null,
          initializationOptions: this.config.initializationOptions,
          capabilities
        }).promise.then((resp) => {
          var _a;
          this.serverCapabilities = resp.capabilities;
          let sync = resp.capabilities.textDocumentSync;
          this.supportSync = sync == null ? 0 : typeof sync == "number" ? sync : (_a = sync.change) !== null && _a !== void 0 ? _a : 0;
          transport.send(JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} }));
          this.init.resolve(null);
        }, this.init.reject);
        this.workspace.connected();
        return this;
      }
      /**
      Disconnect the client from the server.
      */
      disconnect() {
        if (this.transport)
          this.transport.unsubscribe(this.receiveMessage);
        this.serverCapabilities = null;
        this.initializing = new Promise((resolve, reject) => this.init = { resolve, reject });
        this.workspace.disconnected();
      }
      /**
      Create a plugin for this client, to add to an editor
      configuration. This extension is necessary to use LSP-related
      functionality exported by this package. The returned extension
      will include the editor
      extensions included in this client's
      [configuration](https://codemirror.net/6/docs/ref/#lsp-client.LSPClientConfig.extensions).
      
      Creating an editor with this plugin will cause
      [`openFile`](https://codemirror.net/6/docs/ref/#lsp-client.Workspace.openFile) to be called on the
      workspace.
      
      By default, the language ID given to the server for this file is
      derived from the editor's language configuration via
      [`Language.name`](https://codemirror.net/6/docs/ref/#language.Language.name). You can pass in
      a specific ID as a third parameter.
      */
      plugin(fileURI, languageID) {
        return [
          lspPlugin.of({ client: this, uri: fileURI, languageID }),
          lspTheme,
          this.extensions
        ];
      }
      /**
      Send a `textDocument/didOpen` notification to the server.
      */
      didOpen(file) {
        this.notification("textDocument/didOpen", {
          textDocument: {
            uri: file.uri,
            languageId: file.languageId,
            text: file.doc.toString(),
            version: file.version
          }
        });
      }
      /**
      Send a `textDocument/didClose` notification to the server.
      */
      didClose(uri) {
        this.notification("textDocument/didClose", { textDocument: { uri } });
      }
      receiveMessage(msg) {
        var _a;
        const value = JSON.parse(msg);
        if ("id" in value && !("method" in value)) {
          let index = this.requests.findIndex((r) => r.id == value.id);
          if (index < 0) {
            console.warn(`[lsp] Received a response for non-existent request ${value.id}`);
          } else {
            let req = this.requests[index];
            clearTimeout(req.timeout);
            this.requests.splice(index, 1);
            if (value.error)
              req.reject(value.error);
            else
              req.resolve(value.result);
          }
        } else if (!("id" in value)) {
          let handler = (_a = this.config.notificationHandlers) === null || _a === void 0 ? void 0 : _a[value.method];
          if (handler && handler(this, value.params))
            return;
          if (this.config.extensions)
            for (let ext of this.config.extensions) {
              let { notificationHandlers } = ext;
              let handler2 = notificationHandlers === null || notificationHandlers === void 0 ? void 0 : notificationHandlers[value.method];
              if (handler2 && handler2(this, value.params))
                return;
            }
          let deflt = defaultNotificationHandlers[value.method];
          if (deflt)
            deflt(this, value.params);
          else if (this.config.unhandledNotification)
            this.config.unhandledNotification(this, value.method, value.params);
        } else {
          let resp = {
            jsonrpc: "2.0",
            id: value.id,
            error: { code: -32601, message: "Method not implemented" }
          };
          this.transport.send(JSON.stringify(resp));
        }
      }
      /**
      Make a request to the server. Returns a promise that resolves to
      the response or rejects with a failure message. You'll probably
      want to use types from the `vscode-languageserver-protocol`
      package for the type parameters.
      
      The caller is responsible for
      [synchronizing](https://codemirror.net/6/docs/ref/#lsp-client.LSPClient.sync) state before the
      request and correctly handling state drift caused by local
      changes that happend during the request.
      */
      request(method, params) {
        if (!this.transport)
          return Promise.reject(new Error("Client not connected"));
        return this.initializing.then(() => this.requestInner(method, params).promise);
      }
      requestInner(method, params, mapped = false) {
        let id = ++this.nextReqID, data = {
          jsonrpc: "2.0",
          id,
          method,
          params
        };
        let req = new Request(id, params, setTimeout(() => this.timeoutRequest(req), this.timeout));
        this.requests.push(req);
        try {
          this.transport.send(JSON.stringify(data));
        } catch (e) {
          req.reject(e);
        }
        return req;
      }
      /**
      Send a notification to the server.
      */
      notification(method, params) {
        if (!this.transport)
          return;
        this.initializing.then(() => {
          let data = {
            jsonrpc: "2.0",
            method,
            params
          };
          this.transport.send(JSON.stringify(data));
        });
      }
      /**
      Cancel the in-progress request with the given parameter value
      (which is compared by identity).
      */
      cancelRequest(params) {
        let found = this.requests.find((r) => r.params === params);
        if (found)
          this.notification("$/cancelRequest", { id: found.id });
      }
      /**
      @internal
      */
      hasCapability(name2) {
        return this.serverCapabilities ? !!this.serverCapabilities[name2] : null;
      }
      /**
      Create a [workspace mapping](https://codemirror.net/6/docs/ref/#lsp-client.WorkspaceMapping) that
      tracks changes to files in this client's workspace, relative to
      the moment where it was created. Make sure you call
      [`destroy`](https://codemirror.net/6/docs/ref/#lsp-client.WorkspaceMapping.destroy) on the mapping
      when you're done with it.
      */
      workspaceMapping() {
        let mapping = new WorkspaceMapping(this);
        this.activeMappings.push(mapping);
        return mapping;
      }
      /**
      Run the given promise with a [workspace
      mapping](https://codemirror.net/6/docs/ref/#lsp-client.WorkspaceMapping) active. Automatically
      release the mapping when the promise resolves or rejects.
      */
      withMapping(f) {
        let mapping = this.workspaceMapping();
        return f(mapping).finally(() => mapping.destroy());
      }
      /**
      Push any [pending changes](https://codemirror.net/6/docs/ref/#lsp-client.Workspace.syncFiles) in
      the open files to the server. You'll want to call this before
      most types of requests, to make sure the server isn't working
      with outdated information.
      */
      sync() {
        for (let { file, changes, prevDoc } of this.workspace.syncFiles()) {
          for (let mapping of this.activeMappings)
            mapping.addChanges(file.uri, changes);
          if (this.supportSync)
            this.notification("textDocument/didChange", {
              textDocument: { uri: file.uri, version: file.version },
              contentChanges: contentChangesFor(
                file,
                prevDoc,
                changes,
                this.supportSync == 2
                /* Incremental */
              )
            });
        }
      }
      timeoutRequest(req) {
        let index = this.requests.indexOf(req);
        if (index > -1) {
          req.reject(new Error("Request timed out"));
          this.requests.splice(index, 1);
        }
      }
    };
    completionConfig = /* @__PURE__ */ Facet.define({
      combine: (results) => results.length ? results[0] : { validFor: null }
    });
    serverCompletionSource = (context2) => {
      const plugin = context2.view && LSPPlugin.get(context2.view);
      if (!plugin)
        return null;
      let triggerChar = context2.state.sliceDoc(context2.pos - 1, context2.pos);
      let triggerReason = context2.explicit ? "invoked" : shouldTriggerCompletion(plugin, triggerChar);
      if (!triggerReason)
        return null;
      let completionContext = triggerReason == "triggerCharacter" ? { triggerKind: 2, triggerCharacter: triggerChar } : {
        triggerKind: 1
        /* Invoked */
      };
      return getCompletions(plugin, context2.pos, completionContext, context2).then((result) => {
        var _a, _b;
        if (!result)
          return null;
        if (Array.isArray(result))
          result = { items: result };
        let { from, to } = completionResultRange(context2, result);
        let defaultCommitChars = (_a = result.itemDefaults) === null || _a === void 0 ? void 0 : _a.commitCharacters;
        let config = context2.state.facet(completionConfig);
        let extraEdits = [];
        return {
          from,
          to,
          options: result.items.map((item, i) => {
            var _a2, _b2, _c;
            let text = ((_a2 = item.textEdit) === null || _a2 === void 0 ? void 0 : _a2.newText) || item.textEditText || item.insertText || item.label;
            let option = {
              label: item.filterText || item.label,
              displayLabel: item.label,
              type: item.kind && kindToType[item.kind]
            };
            let insertTextFormat = (_b2 = item.insertTextFormat) !== null && _b2 !== void 0 ? _b2 : (_c = result.itemDefaults) === null || _c === void 0 ? void 0 : _c.insertTextFormat;
            if (item.commitCharacters && item.commitCharacters != defaultCommitChars)
              option.commitCharacters = item.commitCharacters;
            if (item.detail)
              option.detail = item.detail;
            if (item.sortText)
              option.sortText = item.sortText;
            if (insertTextFormat == 2) {
              option.apply = (view, c, from2, to2) => snippet(lspToSnippet(text))(view, c, from2, to2);
            } else if (item.additionalTextEdits) {
              let edits = [];
              for (let edit2 of item.additionalTextEdits) {
                let from2 = fromPositionChecked(context2.state.doc, edit2.range.start);
                let to2 = fromPositionChecked(context2.state.doc, edit2.range.end);
                if (from2 != null && to2 != null)
                  edits.push({ from: from2, to: to2, text: edit2.newText });
              }
              extraEdits.push({ index: i, text, edits });
              option.apply = applyEdits(edits, text, null);
            } else if (option.label != text) {
              option.apply = text;
            }
            if (item.documentation)
              option.info = () => renderDocInfo(plugin, item.documentation);
            return option;
          }),
          commitCharacters: defaultCommitChars,
          validFor: result.isIncomplete ? void 0 : (_b = config.validFor) !== null && _b !== void 0 ? _b : prefixRegexp(result.items),
          map: extraEdits.length ? resultMapper(null, extraEdits) : void 0
        };
      }, (err) => {
        if ("code" in err && err.code == -32800)
          return null;
        throw err;
      });
    };
    kindToType = {
      1: "text",
      // Text
      2: "method",
      // Method
      3: "function",
      // Function
      4: "class",
      // Constructor
      5: "property",
      // Field
      6: "variable",
      // Variable
      7: "class",
      // Class
      8: "interface",
      // Interface
      9: "namespace",
      // Module
      10: "property",
      // Property
      11: "keyword",
      // Unit
      12: "constant",
      // Value
      13: "constant",
      // Enum
      14: "keyword",
      // Keyword
      16: "constant",
      // Color
      20: "constant",
      // EnumMember
      21: "constant",
      // Constant
      22: "class",
      // Struct
      25: "type"
      // TypeParameter
    };
    formatDocument = (view) => {
      const plugin = LSPPlugin.get(view);
      if (!plugin)
        return false;
      plugin.client.sync();
      plugin.client.withMapping((mapping) => getFormatting(plugin, {
        tabSize: getIndentUnit(view.state),
        insertSpaces: view.state.facet(indentUnit).indexOf("	") < 0
      }).then((response) => {
        if (!response)
          return;
        let changed = mapping.getMapping(plugin.uri);
        let changes = [];
        for (let change of response) {
          let from = mapping.mapPosition(plugin.uri, change.range.start);
          let to = mapping.mapPosition(plugin.uri, change.range.end);
          if (changed) {
            if (changed.touchesRange(from, to))
              return;
            from = changed.mapPos(from, 1);
            to = changed.mapPos(to, -1);
          }
          changes.push({ from, to, insert: change.newText });
        }
        view.dispatch({
          changes,
          userEvent: "format"
        });
      }, (err) => {
        plugin.reportError("Formatting request failed", err);
      }));
      return true;
    };
    formatKeymap = [
      { key: "Shift-Alt-f", run: formatDocument, preventDefault: true }
    ];
    renameSymbol = (view) => {
      let wordRange = view.state.wordAt(view.state.selection.main.head);
      let plugin = LSPPlugin.get(view);
      if (!wordRange || !plugin || plugin.client.hasCapability("renameProvider") === false)
        return false;
      const word = view.state.sliceDoc(wordRange.from, wordRange.to);
      let panel = getDialog(view, "cm-lsp-rename-panel");
      if (panel) {
        let input = panel.dom.querySelector("[name=name]");
        input.value = word;
        input.select();
      } else {
        let { close, result } = showDialog(view, {
          label: view.state.phrase("New name"),
          input: { name: "name", value: word },
          focus: true,
          submitLabel: view.state.phrase("rename"),
          class: "cm-lsp-rename-panel"
        });
        result.then((form) => {
          view.dispatch({ effects: close });
          if (form)
            doRename(view, form.elements.namedItem("name").value);
        });
      }
      return true;
    };
    renameKeymap = [
      { key: "F2", run: renameSymbol, preventDefault: true }
    ];
    signaturePlugin = /* @__PURE__ */ ViewPlugin.fromClass(class {
      constructor() {
        this.activeRequest = null;
        this.delayedRequest = 0;
      }
      update(update) {
        var _a;
        if (this.activeRequest) {
          if (update.selectionSet) {
            this.activeRequest.drop = true;
            this.activeRequest = null;
          } else if (update.docChanged) {
            this.activeRequest.pos = update.changes.mapPos(this.activeRequest.pos);
          }
        }
        const plugin = LSPPlugin.get(update.view);
        if (!plugin)
          return;
        const sigState = update.view.state.field(signatureState);
        let triggerCharacter = "";
        if (update.docChanged && update.transactions.some((tr) => tr.isUserEvent("input.type"))) {
          const serverConf = (_a = plugin.client.serverCapabilities) === null || _a === void 0 ? void 0 : _a.signatureHelpProvider;
          const triggers = ((serverConf === null || serverConf === void 0 ? void 0 : serverConf.triggerCharacters) || []).concat(sigState && (serverConf === null || serverConf === void 0 ? void 0 : serverConf.retriggerCharacters) || []);
          if (triggers) {
            update.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
              let ins = inserted.toString();
              if (ins)
                for (let ch of triggers) {
                  if (ins.indexOf(ch) > -1)
                    triggerCharacter = ch;
                }
            });
          }
        }
        if (triggerCharacter) {
          this.startRequest(plugin, {
            triggerKind: 2,
            isRetrigger: !!sigState,
            triggerCharacter,
            activeSignatureHelp: sigState ? sigState.data : void 0
          });
        } else if (sigState && update.selectionSet) {
          if (this.delayedRequest)
            clearTimeout(this.delayedRequest);
          this.delayedRequest = setTimeout(() => {
            this.startRequest(plugin, {
              triggerKind: 3,
              isRetrigger: true,
              activeSignatureHelp: sigState.data
            });
          }, 250);
        }
      }
      startRequest(plugin, context2) {
        if (this.delayedRequest)
          clearTimeout(this.delayedRequest);
        let { view } = plugin, pos = view.state.selection.main.head;
        if (this.activeRequest)
          this.activeRequest.drop = true;
        let req = this.activeRequest = { pos, drop: false };
        getSignatureHelp(plugin, pos, context2).then((result) => {
          var _a;
          if (req.drop)
            return;
          if (result && result.signatures.length) {
            let cur = view.state.field(signatureState);
            let same = cur && sameSignatures(cur.data, result);
            let active = same && context2.triggerKind == 3 ? cur.active : (_a = result.activeSignature) !== null && _a !== void 0 ? _a : 0;
            if (same && sameActiveParam(cur.data, result, active))
              return;
            view.dispatch({ effects: signatureEffect.of({
              data: result,
              active,
              pos: same ? cur.tooltip.pos : req.pos
            }) });
          } else if (view.state.field(signatureState)) {
            view.dispatch({ effects: signatureEffect.of(null) });
          }
        }, context2.triggerKind == 1 ? (err) => plugin.reportError("Signature request failed", err) : void 0);
      }
      destroy() {
        if (this.delayedRequest)
          clearTimeout(this.delayedRequest);
        if (this.activeRequest)
          this.activeRequest.drop = true;
      }
    });
    SignatureState = class {
      constructor(data, active, tooltip) {
        this.data = data;
        this.active = active;
        this.tooltip = tooltip;
      }
    };
    signatureState = /* @__PURE__ */ StateField.define({
      create() {
        return null;
      },
      update(sig, tr) {
        for (let e of tr.effects)
          if (e.is(signatureEffect)) {
            if (e.value) {
              return new SignatureState(e.value.data, e.value.active, signatureTooltip(e.value.data, e.value.active, e.value.pos));
            } else {
              return null;
            }
          }
        if (sig && tr.docChanged)
          return new SignatureState(sig.data, sig.active, { ...sig.tooltip, pos: tr.changes.mapPos(sig.tooltip.pos) });
        return sig;
      },
      provide: (f) => showTooltip.from(f, (sig) => sig && sig.tooltip)
    });
    signatureEffect = /* @__PURE__ */ StateEffect.define();
    showSignatureHelp = (view) => {
      let plugin = view.plugin(signaturePlugin);
      if (!plugin) {
        view.dispatch({ effects: StateEffect.appendConfig.of([signatureState, signaturePlugin]) });
        plugin = view.plugin(signaturePlugin);
      }
      let field = view.state.field(signatureState);
      if (!plugin || field === void 0)
        return false;
      let lspPlugin2 = LSPPlugin.get(view);
      if (!lspPlugin2)
        return false;
      plugin.startRequest(lspPlugin2, {
        triggerKind: 1,
        activeSignatureHelp: field ? field.data : void 0,
        isRetrigger: !!field
      });
      return true;
    };
    nextSignature = (view) => {
      let field = view.state.field(signatureState);
      if (!field)
        return false;
      if (field.active < field.data.signatures.length - 1)
        view.dispatch({ effects: signatureEffect.of({ data: field.data, active: field.active + 1, pos: field.tooltip.pos }) });
      return true;
    };
    prevSignature = (view) => {
      let field = view.state.field(signatureState);
      if (!field)
        return false;
      if (field.active > 0)
        view.dispatch({ effects: signatureEffect.of({ data: field.data, active: field.active - 1, pos: field.tooltip.pos }) });
      return true;
    };
    signatureKeymap = [
      { key: "Mod-Shift-Space", run: showSignatureHelp },
      { key: "Mod-Shift-ArrowUp", run: prevSignature },
      { key: "Mod-Shift-ArrowDown", run: nextSignature }
    ];
    jumpToDefinition = (view) => jumpToOrigin(view, {
      get: getDefinition,
      capability: "definitionProvider"
    });
    jumpToDeclaration = (view) => jumpToOrigin(view, {
      get: getDeclaration,
      capability: "declarationProvider"
    });
    jumpToTypeDefinition = (view) => jumpToOrigin(view, {
      get: getTypeDefinition,
      capability: "typeDefinitionProvider"
    });
    jumpToImplementation = (view) => jumpToOrigin(view, {
      get: getImplementation,
      capability: "implementationProvider"
    });
    jumpToDefinitionKeymap = [
      { key: "F12", run: jumpToDefinition, preventDefault: true }
    ];
    findReferences = (view) => {
      const plugin = LSPPlugin.get(view);
      if (!plugin || plugin.client.hasCapability("referencesProvider") === false)
        return false;
      plugin.client.sync();
      let mapping = plugin.client.workspaceMapping(), passedMapping = false;
      getReferences(plugin, view.state.selection.main.head).then((response) => {
        if (!response)
          return;
        return Promise.all(response.map((loc) => plugin.client.workspace.requestFile(loc.uri).then((file) => {
          return file ? { file, range: loc.range } : null;
        }))).then((resolved) => {
          let locs = resolved.filter((l) => l);
          if (locs.length) {
            displayReferences(plugin.view, locs, mapping);
            passedMapping = true;
          }
        });
      }, (err) => plugin.reportError("Finding references failed", err)).finally(() => {
        if (!passedMapping)
          mapping.destroy();
      });
      return true;
    };
    closeReferencePanel = (view) => {
      if (!view.state.field(referencePanel, false))
        return false;
      view.dispatch({ effects: setReferencePanel.of(null) });
      return true;
    };
    referencePanel = /* @__PURE__ */ StateField.define({
      create() {
        return null;
      },
      update(panel, tr) {
        for (let e of tr.effects)
          if (e.is(setReferencePanel))
            return e.value;
        return panel;
      },
      provide: (f) => showPanel.from(f)
    });
    setReferencePanel = /* @__PURE__ */ StateEffect.define();
    findReferencesKeymap = [
      { key: "Shift-F12", run: findReferences, preventDefault: true },
      { key: "Escape", run: closeReferencePanel }
    ];
    autoSync = /* @__PURE__ */ ViewPlugin.fromClass(class {
      constructor() {
        this.pending = -1;
      }
      update(update) {
        if (update.docChanged) {
          if (this.pending > -1)
            clearTimeout(this.pending);
          this.pending = setTimeout(() => {
            this.pending = -1;
            let plugin = LSPPlugin.get(update.view);
            if (plugin)
              plugin.client.sync();
          }, 500);
        }
      }
      destroy() {
        if (this.pending > -1)
          clearTimeout(this.pending);
      }
    });
  }
});

// src/client/index.jsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);
var import_react6 = __toESM(require("react"), 1);

// src/contract/index.js
var SLOT_KEYS = Object.freeze({
  /** The contract bridge: the codeintel puts a component here, the core hands it the contract as a prop. */
  editorBridge: "ide-workbench.editor.bridge",
  /** The entries of the status bar. */
  statusItem: "ide-workbench.status.item",
  /** The groups of the settings page. */
  settingsSection: "ide-workbench.settings.section",
  /** The editor commands (context menu / command palette). */
  commandItem: "ide-workbench.command.item"
});
var CODEINTEL_PRIORITY = 100;

// src/client/i18n.js
var NS = "dsh-ide-codeintel";
var en = {
  "settings.findUsagesShortcut": "Find usages (semantic)",
  "settings.findUsagesShortcutHint": "List the semantic references of the symbol at the cursor",
  "settings.findUsagesTextShortcut": "Find usages (text)",
  "settings.findUsagesTextShortcutHint": "Text search for the symbol at the cursor; always available",
  "settings.goToDefinitionShortcut": "Go to definition",
  "settings.goToDefinitionShortcutHint": "Jump to the definition of the symbol at the cursor",
  "settings.completeShortcut": "Trigger completion",
  "settings.completeShortcutHint": "Open the completion popup by hand",
  "settings.lspGroup": "Semantic analysis",
  "settings.lspGroupHint": "Language servers provide semantic completion, go to definition and find usages. Without one the workbench keeps its basic mode (local completion and text search). Once it is on, the memory a language server needs is estimated per language, and a tight budget is asked about before the server starts.",
  "settings.lspEnabled": "Build a code index",
  "settings.lspEnabledHint": "With this off no language server is started: hovering, semantic completion and go to definition are unavailable, and the workbench does not ask when a project is opened. Turning it off ends the running index processes immediately and releases their memory.",
  "settings.lspIndexOnOpen": "When opening an unindexed folder",
  "settings.lspIndexOnOpenHint": "The first build of a project can take one or two minutes. The policy applies to every project; a project you put into the basic mode keeps it.",
  "settings.lspIndexAsk": "Ask me",
  "settings.lspIndexAlways": "Always index (unless the project is in the basic mode)",
  "settings.lspIndexNever": "Never index (basic mode only)",
  "settings.lspWorkspaceDefaultHint": 'This policy applies to every project. A project whose workspace you put into the basic mode keeps it - even with "always index". The choice is remembered per project and survives a restart.',
  "settings.lspMemoryLimit": "Language server memory limit (MB)",
  "settings.lspMemoryLimitHint": "The ceiling for all language servers at once: lowering it lowers every language, and raising it cannot push a language past its own built-in ceiling",
  "settings.lspFreeMemory": "Conservative fallback for free memory (MB)",
  "settings.lspFreeMemoryHint": "Only used when no memory estimate is available. With an estimate the threshold comes from the estimate, so a large value here does not block a start",
  "settings.lspHeadroom": "Memory headroom factor",
  "settings.lspHeadroomHint": "The estimate is multiplied by this factor. 1.5 means the language server may use about 1.5 times its baseline",
  "settings.lspHardFloor": "Hard memory floor (MB)",
  "settings.lspHardFloorHint": "Below this amount of free memory no language server is started at all",
  "settings.lspMemoryGroup": "Memory and thresholds",
  "settings.lspMemoryLimitShort": "The ceiling for every server",
  "settings.lspFreeMemoryShort": "The floor without an estimate",
  "settings.lspHeadroomShort": "The factor of the estimate",
  "settings.lspHardFloorShort": "Below this nothing starts",
  "settings.lspTimeoutGroup": "Timeouts and exit",
  "settings.lspIdleTimeoutShort": "Exit after this idle time",
  "settings.lspRequestTimeoutShort": "The limit of one request",
  "settings.lspMemoryNow": "Available now: {available} MB \xB7 {language} is expected to need {need} MB ({state}) \xB7 the server does not start below {threshold} MB \xB7 hard floor {floor} MB",
  "settings.lspMemoryNowNoProject": "Available now: {available} MB \xB7 no project is open, so there is no estimate yet",
  "settings.lspMemoryReserved": "The running language servers have reserved {reserved} MB of it - what they may still grow into (their ceiling minus what they already use), not what they already use.",
  "settings.lspMemoryState.ok": "can start",
  "settings.lspMemoryState.tight": "tight",
  "settings.lspMemoryState.low": "not enough",
  "settings.lspServersGroup": "Language servers",
  "settings.lspServersGroupHint": "Turn a language off to keep its language server from running",
  "settings.lspServerMemoryLimit": "Memory ceiling of this language (MB)",
  "settings.lspServerMemoryLimitHint": "Leave empty to use the global ceiling above; a number here replaces the global ceiling for this language and may be higher than it",
  "settings.lspServerRunning": "{count} language server process(es) are running; turning the switch off ends them immediately",
  "settings.lspIdlePolicy": "Idle policy",
  "settings.lspIdlePolicyShort": "When the server lets go by itself",
  "settings.lspIdlePolicyHint": '"Never exit" keeps the language server alive for good, "after an idle time" lets it go after the minutes below, and "only under memory pressure" lets it go when the machine runs short of memory',
  "settings.lspIdlePolicyNever": "Never exit",
  "settings.lspIdlePolicyAfter": "Exit after the idle time below",
  "settings.lspIdlePolicyMemory": "Only when the memory is tight",
  "settings.lspIdlePolicyAlways": "Exit after the idle time and under memory pressure",
  "settings.lspIdlePolicyNeverWarning": "A language server that never exits keeps about 1.8\u20132.2 GB of memory on a large project.",
  "settings.lspBudgetGroup": "Machine budget",
  "settings.lspBudgetRatio": "Share of the memory",
  "settings.lspBudgetRatioShort": "The share of the total memory the language servers may use together",
  "settings.lspBudgetRatioHint": "The budget of the machine is a share of its total memory (0.25 = a quarter) and the absolute cap below. The smaller of the two wins. The smallest share is 5 %.",
  "settings.lspBudgetCap": "Budget limit",
  "settings.lspBudgetCapShort": "The absolute limit of the budget, in MB",
  "settings.lspBudgetCapHint": "No matter how much memory the machine has, the language servers may not claim more than this together. 4096 MB holds about four TypeScript indexes.",
  "settings.lspMaxConcurrent": "Indexes at the same time",
  "settings.lspMaxConcurrentShort": "0 lets the budget decide",
  "settings.lspMaxConcurrentHint": "Your own limit on top of the budget: how many language servers may run at the same time. When both apply, the stricter one wins.",
  "settings.lspPressureYield": "Release on memory pressure",
  "settings.lspPressureYieldHint": "When the machine runs short of memory, the least active language server is released. This switch is the only way to turn the valve off.",
  "settings.lspIdleTimeout": "Idle exit (minutes)",
  "settings.lspIdleTimeoutHint": "The server exits after this much time without activity, and its memory is released",
  "settings.lspCancelAfter": "Cancel button after (seconds)",
  "settings.lspCancelAfterShort": "When the cancel button appears",
  "settings.lspCancelAfterHint": "The cancel button appears after the index has run this long; 60 seconds is the default",
  "settings.lspRequestTimeout": "Request timeout (ms)",
  "settings.lspRequestTimeoutHint": "Must stay at 30000 or above: a shorter timeout fails silently on a large project",
  "settings.lspAutoRestart": "Restart once after a crash",
  "settings.lspServersMissing": "Language servers not found",
  "settings.lspServersMissingHint": "Install them and make sure they are on PATH",
  "settings.lspOfflineNote": "An offline install does not include the bundled language servers: TypeScript, JavaScript and Python then need a language server on PATH.",
  "common.close": "Close",
  "common.cancel": "Cancel",
  "common.retry": "Retry",
  "common.loading": "Loading\u2026",
  "common.error": "Error",
  "search.title": "Find in Files",
  "search.placeholder": "Search the whole project",
  "search.empty": "Type to search every file in the project",
  "search.noResults": "No matches",
  "search.resultCount": "matches in files",
  "search.took": "ms",
  "search.truncated": "Results truncated",
  "search.caseSensitive": "Match case",
  "search.wholeWord": "Whole word",
  "search.regexp": "Regex",
  "search.cancel": "Cancel",
  "search.fileFilter": "File mask",
  "search.openResult": "Open result",
  "search.results": "Results",
  "search.searching": "Searching\u2026",
  "search.popup.hint": "\u2191\u2193 to change the file \xB7 Enter to open \xB7 Esc to close \xB7 double click to open",
  "search.popup.matches": "{count} matches in {files} files",
  "search.popup.matchCount": "{count} matches",
  "search.popup.files": "{count} files",
  "search.popup.preview": "Preview",
  "search.popup.binary": "This file is binary and cannot be previewed",
  "search.popup.noPreview": "No preview for this hit",
  "lsp.status.disabled": "Semantic analysis: off",
  "lsp.status.missing": "Semantic analysis: {language} not installed",
  "lsp.status.starting": "Semantic analysis: starting\u2026",
  "lsp.status.startingWait": "Semantic analysis: starting\u2026 (waited {minutes} min {seconds} s)",
  "lsp.status.restarting": "Semantic analysis: restarting\u2026",
  "lsp.status.restartingWait": "Semantic analysis: restarting\u2026 (waited {minutes} min {seconds} s)",
  "lsp.status.building": "Semantic analysis: indexing\u2026",
  "lsp.status.buildingProgram": "Semantic analysis: building the index\u2026 (the first semantic request may take minutes)",
  "lsp.status.cancelling": "Semantic analysis: cancelling\u2026",
  "lsp.status.updating": "Updating the index\u2026",
  "lsp.status.ready": "Semantic analysis: ready",
  "lsp.status.degraded": "Semantic analysis: basic mode",
  "lsp.status.failed": "Semantic analysis: failed to start",
  "lsp.status.idle": "Semantic analysis: not enabled (no language server)",
  "lsp.status.suspended": "Semantic analysis: suspended (memory saved)",
  "lsp.status.unknown": "Semantic analysis: unknown (retrying\u2026)",
  "lsp.status.crashed": "Semantic analysis: crashed",
  "lsp.status.cancelled": "Semantic analysis: cancelled (basic mode)",
  "lsp.status.workspaceOff": "Semantic analysis: not enabled for this project",
  "lsp.status.unstable": "Semantic analysis: unstable ({count} consecutive failures)",
  "lsp.status.unstableTimeout": "Semantic analysis: unstable ({count} consecutive timeouts)",
  "lsp.status.sessionFailed": "Semantic analysis: the session is not ready",
  "lsp.status.sessionConnecting": "Semantic analysis: connecting\u2026",
  "lsp.status.sessionIdle": "Semantic analysis: the session is not connected",
  "lsp.cancelIndex": "Cancel indexing",
  "lsp.statusTitle": "Semantic analysis status",
  "lsp.rebuildIndex": "Rebuild the index",
  "lsp.reconnect": "Reconnect",
  "lsp.sessionFailedToast": "The semantic analysis session could not be established.",
  "lsp.diagnostics.title": "Semantic analysis diagnostics",
  "lsp.diagnostics.state": "State",
  "lsp.diagnostics.health": "Failures / timeouts",
  "lsp.diagnostics.lastFailure": "Last failure",
  "lsp.diagnostics.reason": "Reason",
  "lsp.diagnostics.noFailure": "No failure was recorded.",
  "lsp.diagnostics.stderr": "Language server output",
  "lsp.diagnostics.noLogs": "The language server wrote nothing to its output.",
  "lsp.diagnostics.memory": "Memory",
  "lsp.diagnostics.memoryAvailable": "Available",
  "lsp.diagnostics.memoryNeed": "Needs",
  "lsp.diagnostics.memoryReserved": "Reserved",
  "lsp.diagnostics.memoryHint": "Available: the free memory of the machine minus what the running language servers may still grow into. Needs: the estimated memory of the next language server. Reserved: what the running language servers may still take - their ceiling minus what they already use, not their ceiling.",
  "lsp.diagnostics.memoryWorstCase": "Worst case",
  "lsp.diagnostics.memoryWorstText": "If this server takes its ceiling of {ceiling} MB, the machine will be left with {left} MB.",
  "lsp.diagnostics.memoryWorstHint": "The worst case: what the machine would be left with if the next language server grew into the ceiling it was granted. The number may be negative - that is the point of the row.",
  "lsp.diagnostics.memorySafeAvailable": "Pressure margin",
  "lsp.diagnostics.rebuild": "Rebuild the index",
  "lsp.diagnostics.degrade": "Use the basic mode",
  "lsp.diagnostics.degradeHint": "Stop the language server and keep the basic mode (local completion and text search)",
  "lsp.diagnostics.settings": "Open the settings",
  "lsp.diagnostics.settingsHint": "Open the semantic-analysis settings",
  "lsp.diagnostics.closed": "Semantic analysis is off.",
  "lsp.diagnostics.rebuilding": "Rebuilding the index\u2026",
  "lsp.diagnostics.healthy": "No failures",
  "lsp.memoryWarn.title": "Memory is tight",
  "lsp.memoryWarn.body": "{free} MB are available, {language} needs about {need} MB.",
  "lsp.memoryWarn.bodyUnknown": "{free} MB are available, the language server needs about {need} MB.",
  "lsp.memoryWarn.start": "Start anyway",
  "lsp.memoryWarn.conservative": "Use the basic mode",
  "lsp.memoryWarn.conservativeHint": "Do not start the language server (local completion and text search)",
  "lsp.workspaceBasicModeToast": "This workspace has not turned on the semantic analysis. You can turn it on for a project.",
  "lsp.workspaceConservativeToast": "You chose the basic mode for this project. You can turn the semantic analysis on for it at any time.",
  "lsp.workspaceOffHint": "You chose the basic mode for this project. You can turn the semantic analysis on for it at any time.",
  "index.decision.title": "Enable semantic analysis for {name}",
  "index.decision.body": "Starts the {language} language server and builds the project index. It takes about {time}.",
  "index.decision.bodyUnknown": "Starts the language server and builds the project index. It takes about {time}.",
  "index.decision.rootTitle": "This is the workspace root",
  "index.decision.rootWarning": "The workspace root usually contains several independent repositories. The language server treats them as one program, which raises memory usage and build time considerably. Switch to a specific subfolder first.",
  "index.decision.rootRepo": "This folder is a repository, but it may still be large. Enabling it here covers the whole repository.",
  "index.decision.build": "Enable",
  "index.decision.buildRoot": "Enable here anyway",
  "index.decision.conservative": "Do not enable",
  "index.decision.conservativeHint": "Switch the project, but keep the basic mode (local completion and text search)",
  "index.decision.cancel": "Cancel the switch",
  "index.decision.cancelHint": "Do not switch the project",
  "index.decision.time.under1": "1 minute or less",
  "index.decision.time.1to2": "1\u20132 minutes",
  "index.decision.time.2to5": "2\u20135 minutes",
  "index.decision.time.5to10": "5\u201310 minutes",
  "nav.goToDefinition": "Go to definition",
  "nav.findUsages": "Find usages (semantic)",
  "nav.findUsagesText": "Find usages (text)",
  "nav.textMatch": "Text match",
  "nav.usagesTitle": "Usages",
  "nav.usagesCount": "{count} usages",
  "nav.noUsages": "No usages found",
  "nav.semanticUnavailable": "The language server does not support finding usages.",
  "nav.semanticSessionUnavailable": "The semantic analysis session is not ready. Reconnect it from the status bar.",
  "nav.semanticSessionConnecting": "The semantic analysis session is still connecting.",
  "nav.semanticSessionIdle": "There is no semantic analysis session. The index can be built again from the status bar.",
  "lsp.lowMemory": "Not enough available memory (needs {need} MB, {free} MB available)",
  "lsp.lowMemoryHint": "Close the other programs, or use the basic mode for this language.",
  "lsp.crashedToast": "The language server exited.",
  "lsp.degradedToast": "Semantic analysis paused.",
  "lsp.crashedTimeout": "A request took too long. The limit of a single request can be raised in the settings.",
  "lsp.crashedMemory": "The machine ran out of memory. Close other programs, or use the basic mode for this language.",
  "lsp.crashedBudget": "The budget of the language servers is used up. Release a language server, or raise the budget in the settings - closing other programs does not help here.",
  "lsp.crashedGeneric": "The details are in the diagnostics panel.",
  "lsp.outsideProject": "That file is outside the workspace and cannot be opened.",
  "lsp.serverMissing": "No language server was found for {language}. Install it and make sure it is on PATH.",
  "lsp.degraded": "Semantic analysis is unavailable; the basic mode is used instead.",
  "codeintel.settingsTitle": "Code Intelligence",
  "codeintel.workbenchMissing": "Code intelligence needs the IDE workbench plugin",
  "codeintel.workbenchMissingHint": 'Install the "IDE Workbench" plugin to use semantic analysis, completion and find usages.',
  "codeintel.degradedTitle": "The IDE workbench plugin was not found",
  "codeintel.degradedBody": "Semantic analysis, completion and find usages stay switched off until the IDE workbench plugin is installed. No language server is started in the meantime.",
  "codeintel.versionMismatch": "The IDE workbench plugin is too old. Please update it to use the code intelligence.",
  "codeintel.standalone": "Standalone mode",
  "codeintel.standaloneHint": "Run the code intelligence without the IDE workbench plugin, using the working directory of the session as the project root."
};
var zh = {
  "settings.findUsagesShortcut": "\u67E5\u627E\u7528\u6CD5\uFF08\u8BED\u4E49\uFF09",
  "settings.findUsagesShortcutHint": "\u5217\u51FA\u5149\u6807\u5904\u7B26\u53F7\u7684\u8BED\u4E49\u5F15\u7528",
  "settings.findUsagesTextShortcut": "\u67E5\u627E\u7528\u6CD5\uFF08\u6587\u672C\uFF09",
  "settings.findUsagesTextShortcutHint": "\u6309\u5149\u6807\u5904\u7B26\u53F7\u505A\u6587\u672C\u641C\u7D22\uFF1B\u59CB\u7EC8\u53EF\u7528",
  "settings.goToDefinitionShortcut": "\u8DF3\u8F6C\u5B9A\u4E49",
  "settings.goToDefinitionShortcutHint": "\u8DF3\u5230\u5149\u6807\u5904\u7B26\u53F7\u7684\u5B9A\u4E49",
  "settings.completeShortcut": "\u624B\u52A8\u89E6\u53D1\u8865\u5168",
  "settings.completeShortcutHint": "\u624B\u52A8\u6253\u5F00\u8865\u5168\u5F39\u7A97",
  "settings.lspGroup": "\u8BED\u4E49\u5206\u6790",
  "settings.lspGroupHint": "\u8BED\u8A00\u670D\u52A1\u5668\u63D0\u4F9B\u8BED\u4E49\u8865\u5168\u3001\u8DF3\u8F6C\u5B9A\u4E49\u4E0E\u67E5\u627E\u5F15\u7528\u3002\u6CA1\u6709\u8BED\u8A00\u670D\u52A1\u5668\u65F6\u5DE5\u4F5C\u53F0\u4FDD\u6301\u4FDD\u5B88\u7248\uFF08\u672C\u5730\u8865\u5168 + \u6587\u672C\u641C\u7D22\uFF09\u3002\u5F00\u542F\u540E\u4F1A\u6309\u8BED\u8A00\u4F30\u7B97\u6240\u9700\u5185\u5B58\uFF0C\u5185\u5B58\u7D27\u5F20\u65F6\u5148\u8BE2\u95EE\u518D\u542F\u52A8\u3002",
  "settings.lspEnabled": "\u6784\u5EFA\u4EE3\u7801\u7D22\u5F15",
  "settings.lspEnabledHint": "\u5173\u95ED\u540E\u4E0D\u542F\u52A8\u4EFB\u4F55\u8BED\u8A00\u670D\u52A1\u5668\uFF0C\u60AC\u6D6E\u63D0\u793A\u3001\u8BED\u4E49\u8865\u5168\u4E0E\u8DF3\u8F6C\u5B9A\u4E49\u90FD\u4E0D\u53EF\u7528\uFF1B\u5207\u6362\u9879\u76EE\u65F6\u4E5F\u4E0D\u518D\u8BE2\u95EE\u3002\u5173\u95ED\u4F1A\u7ACB\u5373\u7ED3\u675F\u6B63\u5728\u8FD0\u884C\u7684\u7D22\u5F15\u8FDB\u7A0B\u5E76\u91CA\u653E\u5185\u5B58\u3002",
  "settings.lspIndexOnOpen": "\u6253\u5F00\u672A\u7D22\u5F15\u76EE\u5F55\u65F6",
  "settings.lspIndexOnOpenHint": "\u4E00\u4E2A\u9879\u76EE\u7684\u9996\u6B21\u6784\u5EFA\u53EF\u80FD\u9700\u8981\u4E00\u4E24\u5206\u949F\u3002\u8BE5\u7B56\u7565\u9002\u7528\u4E8E\u6240\u6709\u9879\u76EE\uFF1B\u4F60\u9009\u62E9\u8FC7\u57FA\u7840\u6A21\u5F0F\u7684\u9879\u76EE\u4F1A\u4FDD\u6301\u57FA\u7840\u6A21\u5F0F\u3002",
  "settings.lspIndexAsk": "\u8BE2\u95EE\u6211",
  "settings.lspIndexAlways": "\u603B\u662F\u7D22\u5F15\uFF08\u9664\u975E\u8BE5\u9879\u76EE\u5904\u4E8E\u57FA\u7840\u6A21\u5F0F\uFF09",
  "settings.lspIndexNever": "\u4ECE\u4E0D\u7D22\u5F15\uFF08\u4EC5\u4FDD\u5B88\u7248\uFF09",
  "settings.lspWorkspaceDefaultHint": "\u8BE5\u7B56\u7565\u9002\u7528\u4E8E\u6240\u6709\u9879\u76EE\u3002\u4F60\u9009\u62E9\u8FC7\u57FA\u7840\u6A21\u5F0F\u7684\u9879\u76EE\u4F1A\u4FDD\u6301\u57FA\u7840\u6A21\u5F0F \u2014\u2014 \u5373\u4F7F\u7B56\u7565\u662F\u300C\u603B\u662F\u7D22\u5F15\u300D\u3002\u8BE5\u9009\u62E9\u6309\u9879\u76EE\u8BB0\u4F4F\uFF0C\u91CD\u542F\u540E\u4ECD\u7136\u6709\u6548\u3002",
  "settings.lspMemoryLimit": "\u8BED\u8A00\u670D\u52A1\u5668\u5185\u5B58\u4E0A\u9650 (MB)",
  "settings.lspMemoryLimitHint": "\u6240\u6709\u8BED\u8A00\u670D\u52A1\u5668\u5171\u540C\u7684\u4E0A\u9650\uFF1A\u8C03\u4F4E\u5B83\u4F1A\u8BA9\u6BCF\u4E2A\u8BED\u8A00\u90FD\u7528\u66F4\u5C0F\u7684\u4E0A\u9650\uFF0C\u8C03\u9AD8\u5B83\u4E5F\u65E0\u6CD5\u8BA9\u67D0\u4E2A\u8BED\u8A00\u7A81\u7834\u81EA\u8EAB\u7684\u5185\u7F6E\u4E0A\u9650",
  "settings.lspFreeMemory": "\u4FDD\u5B88\u515C\u5E95\u4E0B\u9650 (MB)",
  "settings.lspFreeMemoryHint": "\u4EC5\u5728\u65E0\u6CD5\u4F30\u7B97\u5185\u5B58\u9700\u6C42\u65F6\u4F7F\u7528\u3002\u6709\u4F30\u7B97\u503C\u65F6\u542F\u52A8\u95E8\u69DB\u6765\u81EA\u4F30\u7B97\u503C\uFF0C\u56E0\u6B64\u628A\u5B83\u8C03\u5927\u4E0D\u4F1A\u963B\u6B62\u542F\u52A8",
  "settings.lspHeadroom": "\u5185\u5B58\u4F59\u91CF\u7CFB\u6570",
  "settings.lspHeadroomHint": "\u4F30\u7B97\u503C\u4F1A\u4E58\u4EE5\u8BE5\u7CFB\u6570\u30021.5 \u8868\u793A\u8BED\u8A00\u670D\u52A1\u5668\u53EF\u7528\u7EA6 1.5 \u500D\u57FA\u7EBF\u7684\u5185\u5B58",
  "settings.lspHardFloor": "\u5185\u5B58\u786C\u4E0B\u9650 (MB)",
  "settings.lspHardFloorHint": "\u53EF\u7528\u5185\u5B58\u4F4E\u4E8E\u8BE5\u503C\u65F6\uFF0C\u4EFB\u4F55\u8BED\u8A00\u670D\u52A1\u5668\u90FD\u4E0D\u4F1A\u542F\u52A8",
  "settings.lspMemoryGroup": "\u5185\u5B58\u4E0E\u9608\u503C",
  "settings.lspMemoryLimitShort": "\u6240\u6709\u670D\u52A1\u5668\u5171\u540C\u7684\u4E0A\u9650",
  "settings.lspFreeMemoryShort": "\u65E0\u6CD5\u4F30\u7B97\u65F6\u7684\u515C\u5E95\u4E0B\u9650",
  "settings.lspHeadroomShort": "\u4F30\u7B97\u503C\u7684\u500D\u6570",
  "settings.lspHardFloorShort": "\u4F4E\u4E8E\u6B64\u503C\u4E00\u5F8B\u4E0D\u542F\u52A8",
  "settings.lspTimeoutGroup": "\u8D85\u65F6\u4E0E\u9000\u51FA",
  "settings.lspIdleTimeoutShort": "\u65E0\u6D3B\u52A8\u540E\u81EA\u52A8\u9000\u51FA",
  "settings.lspRequestTimeoutShort": "\u5355\u6B21\u8BF7\u6C42\u7684\u4E0A\u9650",
  "settings.lspMemoryNow": "\u5F53\u524D\u53EF\u7528 {available} MB \xB7 {language} \u9884\u8BA1\u9700\u8981 {need} MB\uFF08{state}\uFF09\xB7 \u4F4E\u4E8E {threshold} MB \u4E0D\u542F\u52A8 \xB7 \u786C\u4E0B\u9650 {floor} MB",
  "settings.lspMemoryNowNoProject": "\u5F53\u524D\u53EF\u7528 {available} MB \xB7 \u5C1A\u672A\u6253\u5F00\u9879\u76EE\uFF0C\u6682\u65E0\u5185\u5B58\u4F30\u7B97",
  "settings.lspMemoryReserved": "\u8FD0\u884C\u4E2D\u7684\u8BED\u8A00\u670D\u52A1\u5668\u5DF2\u9884\u7559\u4E86 {reserved} MB \u2014\u2014 \u6309\u5B83\u4EEC\u300C\u8FD8\u53EF\u80FD\u518D\u6DA8\u300D\u7684\u90E8\u5206\u8BB0\u7684\u8D26\uFF08\u4E0A\u9650\u51CF\u53BB\u5DF2\u5B9E\u6D4B\u5360\u7528\uFF09\uFF0C\u4E0D\u662F\u5B83\u4EEC\u5DF2\u7ECF\u5360\u7528\u7684\u5185\u5B58\u3002",
  "settings.lspMemoryState.ok": "\u53EF\u542F\u52A8",
  "settings.lspMemoryState.tight": "\u5185\u5B58\u7D27\u5F20",
  "settings.lspMemoryState.low": "\u5185\u5B58\u4E0D\u8DB3",
  "settings.lspServersGroup": "\u8BED\u8A00\u670D\u52A1\u5668",
  "settings.lspServersGroupHint": "\u5173\u95ED\u67D0\u4E2A\u8BED\u8A00\u540E\uFF0C\u5B83\u7684\u8BED\u8A00\u670D\u52A1\u5668\u4E0D\u4F1A\u542F\u52A8",
  "settings.lspServerMemoryLimit": "\u8FD9\u4E2A\u8BED\u8A00\u7684\u5185\u5B58\u4E0A\u9650 (MB)",
  "settings.lspServerMemoryLimitHint": "\u7559\u7A7A\u5219\u4F7F\u7528\u4E0A\u9762\u7684\u5168\u5C40\u4E0A\u9650\uFF1B\u586B\u5165\u7684\u6570\u5B57\u4F1A\u66FF\u6362\u8FD9\u4E2A\u8BED\u8A00\u7684\u5168\u5C40\u4E0A\u9650\uFF0C\u53EF\u4EE5\u6BD4\u5168\u5C40\u4E0A\u9650\u66F4\u9AD8",
  "settings.lspServerRunning": "\u5F53\u524D\u6709 {count} \u4E2A\u8BED\u8A00\u670D\u52A1\u5668\u8FDB\u7A0B\u5728\u8FD0\u884C\uFF0C\u5173\u95ED\u5F00\u5173\u4F1A\u7ACB\u5373\u7ED3\u675F\u5B83\u4EEC",
  "settings.lspIdlePolicy": "\u7A7A\u95F2\u7B56\u7565",
  "settings.lspIdlePolicyShort": "\u670D\u52A1\u5668\u4F55\u65F6\u81EA\u884C\u9000\u51FA",
  "settings.lspIdlePolicyHint": "\u300C\u6C38\u4E0D\u9000\u51FA\u300D\u8BA9\u8BED\u8A00\u670D\u52A1\u5668\u4E00\u76F4\u6D3B\u7740\uFF1B\u300C\u7A7A\u95F2\u540E\u9000\u51FA\u300D\u5728\u4E0B\u9762\u7684\u5206\u949F\u6570\u4E4B\u540E\u653E\u6389\u5B83\uFF1B\u300C\u4EC5\u5185\u5B58\u7D27\u5F20\u65F6\u300D\u53EA\u5728\u673A\u5668\u5185\u5B58\u4E0D\u8DB3\u65F6\u653E\u6389\u5B83",
  "settings.lspIdlePolicyNever": "\u6C38\u4E0D\u9000\u51FA",
  "settings.lspIdlePolicyAfter": "\u5728\u4E0B\u9762\u7684\u7A7A\u95F2\u65F6\u95F4\u540E\u9000\u51FA",
  "settings.lspIdlePolicyMemory": "\u4EC5\u5728\u5185\u5B58\u7D27\u5F20\u65F6\u9000\u51FA",
  "settings.lspIdlePolicyAlways": "\u7A7A\u95F2\u540E\u9000\u51FA\uFF0C\u5E76\u5728\u5185\u5B58\u7D27\u5F20\u65F6\u91CA\u653E",
  "settings.lspBudgetGroup": "\u6574\u673A\u9884\u7B97",
  "settings.lspBudgetRatio": "\u5185\u5B58\u5360\u6BD4",
  "settings.lspBudgetRatioShort": "\u8BED\u8A00\u670D\u52A1\u5668\u5408\u8BA1\u53EF\u5360\u7528\u7684\u5185\u5B58\u6BD4\u4F8B",
  "settings.lspBudgetRatioHint": "\u6574\u673A\u9884\u7B97 = \u603B\u5185\u5B58\u7684\u8BE5\u6BD4\u4F8B\uFF080.25 = \u56DB\u5206\u4E4B\u4E00\uFF09\u4E0E\u4E0B\u9762\u7684\u7EDD\u5BF9\u4E0A\u9650\uFF0C\u4E24\u8005\u53D6\u66F4\u4E25\u8005\u3002\u6700\u5C0F\u6BD4\u4F8B\u4E3A 5%\u3002",
  "settings.lspBudgetCap": "\u9884\u7B97\u4E0A\u9650",
  "settings.lspBudgetCapShort": "\u9884\u7B97\u7684\u7EDD\u5BF9\u4E0A\u9650\uFF08MB\uFF09",
  "settings.lspBudgetCapHint": "\u65E0\u8BBA\u673A\u5668\u6709\u591A\u5C11\u5185\u5B58\uFF0C\u8BED\u8A00\u670D\u52A1\u5668\u5408\u8BA1\u4E0D\u5F97\u8D85\u8FC7\u8FD9\u4E2A\u989D\u5EA6\u30024096 MB \u5927\u7EA6\u5BB9\u7EB3\u56DB\u4E2A TypeScript \u7D22\u5F15\u3002",
  "settings.lspMaxConcurrent": "\u540C\u65F6\u5EFA\u7ACB\u7684\u7D22\u5F15",
  "settings.lspMaxConcurrentShort": "0 \u8868\u793A\u7531\u9884\u7B97\u51B3\u5B9A",
  "settings.lspMaxConcurrentHint": "\u9884\u7B97\u4E4B\u5916\u4F60\u81EA\u5DF1\u7684\u9650\u5236\uFF1A\u6700\u591A\u540C\u65F6\u8FD0\u884C\u591A\u5C11\u53F0\u8BED\u8A00\u670D\u52A1\u5668\u3002\u4E24\u8005\u540C\u65F6\u751F\u6548\u65F6\u53D6\u66F4\u4E25\u8005\u3002",
  "settings.lspPressureYield": "\u5185\u5B58\u7D27\u5F20\u65F6\u91CA\u653E",
  "settings.lspPressureYieldHint": "\u673A\u5668\u5185\u5B58\u7D27\u5F20\u65F6\uFF0C\u91CA\u653E\u6700\u4E0D\u6D3B\u8DC3\u7684\u8BED\u8A00\u670D\u52A1\u5668\u3002\u8BE5\u5F00\u5173\u662F\u5173\u95ED\u6B64\u4FDD\u62A4\u9600\u7684\u552F\u4E00\u65B9\u5F0F\u3002",
  "settings.lspIdlePolicyNeverWarning": "\u6C38\u4E0D\u9000\u51FA\u7684\u8BED\u8A00\u670D\u52A1\u5668\u5728\u5927\u9879\u76EE\u4E0A\u4F1A\u5E38\u9A7B\u7EA6 1.8\u20132.2 GB \u5185\u5B58\u3002",
  "settings.lspIdleTimeout": "\u7A7A\u95F2\u9000\u51FA (\u5206\u949F)",
  "settings.lspIdleTimeoutHint": "\u670D\u52A1\u5668\u5728\u8FD9\u4E48\u4E45\u6CA1\u6709\u6D3B\u52A8\u540E\u9000\u51FA\uFF0C\u5185\u5B58\u968F\u4E4B\u91CA\u653E",
  "settings.lspCancelAfter": "\u53D6\u6D88\u6309\u94AE\u51FA\u73B0\u65F6\u95F4 (\u79D2)",
  "settings.lspCancelAfterShort": "\u53D6\u6D88\u6309\u94AE\u4F55\u65F6\u51FA\u73B0",
  "settings.lspCancelAfterHint": "\u7D22\u5F15\u8FD0\u884C\u8FD9\u4E48\u4E45\u4E4B\u540E\u624D\u4F1A\u51FA\u73B0\u53D6\u6D88\u6309\u94AE\uFF1B\u9ED8\u8BA4 60 \u79D2",
  "settings.lspRequestTimeout": "\u8BF7\u6C42\u8D85\u65F6 (\u6BEB\u79D2)",
  "settings.lspRequestTimeoutHint": "\u5FC5\u987B\u4E0D\u4F4E\u4E8E 30000\uFF1A\u66F4\u77ED\u7684\u503C\u5728\u5927\u9879\u76EE\u4E0A\u4F1A\u9759\u9ED8\u5931\u8D25",
  "settings.lspAutoRestart": "\u5D29\u6E83\u540E\u81EA\u52A8\u91CD\u542F\u4E00\u6B21",
  "settings.lspServersMissing": "\u672A\u627E\u5230\u7684\u8BED\u8A00\u670D\u52A1\u5668",
  "settings.lspServersMissingHint": "\u8BF7\u5B89\u88C5\u5B83\u4EEC\u5E76\u786E\u4FDD\u5B83\u4EEC\u5728 PATH \u4E2D",
  "settings.lspOfflineNote": "\u79BB\u7EBF\u5B89\u88C5\u4E0D\u5305\u542B\u6253\u5305\u7684\u8BED\u8A00\u670D\u52A1\u5668\uFF1ATypeScript\u3001JavaScript \u4E0E Python \u9700\u8981 PATH \u4E0A\u6709\u5BF9\u5E94\u7684\u8BED\u8A00\u670D\u52A1\u5668\u3002",
  "common.close": "\u5173\u95ED",
  "common.cancel": "\u53D6\u6D88",
  "common.retry": "\u91CD\u8BD5",
  "common.loading": "\u52A0\u8F7D\u4E2D\u2026",
  "common.error": "\u9519\u8BEF",
  "search.title": "\u5168\u9879\u76EE\u67E5\u627E",
  "search.placeholder": "\u641C\u7D22\u6574\u4E2A\u9879\u76EE",
  "search.empty": "\u8F93\u5165\u5185\u5BB9\u4EE5\u641C\u7D22\u9879\u76EE\u4E2D\u7684\u5168\u90E8\u6587\u4EF6",
  "search.noResults": "\u6CA1\u6709\u5339\u914D",
  "search.resultCount": "\u5904\u5339\u914D\uFF0C\u4F4D\u4E8E\u6587\u4EF6",
  "search.took": "\u6BEB\u79D2",
  "search.truncated": "\u7ED3\u679C\u5DF2\u622A\u65AD",
  "search.caseSensitive": "\u533A\u5206\u5927\u5C0F\u5199",
  "search.wholeWord": "\u5168\u5B57\u5339\u914D",
  "search.regexp": "\u6B63\u5219",
  "search.cancel": "\u53D6\u6D88",
  "search.fileFilter": "\u6587\u4EF6\u63A9\u7801",
  "search.openResult": "\u6253\u5F00\u7ED3\u679C",
  "search.results": "\u7ED3\u679C",
  "search.searching": "\u641C\u7D22\u4E2D\u2026",
  "search.popup.hint": "\u2191\u2193 \u5207\u6362\u6587\u4EF6 \xB7 Enter \u6253\u5F00 \xB7 Esc \u5173\u95ED \xB7 \u53CC\u51FB\u6253\u5F00",
  "search.popup.matches": "{count} \u5904\u5339\u914D\uFF0C\u4F4D\u4E8E {files} \u4E2A\u6587\u4EF6",
  "search.popup.matchCount": "{count} \u5904\u5339\u914D",
  "search.popup.files": "{count} \u4E2A\u6587\u4EF6",
  "search.popup.preview": "\u9884\u89C8",
  "search.popup.binary": "\u8BE5\u6587\u4EF6\u662F\u4E8C\u8FDB\u5236\u6587\u4EF6\uFF0C\u65E0\u6CD5\u9884\u89C8",
  "search.popup.noPreview": "\u8BE5\u547D\u4E2D\u6CA1\u6709\u53EF\u9884\u89C8\u7684\u5185\u5BB9",
  "lsp.status.disabled": "\u8BED\u4E49\u5206\u6790\uFF1A\u5DF2\u5173\u95ED",
  "lsp.status.missing": "\u8BED\u4E49\u5206\u6790\uFF1A\u672A\u5B89\u88C5\uFF08{language}\uFF09",
  "lsp.status.starting": "\u8BED\u4E49\u5206\u6790\uFF1A\u542F\u52A8\u4E2D\u2026",
  "lsp.status.startingWait": "\u8BED\u4E49\u5206\u6790\uFF1A\u542F\u52A8\u4E2D\u2026\uFF08\u5DF2\u7B49\u5F85 {minutes} \u5206 {seconds} \u79D2\uFF09",
  "lsp.status.restarting": "\u8BED\u4E49\u5206\u6790\uFF1A\u91CD\u542F\u4E2D\u2026",
  "lsp.status.restartingWait": "\u8BED\u4E49\u5206\u6790\uFF1A\u91CD\u542F\u4E2D\u2026\uFF08\u5DF2\u7B49\u5F85 {minutes} \u5206 {seconds} \u79D2\uFF09",
  "lsp.status.building": "\u8BED\u4E49\u5206\u6790\uFF1A\u7D22\u5F15\u4E2D\u2026",
  "lsp.status.buildingProgram": "\u8BED\u4E49\u5206\u6790\uFF1A\u6B63\u5728\u6784\u5EFA\u7D22\u5F15\u2026\uFF08\u9996\u6B21\u8BED\u4E49\u8BF7\u6C42\u53EF\u80FD\u9700\u8981\u6570\u5206\u949F\uFF09",
  "lsp.status.cancelling": "\u8BED\u4E49\u5206\u6790\uFF1A\u53D6\u6D88\u4E2D\u2026",
  "lsp.status.updating": "\u6B63\u5728\u66F4\u65B0\u7D22\u5F15\u2026",
  "lsp.status.ready": "\u8BED\u4E49\u5206\u6790\uFF1A\u5C31\u7EEA",
  "lsp.status.degraded": "\u8BED\u4E49\u5206\u6790\uFF1A\u4FDD\u5B88\u7248",
  "lsp.status.failed": "\u8BED\u4E49\u5206\u6790\uFF1A\u542F\u52A8\u5931\u8D25",
  "lsp.status.idle": "\u8BED\u4E49\u5206\u6790\uFF1A\u672A\u542F\u7528\uFF08\u65E0\u8BED\u8A00\u670D\u52A1\u5668\uFF09",
  "lsp.status.suspended": "\u8BED\u4E49\u5206\u6790\uFF1A\u5DF2\u4F11\u7720\uFF08\u7701\u5185\u5B58\uFF09",
  "lsp.status.unknown": "\u8BED\u4E49\u5206\u6790\uFF1A\u72B6\u6001\u672A\u77E5\uFF08\u6B63\u5728\u91CD\u8BD5\u2026\uFF09",
  "lsp.status.crashed": "\u8BED\u4E49\u5206\u6790\uFF1A\u5DF2\u5D29\u6E83",
  "lsp.status.cancelled": "\u8BED\u4E49\u5206\u6790\uFF1A\u5DF2\u53D6\u6D88\uFF08\u4FDD\u5B88\u7248\uFF09",
  "lsp.status.workspaceOff": "\u8BED\u4E49\u5206\u6790\uFF1A\u672C\u9879\u76EE\u672A\u5F00\u542F",
  "lsp.status.unstable": "\u8BED\u4E49\u5206\u6790\uFF1A\u4E0D\u7A33\u5B9A\uFF08\u8FDE\u7EED\u5931\u8D25 {count} \u6B21\uFF09",
  "lsp.status.unstableTimeout": "\u8BED\u4E49\u5206\u6790\uFF1A\u4E0D\u7A33\u5B9A\uFF08\u8FDE\u7EED\u8D85\u65F6 {count} \u6B21\uFF09",
  "lsp.status.sessionFailed": "\u8BED\u4E49\u5206\u6790\uFF1A\u4F1A\u8BDD\u672A\u5C31\u7EEA",
  "lsp.status.sessionConnecting": "\u8BED\u4E49\u5206\u6790\uFF1A\u6B63\u5728\u8FDE\u63A5\u2026",
  "lsp.status.sessionIdle": "\u8BED\u4E49\u5206\u6790\uFF1A\u4F1A\u8BDD\u6CA1\u6709\u8FDE\u63A5",
  "lsp.cancelIndex": "\u53D6\u6D88\u7D22\u5F15",
  "lsp.statusTitle": "\u8BED\u4E49\u5206\u6790\u72B6\u6001",
  "lsp.rebuildIndex": "\u91CD\u65B0\u5EFA\u7ACB\u7D22\u5F15",
  "lsp.reconnect": "\u91CD\u65B0\u8FDE\u63A5",
  "lsp.sessionFailedToast": "\u8BED\u4E49\u5206\u6790\u4F1A\u8BDD\u672A\u80FD\u5EFA\u7ACB\u3002",
  "lsp.diagnostics.title": "\u8BED\u4E49\u5206\u6790\u8BCA\u65AD",
  "lsp.diagnostics.state": "\u5F53\u524D\u72B6\u6001",
  "lsp.diagnostics.health": "\u5931\u8D25 / \u8D85\u65F6\u6B21\u6570",
  "lsp.diagnostics.lastFailure": "\u6700\u8FD1\u5931\u8D25",
  "lsp.diagnostics.reason": "\u539F\u56E0",
  "lsp.diagnostics.noFailure": "\u6682\u65E0\u5931\u8D25\u8BB0\u5F55\u3002",
  "lsp.diagnostics.stderr": "\u8BED\u8A00\u670D\u52A1\u5668\u8F93\u51FA",
  "lsp.diagnostics.noLogs": "\u8BED\u8A00\u670D\u52A1\u5668\u6CA1\u6709\u8F93\u51FA\u4EFB\u4F55\u5185\u5BB9\u3002",
  "lsp.diagnostics.memory": "\u5185\u5B58",
  "lsp.diagnostics.memoryAvailable": "\u53EF\u7528",
  "lsp.diagnostics.memoryNeed": "\u9700\u8981",
  "lsp.diagnostics.memoryReserved": "\u5DF2\u9884\u7559",
  "lsp.diagnostics.memoryHint": "\u53EF\u7528\uFF1A\u6574\u673A\u7A7A\u95F2\u5185\u5B58\u51CF\u53BB\u8FD0\u884C\u4E2D\u7684\u8BED\u8A00\u670D\u52A1\u5668\u300C\u8FD8\u53EF\u80FD\u518D\u6DA8\u300D\u7684\u90E8\u5206\u3002\u9700\u8981\uFF1A\u4E0B\u4E00\u53F0\u8BED\u8A00\u670D\u52A1\u5668\u7684\u9884\u4F30\u5185\u5B58\u3002\u5DF2\u9884\u7559\uFF1A\u8FD0\u884C\u4E2D\u7684\u8BED\u8A00\u670D\u52A1\u5668\u8FD8\u80FD\u518D\u5403\u591A\u5C11\uFF08\u4E0A\u9650\u51CF\u53BB\u5DF2\u5B9E\u6D4B\u5360\u7528\uFF09\uFF0C\u4E0D\u662F\u5B83\u4EEC\u5DF2\u7ECF\u5360\u7528\u7684\u5185\u5B58\u3002",
  "lsp.diagnostics.memoryWorstCase": "\u6700\u574F\u60C5\u51B5",
  "lsp.diagnostics.memoryWorstText": "\u82E5\u8BE5\u670D\u52A1\u5668\u5403\u5230\u4E0A\u9650 {ceiling} MB\uFF0C\u673A\u5668\u5C06\u5269 {left} MB\u3002",
  "lsp.diagnostics.memoryWorstHint": "\u6700\u574F\u60C5\u51B5\uFF1A\u82E5\u4E0B\u4E00\u53F0\u8BED\u8A00\u670D\u52A1\u5668\u957F\u5230\u5B83\u88AB\u6388\u4E88\u7684\u4E0A\u9650\uFF0C\u673A\u5668\u5C06\u5269\u4E0B\u591A\u5C11\u5185\u5B58\u3002\u8BE5\u6570\u53EF\u80FD\u4E3A\u8D1F \u2014\u2014 \u8FD9\u6B63\u662F\u8FD9\u4E00\u884C\u7684\u610F\u4E49\u3002",
  "lsp.diagnostics.memorySafeAvailable": "\u538B\u529B\u4F59\u91CF",
  "lsp.diagnostics.rebuild": "\u91CD\u65B0\u5EFA\u7ACB\u7D22\u5F15",
  "lsp.diagnostics.degrade": "\u4F7F\u7528\u57FA\u7840\u6A21\u5F0F",
  "lsp.diagnostics.degradeHint": "\u505C\u6B62\u8BED\u8A00\u670D\u52A1\u5668\uFF0C\u4FDD\u6301\u57FA\u7840\u6A21\u5F0F\uFF08\u672C\u5730\u8865\u5168 + \u6587\u672C\u67E5\u627E\uFF09",
  "lsp.diagnostics.settings": "\u6253\u5F00\u8BBE\u7F6E",
  "lsp.diagnostics.settingsHint": "\u6253\u5F00\u8BED\u4E49\u5206\u6790\u7684\u8BBE\u7F6E",
  "lsp.diagnostics.closed": "\u8BED\u4E49\u5206\u6790\u5DF2\u5173\u95ED\u3002",
  "lsp.diagnostics.rebuilding": "\u6B63\u5728\u91CD\u5EFA\u7D22\u5F15\u2026",
  "lsp.diagnostics.healthy": "\u65E0\u5931\u8D25",
  "lsp.memoryWarn.title": "\u5185\u5B58\u7D27\u5F20",
  "lsp.memoryWarn.body": "\u5F53\u524D\u53EF\u7528 {free} MB\uFF0C{language} \u9884\u8BA1\u9700\u8981 {need} MB\u3002",
  "lsp.memoryWarn.bodyUnknown": "\u5F53\u524D\u53EF\u7528 {free} MB\uFF0C\u8BED\u8A00\u670D\u52A1\u5668\u9884\u8BA1\u9700\u8981 {need} MB\u3002",
  "lsp.memoryWarn.start": "\u4ECD\u7136\u542F\u52A8",
  "lsp.memoryWarn.conservative": "\u4F7F\u7528\u57FA\u7840\u6A21\u5F0F",
  "lsp.memoryWarn.conservativeHint": "\u4E0D\u542F\u52A8\u8BED\u8A00\u670D\u52A1\u5668\uFF08\u672C\u5730\u8865\u5168 + \u6587\u672C\u67E5\u627E\uFF09",
  "lsp.workspaceBasicModeToast": "\u672C\u5DE5\u4F5C\u533A\u672A\u5F00\u542F\u8BED\u4E49\u5206\u6790\uFF08\u53EF\u5728\u9879\u76EE\u4E0A\u5F00\u542F\uFF09\u3002",
  "lsp.workspaceConservativeToast": "\u4F60\u4E3A\u672C\u9879\u76EE\u9009\u62E9\u4E86\u57FA\u7840\u6A21\u5F0F\uFF0C\u968F\u65F6\u53EF\u91CD\u65B0\u5F00\u542F\u8BED\u4E49\u5206\u6790\u3002",
  "lsp.workspaceOffHint": "\u4F60\u4E3A\u672C\u9879\u76EE\u9009\u62E9\u4E86\u57FA\u7840\u6A21\u5F0F\uFF0C\u968F\u65F6\u53EF\u91CD\u65B0\u5F00\u542F\u8BED\u4E49\u5206\u6790\u3002",
  "index.decision.title": "\u4E3A {name} \u542F\u7528\u8BED\u4E49\u5206\u6790",
  "index.decision.body": "\u5C06\u542F\u52A8 {language} \u8BED\u8A00\u670D\u52A1\u5668\u5E76\u5EFA\u7ACB\u9879\u76EE\u7D22\u5F15\uFF0C\u9884\u8BA1 {time}\u3002",
  "index.decision.bodyUnknown": "\u5C06\u542F\u52A8\u8BED\u8A00\u670D\u52A1\u5668\u5E76\u5EFA\u7ACB\u9879\u76EE\u7D22\u5F15\uFF0C\u9884\u8BA1 {time}\u3002",
  "index.decision.rootTitle": "\u8FD9\u662F\u5DE5\u4F5C\u533A\u6839\u76EE\u5F55",
  "index.decision.rootWarning": "\u5DE5\u4F5C\u533A\u6839\u76EE\u5F55\u901A\u5E38\u5305\u542B\u591A\u4E2A\u72EC\u7ACB\u4ED3\u5E93\u3002\u8BED\u8A00\u670D\u52A1\u5668\u4F1A\u628A\u5B83\u4EEC\u5F53\u4F5C\u540C\u4E00\u4E2A\u7A0B\u5E8F\u5904\u7406\uFF0C\u5185\u5B58\u5360\u7528\u4E0E\u6784\u5EFA\u65F6\u95F4\u90FD\u4F1A\u660E\u663E\u589E\u52A0\u3002\u5EFA\u8BAE\u5148\u5207\u6362\u5230\u5177\u4F53\u5B50\u76EE\u5F55\u518D\u542F\u7528\u3002",
  "index.decision.rootRepo": "\u8BE5\u76EE\u5F55\u672C\u8EAB\u662F\u4E00\u4E2A\u4ED3\u5E93\uFF0C\u4F46\u4ECD\u53EF\u80FD\u5F88\u5927\u3002\u5728\u6B64\u542F\u7528\u4F1A\u8986\u76D6\u6574\u4E2A\u4ED3\u5E93\u3002",
  "index.decision.build": "\u542F\u7528",
  "index.decision.buildRoot": "\u5728\u6B64\u76EE\u5F55\u542F\u7528",
  "index.decision.conservative": "\u4E0D\u542F\u7528",
  "index.decision.conservativeHint": "\u5207\u6362\u9879\u76EE\uFF0C\u4F46\u4FDD\u6301\u57FA\u7840\u6A21\u5F0F\uFF08\u672C\u5730\u8865\u5168 + \u6587\u672C\u67E5\u627E\uFF09",
  "index.decision.cancel": "\u53D6\u6D88\u5207\u6362",
  "index.decision.cancelHint": "\u4E0D\u5207\u6362\u9879\u76EE",
  "index.decision.time.under1": "1 \u5206\u949F\u4EE5\u5185",
  "index.decision.time.1to2": "1\u20132 \u5206\u949F",
  "index.decision.time.2to5": "2\u20135 \u5206\u949F",
  "index.decision.time.5to10": "5\u201310 \u5206\u949F",
  "nav.goToDefinition": "\u8DF3\u8F6C\u5B9A\u4E49",
  "nav.findUsages": "\u67E5\u627E\u7528\u6CD5\uFF08\u8BED\u4E49\uFF09",
  "nav.findUsagesText": "\u67E5\u627E\u7528\u6CD5\uFF08\u6587\u672C\uFF09",
  "nav.textMatch": "\u6587\u672C\u5339\u914D",
  "nav.usagesTitle": "\u67E5\u627E\u7528\u6CD5",
  "nav.usagesCount": "{count} \u5904\u5F15\u7528",
  "nav.noUsages": "\u672A\u627E\u5230\u5F15\u7528",
  "nav.semanticUnavailable": "\u8BE5\u8BED\u8A00\u670D\u52A1\u5668\u4E0D\u652F\u6301\u67E5\u627E\u5F15\u7528\u3002",
  "nav.semanticSessionUnavailable": "\u8BED\u4E49\u5206\u6790\u4F1A\u8BDD\u5C1A\u672A\u5C31\u7EEA\uFF0C\u53EF\u5728\u72B6\u6001\u680F\u91CD\u65B0\u8FDE\u63A5\u3002",
  "nav.semanticSessionConnecting": "\u8BED\u4E49\u5206\u6790\u4F1A\u8BDD\u6B63\u5728\u8FDE\u63A5\u2026",
  "nav.semanticSessionIdle": "\u6CA1\u6709\u8BED\u4E49\u5206\u6790\u7684\u4F1A\u8BDD\u3002\u53EF\u4EE5\u5728\u72B6\u6001\u680F\u91CC\u91CD\u65B0\u5EFA\u7ACB\u7D22\u5F15\u3002",
  "lsp.lowMemory": "\u7CFB\u7EDF\u53EF\u7528\u5185\u5B58\u4E0D\u8DB3\uFF08\u9700\u8981 {need} MB\uFF0C\u53EF\u7528 {free} MB\uFF09",
  "lsp.lowMemoryHint": "\u8BF7\u5173\u95ED\u5176\u5B83\u7A0B\u5E8F\uFF0C\u6216\u5BF9\u8BE5\u8BED\u8A00\u6539\u7528\u4FDD\u5B88\u7248\u3002",
  "lsp.crashedToast": "\u8BED\u8A00\u670D\u52A1\u5668\u5DF2\u9000\u51FA\u3002",
  "lsp.degradedToast": "\u8BED\u4E49\u5206\u6790\u5DF2\u6682\u505C\u3002",
  "lsp.crashedTimeout": "\u67D0\u4E2A\u8BF7\u6C42\u8017\u65F6\u8FC7\u957F\u3002\u53EF\u5728\u8BBE\u7F6E\u91CC\u8C03\u9AD8\u300C\u5355\u6B21\u8BF7\u6C42\u7684\u4E0A\u9650\u300D\u3002",
  "lsp.crashedMemory": "\u673A\u5668\u53EF\u7528\u5185\u5B58\u4E0D\u8DB3\u3002\u8BF7\u5173\u95ED\u5176\u5B83\u7A0B\u5E8F\uFF0C\u6216\u5BF9\u8BE5\u8BED\u8A00\u6539\u7528\u4FDD\u5B88\u7248\u3002",
  "lsp.crashedBudget": "\u8BED\u8A00\u670D\u52A1\u5668\u7684\u5185\u5B58\u9884\u7B97\u5DF2\u7528\u5B8C\u3002\u8BF7\u91CA\u653E\u4E00\u53F0\u8BED\u8A00\u670D\u52A1\u5668\uFF0C\u6216\u5728\u8BBE\u7F6E\u91CC\u8C03\u9AD8\u9884\u7B97 \u2014\u2014 \u5173\u95ED\u5176\u5B83\u7A0B\u5E8F\u5728\u8FD9\u91CC\u5E2E\u4E0D\u4E0A\u5FD9\u3002",
  "lsp.crashedGeneric": "\u8BE6\u60C5\u89C1\u8BCA\u65AD\u9762\u677F\u3002",
  "lsp.outsideProject": "\u8BE5\u6587\u4EF6\u5728\u5DE5\u4F5C\u533A\u4E4B\u5916\uFF0C\u65E0\u6CD5\u6253\u5F00\u3002",
  "lsp.serverMissing": "\u672A\u627E\u5230 {language} \u7684\u8BED\u8A00\u670D\u52A1\u5668\u3002\u8BF7\u5B89\u88C5\u5B83\u5E76\u786E\u4FDD\u5B83\u5728 PATH \u4E2D\u3002",
  "lsp.degraded": "\u8BED\u4E49\u5206\u6790\u4E0D\u53EF\u7528\uFF0C\u5DF2\u6539\u7528\u4FDD\u5B88\u7248\u3002",
  "codeintel.settingsTitle": "\u4EE3\u7801\u667A\u80FD",
  "codeintel.workbenchMissing": "\u4EE3\u7801\u667A\u80FD\u9700\u8981 IDE \u5DE5\u4F5C\u53F0\u63D2\u4EF6",
  "codeintel.workbenchMissingHint": "\u5B89\u88C5\u300CIDE \u5DE5\u4F5C\u53F0\u300D\u63D2\u4EF6\u540E\u5373\u53EF\u4F7F\u7528\u8BED\u4E49\u5206\u6790\u3001\u8865\u5168\u4E0E\u67E5\u627E\u7528\u6CD5\u3002",
  "codeintel.degradedTitle": "\u672A\u68C0\u6D4B\u5230 IDE \u5DE5\u4F5C\u53F0\u63D2\u4EF6",
  "codeintel.degradedBody": "\u5728\u5B89\u88C5 IDE \u5DE5\u4F5C\u53F0\u63D2\u4EF6\u4E4B\u524D\uFF0C\u8BED\u4E49\u5206\u6790\u3001\u8865\u5168\u4E0E\u67E5\u627E\u7528\u6CD5\u4FDD\u6301\u5173\u95ED\uFF0C\u5176\u95F4\u4E0D\u4F1A\u542F\u52A8\u4EFB\u4F55\u8BED\u8A00\u670D\u52A1\u5668\u3002",
  "codeintel.versionMismatch": "IDE \u5DE5\u4F5C\u53F0\u63D2\u4EF6\u7248\u672C\u8FC7\u65E7\uFF0C\u8BF7\u5347\u7EA7\u540E\u518D\u4F7F\u7528\u4EE3\u7801\u667A\u80FD\u3002",
  "codeintel.standalone": "\u72EC\u7ACB\u8FD0\u884C",
  "codeintel.standaloneHint": "\u4E0D\u4F9D\u8D56 IDE \u5DE5\u4F5C\u53F0\u63D2\u4EF6\u8FD0\u884C\u4EE3\u7801\u667A\u80FD\uFF0C\u4EE5\u4F1A\u8BDD\u7684\u5DE5\u4F5C\u76EE\u5F55\u4F5C\u4E3A\u9879\u76EE\u6839\u3002"
};

// src/client/bridge.jsx
var import_react = __toESM(require("react"), 1);

// src/client/extensions.js
init_cm_autocomplete();
init_cm_view();

// src/client/lsp-lib.js
var library = null;
var pending = null;
function loadLspLibrary() {
  if (library !== null) return Promise.resolve(library);
  if (pending === null) {
    pending = Promise.resolve().then(() => (init_dist3(), dist_exports)).then(
      (module2) => {
        library = module2;
        return module2;
      },
      (error) => {
        pending = null;
        throw error;
      }
    );
  }
  return pending;
}
function lspLibrary() {
  return library;
}

// src/client/ctrl-hover.js
init_cm_state();
init_cm_view();
init_cm_language();
var IDENTIFIER_NODE_NAMES = /* @__PURE__ */ new Set([
  "Name",
  "VariableName",
  "FunctionName",
  "PropertyName",
  "ClassName",
  "TypeName",
  "LabelName",
  "TagName",
  "AttributeName",
  "Identifier",
  "VariableDefinition",
  "PrivatePropertyName",
  "JSXIdentifier",
  "MethodName",
  "ScopedIdentifier",
  "FieldName",
  "DefName",
  "TypeIdentifier",
  "FieldIdentifier",
  "ScopeIdentifier",
  "IdName",
  "PseudoClassName",
  "NamespaceName",
  "Label"
]);
var lazy = { field: null, effect: null, mark: null };
function ctrlHoverMark() {
  if (lazy.mark === null) lazy.mark = Decoration.mark({ class: "iwb-ctrl-hover-symbol" });
  return lazy.mark;
}
function setCtrlHover() {
  if (lazy.effect === null) lazy.effect = StateEffect.define();
  return lazy.effect;
}
function ctrlHoverField() {
  if (lazy.field === null) {
    const effect = setCtrlHover();
    const mark = ctrlHoverMark();
    lazy.field = StateField.define({
      create: () => Decoration.none,
      update(value, transaction) {
        let next = value.map(transaction.changes);
        for (const item of transaction.effects) {
          if (!item.is(effect)) continue;
          const range = item.value;
          next = range === null ? Decoration.none : Decoration.set([mark.range(range.from, range.to)]);
        }
        return next;
      },
      provide: (field) => EditorView.decorations.from(field)
    });
  }
  return lazy.field;
}
function identifierRangeAt(state, pos) {
  if (state === null || state === void 0) return null;
  if (!Number.isInteger(pos) || pos < 0 || pos > state.doc.length) return null;
  let node = null;
  try {
    const tree = ensureSyntaxTree(state, pos, 1e3);
    if (tree === null || tree === void 0) return null;
    node = tree.resolveInner(pos, 1);
  } catch {
    return null;
  }
  for (let depth = 0; node !== null && node !== void 0 && depth < 3; depth += 1) {
    if (IDENTIFIER_NODE_NAMES.has(node.name)) {
      if (node.to <= node.from) return null;
      return { from: node.from, to: node.to };
    }
    node = node.parent;
  }
  return null;
}
function identifierAt(state, pos) {
  const range = identifierRangeAt(state, pos);
  if (range === null) return null;
  return state.doc.sliceString(range.from, range.to);
}
function currentCtrlHover(state) {
  const field = ctrlHoverField();
  const value = state.field(field, false);
  if (value === void 0 || value === null || value.size === 0) return null;
  const first = value.iter();
  return { from: first.from, to: first.to };
}
function highlightCtrlHover(view, range) {
  if (view === null || view === void 0) return;
  const current = currentCtrlHover(view.state);
  const same = current === null && range === null || current !== null && range !== null && current.from === range.from && current.to === range.to;
  if (same) return;
  try {
    view.dispatch({ effects: setCtrlHover().of(range) });
  } catch {
  }
}
function ctrlHoverRangeAt(view, pointer) {
  if (pointer === null || pointer === void 0) return null;
  const pos = view.posAtCoords({ x: pointer.x, y: pointer.y });
  if (typeof pos !== "number") return null;
  return identifierRangeAt(view.state, pos);
}
function handleCtrlClick(event, view, options2 = {}) {
  if (event === null || event === void 0) return false;
  if (!(event.ctrlKey === true || event.metaKey === true)) return false;
  if (view === null || view === void 0) return false;
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (typeof pos !== "number") return false;
  if (identifierAt(view.state, pos) === null) return false;
  const library2 = lspLibrary();
  if (options2.requirePlugin !== false) {
    if (library2 === null || library2.LSPPlugin.get(view) === null) return false;
  }
  event.preventDefault();
  view.dispatch({ selection: { anchor: pos } });
  const trigger = options2.trigger ?? (library2 === null ? null : library2.jumpToDefinition);
  if (trigger !== null) trigger(view);
  return true;
}
function ctrlHoverExtensions() {
  let pointer = null;
  return [
    ctrlHoverField(),
    EditorView.domEventHandlers({
      mousemove: (event, view) => {
        pointer = { x: event.clientX, y: event.clientY };
        highlightCtrlHover(view, event.ctrlKey || event.metaKey ? ctrlHoverRangeAt(view, pointer) : null);
        return false;
      },
      mousedown: (event, view) => handleCtrlClick(event, view)
    })
  ];
}

// src/client/lsp-completion.js
init_cm_state();
init_cm_autocomplete();
function clampCompletionRange(range, context2) {
  const pos = context2?.pos ?? 0;
  const word = context2?.state?.wordAt?.(pos) ?? null;
  if (word === null || word === void 0) return { from: pos, to: pos };
  if (range.to <= word.from || range.from >= word.to) return { from: pos, to: pos };
  const from = Math.min(Math.max(range.from, word.from), word.to);
  const to = Math.max(Math.min(range.to, word.to), from);
  return { from, to };
}
function withoutCommitCharacters(option) {
  if (option === null || option === void 0 || typeof option !== "object") return option;
  if (option.commitCharacters === void 0) return option;
  const { commitCharacters, ...rest } = option;
  return rest;
}
function faithfulResult(result, context2) {
  if (result === null || result === void 0) return result;
  const range = clampCompletionRange({ from: result.from, to: result.to }, context2);
  const options2 = Array.isArray(result.options) ? result.options.map((option) => withoutCommitCharacters(option)) : result.options;
  return { ...result, from: range.from, to: range.to, commitCharacters: void 0, options: options2 };
}
function faithfulCompletionSource(source) {
  return (context2) => {
    const result = typeof source === "function" ? source(context2) : null;
    if (result === null || result === void 0) return result;
    if (typeof result.then !== "function") return faithfulResult(result, context2);
    return result.then((resolved) => faithfulResult(resolved, context2));
  };
}
function faithfulServerCompletionExtensions(source) {
  return [
    autocompletion(),
    EditorState.languageData.of(() => [{ autocomplete: faithfulCompletionSource(source) }])
  ];
}

// src/client/api.js
var API_PREFIX = "dsh-codeintel/api/";
var PLACEHOLDER = "http://dsh.internal/";
function transportBase() {
  const injected = globalThis.__DSH_TRANSPORT__?.streamBaseUrl;
  if (typeof injected === "string" && injected !== "") return injected;
  if (typeof document !== "undefined" && typeof document.baseURI === "string") return document.baseURI;
  return "";
}
function directoryBase(input) {
  const url = new URL(input === "" ? PLACEHOLDER : input, PLACEHOLDER);
  url.search = "";
  url.hash = "";
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.href;
}
function httpUrl(path) {
  const base = typeof document !== "undefined" ? document.baseURI : transportBase();
  return new URL(String(path).replace(/^\/+/, ""), directoryBase(base));
}
function wsUrl(path) {
  const url = new URL(String(path).replace(/^\/+/, ""), directoryBase(transportBase()));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url;
}
var ApiError = class extends Error {
  /**
   * @param {string} code the machine code of the host
   * @param {string} message the message of the host
   */
  constructor(code, message) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
};
async function call(method, payload = {}, signal) {
  let response;
  try {
    response = await fetch(httpUrl(`${API_PREFIX}${method}`).href, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError("network", error instanceof Error ? error.message : String(error));
  }
  let parsed = null;
  try {
    parsed = await response.json();
  } catch {
    throw new ApiError("http", `HTTP ${response.status}`);
  }
  if (!response.ok || parsed === null || parsed.ok !== true) {
    throw new ApiError(parsed?.error?.code ?? "http", parsed?.error?.message ?? `HTTP ${response.status}`);
  }
  return parsed.value;
}

// src/client/lsp-sanitize.js
var DANGEROUS_ELEMENTS = [
  "script",
  "iframe",
  "object",
  "embed",
  "applet",
  "frame",
  "frameset",
  "base",
  "meta",
  "link",
  "style"
];
var URL_ATTRIBUTES = /\b(href|src|xlink:href|action|formaction|poster|background|ping|data|srcset)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'<>`]+))/gi;
var DANGEROUS_SCHEME = /^(?:javascript|vbscript|livescript|mocha|data:text\/html)/i;
function decodeEntities(text) {
  return text.replace(/&#x([0-9a-f]+);/gi, (_match, hex) => {
    const code = Number.parseInt(hex, 16);
    try {
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    } catch {
      return "";
    }
  }).replace(/&#(\d+);/g, (_match, dec) => {
    const code = Number.parseInt(dec, 10);
    try {
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    } catch {
      return "";
    }
  });
}
function stripInvisible(text) {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code > 32) out += char;
  }
  return out;
}
function removeDangerousElements(html2) {
  let out = html2;
  for (const name2 of DANGEROUS_ELEMENTS) {
    out = out.replace(new RegExp(`<\\s*${name2}\\b[^>]*>[\\s\\S]*?<\\s*\\/\\s*${name2}\\s*>`, "gi"), "");
    out = out.replace(new RegExp(`<\\s*\\/\\s*${name2}\\s*>`, "gi"), "");
    out = out.replace(new RegExp(`<\\s*${name2}\\b[^>]*\\/?>`, "gi"), "");
  }
  return out;
}
function removeEventAttributes(html2) {
  return html2.replace(/\s+on[a-z0-9_-]+\s*=\s*"[^"]*"/gi, "").replace(/\s+on[a-z0-9_-]+\s*=\s*'[^']*'/gi, "").replace(/\s+on[a-z0-9_-]+\s*=\s*[^\s"'<>`]+/gi, "");
}
function neutralizeScriptUrls(html2) {
  const byAttribute = html2.replace(URL_ATTRIBUTES, (match, name2, _quoted, doubleQuoted, singleQuoted, bare) => {
    const raw = doubleQuoted ?? singleQuoted ?? bare ?? "";
    const decoded = stripInvisible(decodeEntities(raw));
    if (DANGEROUS_SCHEME.test(decoded)) return `${name2}="about:blank"`;
    return match;
  });
  return byAttribute.replace(/javascript\s*:/gi, "about:blank");
}
function sanitizeHTML(html2) {
  if (typeof html2 !== "string" || html2 === "") return "";
  return neutralizeScriptUrls(removeEventAttributes(removeDangerousElements(html2)));
}

// src/client/lsp-transport.js
var RETRY_BASE_MS = 500;
var RETRY_MAX_MS = 3e4;
function isControlEvent(text) {
  if (typeof text !== "string" || text === "") return null;
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  if (parsed.jsonrpc !== void 0) return null;
  if (typeof parsed.type !== "string") return null;
  return parsed;
}
function createLspTransport(options2 = {}) {
  const { url, onOpen, onClose, onError, onControl } = options2;
  const handlers = /* @__PURE__ */ new Set();
  const queue = [];
  let socket = null;
  let stopped = false;
  let attempt = 0;
  let retryTimer = null;
  let opened = 0;
  function resolveUrl() {
    const value = typeof url === "function" ? url() : url;
    if (value === void 0 || value === null) return "";
    return typeof value === "string" ? value : String(value);
  }
  function socketImpl() {
    if (typeof options2.WebSocketImpl === "function") return options2.WebSocketImpl;
    return globalThis.WebSocket;
  }
  function report(error) {
    if (typeof onError === "function") {
      try {
        onError(error);
      } catch {
      }
    }
  }
  function flush() {
    if (socket === null || socket.readyState !== 1) return;
    while (queue.length > 0) {
      const message = queue.shift();
      try {
        socket.send(message);
      } catch (error) {
        queue.unshift(message);
        report(error);
        return;
      }
    }
  }
  function connect() {
    if (stopped) return;
    const Impl = socketImpl();
    if (typeof Impl !== "function") {
      report(new Error("No WebSocket implementation is available for the LSP transport"));
      return;
    }
    const target = resolveUrl();
    if (target === "") {
      report(new Error("The LSP transport has no WebSocket URL"));
      return;
    }
    try {
      socket = new Impl(target);
    } catch (error) {
      report(error);
      scheduleReconnect();
      return;
    }
    socket.addEventListener?.("open", () => {
      attempt = 0;
      const reopened = opened > 0;
      opened += 1;
      if (typeof onOpen === "function") {
        try {
          onOpen({ attempt, reopened });
        } catch (error) {
          report(error);
        }
      }
      flush();
    });
    socket.addEventListener?.("message", (event) => {
      const data = typeof event?.data === "string" ? event.data : String(event?.data ?? "");
      const control = isControlEvent(data);
      if (control !== null) {
        if (typeof onControl === "function") {
          try {
            onControl(control);
          } catch (error) {
            report(error);
          }
        }
        return;
      }
      for (const handler of [...handlers]) {
        try {
          handler(data);
        } catch (error) {
          report(error);
        }
      }
    });
    socket.addEventListener?.("error", (event) => {
      report(event instanceof Error ? event : new Error("The LSP WebSocket reported an error"));
    });
    socket.addEventListener?.("close", (event) => {
      socket = null;
      const info = { code: Number(event?.code ?? 0), reason: String(event?.reason ?? "") };
      if (typeof onClose === "function") {
        try {
          onClose(info);
        } catch (error) {
          report(error);
        }
      }
      if (stopped) return;
      scheduleReconnect();
    });
  }
  function scheduleReconnect() {
    if (stopped || retryTimer !== null) return;
    const delay = Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);
    attempt += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, delay);
    if (typeof retryTimer?.unref === "function") retryTimer.unref();
  }
  return {
    /**
     * Send one JSON document.
     *
     * The message is queued while the socket is not open yet; a permanently
     * stopped transport drops it and reports the failure instead of throwing.
     * @param {string} message the JSON body
     */
    send(message) {
      if (typeof message !== "string") return;
      if (stopped) {
        report(new Error("The LSP transport is closed"));
        return;
      }
      if (socket !== null && socket.readyState === 1) {
        try {
          socket.send(message);
        } catch (error) {
          queue.push(message);
          report(error);
        }
        return;
      }
      queue.push(message);
      if (socket === null) connect();
    },
    /**
     * Register a handler for the incoming JSON documents.
     * @param {(value: string) => void} handler the handler
     */
    subscribe(handler) {
      if (typeof handler !== "function") return;
      handlers.add(handler);
    },
    /**
     * Remove a handler.
     * @param {(value: string) => void} handler the handler
     */
    unsubscribe(handler) {
      handlers.delete(handler);
    },
    /** Stop the transport: no reconnect, no further messages. */
    close() {
      stopped = true;
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      queue.length = 0;
      const current = socket;
      socket = null;
      try {
        current?.close();
      } catch {
      }
    },
    /** Whether the socket is open and able to carry messages. */
    get ready() {
      return socket !== null && socket.readyState === 1;
    },
    /** How many messages are waiting for the socket. */
    get queued() {
      return queue.length;
    }
  };
}

// src/client/lsp-uri.js
var LANGUAGE_IDS = new Map(Object.entries({
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "typescriptreact",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascriptreact",
  py: "python",
  pyw: "python",
  pyi: "python",
  yaml: "yaml",
  yml: "yaml",
  java: "java",
  go: "go",
  rs: "rust",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  html: "html",
  htm: "html",
  vue: "html",
  svelte: "html",
  css: "css",
  scss: "css",
  less: "css",
  json: "json",
  jsonc: "json",
  json5: "json",
  sql: "sql",
  xml: "xml",
  svg: "xml",
  xsl: "xml",
  xsd: "xml",
  md: "markdown",
  markdown: "markdown"
}));
function utf8Percent(char) {
  let out = "";
  for (const byte of new TextEncoder().encode(char)) {
    out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}
function encodePath(path) {
  let out;
  try {
    out = encodeURI(path);
  } catch {
    out = path.replace(/[\uD800-\uDFFF]/g, (char) => utf8Percent(char));
  }
  out = out.replace(/[?#]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  out = out.replace(/[^\x00-\x7F]/gu, (char) => utf8Percent(char));
  return out;
}
function fileUriOf(absolutePath) {
  if (typeof absolutePath !== "string" || absolutePath === "") return "";
  let path = absolutePath.replace(/\\/g, "/");
  let authority = "";
  if (path.startsWith("//")) {
    const rest = path.slice(2);
    const slash = rest.indexOf("/");
    if (slash < 0) {
      authority = rest;
      path = "/";
    } else {
      authority = rest.slice(0, slash);
      path = rest.slice(slash);
    }
  }
  if (!path.startsWith("/")) path = `/${path}`;
  const host = authority === "" ? "" : encodeURI(authority);
  return `file://${host}${encodePath(path)}`;
}
function pathOfFileUri(uri) {
  if (typeof uri !== "string" || uri === "") return null;
  if (!/^file:/i.test(uri)) return null;
  let rest = uri.slice(5).replace(/[?#].*$/, "");
  let authority = "";
  if (rest.startsWith("//")) {
    rest = rest.slice(2);
    const slash = rest.indexOf("/");
    if (slash < 0) {
      authority = rest;
      rest = "";
    } else {
      authority = rest.slice(0, slash);
      rest = rest.slice(slash);
    }
  }
  let path;
  try {
    path = decodeURIComponent(rest);
  } catch {
    path = rest;
  }
  if (authority !== "" && authority.toLowerCase() !== "localhost") {
    return `\\\\${authority}${path.replace(/\//g, "\\")}`;
  }
  if (/^\/[A-Za-z]:/.test(path)) {
    return path.slice(1).replace(/\//g, "\\");
  }
  return path;
}
function languageIdForPath(path) {
  if (typeof path !== "string" || path === "") return "plaintext";
  const name2 = path.replace(/\\/g, "/").split("/").pop() ?? "";
  const dot = name2.lastIndexOf(".");
  if (dot <= 0) return "plaintext";
  const ext = name2.slice(dot + 1).toLowerCase();
  return LANGUAGE_IDS.get(ext) ?? "plaintext";
}

// src/client/lsp-workspace.js
init_cm_state();

// src/client/workspace-scope.js
function normalizeScopePath(path) {
  if (typeof path !== "string" || path === "") return "";
  const slashed = path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/+$/, "");
  const windows = /^[A-Za-z]:\//.test(slashed) || slashed.startsWith("//");
  return windows ? slashed.toLowerCase() : slashed;
}
function sameScopePath(left, right) {
  const normalized = normalizeScopePath(left);
  return normalized !== "" && normalized === normalizeScopePath(right);
}
function isPathWithin(root, path) {
  const parent = normalizeScopePath(root);
  if (parent === "") return false;
  const candidate = normalizeScopePath(path);
  return candidate === parent || candidate.startsWith(`${parent}/`);
}
function baseName(path) {
  if (typeof path !== "string" || path === "") return "";
  const parts = path.replace(/\\/g, "/").replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] ?? "";
}

// src/client/lsp-workspace.js
var VIEW_WAIT_MS = 5e3;
var REQUEST_CACHE_LIMIT = 64;
function splitLines(text) {
  const lines = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) {
      lines.push(text.slice(start, index + 1));
      start = index + 1;
    }
  }
  if (start < text.length) lines.push(text.slice(start));
  return lines;
}
function lineOffsets(lines) {
  const offsets = [0];
  let total = 0;
  for (const line of lines) {
    total += line.length;
    offsets.push(total);
  }
  return offsets;
}
function lcsMatches(a, b) {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return [];
  if (n * m > 25e4) return null;
  const width = m + 1;
  const table = new Int32Array((n + 1) * width);
  for (let i2 = n - 1; i2 >= 0; i2 -= 1) {
    for (let j2 = m - 1; j2 >= 0; j2 -= 1) {
      table[i2 * width + j2] = a[i2] === b[j2] ? table[(i2 + 1) * width + (j2 + 1)] + 1 : Math.max(table[(i2 + 1) * width + j2], table[i2 * width + (j2 + 1)]);
    }
  }
  const matches = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      matches.push([i, j]);
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j] >= table[i * width + (j + 1)]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return matches;
}
function regionChange(from, oldText, newText) {
  let prefix = 0;
  const maxPrefix = Math.min(oldText.length, newText.length);
  while (prefix < maxPrefix && oldText[prefix] === newText[prefix]) prefix += 1;
  let suffix = 0;
  const maxSuffix = Math.min(oldText.length - prefix, newText.length - prefix);
  while (suffix < maxSuffix && oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]) suffix += 1;
  return {
    from: from + prefix,
    to: from + prefix + (oldText.length - suffix - prefix),
    insert: newText.slice(prefix, newText.length - suffix)
  };
}
function computeChanges(previous, next) {
  if (previous === next) return ChangeSet.empty(previous.length);
  if (previous === "") return ChangeSet.of([{ from: 0, to: 0, insert: next }], 0);
  if (next === "") return ChangeSet.of([{ from: 0, to: previous.length, insert: "" }], previous.length);
  const before = splitLines(previous);
  const after = splitLines(next);
  const offsets = lineOffsets(before);
  const matches = lcsMatches(before, after);
  if (matches === null) {
    return ChangeSet.of([regionChange(0, previous, next)], previous.length);
  }
  const specs = [];
  let beforeIndex = 0;
  let afterIndex = 0;
  const pushRegion = (toLine, toAfterLine) => {
    const oldText = before.slice(beforeIndex, toLine).join("");
    const newText = after.slice(afterIndex, toAfterLine).join("");
    if (oldText === newText) return;
    specs.push(regionChange(offsets[beforeIndex], oldText, newText));
  };
  for (const [matchBefore, matchAfter] of matches) {
    if (matchBefore > beforeIndex || matchAfter > afterIndex) {
      pushRegion(matchBefore, matchAfter);
    }
    beforeIndex = matchBefore + 1;
    afterIndex = matchAfter + 1;
  }
  if (beforeIndex < before.length || afterIndex < after.length) {
    pushRegion(before.length, after.length);
  }
  return ChangeSet.of(specs, previous.length);
}
function textOf(content2) {
  return Text.of(String(content2 ?? "").split("\n"));
}
function workspaceClass() {
  if (workspaceClass.value === null) {
    const library2 = lspLibrary();
    if (library2 === null) {
      throw new Error("The language-server client library is not loaded yet - the IDE workbench plugin is not installed.");
    }
    workspaceClass.value = class WorkbenchWorkspace extends library2.Workspace {
      /**
       * @param {import('@codemirror/lsp-client').LSPClient} client the client
       * @param {any} store the workbench store
       * @param {{viewRegistry?: {waitForEditorView?: (uri: string, timeoutMs?: number) => Promise<any>}}} [options]
       */
      constructor(client, store, options2 = {}) {
        super(client);
        this.store = store;
        this.options = options2;
        this.viewRegistry = options2.viewRegistry ?? null;
        this.files = [];
        this.requestCache = /* @__PURE__ */ new Map();
      }
      /**
       * The document of one absolute path, when the core reported it.
       *
       * The paths are compared in their normalized form: the core spells a
       * path with the separator of the project root, while the LSP URI always
       * uses slashes - and on Windows the case does not matter either.
       * @param {string} absolute the absolute path
       * @returns {any} the document, or `undefined`
       */
      tabFor(absolute) {
        const documents = this.store?.state?.documents;
        if (!Array.isArray(documents)) return void 0;
        const wanted = normalizeScopePath(absolute);
        if (wanted === "") return void 0;
        return documents.find((document2) => {
          if (typeof document2?.absolutePath !== "string") return false;
          return normalizeScopePath(document2.absolutePath) === wanted;
        });
      }
      /**
       * The current content of one document.
       *
       * The editor is the freshest source: the user may have typed a character
       * that the core has not broadcast yet. When no editor is available the
       * document of the core is used, and there the DRAFT wins over the file on
       * the disk - an unsaved symbol must be visible to the language server.
       * @param {string} uri the document URI
       * @param {any} [view] the editor, when there is one
       * @returns {string} the content
       */
      contentOf(uri, view = null) {
        if (view !== null && view !== void 0 && typeof view.state?.doc?.toString === "function") {
          return view.state.doc.toString();
        }
        const absolute = pathOfFileUri(uri);
        if (absolute === null) return "";
        const document2 = this.tabFor(absolute);
        if (document2 === void 0) return "";
        return typeof document2.content === "string" ? document2.content : "";
      }
      /**
       * The editor that shows one document, when the workbench has one.
       * @param {string} uri the document URI
       * @returns {any} the editor, or `null`
       */
      viewOf(uri) {
        const file = this.getFile(uri);
        if (file !== null && file !== void 0) {
          const view = file.getView();
          if (view !== null && view !== void 0) return view;
        }
        if (this.viewRegistry !== null && typeof this.viewRegistry.get === "function") {
          const view = this.viewRegistry.get(uri);
          if (view !== null && view !== void 0) return view;
        }
        return null;
      }
      /**
       * Open one document with the server.
       *
       * The content that is announced is the editor buffer (the draft), never the
       * file on disk.
       *
       * A document outside the scope is *not* announced: the language server only
       * knows the documents of the project it builds its program for and complains
       * about the others ("Unexpected resource …"), and that complaint reaches the
       * workbench as a fake error (review S8). The file itself stays known to the
       * editor - the tab needs it - it is only kept away from the server.
       * @param {string} uri the document URI
       * @param {string} languageId the LSP language id
       * @param {any} view the editor
       */
      openFile(uri, languageId, view) {
        const existing = this.getFile(uri);
        if (existing !== null && existing !== void 0) {
          existing.languageId = languageId;
          existing.view = view;
          return;
        }
        const content2 = this.contentOf(uri, view);
        const file = {
          uri,
          languageId,
          version: 1,
          doc: textOf(content2),
          view,
          /** Whether the server was told about this document. */
          announced: false,
          /** @returns {any} the editor that shows this document */
          getView() {
            return this.view ?? null;
          }
        };
        this.files.push(file);
        const absolute = pathOfFileUri(uri);
        if (absolute === null || !this.insideScope(absolute)) return;
        if (this.client.connected === false) return;
        file.announced = true;
        this.client.didOpen(file);
      }
      /**
       * The file of one URI, whether or not it is open in an editor.
       *
       * The library's own answer only knows the files that have an editor, and
       * `findReferences` drops every reference whose file is not in that list -
       * which is why the usages of a symbol, which usually live in other files,
       * were almost never shown. This method reads the missing files from the
       * disk instead.
       *
       * Three rules keep the method harmless:
       *
       * 1. **No tab is opened.** The file is only needed to render the context
       *    of a reference row; opening it would turn one search into a batch of
       *    opened files.
       * 2. **The fence holds.** A path outside the workspace is not read and
       *    does not even produce a toast - one search may touch dozens of files,
       *    and dozens of toasts would bury the panel.
       * 3. **The file is cached.** One search reads the same file again for
       *    every reference in it.
       * @param {string} uri the document URI
       * @returns {Promise<any>} the file, or `null` when it cannot be read
       */
      async requestFile(uri) {
        const existing = this.getFile(uri);
        if (existing !== null && existing !== void 0) return existing;
        const cached = this.requestCache.get(uri);
        if (cached !== void 0) return cached;
        const absolute = pathOfFileUri(uri);
        if (absolute === null) return null;
        if (!this.insideRoot(absolute)) return null;
        const content2 = await this.readFileContent(absolute);
        if (content2 === null) return null;
        const file = {
          uri,
          languageId: languageIdForPath(absolute),
          version: 1,
          doc: textOf(content2),
          /** The file is only read, never announced to the server. */
          announced: false,
          /** @returns {any} the editor - there is none, the file is only read */
          getView() {
            return null;
          }
        };
        this.rememberRequest(file);
        return file;
      }
      /**
       * The content of one file on disk, read through the contract.
       *
       * The contract of the core resolves the path inside the project root, so
       * the fence of the core applies a second time - the plugin never builds a
       * path of its own.
       * @param {string} absolute the absolute path
       * @returns {Promise<string | null>} the content, or `null` when the file
       *   cannot be read
       */
      async readFileContent(absolute) {
        const store = this.store;
        if (store === null || store === void 0) return null;
        if (typeof store.readFile !== "function") return null;
        try {
          const content2 = await store.readFile(absolute);
          return typeof content2 === "string" ? content2 : null;
        } catch (error) {
          console.warn("[lsp] the file could not be read:", absolute, error instanceof Error ? error.message : error);
          return null;
        }
      }
      /**
       * Remember one requested file, dropping the oldest one when the cache is
       * full.
       * @param {any} file the file
       */
      rememberRequest(file) {
        this.requestCache.set(file.uri, file);
        while (this.requestCache.size > REQUEST_CACHE_LIMIT) {
          const oldest = this.requestCache.keys().next();
          if (oldest.done === true) break;
          this.requestCache.delete(oldest.value);
        }
      }
      /**
       * Forget the files that were read for the last find cycle.
       *
       * The session calls this when a new reference request starts, so that
       * every search reads the files of the project as they are *now*.
       */
      clearRequestCache() {
        this.requestCache.clear();
      }
      /**
       * The document of one URI, when the workspace knows it.
       *
       * The library maps the positions of a reference with the workspace
       * mapping it created when the search started; that mapping only knows the
       * documents that were open at that moment. This method gives the mapping
       * the document of a file that was read for the panel.
       * @param {string} uri the document URI
       * @returns {any} the document, or `null` when the URI is unknown
       */
      documentFor(uri) {
        const open = this.getFile(uri);
        if (open !== null && open !== void 0) return open.doc ?? null;
        const requested = this.requestCache.get(uri);
        if (requested !== void 0) return requested.doc ?? null;
        return null;
      }
      /**
       * Push the pending edits of every open document to the server.
       *
       * Only the documents that actually changed are reported, and the change is
       * incremental. A document that was never announced to the server (a file
       * outside the project) is kept up to date locally, but it is not reported:
       * the server does not know it and would complain about an unknown
       * document.
       * @returns {Array<any>} the updates
       */
      syncFiles() {
        const updates = [];
        for (const file of this.files) {
          const view = file.getView();
          const next = this.contentOf(file.uri, view);
          const previous = file.doc.toString();
          if (next === previous) continue;
          const changes = computeChanges(previous, next);
          const prevDoc = file.doc;
          file.doc = textOf(next);
          file.version += 1;
          if (file.announced !== true) continue;
          updates.push({ file, prevDoc, changes });
        }
        return updates;
      }
      /**
       * Whether one path is inside the current project.
       *
       * The fence of the *workbench*: the project is the workspace root, and the
       * workbench may open and show every file of it.
       * @param {string} absolute the absolute path
       * @returns {boolean} true when the path may be opened
       */
      insideRoot(absolute) {
        const root = this.store?.state?.root;
        if (typeof root !== "string" || root === "") return false;
        return isPathWithin(root, absolute);
      }
      /**
       * Whether one path is inside the scope of the language server.
       *
       * The server is scoped to the *scope root* of the project (PRD-v5 §4.2):
       * it builds its program for that directory, and a document outside of it is
       * not part of the project. Such a document is never announced - the server
       * would answer with a complaint ("not part of the workspace") that the
       * workbench would have to swallow.
       *
       * The scope root comes from the store, which mirrors what the host reports.
       * Without one the workspace root is the scope: the server knows the whole
       * workspace then, and every document of it may be announced.
       *
       * The workbench itself is *not* fenced by the scope: the workbench may
       * still open and show every file of the workspace - the scope is a fact
       * about the server, not about the files.
       * @param {string} absolute the absolute path
       * @returns {boolean} true when the server may know the file
       */
      insideScope(absolute) {
        const scope = this.store?.state?.lsp?.scopeRoot;
        const root = typeof scope === "string" && scope !== "" ? scope : this.store?.state?.root;
        if (typeof root !== "string" || root === "") return false;
        return isPathWithin(root, absolute);
      }
      /**
       * Tell the user that a path is outside the project.
       * @param {string} absolute the absolute path
       */
      notifyOutside(absolute) {
        const store = this.store;
        if (store === null || store === void 0) return;
        const text = typeof store.t === "function" ? store.t("lsp.outsideProject") : "lsp.outsideProject";
        if (typeof store.toast === "function") {
          try {
            store.toast("error", text, absolute);
          } catch {
          }
        }
      }
      /**
       * Show another document to the user.
       *
       * A path outside the workspace is refused: it is neither opened nor read.
       * The scope of the language server does not narrow this: a file of the
       * workspace that the server knows nothing about may still be shown - the
       * server mentioned it, and the user has to see it.
       * @param {string} uri the document URI
       * @returns {Promise<any>} the editor, or `null` when it cannot be shown
       */
      async displayFile(uri) {
        const absolute = pathOfFileUri(uri);
        if (absolute === null) return null;
        if (!this.insideRoot(absolute)) {
          this.notifyOutside(absolute);
          return null;
        }
        const store = this.store;
        if (store === null || store === void 0 || typeof store.openFile !== "function") return null;
        try {
          store.openFile(absolute, { preview: false });
        } catch (error) {
          this.notifyOutside(absolute);
          return null;
        }
        const registry = this.viewRegistry;
        if (registry === null || registry === void 0) return null;
        if (typeof registry.waitForEditorView === "function") {
          try {
            return await registry.waitForEditorView(uri, VIEW_WAIT_MS);
          } catch {
            return null;
          }
        }
        if (typeof registry.get === "function") return registry.get(uri) ?? null;
        return null;
      }
      /**
       * The connection to the server is live.
       *
       * The default implementation of the library re-opens every document here.
       * That is wrong for a *re*connection: the language server still knows the
       * documents, and a second `didOpen` for the same URI breaks the protocol.
       * The documents are opened by `openFile()` - the editor plugin calls it as
       * soon as the plugin extension exists - and the host re-opens them itself
       * after a crash restart.
       *
       * One exception: a document that was opened *before* the client was
       * connected was never announced - the library drops a notification that is
       * sent without a transport, and the client is connected a moment after it
       * was created (the scope root of the project is asked for before the
       * handshake goes out, PRD-v5 §4.2). Such a document is announced now.
       */
      connected() {
        for (const file of this.files) {
          if (file.announced === true) continue;
          const absolute = pathOfFileUri(file.uri);
          if (absolute === null || !this.insideScope(absolute)) continue;
          file.announced = true;
          this.client.didOpen(file);
        }
      }
      /**
       * Apply a server initiated change to one document.
       * @param {string} uri the document URI
       * @param {any} transaction the transaction
       */
      updateFile(uri, transaction) {
        const file = this.getFile(uri);
        if (file === null || file === void 0) return;
        const view = file.getView();
        if (view === null || view === void 0) return;
        try {
          view.dispatch(transaction);
        } catch {
        }
      }
      /**
       * Close one document with the server.
       *
       * A document that was never announced (a file outside the project) is
       * closed locally only: the server does not know it, and a `didClose` for
       * an unknown document is another complaint it would answer with.
       * @param {string} uri the document URI
       */
      closeFile(uri) {
        const index = this.files.findIndex((file2) => file2.uri === uri);
        if (index < 0) return;
        const [file] = this.files.splice(index, 1);
        if (file.announced !== true) return;
        this.client.didClose(uri);
      }
    };
  }
  return workspaceClass.value;
}
workspaceClass.value = null;
var WorkbenchWorkspace = new Proxy(function WorkbenchWorkspaceProxy() {
}, {
  construct(_target, args) {
    return Reflect.construct(workspaceClass(), args);
  },
  get(_target, key) {
    return Reflect.get(workspaceClass(), key);
  }
});

// src/host/settings-defaults.js
var BUILD_REQUEST_TIMEOUT_MS = 6e5;
var IDLE_POLICIES = ["never", "after", "onMemoryPressure", "always"];
var LSP_LANGUAGE_IDS = [
  "typescript",
  "javascript",
  "javascriptreact",
  "typescriptreact",
  "python",
  "yaml",
  "java",
  "go",
  "rust",
  "c",
  "cpp"
];
var DEFAULT_LSP_SETTINGS = {
  /** Master switch. false = never start a language server. */
  enabled: true,
  /** 'ask' = ask; 'always' = always index; 'never' = never index. */
  indexOnOpen: "ask",
  /** Memory ceiling handed to the language server (MB). */
  memoryLimitMB: 2048,
  /**
   * Conservative fallback floor (MB): the free memory that is required when
   * no estimate of the language is known. It is not a gate for a language
   * that has an estimate (PRD §4.4).
   */
  freeMemoryThresholdMB: 512,
  /** Factor between the estimate of a language server and the memory it needs. */
  memoryHeadroom: 1.5,
  /** Free memory below which no language server starts at all (MB). */
  memoryHardFloorMB: 256,
  /**
   * The machine-level total budget, as a fraction of the total memory
   * (PRD-v5.1 MEM-08).
   *
   * The per-server gate answers one question only: "may the next server
   * start". It cannot answer "may three servers grow to their ceiling at the
   * same time" - and that is the question that ends in the swap. The budget
   * is the last gate: the sum of the ceilings of the running servers never
   * exceeds `totalBytes × budgetRatio`.
   *
   * A quarter of the memory is the default: a machine that gives a quarter
   * of its memory to the language servers still has room for the editor, the
   * build and the agent - and on a large machine the absolute cap
   * (`budgetCapMB`) takes over anyway.
   */
  budgetRatio: 0.25,
  /**
   * The absolute cap of the machine-level total budget (MB, MEM-08).
   *
   * The ratio alone would hand a 64 GB machine 16 GB of language servers,
   * which is more than any machine needs. The cap is the ceiling of the
   * budget: `min(totalBytes × budgetRatio, budgetCapMB)`. Four gigabytes
   * hold about four TypeScript indexes of the default size, which is what
   * the budget is meant to allow.
   */
  budgetCapMB: 4096,
  /**
   * The number of indexes that may run at the same time (0 = no limit).
   *
   * The budget decides how many servers fit into the machine; this setting
   * is the user's own limit on top of it. When both apply, the stricter one
   * wins: a limit of 1 keeps a single index even on a machine with room for
   * four. 0 leaves the decision to the budget alone.
   */
  maxConcurrentIndexes: 0,
  /** Idle time after which the language server exits (ms). */
  idleTimeoutMs: 6e5,
  /**
   * When an idle language server may release its memory (PRD-v5 §3.2).
   *
   * 'never' = never because of idleness; 'after' = after `idleTimeoutMs`
   * without a request; 'onMemoryPressure' = only when the machine runs out
   * of free memory; 'always' = the idle timeout *and* the pressure yield.
   *
   * The idle half of the policy never exempts the machine from the memory
   * pressure: 'never' means "not because of idleness", not "not even when
   * the machine is dying" (PRD-v5.1 MEM-12). The pressure valve has a
   * switch of its own - `pressureYield` - and that is the only way to
   * switch it off.
   *
   * `autoExit: false` still means "never" for the documents that were
   * written before this setting existed - the host honours the older
   * switch over the newer policy.
   */
  idlePolicy: "after",
  /**
   * Whether a language server may be released when the machine runs out of
   * memory (PRD-v5.1 MEM-12).
   *
   * The pressure valve is the last defence against the swap: when the
   * available memory falls below the hard floor, the least active server is
   * released and the machine gets its memory back. The valve is independent
   * of `idlePolicy` - "never" means "never because of idleness", not "not
   * even when the machine is dying" - and it is installed by default.
   *
   * `false` is the one and only way to switch the valve off: the host does
   * not install the pressure timer at all. The user who switches it off
   * gives up the protection against the swap, so the switch has to be an
   * explicit one.
   */
  pressureYield: true,
  /**
   * The scope of the program the language server builds (PRD-v5 §4.2).
   *
   * 'auto' = the nearest sub-project root when the root is not a project of
   * its own; 'root' = the whole root; 'project' = always the nearest
   * sub-project root. A workspace root with several projects in it makes
   * the language server merge them into one program (measured: 2,335 files
   * / 84 MB), so the scope is converged onto one project.
   */
  indexScope: "auto",
  /** LSP request timeout (ms). Must stay >= 30000: the client library's own
   * default is 3000, which silently times out on large projects. */
  requestTimeoutMs: 3e4,
  /** How long an index may run before the cancel button appears (ms). */
  cancelAfterMs: 6e4,
  /** Whether an idle language server may exit on its own. */
  autoExit: true,
  /** Whether a crashed language server is restarted once. */
  autoRestart: true,
  /**
   * Per-language overrides: { [languageId]: { enabled, command, args } }.
   *
   * `enabled: false` switches one language off: its server is never
   * started and the language stays in the conservative mode. `command` and
   * `args` replace the registered ones; `memoryLimitMB` lowers the
   * ceiling of one language; `memoryBaselineMB` replaces the estimate the
   * free memory is compared with.
   *
   * The java server has four keys of its own under `servers.java` (PRD-v5.1
   * JS-02). Every one of them defaults to empty and every default is
   * environment-derived: a path written into this file would work on one
   * machine and nowhere else.
   *
   *   - `javaHome` (string, default `''`): the JDK that starts jdtls. A
   *     directory that contains `bin/java[.exe]`, or the executable itself.
   *     Empty = discover one, in the order explicit setting > `JAVA_HOME` >
   *     `java` on PATH > the IDE's JDK table > the IDE's bundled runtime >
   *     a scan of environment-derived roots.
   *   - `jdtlsHome` (string, default `''`): the jdtls installation root.
   *     Empty = `JDTLS_HOME`, else the layout is derived from the resolved
   *     `jdtls` command.
   *   - `javaSearchRoots` (string[], default `[]`): EXTRA roots to scan for a
   *     JDK, for the user whose IDE is installed where nothing looks. It is a
   *     fallback, not the normal path - the discovered sources above already
   *     cover a standard machine.
   *   - `javaArgs` (string[], default `[]`): extra JVM arguments appended to
   *     the JVM part of the generated command line, before `-jar` (for
   *     debugging, e.g. `-Dxxx` or an extra `-Xmx`; after the jar, `java`
   *     would pass them to the Eclipse application instead of the JVM).
   *
   * `servers` is a free object: the settings store only guarantees that it is
   * an object, so a missing key means "the default above" and no migration is
   * needed when one of the keys is added.
   */
  servers: {},
  /** Project roots that completed a first build: { [absPath]: { at, languageId } }. */
  indexedRoots: {},
  /** Project roots the user has already been warned about on a tight memory
   * budget: { [absPath]: true }. The same project is not asked twice. */
  memoryWarnedRoots: {},
  /**
   * The semantic-analysis default state of every workspace:
   * `{ [scopePath]: 'build' | 'conservative' }` (PRD-v5.1 WS-04).
   *
   * `indexOnOpen` is the global policy, and this map outranks it: a
   * workspace whose user once chose the basic mode stays in the basic mode
   * even when `indexOnOpen` is 'always'. The decision of the user is
   * persistent - it lives in the settings document, so it survives a
   * workspace switch and a restart of DSH, which the memory of the client
   * does not.
   *
   * Only a decision the user made belongs here. A decision the policy
   * derived (the automatic start of the 'always' policy) stays in the
   * memory of the client - written here it would take the choice away from
   * the user, who could never turn the index of that workspace off again.
   */
  workspaceDefaults: {}
};

// src/host/semantic-methods.js
var SEMANTIC_METHODS = /* @__PURE__ */ new Set([
  "textDocument/references",
  "textDocument/definition",
  "textDocument/declaration",
  "textDocument/typeDefinition",
  "textDocument/implementation",
  "textDocument/hover",
  "textDocument/completion",
  "textDocument/signatureHelp"
]);

// src/client/lsp-session.js
var DEFAULT_SHORTCUTS = {
  goToDefinition: "F12",
  findUsages: "Alt+F7",
  findUsagesText: "Alt+F8",
  complete: "Ctrl+Space"
};
var LSP_WS_PATH = "dsh-codeintel/ws/lsp";
var SCOPE_TIMEOUT_MS = 3e3;
var HANDSHAKE_TIMEOUT_MS = 3e4;
var LSP_HOST_HEALTHY_STATES = ["starting", "building", "ready", "restarting"];
function indexDecisionOf(store, root) {
  if (store === null || store === void 0) return "unknown";
  if (typeof store.lspIndexDecision !== "function") {
    return "build";
  }
  try {
    const decision = store.lspIndexDecision(root);
    return decision === "build" || decision === "conservative" ? decision : "unknown";
  } catch {
    return "build";
  }
}
var clientSessionState = "idle";
var clientSessionSince = 0;
var clientSessionDetail = "";
var lastHandshakeError = "";
var sessionStore = null;
var currentClient = null;
var currentWorkspace = null;
var currentTransport = null;
var sessionEnabled = true;
var sessionVersion = 0;
var editorViews = /* @__PURE__ */ new Map();
var sessionListeners = /* @__PURE__ */ new Set();
var unsubscribeStore = null;
var sessionKey = null;
var sessionGeneration = 0;
var sessionRoot = "";
var sessionScopeRoot = "";
var pendingConnection = null;
var pendingConfig = null;
var reportErrorRedirected = false;
var handshakeTimer = null;
var handshakeRetries = 0;
var mappingRedirected = false;
var health = { consecutiveFailures: 0, consecutiveTimeouts: 0, lastFailure: null };
function reportClientState(state, detail = "") {
  clientSessionState = state;
  clientSessionDetail = typeof detail === "string" ? detail : "";
  if (state === "starting") {
    if (clientSessionSince === 0) clientSessionSince = Date.now();
  } else {
    clientSessionSince = 0;
  }
  const store = sessionStore;
  if (store === null || store === void 0) return;
  if (typeof store.lspSessionState !== "function") return;
  try {
    store.lspSessionState(state, clientSessionDetail, clientSessionSince);
  } catch (error) {
    console.warn("[lsp] the state of the session could not be reported:", error instanceof Error ? error.message : error);
  }
}
var semanticAnswers = 0;
var lastProcessId = null;
var OUTSIDE_PROJECT_COMPLAINTS = [
  /unexpected resource/i,
  /not part of the workspace/i,
  /outside the project/i,
  /not in the project/i
];
function isOutsideProjectComplaint(message, detail) {
  const text = `${message ?? ""} ${detail ?? ""}`;
  return OUTSIDE_PROJECT_COMPLAINTS.some((pattern) => pattern.test(text));
}
function redirectErrorsToToast() {
  if (reportErrorRedirected) return;
  const library2 = lspLibrary();
  if (library2 === null) {
    void loadLspLibrary().then(() => {
      redirectErrorsToToast();
    }, () => {
    });
    return;
  }
  reportErrorRedirected = true;
  const original = library2.LSPPlugin.prototype.reportError;
  library2.LSPPlugin.prototype.reportError = function reportError(message, err) {
    const detail = err?.message ?? String(err ?? "");
    console.warn("[lsp]", message, detail);
    if (isOutsideProjectComplaint(message, detail)) return;
    const store = sessionStore;
    if (store !== null && typeof store.toast === "function") {
      try {
        store.toast("error", `${message}: ${detail}`, "");
        return;
      } catch {
      }
    }
    original.call(this, message, err);
  };
}
function resetLspHealth() {
  health = { consecutiveFailures: 0, consecutiveTimeouts: 0, lastFailure: null };
  semanticAnswers = 0;
  publishHealth();
}
function sameFailure(left, right) {
  if (left === right) return true;
  if (left === null || left === void 0 || right === null || right === void 0) return false;
  return left.message === right.message && left.at === right.at;
}
function publishHealth() {
  const store = sessionStore;
  if (store === null || store === void 0) return;
  if (typeof store.set !== "function") return;
  const lsp = store.state?.lsp;
  if (lsp === null || lsp === void 0) return;
  const next = {
    ...lsp,
    consecutiveFailures: health.consecutiveFailures,
    consecutiveTimeouts: health.consecutiveTimeouts,
    lastFailure: health.lastFailure === null ? null : { ...health.lastFailure }
  };
  if (lsp.consecutiveFailures === next.consecutiveFailures && lsp.consecutiveTimeouts === next.consecutiveTimeouts && sameFailure(lsp.lastFailure, next.lastFailure)) return;
  store.set({ lsp: next });
}
function failureMessage(error) {
  if (typeof error === "string") return error;
  if (error !== null && typeof error === "object" && typeof error.message === "string") return error.message;
  return String(error ?? "");
}
function isTimeout(message) {
  return /timed out|timeout/i.test(message);
}
function isClientDeadline(error) {
  if (!(error instanceof Error)) return false;
  return /^request timed out$/i.test(error.message ?? "");
}
function noteSemanticSuccess() {
  health.consecutiveFailures = 0;
  health.consecutiveTimeouts = 0;
  publishHealth();
}
function noteSemanticFailure(error) {
  const message = failureMessage(error);
  health.consecutiveFailures += 1;
  if (isTimeout(message)) health.consecutiveTimeouts += 1;
  health.lastFailure = { message, at: Date.now() };
  publishHealth();
}
function watchSemanticRequests(client) {
  const original = client.request.bind(client);
  client.request = function request(method, params) {
    applyRequestBudget(client);
    if (method === "textDocument/references") clearRequestCache();
    const connection = pendingConnection !== null && pendingConnection.client === client ? pendingConnection.promise : null;
    const promise = connection === null ? original(method, params) : connection.then(() => {
      applyRequestBudget(client);
      return original(method, params);
    });
    if (!SEMANTIC_METHODS.has(method)) return promise;
    return promise.then(
      (result) => {
        semanticAnswers += 1;
        noteSemanticSuccess();
        return result;
      },
      (error) => {
        noteSemanticFailure(error);
        if (!isClientDeadline(error)) semanticAnswers += 1;
        throw error;
      }
    );
  };
}
function clearRequestCache() {
  const workspace = currentWorkspace;
  if (workspace === null || workspace === void 0) return;
  if (typeof workspace.clearRequestCache !== "function") return;
  try {
    workspace.clearRequestCache();
  } catch (error) {
    console.warn("[lsp] the request cache could not be cleared:", error instanceof Error ? error.message : error);
  }
}
function documentOf(client, uri) {
  const workspace = client?.workspace ?? null;
  if (workspace === null || workspace === void 0) return null;
  if (typeof workspace.documentFor !== "function") return null;
  try {
    return workspace.documentFor(uri) ?? null;
  } catch {
    return null;
  }
}
function offsetOfPosition(doc, pos) {
  const line = Number.isFinite(pos?.line) ? pos.line + 1 : 1;
  const text = doc.line(Math.min(Math.max(line, 1), doc.lines));
  const character = Number.isFinite(pos?.character) ? pos.character : 0;
  return text.from + Math.min(Math.max(character, 0), text.length);
}
function redirectMappingPositions() {
  if (mappingRedirected) return;
  const library2 = lspLibrary();
  if (library2 === null) return;
  mappingRedirected = true;
  const original = library2.WorkspaceMapping.prototype.mapPosition;
  library2.WorkspaceMapping.prototype.mapPosition = function mapPosition(uri, pos, assoc = -1, mode) {
    try {
      return original.call(this, uri, pos, assoc, mode);
    } catch (error) {
      const doc = documentOf(this.client, uri);
      if (doc === null) throw error;
      return offsetOfPosition(doc, pos);
    }
  };
}
function shutdownHostLsp(root) {
  if (typeof root !== "string" || root === "") return;
  void call("lsp.shutdown", { root }).catch((error) => {
    console.warn("[lsp] the language server could not be stopped:", error instanceof Error ? error.message : error);
  });
}
var focusRootReported = "";
function reportLspFocus(root) {
  const next = typeof root === "string" ? root : "";
  if (next === focusRootReported) return;
  focusRootReported = next;
  void call("lsp.focus", { root: next }).catch((error) => {
    console.warn("[lsp] the focus could not be reported:", error instanceof Error ? error.message : error);
  });
}
var SHUTDOWN_TIMEOUT_MS = 1e4;
async function shutdownHostLspAwaited(root) {
  if (typeof root !== "string" || root === "") return;
  const key = shutdownKeyOf(root);
  const running = pendingShutdowns.get(key);
  if (running !== void 0) {
    await running;
    return;
  }
  const promise = stopHostLspAwaited(root);
  pendingShutdowns.set(key, promise);
  try {
    await promise;
  } finally {
    if (pendingShutdowns.get(key) === promise) pendingShutdowns.delete(key);
  }
}
var pendingShutdowns = /* @__PURE__ */ new Map();
function shutdownKeyOf(root) {
  const normalized = normalizeScopePath(root);
  return normalized === "" ? root : normalized;
}
async function stopHostLspAwaited(root) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, SHUTDOWN_TIMEOUT_MS);
  if (typeof timer?.unref === "function") timer.unref();
  try {
    await call("lsp.shutdown", { root }, controller.signal);
  } catch (error) {
    console.warn("[lsp] the language server could not be stopped:", error instanceof Error ? error.message : error);
  } finally {
    clearTimeout(timer);
  }
}
function bumpVersion() {
  sessionVersion += 1;
  for (const listener of [...sessionListeners]) {
    try {
      listener(sessionVersion);
    } catch (error) {
      console.warn("[lsp] session listener failed:", error instanceof Error ? error.message : error);
    }
  }
}
var viewRegistry = {
  /**
   * @param {string} uri the document URI
   * @returns {any} the editor, or `null`
   */
  get(uri) {
    const views = editorViews.get(uri);
    if (views === void 0 || views.size === 0) return null;
    for (const view of views) return view;
    return null;
  },
  /**
   * @param {string} uri the document URI
   * @param {number} [timeoutMs] how long to wait
   * @returns {Promise<any>} the editor, or `null` on timeout
   */
  waitForEditorView(uri, timeoutMs = 5e3) {
    return waitForEditorView(uri, timeoutMs);
  }
};
function waitForEditorView(uri, timeoutMs = 5e3) {
  const existing = viewRegistry.get(uri);
  if (existing !== null) return Promise.resolve(existing);
  return new Promise((resolve) => {
    let timer = null;
    let interval = null;
    const finish = (value) => {
      if (timer !== null) clearTimeout(timer);
      if (interval !== null) clearInterval(interval);
      resolve(value);
    };
    timer = setTimeout(() => finish(null), Math.max(0, timeoutMs));
    interval = setInterval(() => {
      const view = viewRegistry.get(uri);
      if (view !== null) finish(view);
    }, 40);
    if (typeof interval?.unref === "function") interval.unref();
    if (typeof timer?.unref === "function") timer.unref();
  });
}
function lspSocketUrl(root) {
  const url = wsUrl(LSP_WS_PATH);
  if (typeof root === "string" && root !== "") url.searchParams.set("root", root);
  return url.href;
}
function requestTimeoutOf(store) {
  const configured = store?.state?.settings?.lsp?.requestTimeoutMs;
  if (Number.isFinite(configured) && configured >= 3e4) return configured;
  return 3e4;
}
function requestBudgetOf(store) {
  const configured = requestTimeoutOf(store);
  if (store?.state?.lsp?.state === "suspended") return Math.max(configured, BUILD_REQUEST_TIMEOUT_MS);
  if (semanticAnswers > 0) return configured;
  return Math.max(configured, BUILD_REQUEST_TIMEOUT_MS);
}
function applyRequestBudget(client) {
  if (client === null || client === void 0) return;
  const budget = requestBudgetOf(sessionStore);
  if (client.timeout === budget) return;
  client.timeout = budget;
}
function hostIsReachable() {
  const injected = globalThis.__DSH_TRANSPORT__?.streamBaseUrl;
  if (typeof injected === "string" && injected !== "") return true;
  if (typeof document !== "undefined" && typeof document.baseURI === "string" && document.baseURI !== "") return true;
  return false;
}
var languageHint = { root: "", languageId: "" };
function setLspLanguageHint(root, languageId) {
  if (typeof root !== "string" || root === "") return;
  languageHint = {
    root: normalizeScopePath(root),
    languageId: typeof languageId === "string" ? languageId : ""
  };
}
function languageHintFor(root) {
  if (languageHint.root === "" || languageHint.languageId === "") return "";
  return languageHint.root === normalizeScopePath(root) ? languageHint.languageId : "";
}
async function scopeRootFor(root) {
  if (typeof root !== "string" || root === "") return "";
  if (!hostIsReachable()) return root;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, SCOPE_TIMEOUT_MS);
  if (typeof timer?.unref === "function") timer.unref();
  try {
    const payload = { root };
    const languageId = languageHintFor(root);
    if (languageId !== "") payload.languageId = languageId;
    const answer = await call("lsp.scope", payload, controller.signal);
    const scope = answer?.scopeRoot;
    if (typeof scope === "string" && scope !== "") return scope;
  } catch (error) {
    console.warn("[lsp] the scope root could not be read:", error instanceof Error ? error.message : error);
  } finally {
    clearTimeout(timer);
  }
  return root;
}
function indexScopePolicy(lsp) {
  const section = lsp !== null && typeof lsp === "object" && !Array.isArray(lsp) ? lsp : {};
  return typeof section.indexScope === "string" ? section.indexScope : "";
}
function sameRoot(left, right) {
  return normalizeScopePath(left) === normalizeScopePath(right);
}
function sessionKeyOf(enabled, root, policy, scopeRoot, wanted = true) {
  return `${enabled}|${root}|${policy}|${scopeRoot}|${wanted ? "1" : "0"}`;
}
function sessionWanted(store, root) {
  if (store === null || store === void 0) return false;
  const lspSettings = store.state?.settings?.lsp ?? null;
  if (!sessionEnabled || lspSettings?.enabled === false) return false;
  if (typeof root !== "string" || root === "") return false;
  return indexDecisionOf(store, root) !== "conservative";
}
function connectClient(client, config, root, scopeRoot) {
  config.rootUri = fileUriOf(scopeRoot);
  sessionScopeRoot = scopeRoot;
  const lspSettings = sessionStore?.state?.settings?.lsp ?? null;
  sessionKey = sessionKeyOf(
    sessionEnabled && lspSettings?.enabled !== false,
    root,
    indexScopePolicy(lspSettings),
    scopeRoot,
    sessionWanted(sessionStore, root)
  );
  client.timeout = HANDSHAKE_TIMEOUT_MS;
  client.connect(currentTransport);
  applyRequestBudget(client);
  watchHandshake(client);
  bumpVersion();
  if (pendingConnection !== null && pendingConnection.client === client) pendingConnection.resolve();
}
async function connectWithScope(client, config, root) {
  const scopeRoot = await scopeRootFor(root);
  if (currentClient !== client) {
    if (pendingConnection !== null && pendingConnection.client === client) {
      pendingConnection.resolve();
      pendingConnection = null;
    }
    return;
  }
  connectClient(client, config, root, scopeRoot);
}
function startLsp(options2 = {}) {
  if (currentClient !== null) return;
  const store = sessionStore;
  if (store === null || store === void 0) return;
  const library2 = lspLibrary();
  if (library2 === null) return;
  reportClientState("starting");
  redirectErrorsToToast();
  redirectMappingPositions();
  const root = typeof store.state?.root === "string" ? store.state.root : "";
  semanticAnswers = 0;
  const config = {
    rootUri: fileUriOf(root),
    // The budget of the construction is the budget of the session, so that a
    // request which is sent before the first wrapper call is not short
    // either.
    timeout: requestBudgetOf(store),
    sanitizeHTML,
    workspace: (client) => {
      currentWorkspace = new WorkbenchWorkspace(client, store, { viewRegistry });
      return currentWorkspace;
    },
    // The editor extensions are added by `lspExtensions()` instead, so that
    // the workbench can keep them out of the editors that have no client.
    extensions: []
  };
  currentClient = new library2.LSPClient(config);
  watchSemanticRequests(currentClient);
  currentTransport = createLspTransport({
    url: () => lspSocketUrl(root),
    onOpen: (info) => {
      if (info?.reopened === true) reinitializeLsp();
      bumpVersion();
    },
    onClose: () => {
      bumpVersion();
    },
    onError: (error) => {
      console.warn("[lsp] transport error:", error instanceof Error ? error.message : error);
    },
    // The control events of the host (a degradation, a crash) are not
    // JSON-RPC messages: they belong to the store, which turns them into a
    // toast. The store may be gone and the method may not exist yet, so the
    // callback never throws.
    onControl: (event) => {
      store?.lspControl?.(event);
    }
  });
  let resolveConnection = () => {
  };
  const connection = new Promise((resolve) => {
    resolveConnection = resolve;
  });
  pendingConnection = { client: currentClient, promise: connection, resolve: resolveConnection };
  pendingConfig = { client: currentClient, config, root };
  if (options2.waitForShutdown === true) return;
  connectPendingClient();
}
function connectPendingClient() {
  const pending2 = pendingConfig;
  if (pending2 === null) return;
  pendingConfig = null;
  const { client, config, root } = pending2;
  if (currentClient !== client) return;
  if (!hostIsReachable()) {
    connectClient(client, config, root, root);
    return;
  }
  void connectWithScope(client, config, root);
}
var MAX_HANDSHAKE_RETRIES = 3;
function watchHandshake(client) {
  const handshake = client?.initializing;
  if (handshake === null || handshake === void 0 || typeof handshake.then !== "function") return;
  handshake.then(
    () => {
      if (client?.initializing !== handshake) return;
      handshakeRetries = 0;
      lastHandshakeError = "";
      applyRequestBudget(client);
      reportClientState("ready");
    },
    (error) => {
      if (client?.initializing !== handshake) return;
      const message = failureMessage(error);
      lastHandshakeError = message;
      console.warn("[lsp] the handshake failed:", message);
      scheduleHandshakeRetry();
    }
  );
}
var HANDSHAKE_RETRY_DELAY_MS = 2e3;
var HOST_SERVER_ALIVE_STATES = ["starting", "building", "restarting", "ready"];
var HOST_SERVER_ABSENT_STATES = ["idle", "suspended", "degraded", "cancelled", "failed"];
function hostLanguageServerState() {
  const state = sessionStore?.state?.lsp?.state;
  return typeof state === "string" ? state : "";
}
function armHandshakeRetry() {
  handshakeTimer = setTimeout(() => {
    handshakeTimer = null;
    if (currentClient === null) return;
    reinitializeLsp();
  }, HANDSHAKE_RETRY_DELAY_MS);
  handshakeTimer.unref?.();
}
function scheduleHandshakeRetry() {
  if (handshakeTimer !== null) return;
  const hostState = hostLanguageServerState();
  if (HOST_SERVER_ALIVE_STATES.includes(hostState)) {
    handshakeRetries = 0;
    armHandshakeRetry();
    return;
  }
  if (HOST_SERVER_ABSENT_STATES.includes(hostState)) {
    console.warn("[lsp] the host has no language server; the session cannot be established");
    reportClientState("failed", `the host has no language server for this project (state: ${hostState})`);
    return;
  }
  if (handshakeRetries >= MAX_HANDSHAKE_RETRIES) {
    console.warn("[lsp] the handshake keeps failing; the session is dead - reconnect it from the status bar");
    reportClientState("failed", lastHandshakeError);
    return;
  }
  handshakeRetries += 1;
  armHandshakeRetry();
}
function reinitializeLsp() {
  if (currentClient === null || currentTransport === null) return;
  try {
    currentClient.disconnect();
    resetLspHealth();
    currentClient.timeout = HANDSHAKE_TIMEOUT_MS;
    currentClient.connect(currentTransport);
    applyRequestBudget(currentClient);
    watchHandshake(currentClient);
    reportClientState("starting");
  } catch (error) {
    console.warn("[lsp] the handshake could not be repeated:", error instanceof Error ? error.message : error);
  }
}
function reconnectLsp() {
  const root = typeof sessionStore?.state?.root === "string" ? sessionStore.state.root : "";
  if (indexDecisionOf(sessionStore, root) === "conservative") {
    console.warn("[lsp] the reconnect was refused: this project stays in the basic mode");
    return;
  }
  handshakeRetries = 0;
  lastHandshakeError = "";
  reportClientState("starting");
  try {
    if (currentClient === null) {
      startLsp();
      return;
    }
    if (pendingConfig !== null) {
      return;
    }
    reinitializeLsp();
  } catch (error) {
    console.warn("[lsp] the session could not be reconnected:", error instanceof Error ? error.message : error);
  }
}
function resetForNewServer() {
  resetLspHealth();
  applyRequestBudget(currentClient);
}
function watchServerProcess(store) {
  const reported = store?.state?.lsp?.processId;
  if (!Number.isFinite(reported)) return;
  const processId = reported;
  if (processId === 0) {
    if (lastProcessId === null) return;
    lastProcessId = null;
    resetForNewServer();
    return;
  }
  if (lastProcessId === null) {
    lastProcessId = processId;
    if (semanticAnswers > 0) resetForNewServer();
    return;
  }
  if (processId === lastProcessId) return;
  lastProcessId = processId;
  resetForNewServer();
}
function stopLsp() {
  sessionGeneration += 1;
  if (handshakeTimer !== null) {
    clearTimeout(handshakeTimer);
    handshakeTimer = null;
  }
  handshakeRetries = 0;
  if (currentClient !== null) {
    try {
      currentClient.disconnect();
    } catch {
    }
  }
  if (currentTransport !== null) {
    try {
      currentTransport.close();
    } catch {
    }
  }
  currentClient = null;
  currentWorkspace = null;
  currentTransport = null;
  pendingConfig = null;
  if (pendingConnection !== null) {
    pendingConnection.resolve();
    pendingConnection = null;
  }
  resetLspHealth();
  reportClientState("idle");
  bumpVersion();
}
var switchChain = Promise.resolve();
var pendingSwitches = 0;
function enqueueSwitch(shutdownRoot, key) {
  pendingSwitches += 1;
  switchChain = switchChain.then(async () => {
    if (shutdownRoot !== "") await shutdownHostLspAwaited(shutdownRoot);
    if (sessionKey !== key) return;
    connectPendingClient();
  }).catch((error) => {
    console.warn("[lsp] the project switch failed:", error instanceof Error ? error.message : error);
  }).finally(() => {
    pendingSwitches -= 1;
  });
}
function refreshLsp() {
  publishHealth();
  const store = sessionStore;
  if (store === null || store === void 0) {
    if (sessionKey !== null) {
      sessionKey = null;
      sessionRoot = "";
      stopLsp();
    }
    return;
  }
  const lspSettings = store.state?.settings?.lsp ?? null;
  const root = typeof store.state?.root === "string" ? store.state.root : "";
  const enabled = sessionEnabled && lspSettings?.enabled !== false;
  const wanted = sessionWanted(store, root);
  const policy = indexScopePolicy(lspSettings);
  if (!sameRoot(sessionRoot, root)) sessionScopeRoot = "";
  const key = sessionKeyOf(enabled, root, policy, sessionScopeRoot, wanted);
  if (key === sessionKey) return;
  const hadClient = currentClient !== null;
  const previousRoot = sessionRoot;
  sessionKey = key;
  sessionRoot = root;
  if (!sameRoot(previousRoot, root)) {
    resetLspHealth();
    reportLspFocus(root);
  }
  if (wanted) {
    if (hadClient) stopLsp();
    const shutdownRoot = previousRoot !== "" && !sameRoot(previousRoot, root) ? previousRoot : "";
    if (shutdownRoot === "" && pendingSwitches === 0) {
      startLsp();
    } else {
      startLsp({ waitForShutdown: true });
      enqueueSwitch(shutdownRoot, key);
    }
  } else if (hadClient) {
    shutdownHostLsp(previousRoot);
    stopLsp();
  }
}
function configureLsp(store) {
  sessionStore = store ?? null;
  sessionGeneration += 1;
  const generation = sessionGeneration;
  if (unsubscribeStore !== null) {
    unsubscribeStore();
    unsubscribeStore = null;
  }
  sessionKey = null;
  sessionScopeRoot = "";
  lastProcessId = null;
  if (store !== null && store !== void 0) releasedStores.delete(store);
  if (typeof store?.subscribe === "function") {
    unsubscribeStore = store.subscribe(() => {
      watchServerProcess(store);
      refreshLsp();
    });
  }
  void loadLspLibrary().then(() => {
    if (generation !== sessionGeneration) return;
    redirectErrorsToToast();
    if (currentClient !== null) return;
    sessionKey = null;
    refreshLsp();
  }, (error) => {
    console.warn("[lsp] the client library could not be loaded:", error instanceof Error ? error.message : error);
  });
  refreshLsp();
}
var releasedStores = /* @__PURE__ */ new WeakSet();
function releaseLspForStore(store) {
  if (store === null || store === void 0) return;
  if (releasedStores.has(store)) return;
  releasedStores.add(store);
  const root = typeof store?.state?.root === "string" ? store.state.root : "";
  if (typeof store?.releaseLsp === "function") {
    try {
      store.releaseLsp();
    } catch (error) {
      console.warn("[lsp] the store could not release its session:", error instanceof Error ? error.message : error);
    }
  }
  if (store === sessionStore) {
    if (unsubscribeStore !== null) {
      unsubscribeStore();
      unsubscribeStore = null;
    }
    stopLsp();
    sessionKey = null;
    sessionRoot = "";
  }
  if (root !== "" && !sameRoot(root, sessionRoot)) shutdownHostLsp(root);
}
function lspExtensions() {
  if (currentClient === null) return [];
  const library2 = lspLibrary();
  if (library2 === null) return [];
  return [
    // The semantic completion runs next to the local one; it must not
    // override it (PRD §4.2).
    //
    // It is the FAITHFUL one (`lsp-completion.js`): the completion of a
    // language server must not be able to rewrite the text of the user. The
    // library would apply it BY ITSELF when a "commit character" is typed -
    // and the commit characters of a server are the symbols a user types
    // while writing prose (`#`, `*`, `+`, `/`, `.`): typing `###` at the
    // start of a line swallowed the characters and converted the line. The
    // faithful source publishes NO commit characters (the completion is
    // accepted with Enter or Tab) and clamps its range to the word at the
    // cursor.
    ...faithfulServerCompletionExtensions(library2.serverCompletionSource),
    library2.hoverTooltips({ hoverTime: 300 }),
    library2.signatureHelp({ keymap: false }),
    // The Ctrl+hover hint and the Ctrl+click belong to the same feature:
    // they promise the target of the jump before the click.
    ...ctrlHoverExtensions()
  ];
}
function lspSessionVersion() {
  return sessionVersion;
}
function shortcutFor(name2) {
  const table = sessionStore?.state?.settings?.shortcuts;
  const value = table?.[name2];
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  return DEFAULT_SHORTCUTS[name2] ?? "";
}
function keymapKeyFor(name2) {
  const shortcut = shortcutFor(name2);
  if (shortcut === "") return "";
  return shortcut.split("+").map((part) => {
    const key = part.trim();
    if (key === "Cmd" || key === "Command" || key === "Meta") return "Mod";
    if (key === "Control") return "Ctrl";
    if (key === "Option") return "Alt";
    return key;
  }).filter((part) => part !== "").join("-");
}
function findUsagesText(identifier) {
  const text = typeof identifier === "string" ? identifier.trim() : "";
  if (text === "") return;
  const store = sessionStore;
  if (store === null || typeof store.findUsagesText !== "function") return;
  try {
    void store.findUsagesText(text);
  } catch (error) {
    console.warn("[lsp] text search failed:", error instanceof Error ? error.message : error);
  }
}

// src/client/extensions.js
function codeintelExtensionSlots() {
  return [
    {
      key: "closeBrackets",
      priority: CODEINTEL_PRIORITY,
      extensions: [closeBrackets(), keymap.of(closeBracketsKeymap)]
    },
    {
      key: "autocomplete",
      priority: CODEINTEL_PRIORITY,
      // `icons: false` keeps the popup free of the icon set of the library.
      extensions: [autocompletion({ activateOnTyping: true, icons: false })]
    },
    {
      key: "lsp",
      priority: CODEINTEL_PRIORITY,
      extensions: lspExtensions()
    }
  ];
}
function wordAtCursor(state, pos) {
  if (state === null || state === void 0) return null;
  if (!Number.isInteger(pos) || pos < 0 || pos > state.doc.length) return null;
  const line = state.doc.lineAt(pos);
  const text = line.text;
  let start = Math.min(pos - line.from, text.length);
  let end = start;
  while (start > 0 && /[\w$]/.test(text[start - 1])) start -= 1;
  while (end < text.length && /[\w$]/.test(text[end])) end += 1;
  if (end <= start) return null;
  return text.slice(start, end);
}
function findUsagesTextCommand(view) {
  if (view === null || view === void 0) return false;
  const word = wordAtCursor(view.state, view.state.selection.main.head);
  if (word === null) return false;
  findUsagesText(word);
  return true;
}
function codeintelKeymap() {
  const entries = [];
  const library2 = lspLibrary();
  const goToDefinition = keymapKeyFor("goToDefinition");
  if (goToDefinition !== "" && library2 !== null) {
    entries.push({ key: goToDefinition, run: library2.jumpToDefinition, preventDefault: true });
  }
  const findUsages = keymapKeyFor("findUsages");
  if (findUsages !== "" && library2 !== null) {
    entries.push({ key: findUsages, run: library2.findReferences, preventDefault: true });
  }
  const findUsagesText2 = keymapKeyFor("findUsagesText");
  if (findUsagesText2 !== "") entries.push({ key: findUsagesText2, run: findUsagesTextCommand, preventDefault: true });
  const complete = keymapKeyFor("complete");
  if (complete !== "") entries.push({ key: complete, run: startCompletion, preventDefault: true });
  return entries;
}
function codeintelCommands(store) {
  const navigation = store.semanticNavigation();
  return [
    {
      key: "codeintel.goToDefinition",
      label: store.t("nav.goToDefinition"),
      shortcut: keymapKeyFor("goToDefinition"),
      run: () => {
      },
      enabled: () => navigation.findUsages.enabled
    },
    {
      key: "codeintel.findUsages",
      label: store.t("nav.findUsages"),
      shortcut: keymapKeyFor("findUsages"),
      run: () => {
      },
      enabled: () => navigation.findUsages.enabled
    },
    {
      key: "codeintel.findUsagesText",
      label: store.t("nav.findUsagesText"),
      shortcut: keymapKeyFor("findUsagesText"),
      run: () => {
      },
      enabled: () => true
    }
  ];
}

// src/client/cm-runtime.js
init_cm_runtime();
function bindCodemirror(runtime) {
  if (runtime === null || runtime === void 0) return false;
  if (typeof runtime !== "object") return false;
  if (globalThis[CM_RUNTIME_KEY] !== void 0) return false;
  globalThis[CM_RUNTIME_KEY] = runtime;
  return true;
}

// src/client/store.js
var DEFAULT_SHORTCUTS2 = Object.freeze({
  goToDefinition: "F12",
  findUsages: "Alt+F7",
  findUsagesText: "Alt+F8",
  complete: "Ctrl+Space"
});
function initialState() {
  return {
    /** The project root of the contract, `''` while there is none. */
    root: "",
    /** The root the program of the language server is built for. */
    scopeRoot: null,
    /** True while the IDE workbench plugin is missing (DEG-01). */
    degraded: false,
    /** The reason of the degradation, shown in the settings. */
    degradedReason: "",
    /** The version of the contract, 0 while there is none. */
    contractVersion: 0,
    /** The settings document of the plugin. */
    settings: {
      lsp: { ...DEFAULT_LSP_SETTINGS },
      shortcuts: { ...DEFAULT_SHORTCUTS2 }
    },
    /** The mirrored status of the language server. */
    lsp: {
      enabled: true,
      state: "idle",
      languageId: "",
      serverId: "",
      detail: null,
      progress: "",
      startedAt: 0,
      cancellable: false,
      indexedRoots: [],
      liveRoots: [],
      clientState: "idle",
      clientDetail: "",
      clientSince: 0,
      scopeRoot: null,
      processId: 0,
      buildingProgram: false,
      servers: { available: [], missing: [] },
      consecutiveFailures: 0,
      consecutiveTimeouts: 0,
      lastFailure: null,
      resources: null,
      stderrLines: [],
      rebuilding: false
    },
    /**
     * The result of the last search.
     *
     * The two entries (Find in Files and the text version of Find Usages)
     * share the slice and differ only in `textMatch`: a text hit carries the
     * label, so the user never mistakes it for a semantic reference.
     */
    search: {
      query: "",
      caseSensitive: false,
      wholeWord: false,
      regexp: false,
      textMatch: false,
      loading: false,
      error: null,
      results: [],
      tookMs: 0,
      truncated: false,
      token: 0
    },
    /** The state of the Find in Files popup. */
    searchPopup: { open: false, index: 0, generation: 0 },
    /** The pending index decision (`null` while no dialog is open). */
    indexDecision: null,
    /** The pending memory warning. */
    memoryDecision: null,
    /** The transient notice of the plugin. */
    toast: null,
    /**
     * True while the mirrored status is unknown.
     *
     * A failed poll leaves the client with a value that may be minutes old:
     * the status bar has to say that it does not know, not repeat the
     * "starting" of ten minutes ago (PRD-v5 §2.3).
     */
    lspStatusStale: false,
    /**
     * The documents the core reports.
     *
     * The core owns the tabs; the plugin only mirrors the documents it needs
     * for the language server (the draft of a file has to reach the server,
     * never the file on the disk).
     */
    documents: []
  };
}
function crashAdviceFor(detail, t2) {
  const text = typeof detail === "string" ? detail.toLowerCase() : "";
  if (text.includes("timeout")) return t2("lsp.crashedTimeout");
  if (text.includes("memory budget")) return t2("lsp.crashedBudget");
  if (text.includes("memory") || text.includes("out of memory")) return t2("lsp.crashedMemory");
  return t2("lsp.crashedGeneric");
}
function sameResources(left, right) {
  if (left === null || left === void 0 || typeof left !== "object") return false;
  if (right === null || right === void 0 || typeof right !== "object") return false;
  const mib = 1024 * 1024;
  const fields = ["freeBytes", "availableBytes", "reservedBytes", "measuredBytes", "worstCaseBytes", "thresholdBytes", "safeAvailableBytes", "budgetUsedBytes"];
  for (const field of fields) {
    const leftMB = Math.round((Number.isFinite(left?.[field]) ? left[field] : 0) / mib);
    const rightMB = Math.round((Number.isFinite(right?.[field]) ? right[field] : 0) / mib);
    if (leftMB !== rightMB) return false;
  }
  if (Math.round(Number.isFinite(left?.needMB) ? left.needMB : 0) !== Math.round(Number.isFinite(right?.needMB) ? right.needMB : 0)) return false;
  if ((left?.decision ?? "") !== (right?.decision ?? "")) return false;
  return true;
}
function memoryDecisionOf(resources) {
  if (resources === null || resources === void 0) return "ok";
  const published = typeof resources.decision === "string" ? resources.decision : "";
  if (published !== "") return published;
  if (resources.tight === true) return "tight";
  if (resources.canIndex === false) return "low";
  return "ok";
}
var CodeIntelStore = class {
  /**
   * @param {{t?: (key: string) => string, contract?: any} | any} [options] the
   *   translator of the plugin and the contract (when it is already there),
   *   or the client context of the host - the plugin needs no service of the
   *   host: everything comes through the contract
   * @param {((key: string) => string) | null} [t] the translator, when it is
   *   handed over as the second argument (the signature the migrated tests
   *   of the core used)
   */
  constructor(options2 = {}, t2 = null) {
    this.t = typeof t2 === "function" ? t2 : typeof options2?.t === "function" ? options2.t : ((key) => key);
    this.contract = options2?.contract ?? null;
    this.state = initialState();
    this.listeners = /* @__PURE__ */ new Set();
    this.toastTimer = null;
    this.lspPollTimer = null;
    this.unsubscribers = [];
    this.lspFaultNotified = false;
    this.lspSessionFaultNotified = false;
    this.indexDecisionResolve = null;
    this.memoryDecisionResolve = null;
    this.lspIndexDecisions = /* @__PURE__ */ new Map();
    this.searchToken = 0;
    this.visibilityBound = false;
    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      document.addEventListener("visibilitychange", this.#onVisibilityChange);
      this.visibilityBound = true;
    }
  }
  // ── the state ─────────────────────────────────────────────────────────────
  /**
   * Subscribe to the state.
   * @param {() => void} listener the subscriber
   * @returns {() => void} the unsubscription
   */
  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  /**
   * The current state, for `useSyncExternalStore`.
   * @returns {any} the state
   */
  getSnapshot = () => this.state;
  /**
   * Replace the state and wake the subscribers.
   *
   * A patch whose values are all `===` to the current ones changes nothing,
   * so it neither replaces the state object nor wakes the subscribers.
   * @param {Record<string, unknown>} patch the patch
   */
  set(patch) {
    if (patch === null || typeof patch !== "object") {
      this.state = { ...this.state, ...patch };
      this.#notify();
      return;
    }
    let changed = false;
    for (const key of Object.keys(patch)) {
      if (this.state[key] !== patch[key]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.state = { ...this.state, ...patch };
    this.#notify();
  }
  /**
   * Patch one nested slice.
   * @param {string} key the name of the slice
   * @param {Record<string, unknown>} patch the patch of the slice
   */
  patch(key, patch) {
    this.set({ [key]: { ...this.state[key], ...patch } });
  }
  /** Wake every subscriber. */
  #notify() {
    for (const listener of [...this.listeners]) listener();
  }
  /**
   * Show a transient notice.
   * @param {'error'|'success'|'info'} kind the kind of the notice
   * @param {string} text the text
   * @param {string} [detail] the detail (the tooltip)
   * @param {any} [action] the action of the notice
   */
  toast(kind, text, detail, action) {
    this.set({ toast: { id: `${Date.now()}-${Math.random()}`, kind, text, detail: detail ?? "", action: action ?? null } });
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toastTimer = null;
      this.set({ toast: null });
    }, kind === "error" ? 9e3 : 4500);
  }
  /**
   * Translate a key and fill in its `{placeholder}` slots.
   *
   * The translate function of the host does not interpolate, so the slots of
   * the texts of the plugin are filled in here.
   * @param {string} key the key
   * @param {Record<string, string | number>} [values] the values
   * @returns {string} the text
   */
  tpl(key, values = {}) {
    let text = this.t(key);
    for (const [name2, value] of Object.entries(values)) {
      text = text.replaceAll(`{${name2}}`, String(value));
    }
    return text;
  }
  // ── the contract ──────────────────────────────────────────────────────────
  /**
   * Take over a contract of the IDE workbench.
   *
   * The contract is the ONLY channel to the core: the project root, the
   * documents, the files and the editor all come from it. The store follows
   * the project of the core and never guesses one.
   * @param {any} contract the contract
   */
  attachContract(contract) {
    if (contract === null || contract === void 0) return;
    this.contract = contract;
    this.set({
      contractVersion: typeof contract.version === "number" ? contract.version : 0,
      degraded: false,
      degradedReason: ""
    });
    this.#followProject();
    this.unsubscribers.push(this.#followProjectUnsubscribe());
  }
  /**
   * Leave the contract behind.
   *
   * The core was unloaded: the session of the client is released, so no
   * language server of the browser keeps running for a project that is gone.
   */
  detachContract() {
    for (const unsubscribe of this.unsubscribers.splice(0)) {
      try {
        unsubscribe();
      } catch {
      }
    }
    try {
      releaseLspForStore(this);
    } catch (error) {
      console.warn("[codeintel] the session could not be released:", error instanceof Error ? error.message : error);
    }
    this.contract = null;
    this.set({ root: "", scopeRoot: null, contractVersion: 0 });
  }
  /**
   * Read the project root of the contract and follow it.
   *
   * The core owns the project: the codeintel asks the contract and never
   * keeps a root of its own that could drift away from the one of the user.
   */
  #followProject() {
    const host = this.contract?.host;
    if (host === null || host === void 0) return;
    let root = "";
    let scopeRoot = null;
    try {
      root = typeof host.getProjectRoot === "function" ? host.getProjectRoot() ?? "" : "";
      scopeRoot = typeof host.getScopeRoot === "function" ? host.getScopeRoot() ?? null : null;
    } catch {
      return;
    }
    if (typeof root !== "string") root = "";
    this.set({ root, scopeRoot: typeof scopeRoot === "string" && scopeRoot !== "" ? scopeRoot : null });
  }
  /**
   * The subscription to the changes of the project.
   * @returns {() => void} the unsubscription
   */
  #followProjectUnsubscribe() {
    const host = this.contract?.host;
    if (host === null || host === void 0) return () => {
    };
    if (typeof host.onProjectChanged !== "function") return () => {
    };
    try {
      const unsubscribe = host.onProjectChanged(() => {
        this.#followProject();
      });
      return typeof unsubscribe === "function" ? unsubscribe : () => {
      };
    } catch {
      return () => {
      };
    }
  }
  /**
   * Read a file through the contract.
   *
   * The fence of the core applies: a path outside of the project is refused
   * by the host, not by the plugin.
   * @param {string} absolutePath the absolute path
   * @returns {Promise<string | null>} the content, or `null`
   */
  async readFile(absolutePath) {
    const host = this.contract?.host;
    if (host === null || host === void 0 || typeof host.readFile !== "function") return null;
    try {
      const result = await host.readFile(absolutePath);
      if (typeof result === "string") return result;
      if (result !== null && typeof result === "object" && typeof result.content === "string") return result.content;
      return null;
    } catch {
      return null;
    }
  }
  /**
   * Show a file to the user.
   *
   * The contract reveals the position in the editor of the core; the
   * codeintel does not open tabs of its own.
   * @param {string} absolutePath the absolute path
   * @param {{line?: number, column?: number}} [options] the position
   */
  openFile(absolutePath, options2 = {}) {
    const editor = this.contract?.editor;
    if (editor === null || editor === void 0 || typeof editor.reveal !== "function") return;
    try {
      editor.reveal(absolutePath, options2.line ?? 1, options2.column);
    } catch {
    }
  }
  /**
   * Take over one document of the core.
   *
   * The core broadcasts the document when the tab changes and when the
   * content changes; the plugin keeps the last one of every file, so the
   * language server sees the DRAFT of a file and never the file on the disk.
   * @param {any} document the document (`uri`, `absolutePath`, `languageId`,
   *   `content`, `dirty`)
   */
  setDocument(document2) {
    if (document2 === null || typeof document2 !== "object") return;
    const uri = typeof document2.uri === "string" ? document2.uri : "";
    if (uri === "") return;
    const documents = this.state.documents ?? [];
    const next = documents.filter((entry) => entry.uri !== uri);
    next.push({
      uri,
      absolutePath: typeof document2.absolutePath === "string" ? document2.absolutePath : "",
      languageId: typeof document2.languageId === "string" ? document2.languageId : "",
      content: typeof document2.content === "string" ? document2.content : "",
      dirty: document2.dirty === true
    });
    this.set({ documents: next });
    const languageId = this.languageOnScreen();
    if (languageId !== "") {
      this.set({ lsp: { ...this.state.lsp, languageId } });
      setLspLanguageHint(this.state.root, languageId);
    }
  }
  /**
   * The language of the file on the screen, when the host has a server for it.
   *
   * A language without a server is not reported: the host would refuse an id
   * that is not in its registry, and its own detection decides then.
   * @returns {string} the language, or `''`
   */
  languageOnScreen() {
    const documents = this.state.documents ?? [];
    const last = documents[documents.length - 1];
    const languageId = typeof last?.languageId === "string" ? last.languageId : "";
    if (languageId === "") return "";
    return LSP_LANGUAGE_IDS.includes(languageId) ? languageId : "";
  }
  /**
   * The document of one URI, when the core reported it.
   * @param {string} uri the document URI
   * @returns {any} the document, or `undefined`
   */
  documentOf(uri) {
    const documents = this.state.documents ?? [];
    return documents.find((entry) => entry.uri === uri);
  }
  // ── the settings ──────────────────────────────────────────────────────────
  /**
   * Load the settings document of the plugin.
   *
   * The document lives in the profile of the plugin
   * (`<profile>/dsh-codeintel/settings.json`); the host half of the plugin
   * owns it. A host that cannot answer leaves the defaults in place: the
   * plugin then works with its defaults instead of refusing to start.
   * @returns {Promise<void>}
   */
  async init() {
    try {
      const result = await call("settings.get");
      const value = result?.value ?? result;
      if (value === null || typeof value !== "object") return;
      this.set({
        settings: {
          lsp: { ...DEFAULT_LSP_SETTINGS, ...value.lsp ?? {} },
          shortcuts: { ...DEFAULT_SHORTCUTS2, ...value.shortcuts ?? {} }
        }
      });
    } catch (error) {
      console.warn("[codeintel] the settings could not be read:", error instanceof Error ? error.message : error);
    }
  }
  /**
   * Write a patch of the settings document.
   *
   * The change is applied to the local state first and written afterwards;
   * a failed write takes the change back, so the client and the document do
   * not disagree about what the user has chosen.
   * @param {Record<string, unknown>} patch the patch of the document
   * @returns {Promise<void>}
   */
  async updateSettings(patch) {
    const previous = this.state.settings;
    this.set({ settings: { ...previous, ...patch } });
    try {
      await call("settings.update", { patch });
    } catch (error) {
      console.warn("[lsp] the settings of the semantic analysis could not be written:", error instanceof Error ? error.message : error);
      this.set({ settings: previous });
    }
  }
  /**
   * Write a patch of the `lsp` section of the settings.
   *
   * The change is applied to the local state first and written afterwards; a
   * failed write takes the change back - and ONLY the fields of this write:
   * the settings page moved the budget share while the write of the decision
   * was in flight, and the rollback must not touch it (review R3).
   * @param {Record<string, unknown>} patch the patch
   * @returns {Promise<void>}
   */
  async updateLspSettings(patch) {
    const previous = this.state.settings.lsp ?? {};
    const lsp = { ...previous, ...patch };
    this.set({ settings: { ...this.state.settings, lsp } });
    try {
      await call("settings.update", { patch: { lsp: patch } });
    } catch (error) {
      console.warn("[lsp] the settings of the semantic analysis could not be written:", error instanceof Error ? error.message : error);
      const current = this.state.settings.lsp ?? {};
      const restored = { ...current };
      for (const key of Object.keys(patch)) {
        if (Object.hasOwn(previous, key)) {
          restored[key] = previous[key];
          continue;
        }
        delete restored[key];
      }
      this.set({ settings: { ...this.state.settings, lsp: restored } });
    }
  }
  // ── the index decision ────────────────────────────────────────────────────
  /**
   * The answer of the user the last time the memory was tight.
   *
   * The map remembers ONE thing: "do not ask me again". The legacy value
   * 'accepted' is read as 'conservative' - the old semantics remembered a
   * PERMISSION to force the start, and that permission was contagious.
   * @param {string} root the project root
   * @returns {'conservative'|''} the answer
   */
  #memoryAnswer(root) {
    const warned = this.state.settings?.lsp?.memoryWarnedRoots;
    if (warned === null || warned === void 0 || typeof warned !== "object") return "";
    const key = Object.keys(warned).find((entry) => sameScopePath(entry, root));
    if (key === void 0) return "";
    const answer = warned[key];
    if (answer === "conservative" || answer === "accepted") return "conservative";
    return "";
  }
  /**
   * The workspace-scoped default of one project root.
   *
   * The map outranks the global policy in both directions (PRD-v5.1 WS-04):
   * a project the user sent to the basic mode stays there, and a project the
   * user wants indexed is indexed without a question.
   * @param {string} root the project root
   * @returns {'build'|'conservative'|null} the default
   */
  #workspaceDefault(root) {
    const defaults = this.state.settings?.lsp?.workspaceDefaults;
    if (defaults === null || defaults === void 0 || typeof defaults !== "object") return null;
    const key = Object.keys(defaults).find((entry) => sameScopePath(entry, root));
    if (key === void 0) return null;
    const value = defaults[key];
    return value === "build" || value === "conservative" ? value : null;
  }
  /**
   * Whether one project root completed a first program build.
   *
   * Both sources count: the roots of the settings document and the profile
   * settings.
   * @param {string} root the project root
   * @returns {boolean} true when the folder is indexed
   */
  #isIndexed(root) {
    const roots = this.state.settings?.lsp?.indexedRoots;
    if (roots === null || roots === void 0 || typeof roots !== "object") return false;
    return Object.keys(roots).some((key) => sameScopePath(key, root));
  }
  /**
   * What the plugin decided about the language server of one project.
   *
   * The answer is 'build' (a language server is wanted), 'conservative' (the
   * basic mode: no server) or 'unknown' (nobody decided yet).
   * @param {string} root the project root
   * @returns {'build'|'conservative'|'unknown'} the decision
   */
  lspIndexDecision(root) {
    if (typeof root !== "string" || root === "") return "unknown";
    const lsp = this.state.settings?.lsp;
    if (lsp === null || lsp === void 0 || typeof lsp !== "object") return "unknown";
    if (lsp.enabled === false) return "conservative";
    const workspace = this.#workspaceDefault(root);
    if (workspace === "conservative") return "conservative";
    if (workspace === "build") return "build";
    if ((lsp.indexOnOpen ?? "ask") === "never") return "conservative";
    if (this.#memoryAnswer(root) === "conservative") return "conservative";
    for (const [key, decision] of this.lspIndexDecisions) {
      if (sameScopePath(key, root)) return decision;
    }
    return "unknown";
  }
  /**
   * The workspace-scoped default of one project root, for the user interface.
   * @param {string} root the project root
   * @returns {'build'|'conservative'|null} the default
   */
  lspWorkspaceDefault(root) {
    if (typeof root !== "string" || root === "") return null;
    return this.#workspaceDefault(root);
  }
  /**
   * Remember the index decision of one project root.
   * @param {string} root the project root
   * @param {'build'|'conservative'} decision the decision
   */
  rememberIndexDecision(root, decision) {
    if (decision !== "build" && decision !== "conservative") return;
    this.lspIndexDecisions.set(root, decision);
  }
  /**
   * Remember the answer of the user to the memory warning.
   *
   * The map remembers ONE thing: "do not ask me again". Only the answer
   * 'conservative' is written - the answer "start anyway" belongs to ONE
   * start and is never remembered, because a remembered permission to force
   * the start would make every later tight moment start the server without
   * asking (PRD-v5.1 MEM-10).
   * @param {string} root the project root
   * @param {'conservative'} answer the answer of the user
   * @returns {Promise<void>}
   */
  async rememberMemoryAnswer(root, answer) {
    const warned = this.state.settings.lsp?.memoryWarnedRoots ?? {};
    await this.updateLspSettings({ memoryWarnedRoots: { ...warned, [root]: answer } });
  }
  /**
   * Write the decision of the user about the semantic analysis of one root.
   *
   * Only a decision the USER made belongs in the settings document: a
   * decision the policy derived would take the choice away from the user.
   * @param {string} root the project root
   * @param {'build'|'conservative'} decision the decision
   * @returns {Promise<void>}
   */
  async rememberWorkspaceDecision(root, decision) {
    const lsp = this.state.settings.lsp ?? {};
    const defaults = { ...lsp.workspaceDefaults ?? {}, [root]: decision };
    const warned = { ...lsp.memoryWarnedRoots ?? {} };
    if (decision === "build") {
      const key = Object.keys(warned).find((entry) => sameScopePath(entry, root));
      if (key !== void 0) warned[key] = null;
    }
    await this.updateLspSettings({ workspaceDefaults: defaults, memoryWarnedRoots: warned });
  }
  /**
   * Answer the pending index decision.
   * @param {'build'|'conservative'|'cancel'} choice the answer of the user
   */
  resolveIndexDecision(choice) {
    const resolve = this.indexDecisionResolve;
    this.indexDecisionResolve = null;
    this.set({ indexDecision: null });
    if (resolve === null) return;
    resolve(choice === "build" ? "build" : choice === "conservative" ? "conservative" : "cancel");
  }
  /**
   * Show the index decision and wait for the answer of the user.
   * @param {{path: string, name?: string, language?: string, needMB?: number}} project the project
   * @returns {Promise<'build'|'conservative'|'cancel'>} the answer
   */
  askIndexDecision(project) {
    if (this.indexDecisionResolve !== null) this.indexDecisionResolve("cancel");
    return new Promise((resolve) => {
      this.indexDecisionResolve = resolve;
      this.set({
        indexDecision: {
          path: project.path,
          name: typeof project.name === "string" && project.name !== "" ? project.name : baseName(project.path),
          language: typeof project.language === "string" ? project.language : "",
          needMB: Number.isFinite(project.needMB) ? project.needMB : 0
        }
      });
    });
  }
  // ── the client session ────────────────────────────────────────────────────
  /**
   * Show the memory warning and wait for the user's answer.
   *
   * The host refuses to start a language server on a tight budget unless the
   * start is forced, so this dialog is the only way out of the "tight" band.
   *
   * The number of the dialog is the one the gate judged by
   * (`availableBytes`): the popup said "2648 MB available" while the gate
   * decided with 600 MB, so the same question got two opposite answers on
   * two screens (PRD-v5.1 MEM-09).
   * @param {{path: string, name?: string}} project the project
   * @param {{needMB?: number, availableBytes?: number, freeBytes?: number, languageId?: string}} resources
   *   the memory snapshot of the host
   * @returns {Promise<'start'|'conservative'>} the answer of the user
   */
  askMemoryDecision(project, resources) {
    if (this.memoryDecisionResolve !== null) this.memoryDecisionResolve("conservative");
    const language2 = typeof resources?.languageId === "string" && resources.languageId !== "" ? resources.languageId : "semantic analysis";
    return new Promise((resolve) => {
      this.memoryDecisionResolve = resolve;
      this.set({
        memoryDecision: {
          path: project.path,
          name: typeof project.name === "string" && project.name !== "" ? project.name : baseName(project.path),
          language: language2,
          needMB: Math.round(resources?.needMB ?? 0),
          // The field keeps its name: the dialog renders it, and the field
          // name is not worth a second wave through the renderer.
          freeMB: Math.round((resources?.availableBytes ?? resources?.freeBytes ?? 0) / (1024 * 1024))
        }
      });
    });
  }
  /**
   * Answer the pending memory warning.
   * @param {'start'|'conservative'} choice the answer of the user
   */
  resolveMemoryDecision(choice) {
    const resolve = this.memoryDecisionResolve;
    this.memoryDecisionResolve = null;
    this.set({ memoryDecision: null });
    if (resolve === null) return;
    resolve(choice === "start" ? "start" : "conservative");
  }
  /**
   * Decide what happens with the index of one project root.
   *
   * The decision is the user's: the plugin asks when the policy does not
   * answer, and it remembers what the user said (PRD-v5 §2.3). The hierarchy
   * is the one of PRD-v5.1 WS-04:
   *
   *   1. the master switch: the feature is off, so nothing is started;
   *   2. the workspace-scoped default of the user: it outranks the policy in
   *      both directions;
   *   3. the policy `indexOnOpen` ('ask', 'always', 'never');
   *   4. the memory gate: a machine below the floor degrades, a tight
   *      machine asks the user;
   *   5. the dialog of the index decision.
   *
   * @param {string} root the project root
   * @param {{ask?: boolean}} [options] `ask: false` decides without a dialog
   * @returns {Promise<'build'|'build-forced'|'conservative'|'cancel'>} the decision
   */
  async decideIndex(root, options2 = {}) {
    const ask = options2.ask !== false;
    const lsp = this.state.settings?.lsp;
    if (lsp === null || lsp === void 0 || typeof lsp !== "object") return "conservative";
    if (lsp.enabled === false) return "conservative";
    const workspace = this.#workspaceDefault(root);
    if (workspace === "conservative") return "conservative";
    if (workspace === "build") return "build";
    if ((lsp.indexOnOpen ?? "ask") === "never") return "conservative";
    if (this.#memoryAnswer(root) === "conservative") return "conservative";
    if (this.#isIndexed(root)) return "build";
    const resources = await this.#lspResources(root);
    const decision = memoryDecisionOf(resources);
    if (decision === "low") {
      const need = Math.round((resources?.thresholdBytes ?? 0) / (1024 * 1024));
      const free = Math.round((resources?.availableBytes ?? resources?.freeBytes ?? 0) / (1024 * 1024));
      this.toast("error", this.tpl("lsp.lowMemory", { need, free }), this.t("lsp.lowMemoryHint"));
      return "conservative";
    }
    if (decision === "tight") {
      const choice2 = await this.askMemoryDecision({ path: root }, resources ?? {});
      if (choice2 === "conservative") {
        await this.rememberMemoryAnswer(root, "conservative");
        await this.rememberWorkspaceDecision(root, "conservative");
        return "conservative";
      }
      return "build-forced";
    }
    if ((lsp.indexOnOpen ?? "ask") === "always") {
      await this.#startServer(root, false);
      return "build";
    }
    if (!ask) return "conservative";
    const choice = await this.askIndexDecision({
      path: root,
      language: typeof resources?.languageId === "string" ? resources.languageId : "",
      needMB: Number.isFinite(resources?.needMB) ? resources.needMB : 0
    });
    if (choice === "build") {
      await this.rememberWorkspaceDecision(root, "build");
      await this.#startServer(root, false);
      return "build";
    }
    if (choice === "conservative") {
      await this.rememberWorkspaceDecision(root, "conservative");
      return "conservative";
    }
    return "cancel";
  }
  /**
   * Ask the host to start the language server of one root.
   *
   * The plugin owns the language servers, so it is the plugin that asks for
   * one - and it asks with the language of the file on the screen, so a
   * mixed repository starts the server of the language the user is looking
   * at (PRD-v5.1 JS-04).
   * @param {string} root the project root
   * @param {boolean} force whether the memory gate may be skipped
   * @returns {Promise<void>}
   */
  async #startServer(root, force) {
    const languageId = this.languageOnScreen();
    const payload = languageId === "" ? { root, force } : { root, languageId, force };
    try {
      await call("lsp.start", payload);
    } catch (error) {
      console.warn("[lsp] the language server could not be started:", error instanceof Error ? error.message : error);
    }
  }
  /**
   * The state of the client session, as the session reports it.
   *
   * The session of the client is a fault of its own: the host may be healthy
   * while the link between the browser and the server is dead. The failure is
   * only announced while the host claims to be all right - in every other
   * state the host knows the reason, and its explanation is the truth.
   * @param {'starting'|'ready'|'failed'|'idle'} state the state of the session
   * @param {string} [detail] the reason of the failure
   * @param {number} [since] the moment the client started waiting
   */
  lspSessionState(state, detail = "", since = 0) {
    const next = typeof state === "string" && state !== "" ? state : "starting";
    const reason = typeof detail === "string" ? detail : "";
    const started = Number.isFinite(since) && since > 0 ? since : 0;
    const lsp = this.state.lsp ?? {};
    if (lsp.clientState === next && lsp.clientDetail === reason && lsp.clientSince === started) return;
    this.patch("lsp", { clientState: next, clientDetail: reason, clientSince: started });
    if (next !== "failed") {
      this.lspSessionFaultNotified = false;
      return;
    }
    if (this.lspSessionFaultNotified) return;
    if (!LSP_HOST_HEALTHY_STATES.includes(lsp.state)) return;
    this.lspSessionFaultNotified = true;
    this.toast("error", this.t("lsp.sessionFailedToast"));
  }
  /**
   * The store-side half of the release of the semantic session.
   *
   * The session module calls this method when it releases a store (the
   * method is optional there), so it must NOT call the session module back:
   * that would be a recursion. The session itself is released by
   * `releaseLspForStore(store)`, which the bridge calls when the contract
   * goes away.
   *
   * The method is idempotent: the release may come twice, and a second call
   * must not clear a state that was filled again in between.
   */
  releaseLsp() {
    if (this.lspPollTimer !== null) {
      clearInterval(this.lspPollTimer);
      this.lspPollTimer = null;
    }
    this.patch("lsp", { ...initialState().lsp, servers: this.state.lsp?.servers ?? { available: [], missing: [] } });
    this.lspFaultNotified = false;
    this.lspSessionFaultNotified = false;
  }
  /**
   * Reconnect the semantic analysis: the way out of a dead session.
   *
   * The handshake of the client goes first: the host replays the handshake it
   * holds to the next language server process. The restart of the host comes
   * second: a new process means a new frame worker with an empty handshake
   * cache, so the `initialize` really reaches the server again.
   *
   * The restart is skipped when the user refused a language server for this
   * project: the button may not start a server behind their back.
   * @returns {Promise<void>}
   */
  async reconnectLsp() {
    try {
      reconnectLsp();
    } catch {
    }
    if (this.lspIndexDecision(this.state.root) === "conservative") return;
    await this.restartLsp();
  }
  /**
   * Restart the language server of the current project.
   *
   * The server is stopped and started again, so its index is built from
   * scratch - that is the price of the way out of a broken session.
   * @returns {Promise<void>}
   */
  async restartLsp() {
    const root = this.state.root;
    if (root === "") return;
    await this.rememberWorkspaceDecision(root, "build");
    this.rememberIndexDecision(root, "build");
    this.patch("lsp", { rebuilding: true });
    try {
      await call("lsp.shutdown", { root });
    } catch {
    }
    const resources = this.state.lsp?.resources ?? await this.#lspResources(root);
    const force = memoryDecisionOf(resources) === "tight";
    const languageId = this.languageOnScreen();
    const payload = languageId === "" ? { root, force } : { root, languageId, force };
    try {
      await call("lsp.start", payload);
    } catch {
    }
    await this.refreshLspStatus();
    this.patch("lsp", { rebuilding: false });
  }
  /**
   * The memory snapshot of the host for one root.
   * @param {string} root the project root
   * @returns {Promise<any>} the snapshot, or `null`
   */
  async #lspResources(root) {
    try {
      const result = await call("lsp.resources", { root });
      if (result === null || typeof result !== "object") return null;
      return result;
    } catch {
      return null;
    }
  }
  /**
   * Fall back to the conservative mode.
   *
   * The decision comes first: the session asks the store whether it wants a
   * server, and the answer has to be "no" before the server is gone.
   * @returns {Promise<void>}
   */
  async degradeLsp() {
    const root = this.state.root;
    if (root === "") return;
    this.rememberIndexDecision(root, "conservative");
    await this.rememberWorkspaceDecision(root, "conservative");
    try {
      await call("lsp.shutdown", { root });
    } catch {
    }
    await this.refreshLspStatus();
  }
  /**
   * Cancel a running index build.
   * @returns {Promise<void>}
   */
  async cancelLspIndex() {
    const root = this.state.root;
    if (root === "") return;
    try {
      await call("lsp.cancelIndex", { root });
    } catch {
    }
    await this.refreshLspStatus();
  }
  /**
   * Read the memory snapshot and the log of the language server.
   * @returns {Promise<void>}
   */
  async loadLspResources() {
    const root = this.state.root;
    if (root === "") return;
    const languageId = this.languageOnScreen();
    const payload = languageId === "" ? { root } : { root, languageId };
    let resources = null;
    try {
      resources = await call("lsp.resources", payload);
    } catch {
      resources = null;
    }
    let stderrLines = this.state.lsp.stderrLines ?? [];
    try {
      const logs = await call("lsp.logs", { root });
      if (logs !== null && typeof logs === "object" && Array.isArray(logs.lines)) stderrLines = logs.lines;
    } catch {
    }
    this.patch("lsp", { resources, stderrLines });
  }
  /**
   * Read the registry of the language servers.
   * @returns {Promise<void>}
   */
  async loadLspServers() {
    try {
      const result = await call("lsp.servers", {});
      this.patch("lsp", {
        servers: {
          available: Array.isArray(result?.available) ? result.available : [],
          missing: Array.isArray(result?.missing) ? result.missing : []
        }
      });
    } catch {
    }
  }
  /**
   * Poll the status of the language server.
   *
   * The poll is the only thing that keeps the mirrored status fresh: the
   * host owns the state machine, and the client only mirrors it.
   *
   * A HIDDEN page does not poll: the browser throttles the timers of a
   * background page to once a minute, and a poll every two seconds would ask
   * the host for nothing. The status is refreshed as soon as the window is
   * visible again (the visibility listener).
   * @returns {Promise<void>}
   */
  async pollLspStatus() {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    await this.refreshLspStatus();
  }
  /**
   * Start the poll of the status.
   *
   * The poll belongs to the lifetime of the store: a store that is dropped
   * must not keep a timer running.
   * @returns {void}
   */
  activate() {
    if (this.lspPollTimer !== null) return;
    this.lspPollTimer = setInterval(() => {
      void this.pollLspStatus();
    }, 2e3);
    if (typeof this.lspPollTimer?.unref === "function") this.lspPollTimer.unref();
  }
  /**
   * Pause the work of the store.
   *
   * The poll of the language server KEEPS running: the status of the server
   * belongs to the project, not to the surface the user is looking at, and a
   * frozen status bar would show a state of minutes ago (PRD-v5 §2.3).
   * @returns {void}
   */
  deactivate() {
  }
  /**
   * The listener of the visibility of the document.
   *
   * A hidden page cannot keep its cadence: the browser throttles the timers
   * of a background page to once a minute, and the status bar would show a
   * state of a minute ago for up to a minute. The listener gives the window
   * its status back as soon as it comes to the front.
   */
  #onVisibilityChange = () => {
    if (typeof document === "undefined" || document.visibilityState !== "visible") return;
    void this.refreshLspStatus();
  };
  /**
   * Read the status of the language server of the current project.
   *
   * The host owns the state machine; the client only mirrors the snapshot.
   * @returns {Promise<void>}
   */
  async refreshLspStatus() {
    const root = this.state.root;
    if (root === "") return;
    let result = null;
    try {
      result = await call("lsp.status", { root });
    } catch {
      this.set({ lspStatusStale: true });
      return;
    }
    if (result === null || typeof result !== "object") {
      this.set({ lspStatusStale: true });
      return;
    }
    this.set({ lspStatusStale: false });
    const lsp = this.state.lsp ?? {};
    const next = {
      enabled: result.enabled !== false,
      state: typeof result.state === "string" ? result.state : lsp.state,
      languageId: typeof result.languageId === "string" ? result.languageId : lsp.languageId,
      detail: typeof result.detail === "string" ? result.detail : lsp.detail,
      startedAt: Number.isFinite(result.startedAt) ? result.startedAt : lsp.startedAt,
      cancellable: result.cancellable === true,
      indexedRoots: Array.isArray(result.indexedRoots) ? result.indexedRoots : lsp.indexedRoots,
      liveRoots: Array.isArray(result.liveRoots) ? result.liveRoots : lsp.liveRoots,
      scopeRoot: typeof result.scopeRoot === "string" ? result.scopeRoot : lsp.scopeRoot,
      processId: Number.isFinite(result.processId) ? result.processId : lsp.processId,
      buildingProgram: result.buildingProgram === true
    };
    if (["ready", "idle", "suspended", "degraded", "failed"].includes(next.state)) {
      next.progress = "";
      next.startedAt = 0;
      next.cancellable = false;
    }
    if (result.resources !== null && typeof result.resources === "object") {
      const previous = lsp.resources;
      if (!sameResources(previous, result.resources)) next.resources = result.resources;
    }
    const changed = {};
    let dirty = false;
    for (const key of Object.keys(next)) {
      if (lsp[key] === next[key]) continue;
      changed[key] = next[key];
      dirty = true;
    }
    if (!dirty) return;
    this.patch("lsp", changed);
    if (["crashed", "degraded"].includes(next.state)) {
      this.#announceLspFault(next.state, next.detail);
    } else if (["starting", "building", "ready", "idle", "suspended"].includes(next.state)) {
      this.lspFaultNotified = false;
    }
    if (["starting", "building", "restarting"].includes(next.state)) {
      await this.#refreshLspIndex(root);
    }
  }
  /**
   * Announce one fault of the language server - once per fault episode.
   *
   * The body of the toast is the advice that follows the reason: a server
   * that died of a timeout has nothing to do with the memory, and a toast
   * that blames the memory sends the user to a setting that cannot help.
   * @param {string} state the state of the host ('crashed' or 'degraded')
   * @param {string} detail the reason the host reported
   * @returns {boolean} whether the toast was shown
   */
  #announceLspFault(state, detail) {
    if (!["crashed", "degraded"].includes(state)) return false;
    if (this.lspFaultNotified) return false;
    this.lspFaultNotified = true;
    const crashed = state === "crashed";
    const advice = crashAdviceFor(detail, (key) => this.t(key));
    this.toast("error", this.t(crashed ? "lsp.crashedToast" : "lsp.degradedToast"), advice);
    const raw = typeof detail === "string" ? detail : "";
    if (raw !== "" && this.state.lsp.detail !== raw) this.patch("lsp", { detail: raw });
    return true;
  }
  /**
   * Read the progress of a running index build.
   * @param {string} root the project root
   * @returns {Promise<void>}
   */
  async #refreshLspIndex(root) {
    let index = null;
    try {
      index = await call("lsp.index", { root });
    } catch {
      return;
    }
    if (index === null || typeof index !== "object") return;
    const lsp = this.state.lsp ?? {};
    const next = {
      progress: typeof index.progress === "string" ? index.progress : lsp.progress,
      startedAt: Number.isFinite(index.startedAt) ? index.startedAt : lsp.startedAt,
      cancellable: index.cancellable === true
    };
    const changed = {};
    let dirty = false;
    for (const key of Object.keys(next)) {
      if (lsp[key] === next[key]) continue;
      changed[key] = next[key];
      dirty = true;
    }
    if (!dirty) return;
    this.patch("lsp", changed);
  }
  /**
   * The control event of the host (a crash, a degradation).
   *
   * A control event may never break the socket it arrived on.
   * @param {any} event the event
   */
  lspControl(event) {
    try {
      if (event === null || typeof event !== "object") return;
      const type = typeof event.type === "string" ? event.type : "";
      if (typeof event.root === "string" && event.root !== "" && !sameScopePath(event.root, this.state.root)) return;
      if (type !== "degraded" && type !== "crash") return;
      this.#announceLspFault(type === "crash" ? "crashed" : "degraded", typeof event.detail === "string" ? event.detail : "");
    } catch {
    }
  }
  /**
   * Whether the navigation entries of the editor are available.
   *
   * The semantic entries need a language server; the text entry is always
   * available, so the user always has a way to find the usages of a symbol.
   * @returns {{findUsages: {enabled: boolean, reason: string}, findUsagesText: {enabled: boolean, reason: string}}} the entries
   */
  semanticNavigation() {
    const lsp = this.state.lsp ?? {};
    const ready = lsp.enabled !== false && (lsp.state === "ready" || lsp.state === "suspended");
    return {
      findUsages: { enabled: ready, reason: ready ? "" : this.t("nav.semanticUnavailable") },
      findUsagesText: { enabled: true, reason: "" }
    };
  }
  // ── the search ────────────────────────────────────────────────────────────
  /**
   * Find the usages of one identifier with a TEXT search.
   *
   * The text search is the fallback of the semantic one: it always works, and
   * every hit carries the label "text match", so the user never mistakes a
   * text hit for a semantic reference.
   * @param {string} identifier the identifier
   * @returns {Promise<void>}
   */
  async findUsagesText(identifier) {
    const query = typeof identifier === "string" ? identifier.trim() : "";
    if (query === "") return;
    const popup = this.state.searchPopup ?? { open: false, index: 0, generation: 0 };
    this.set({ searchPopup: { ...popup, open: true, index: 0, generation: (popup.generation ?? 0) + 1 } });
    this.patch("search", {
      query,
      wholeWord: true,
      caseSensitive: false,
      regexp: false,
      textMatch: true,
      loading: false,
      error: null,
      results: [],
      tookMs: 0,
      truncated: false
    });
    await this.runSearch(query, { wholeWord: true, caseSensitive: false, regexp: false });
  }
  /**
   * Run a search over the project.
   *
   * The engine is the one of the core: the plugin asks for it through the
   * contract (`contract.host.searchFiles`), so the plugin never walks the
   * files of the project on its own.
   * @param {string} query the query
   * @param {{caseSensitive?: boolean, wholeWord?: boolean, regexp?: boolean, textMatch?: boolean}} [options] the options
   * @returns {Promise<void>}
   */
  async runSearch(query, options2 = {}) {
    const host = this.contract?.host;
    const search = this.state.search ?? {};
    const value = typeof query === "string" ? query : search.query ?? "";
    const flags = {
      caseSensitive: options2.caseSensitive ?? search.caseSensitive === true,
      wholeWord: options2.wholeWord ?? search.wholeWord === true,
      regexp: options2.regexp ?? search.regexp === true
    };
    const token = ++this.searchToken;
    this.patch("search", {
      query: value,
      ...flags,
      textMatch: options2.textMatch ?? search.textMatch === true,
      loading: value !== "",
      error: null
    });
    if (value === "") return;
    if (host === null || host === void 0 || typeof host.searchFiles !== "function") {
      this.patch("search", { loading: false, error: "no search" });
      return;
    }
    try {
      const result = await host.searchFiles({ query: value, ...flags });
      if (token !== this.searchToken) return;
      const files = (Array.isArray(result?.files) ? result.files : []).map((file) => ({
        ...file,
        // The engine of the core calls the hits of a file `matches`; the
        // contract of the search names them `hits`. Both are accepted.
        matches: file?.matches ?? file?.hits ?? []
      }));
      this.patch("search", {
        loading: false,
        results: files,
        tookMs: Number.isFinite(result?.tookMs) ? result.tookMs : 0,
        truncated: result?.truncated === true,
        error: null
      });
    } catch (error) {
      if (token !== this.searchToken) return;
      this.patch("search", {
        loading: false,
        results: [],
        tookMs: 0,
        truncated: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  /**
   * The hits of the current search, flattened over the files.
   *
   * The popup shows the files on top and the hits of the selected file in
   * the preview below; this flat list is what "F8 cycles the hits" walks.
   * @returns {Array<{path: string, line: number, column: number, match: object, file: object}>} the hits
   */
  searchHits() {
    const hits = [];
    for (const file of this.state.search?.results ?? []) {
      for (const match of file?.matches ?? []) {
        hits.push({ path: file.path, line: match.line, column: match.column, match, file });
      }
    }
    return hits;
  }
  /**
   * The file the popup shows.
   * @returns {any} the file, or `null` when there is none
   */
  selectedSearchFile() {
    const files = (this.state.search?.results ?? []).filter((file) => (file?.matches ?? []).length > 0);
    if (files.length === 0) return null;
    const index = Math.min(Math.max(this.state.searchPopup?.index ?? 0, 0), files.length - 1);
    return files[index] ?? null;
  }
  /**
   * The old entry point of the Find in Files view.
   *
   * The results live in a popup now; the name is kept so an old shortcut
   * still finds the feature.
   * @param {string} [query] the query to run right away
   */
  openSearchTab(query = "") {
    this.openSearchPopup(query);
  }
  /**
   * Open the Find in Files popup.
   *
   * The query and the flags are reset: the two entries (Find in Files and
   * the text version of Find Usages) share one data slice, and a plain
   * project-wide search must not inherit the identifier of a usage search.
   * @param {string} [query] the query to run right away
   */
  openSearchPopup(query = "") {
    const popup = this.state.searchPopup ?? { open: false, index: 0, generation: 0 };
    this.set({ searchPopup: { ...popup, open: true, index: 0, generation: (popup.generation ?? 0) + 1 } });
    this.patch("search", {
      textMatch: false,
      query: "",
      caseSensitive: false,
      wholeWord: false,
      regexp: false
    });
    if (typeof query === "string" && query !== "") void this.runSearch(query);
  }
  /**
   * Close the Find in Files popup.
   */
  closeSearchPopup() {
    if (this.state.searchPopup?.open !== true) return;
    this.set({ searchPopup: { ...this.state.searchPopup, open: false, index: 0 } });
  }
  /**
   * Move the selection inside the Find in Files popup.
   *
   * The upper half of the popup lists the files that matched, so the
   * selection walks the files - the hits of a file are in its preview.
   * @param {number} delta how far to move
   */
  moveSearchSelection(delta) {
    const files = (this.state.search?.results ?? []).filter((file) => (file?.matches ?? []).length > 0);
    if (files.length === 0) return;
    const current = this.state.searchPopup?.index ?? 0;
    const step = Number.isFinite(delta) ? Math.trunc(delta) : 1;
    const index = ((current + step) % files.length + files.length) % files.length;
    this.set({ searchPopup: { ...this.state.searchPopup, open: true, index } });
  }
  /**
   * Open one hit of the search.
   *
   * The popup is a one-shot tool: opening a hit ends it, so the code the
   * user was working on stays in front.
   * @param {string} path the path of the file
   * @param {number} line the line of the hit
   * @param {number} [column] the column of the hit
   */
  openSearchResult(path, line, column) {
    if (typeof path !== "string" || path === "") return;
    this.closeSearchPopup();
    this.openFile(path, {
      line: Number.isInteger(line) ? line : 1,
      column: Number.isInteger(column) ? column : void 0
    });
  }
  // ── the teardown ──────────────────────────────────────────────────────────
  /**
   * Release everything the store holds.
   */
  dispose() {
    try {
      releaseLspForStore(this);
    } catch {
    }
    for (const unsubscribe of this.unsubscribers.splice(0)) {
      try {
        unsubscribe();
      } catch {
      }
    }
    if (this.toastTimer !== null) {
      clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
    if (this.lspPollTimer !== null) {
      clearTimeout(this.lspPollTimer);
      this.lspPollTimer = null;
    }
    if (this.visibilityBound && typeof document !== "undefined" && typeof document.removeEventListener === "function") {
      document.removeEventListener("visibilitychange", this.#onVisibilityChange);
      this.visibilityBound = false;
    }
    this.listeners.clear();
  }
};

// src/client/registry.js
var stores = /* @__PURE__ */ new WeakMap();
function storeOf(contract, t2) {
  if (contract === null || contract === void 0) return null;
  let store = stores.get(contract);
  if (store === void 0) {
    store = new CodeIntelStore({ t: t2 });
    stores.set(contract, store);
  }
  return store;
}

// src/client/bridge.jsx
function CodeIntelBridge({ contract, t: t2, onContract }) {
  const store = (0, import_react.useMemo)(() => storeOf(contract, t2 ?? ((key) => key)), [contract, t2]);
  (0, import_react.useEffect)(() => {
    if (store === null || store === void 0 || contract === null || contract === void 0) return void 0;
    onContract?.(contract);
    store.attachContract(contract);
    void store.init();
    const extensions = contract.editor.registerExtensions(() => codeintelExtensionSlots());
    const offCommands = contract.editor.registerCommands(codeintelCommands(store));
    const offDocument = contract.editor.onDocument((document2) => {
      store.setDocument(document2);
    });
    bindCodemirror(contract.editor?.codemirror);
    let offKeymap = null;
    void loadLspLibrary().then(() => {
      offKeymap = contract.editor.registerKeymap(codeintelKeymap());
      configureLsp(store);
      extensions.refresh();
    }, (error) => {
      console.warn("[codeintel] the client library could not be loaded:", error instanceof Error ? error.message : error);
    });
    let version = lspSessionVersion();
    const unsubscribe = store.subscribe(() => {
      const next = lspSessionVersion();
      if (next === version) return;
      version = next;
      extensions.refresh();
    });
    return () => {
      unsubscribe();
      offDocument();
      offCommands();
      if (offKeymap !== null) offKeymap();
      extensions.dispose();
      store.detachContract();
    };
  }, [contract, store, onContract]);
  return null;
}

// src/client/settings.jsx
var import_react4 = __toESM(require("react"), 1);

// src/client/hooks.js
var import_react2 = require("react");
function useStoreState(store) {
  return (0, import_react2.useSyncExternalStore)(
    (callback) => typeof store?.subscribe === "function" ? store.subscribe(callback) : () => {
    },
    () => store?.getSnapshot?.() ?? null,
    () => null
  );
}

// src/client/status.jsx
var import_react3 = __toESM(require("react"), 1);
var LSP_UNSTABLE_FAILURES = 3;
var LSP_UNSTABLE_TIMEOUTS = 2;
function interpolate(text, values) {
  let out = typeof text === "string" ? text : "";
  for (const [name2, value] of Object.entries(values ?? {})) {
    out = out.replaceAll(`{${name2}}`, String(value));
  }
  return out;
}
function label(t2, key, fallback) {
  const value = t2(key);
  return typeof value === "string" && value !== "" && value !== key ? value : fallback;
}
function waitedFor(elapsedMs) {
  const value = Number.isFinite(elapsedMs) ? elapsedMs : 0;
  const total = Math.max(0, Math.floor(value / 1e3));
  return { minutes: Math.floor(total / 60), seconds: total % 60 };
}
function formatWaited(minutes, seconds, locale = "en") {
  return locale === "zh" ? `${minutes} \u5206 ${seconds} \u79D2` : `${minutes} min ${seconds} s`;
}
function isChineseText(text) {
  return /[\u3400-\u9fff]/.test(typeof text === "string" ? text : "");
}
var CLIENT_SESSION_PROBLEMS = ["failed", "starting", "idle"];
function showRebuildButton(viewKey, lsp = {}) {
  if (lsp.rebuilding === true) return false;
  if (CLIENT_SESSION_PROBLEMS.includes(lsp.clientState)) return false;
  return ["degraded", "failed", "cancelled", "idle", "suspended"].includes(viewKey);
}
function showReconnectButton(viewKey, clientState = "") {
  if (viewKey === "sessionFailed" || viewKey === "sessionConnecting" || viewKey === "sessionIdle") return true;
  return CLIENT_SESSION_PROBLEMS.includes(clientState);
}
function showCancelButton(hostState, cancellable) {
  return cancellable === true && ["building", "starting", "restarting"].includes(hostState);
}
var HOST_CONNECTING_STATES = ["ready", "building"];
function waitedSince(lsp) {
  const startedAt = typeof lsp?.startedAt === "number" && lsp.startedAt > 0 ? lsp.startedAt : 0;
  if (startedAt === 0) return null;
  return waitedFor(Date.now() - startedAt);
}
function waitedSinceClient(lsp) {
  const since = typeof lsp?.clientSince === "number" && lsp.clientSince > 0 ? lsp.clientSince : 0;
  if (since > 0) return waitedFor(Date.now() - since);
  return waitedSince(lsp);
}
function lspStatusView(store, state) {
  const t2 = store.t;
  const lsp = state?.lsp ?? {};
  const settingsLsp = state?.settings?.lsp ?? {};
  const language2 = typeof lsp.languageId === "string" ? lsp.languageId : "";
  const current = typeof lsp.state === "string" && lsp.state !== "" ? lsp.state : "idle";
  const detail = typeof lsp.detail === "string" ? lsp.detail : "";
  const base = { title: t2("lsp.statusTitle"), detail, action: null };
  if (state?.lspStatusStale === true) {
    return { ...base, key: "unknown", text: t2("lsp.status.unknown"), tone: "idle" };
  }
  if (settingsLsp.enabled === false || lsp.enabled === false || current === "disabled") {
    return { ...base, key: "disabled", text: t2("lsp.status.disabled"), tone: "idle" };
  }
  const clientState = typeof lsp.clientState === "string" ? lsp.clientState : "";
  const clientDetail = typeof lsp.clientDetail === "string" ? lsp.clientDetail : "";
  const missing = (lsp.servers?.missing ?? []).filter((entry) => typeof entry?.languageId === "string" && entry.enabled !== false);
  const missingHere = missing.find((entry) => entry.languageId === language2);
  const missingOnly = missingHere ?? (missing.length === 1 ? missing[0] : void 0);
  if (missingOnly !== void 0 && current !== "ready" && current !== "building" && current !== "starting") {
    return {
      ...base,
      key: "missing",
      text: interpolate(t2("lsp.status.missing"), { language: missingOnly.languageId }),
      tone: "idle",
      action: "settings",
      title: interpolate(t2("lsp.serverMissing"), { language: missingOnly.languageId })
    };
  }
  if (clientState === "failed" && LSP_HOST_HEALTHY_STATES.includes(current)) {
    return {
      ...base,
      key: "sessionFailed",
      text: t2("lsp.status.sessionFailed"),
      tone: "error",
      action: "diagnostics",
      detail: clientDetail === "" ? base.detail : clientDetail
    };
  }
  if (clientState === "starting" && HOST_CONNECTING_STATES.includes(current)) {
    const waited = waitedSinceClient(lsp);
    const waitedText = waited === null ? "" : formatWaited(waited.minutes, waited.seconds, isChineseText(t2("lsp.status.sessionConnecting")) ? "zh" : "en");
    const hostText = current === "building" ? t2("lsp.status.building") : "";
    return {
      ...base,
      key: "sessionConnecting",
      text: t2("lsp.status.sessionConnecting"),
      tone: "idle",
      detail: base.detail === "" ? waitedText !== "" ? waitedText : hostText : base.detail
    };
  }
  if (clientState === "idle" && LSP_HOST_HEALTHY_STATES.includes(current)) {
    return {
      ...base,
      key: "sessionIdle",
      text: t2("lsp.status.sessionIdle"),
      tone: "warn",
      action: "diagnostics"
    };
  }
  const failures = Number.isFinite(lsp.consecutiveFailures) ? lsp.consecutiveFailures : 0;
  const timeouts = Number.isFinite(lsp.consecutiveTimeouts) ? lsp.consecutiveTimeouts : 0;
  switch (current) {
    case "starting":
    case "restarting": {
      const waited = waitedSince(lsp);
      if (waited === null) {
        const plain = current === "starting" ? t2("lsp.status.starting") : t2("lsp.status.restarting");
        return { ...base, key: current, text: plain, tone: "idle" };
      }
      const template = current === "starting" ? t2("lsp.status.startingWait") : t2("lsp.status.restartingWait");
      return {
        ...base,
        key: current,
        text: interpolate(template, { minutes: waited.minutes, seconds: waited.seconds }),
        tone: "idle",
        detail: base.detail === "" ? formatWaited(waited.minutes, waited.seconds, isChineseText(template) ? "zh" : "en") : base.detail
      };
    }
    case "building":
      return { ...base, key: "building", text: t2("lsp.status.building"), tone: "warn" };
    case "cancelling":
      return {
        ...base,
        key: "cancelling",
        text: label(t2, "lsp.status.cancelling", t2("lsp.status.cancelled")),
        tone: "idle"
      };
    case "ready":
      if (failures >= LSP_UNSTABLE_FAILURES || timeouts >= LSP_UNSTABLE_TIMEOUTS) {
        const text = timeouts >= LSP_UNSTABLE_TIMEOUTS ? interpolate(t2("lsp.status.unstableTimeout"), { count: timeouts }) : interpolate(t2("lsp.status.unstable"), { count: failures });
        return { ...base, key: "unstable", text, tone: "warn", action: "diagnostics" };
      }
      if (lsp.buildingProgram === true) {
        return { ...base, key: "buildingProgram", text: t2("lsp.status.buildingProgram"), tone: "warn" };
      }
      return { ...base, key: "ready", text: t2("lsp.status.ready"), tone: "ok" };
    case "crashed":
      return { ...base, key: "crashed", text: t2("lsp.status.crashed"), tone: "error", action: "crash" };
    case "cancelled":
      return { ...base, key: "cancelled", text: t2("lsp.status.cancelled"), tone: "warn", action: "diagnostics" };
    case "degraded":
      return { ...base, key: "degraded", text: t2("lsp.status.degraded"), tone: "warn", action: "diagnostics" };
    case "failed":
      return { ...base, key: "failed", text: t2("lsp.status.failed"), tone: "error", action: "diagnostics" };
    case "idle":
      if (typeof store.lspWorkspaceDefault === "function" && store.lspWorkspaceDefault(state?.root) === "conservative") {
        return {
          ...base,
          key: "workspaceOff",
          text: t2("lsp.status.workspaceOff"),
          tone: "idle",
          action: "diagnostics",
          detail: t2("lsp.workspaceOffHint")
        };
      }
      return { ...base, key: "idle", text: t2("lsp.status.idle"), tone: "idle", action: "diagnostics" };
    case "suspended":
      return { ...base, key: "suspended", text: t2("lsp.status.suspended"), tone: "idle", action: "diagnostics" };
    default:
      return { ...base, key: "idle", text: t2("lsp.status.idle"), tone: "idle", action: "diagnostics" };
  }
}
function Toast({ store, state }) {
  const toast = state?.toast ?? null;
  if (toast === null) return null;
  return import_react3.default.createElement(
    "div",
    { className: `iwb-toast iwb-toast-${toast.kind ?? "info"}`, role: "status" },
    import_react3.default.createElement("span", { className: "iwb-toast-text" }, toast.text),
    toast.detail === "" || toast.detail === void 0 ? null : import_react3.default.createElement("span", { className: "iwb-toast-detail" }, toast.detail)
  );
}
function LspStatus({ store, state, onOpenSettings, onOpenDiagnostics }) {
  const t2 = store.t;
  const lsp = state.lsp ?? {};
  const view = lspStatusView(store, state);
  const cancelAfter = state.settings?.lsp?.cancelAfterMs ?? 6e4;
  const startedAt = typeof lsp.startedAt === "number" ? lsp.startedAt : 0;
  const cancellable = lsp.cancellable === true || startedAt > 0 && Date.now() - startedAt > cancelAfter;
  const showCancel = showCancelButton(lsp.state, cancellable);
  const showRebuild = showRebuildButton(view.key, lsp);
  const showReconnect = showReconnectButton(view.key, lsp.clientState);
  const tone = view.tone === "ok" ? " iwb-lsp-status-ready" : view.tone === "warn" ? " iwb-lsp-status-warn" : view.tone === "error" ? " iwb-lsp-status-error" : " iwb-lsp-status-muted";
  const title = view.detail === "" ? view.title : `${view.title} \u2014 ${view.detail}`;
  const onClick = view.action === "settings" ? () => {
    onOpenSettings?.();
  } : view.action === "crash" ? () => {
    store.toast("error", t2("lsp.crashedToast"), view.detail);
  } : view.action === "diagnostics" ? () => {
    onOpenDiagnostics?.();
  } : void 0;
  return import_react3.default.createElement(
    "span",
    {
      className: `iwb-status-item iwb-lsp-status${tone}`,
      title,
      "data-lsp-state": view.key,
      style: onClick === void 0 ? void 0 : { cursor: "pointer" },
      onClick
    },
    import_react3.default.createElement("span", { className: "iwb-lsp-status-dot" }),
    import_react3.default.createElement("span", { className: "iwb-lsp-status-label" }, view.text),
    showCancel ? import_react3.default.createElement("button", {
      type: "button",
      className: "iwb-lsp-cancel",
      title: t2("lsp.cancelIndex"),
      onClick: (event) => {
        event.stopPropagation();
        void store.cancelLspIndex();
      }
    }, t2("lsp.cancelIndex")) : null,
    showRebuild ? import_react3.default.createElement("button", {
      type: "button",
      className: "iwb-lsp-cancel",
      title: t2("lsp.rebuildIndex"),
      onClick: (event) => {
        event.stopPropagation();
        void store.restartLsp();
      }
    }, t2("lsp.rebuildIndex")) : null,
    showReconnect ? import_react3.default.createElement("button", {
      type: "button",
      className: "iwb-lsp-cancel",
      title: t2("lsp.reconnect"),
      onClick: (event) => {
        event.stopPropagation();
        void store.reconnectLsp();
      }
    }, t2("lsp.reconnect")) : null,
    lsp.rebuilding === true ? import_react3.default.createElement("span", { className: "iwb-lsp-status-label" }, t2("lsp.diagnostics.rebuilding")) : null
  );
}

// src/client/settings.jsx
function Row({ label: label2, hint, children }) {
  return import_react4.default.createElement(
    "div",
    { className: "iwb-settings-row" },
    import_react4.default.createElement("div", { className: "iwb-settings-label" }, label2),
    hint === void 0 || hint === "" ? null : import_react4.default.createElement("div", { className: "iwb-settings-hint" }, hint),
    import_react4.default.createElement("div", { className: "iwb-settings-control" }, children)
  );
}
function DegradedNote({ store, state }) {
  const t2 = store.t;
  if (state?.degraded !== true) return null;
  return import_react4.default.createElement(
    "div",
    { className: "iwb-settings-note iwb-settings-note-warn" },
    import_react4.default.createElement("div", { className: "iwb-settings-note-title" }, t2("codeintel.degradedTitle")),
    import_react4.default.createElement("div", { className: "iwb-settings-note-body" }, t2("codeintel.degradedBody"))
  );
}
function clampBudgetRatio(value) {
  const number2 = Number(value);
  if (value === "" || value === null || value === void 0 || !Number.isFinite(number2)) return 0.25;
  if (number2 <= 0) return 0.05;
  if (number2 > 1) return 1;
  return number2;
}
function worstCaseText(store, resources) {
  const worstBytes = Number.isFinite(resources?.worstCaseBytes) ? resources.worstCaseBytes : null;
  const ceilingMB = Number.isFinite(resources?.ceilingMB) ? resources.ceilingMB : null;
  if (worstBytes === null || ceilingMB === null) return "";
  return interpolate(store.t("lsp.diagnostics.memoryWorstText"), {
    ceiling: ceilingMB,
    left: Math.round(worstBytes / (1024 * 1024))
  });
}
function reservedMB(resources) {
  const bytes = Number.isFinite(resources?.reservedBytes) ? resources.reservedBytes : 0;
  return Math.round(bytes / (1024 * 1024));
}
function memoryNowText(store, resources) {
  const t2 = store.t;
  const mib = 1024 * 1024;
  const availableBytes = Number.isFinite(resources?.availableBytes) ? resources.availableBytes : Number.isFinite(resources?.freeBytes) ? resources.freeBytes : 0;
  const available = Math.round(availableBytes / mib);
  const need = Math.round(Number.isFinite(resources?.needMB) ? resources.needMB : 0);
  const threshold = Math.round((Number.isFinite(resources?.thresholdBytes) ? resources.thresholdBytes : 0) / mib);
  const floor = Number.isFinite(resources?.hardFloorMB) ? resources.hardFloorMB : 0;
  const language2 = typeof resources?.languageId === "string" && resources.languageId !== "" ? resources.languageId : t2("settings.lspServersGroup");
  const state = memoryDecisionOf(resources) === "tight" ? t2("settings.lspMemoryState.tight") : memoryDecisionOf(resources) === "low" ? t2("settings.lspMemoryState.low") : t2("settings.lspMemoryState.ok");
  return interpolate(t2("settings.lspMemoryNow"), {
    available,
    language: language2,
    need,
    state,
    threshold,
    floor
  });
}
function SettingsForm({ store, state }) {
  const t2 = store.t;
  const settings = state.settings ?? {};
  const lsp = settings.lsp ?? {};
  const shortcuts = settings.shortcuts ?? {};
  const [ceilings, setCeilings] = (0, import_react4.useState)({});
  const [switches, setSwitches] = (0, import_react4.useState)({});
  const resources = state.lsp?.resources ?? null;
  const servers = state.lsp?.servers ?? { available: [], missing: [] };
  const languages = [
    ...servers.available ?? [],
    ...servers.missing ?? [],
    ...servers.disabled ?? []
  ];
  const missingLanguages = (servers.missing ?? []).filter((language2) => language2?.enabled !== false);
  const writeLsp = (patch) => {
    void store.updateSettings({ lsp: { ...lsp, ...patch } });
  };
  const writeShortcut = (name2, value) => {
    void store.updateSettings({ shortcuts: { ...shortcuts, [name2]: value } });
  };
  const idlePolicy = lsp.autoExit === false ? "never" : lsp.idlePolicy ?? "after";
  return import_react4.default.createElement(
    "div",
    { className: "iwb-settings-group" },
    import_react4.default.createElement(DegradedNote, { store, state }),
    import_react4.default.createElement("div", { className: "iwb-settings-group-title" }, t2("settings.lspGroup")),
    import_react4.default.createElement("div", { className: "iwb-settings-group-hint" }, t2("settings.lspGroupHint")),
    import_react4.default.createElement(
      Row,
      { label: t2("settings.lspEnabled"), hint: t2("settings.lspEnabledHint") },
      import_react4.default.createElement("input", {
        type: "checkbox",
        checked: lsp.enabled !== false,
        onChange: (event) => {
          writeLsp({ enabled: event.target.checked });
        }
      })
    ),
    import_react4.default.createElement(
      Row,
      { label: t2("settings.lspIndexOnOpen"), hint: t2("settings.lspIndexOnOpenHint") },
      import_react4.default.createElement(
        "select",
        {
          value: lsp.indexOnOpen ?? "ask",
          onChange: (event) => {
            writeLsp({ indexOnOpen: event.target.value });
          }
        },
        import_react4.default.createElement("option", { value: "ask" }, t2("settings.lspIndexAsk")),
        import_react4.default.createElement("option", { value: "always" }, t2("settings.lspIndexAlways")),
        import_react4.default.createElement("option", { value: "never" }, t2("settings.lspIndexNever"))
      )
    ),
    import_react4.default.createElement(
      Row,
      { label: t2("settings.lspIdlePolicy"), hint: t2("settings.lspIdlePolicyHint") },
      import_react4.default.createElement("select", {
        value: idlePolicy,
        onChange: (event) => {
          writeLsp({ idlePolicy: event.target.value, autoExit: event.target.value !== "never" });
        }
      }, IDLE_POLICIES.map((policy) => import_react4.default.createElement(
        "option",
        { key: policy, value: policy },
        t2(`settings.lspIdlePolicy${policy.charAt(0).toUpperCase()}${policy.slice(1)}`)
      )))
    ),
    idlePolicy === "never" ? import_react4.default.createElement("div", { className: "iwb-settings-warning" }, t2("settings.lspIdlePolicyNeverWarning")) : null,
    import_react4.default.createElement(
      Row,
      { label: t2("settings.lspCancelAfter"), hint: t2("settings.lspCancelAfterHint") },
      import_react4.default.createElement("input", {
        type: "number",
        min: 1,
        value: Math.round((lsp.cancelAfterMs ?? 6e4) / 1e3),
        onChange: (event) => {
          writeLsp({ cancelAfterMs: Number(event.target.value) * 1e3 });
        }
      })
    ),
    import_react4.default.createElement(
      Row,
      { label: t2("settings.lspRequestTimeout"), hint: t2("settings.lspRequestTimeoutHint") },
      import_react4.default.createElement("input", {
        type: "number",
        min: 30,
        value: Math.round((lsp.requestTimeoutMs ?? 3e4) / 1e3),
        onChange: (event) => {
          writeLsp({ requestTimeoutMs: Number(event.target.value) * 1e3 });
        }
      })
    ),
    import_react4.default.createElement(
      Row,
      { label: t2("settings.lspMemoryLimit"), hint: t2("settings.lspMemoryLimitHint") },
      import_react4.default.createElement("input", {
        type: "number",
        min: 128,
        value: lsp.memoryLimitMB ?? 2048,
        onChange: (event) => {
          writeLsp({ memoryLimitMB: Number(event.target.value) });
        }
      })
    ),
    import_react4.default.createElement(
      Row,
      { label: t2("settings.lspFreeMemory"), hint: t2("settings.lspFreeMemoryHint") },
      import_react4.default.createElement("input", {
        type: "number",
        min: 0,
        value: lsp.freeMemoryThresholdMB ?? 512,
        onChange: (event) => {
          writeLsp({ freeMemoryThresholdMB: Number(event.target.value) });
        }
      })
    ),
    import_react4.default.createElement(
      Row,
      { label: t2("settings.lspHeadroom"), hint: t2("settings.lspHeadroomHint") },
      import_react4.default.createElement("input", {
        type: "number",
        step: "0.1",
        min: "1",
        value: lsp.memoryHeadroom ?? 1.5,
        onChange: (event) => {
          writeLsp({ memoryHeadroom: Number(event.target.value) });
        }
      })
    ),
    import_react4.default.createElement(
      Row,
      { label: t2("settings.lspHardFloor"), hint: t2("settings.lspHardFloorHint") },
      import_react4.default.createElement("input", {
        type: "number",
        min: 0,
        value: lsp.memoryHardFloorMB ?? 256,
        onChange: (event) => {
          writeLsp({ memoryHardFloorMB: Number(event.target.value) });
        }
      })
    ),
    resources === null ? null : import_react4.default.createElement(
      "div",
      { className: "iwb-settings-note" },
      import_react4.default.createElement("div", { className: "iwb-settings-note-body" }, memoryNowText(store, resources)),
      reservedMB(resources) > 0 ? import_react4.default.createElement(
        "div",
        { className: "iwb-settings-note-body" },
        interpolate(t2("settings.lspMemoryReserved"), { reserved: reservedMB(resources) })
      ) : null,
      // The worst case is information, not a verdict: the host reports it
      // and never blocks on it. It belongs where the user looks at the
      // live numbers.
      worstCaseText(store, resources) === "" ? null : import_react4.default.createElement("div", { className: "iwb-settings-note-body" }, worstCaseText(store, resources))
    ),
    import_react4.default.createElement(
      Row,
      { label: t2("settings.lspBudgetRatio"), hint: t2("settings.lspBudgetRatioHint") },
      import_react4.default.createElement("input", {
        type: "number",
        min: "0.05",
        max: "1",
        step: "0.05",
        value: lsp.budgetRatio ?? 0.25,
        onChange: (event) => {
          writeLsp({ budgetRatio: clampBudgetRatio(event.target.value) });
        }
      })
    ),
    import_react4.default.createElement("div", { className: "iwb-settings-group-title" }, t2("settings.lspServersGroup")),
    import_react4.default.createElement("div", { className: "iwb-settings-group-hint" }, t2("settings.lspServersGroupHint")),
    ...languages.map((language2) => {
      const languageId = typeof language2?.languageId === "string" ? language2.languageId : "";
      if (languageId === "") return null;
      const entry = (lsp.servers ?? {})[languageId] ?? {};
      const ceiling = Number.isFinite(entry.memoryLimitMB) ? entry.memoryLimitMB : null;
      const written = ceilings[languageId];
      const shown = written !== void 0 ? written : ceiling === null ? "" : String(ceiling);
      const writeLanguage = (patch) => {
        const servers2 = { ...lsp.servers ?? {} };
        servers2[languageId] = { ...entry, ...patch };
        writeLsp({ servers: servers2 });
      };
      return import_react4.default.createElement(
        "div",
        {
          key: languageId,
          className: "iwb-settings-language"
        },
        import_react4.default.createElement(
          "div",
          {
            className: "iwb-settings-language-toggle",
            // The title of the row is the install advice of the host: the
            // language shows up nowhere else, so this is the last place that
            // can say how to install it.
            title: typeof language2.hint === "string" ? language2.hint : ""
          },
          import_react4.default.createElement("input", {
            type: "checkbox",
            checked: switches[languageId] !== void 0 ? switches[languageId] : entry.enabled !== false && language2.enabled !== false,
            onChange: (event) => {
              setSwitches((current) => ({ ...current, [languageId]: event.target.checked }));
              writeLanguage({ enabled: event.target.checked });
            }
          }),
          import_react4.default.createElement("span", { className: "iwb-settings-language-name" }, languageId)
        ),
        // The ceiling of THIS language: an empty field means that the global
        // ceiling applies (the user could otherwise only lower a language,
        // never raise it).
        import_react4.default.createElement("input", {
          type: "number",
          min: 0,
          "aria-label": `${languageId} ${t2("settings.lspServerMemoryLimit")}`,
          title: t2("settings.lspServerMemoryLimitHint"),
          value: shown,
          onChange: (event) => {
            const raw = event.target.value;
            const value = Number(raw);
            if (raw !== "" && !Number.isFinite(value)) return;
            setCeilings((current) => ({ ...current, [languageId]: raw }));
            writeLanguage(raw === "" ? { memoryLimitMB: void 0 } : { memoryLimitMB: value });
          }
        })
      );
    }),
    // The languages that are wanted but not installed: they are announced
    // here, because the status bar of the plugin filters the languages the
    // user switched off - and the two interfaces must not use the same word
    // for two different things (review R6-3).
    missingLanguages.length === 0 ? null : import_react4.default.createElement(
      import_react4.default.Fragment,
      null,
      import_react4.default.createElement("div", { className: "iwb-settings-group-title" }, t2("settings.lspServersMissing")),
      import_react4.default.createElement("div", { className: "iwb-settings-group-hint" }, t2("settings.lspServersMissingHint")),
      ...missingLanguages.map((language2) => import_react4.default.createElement("div", {
        key: language2.languageId,
        className: "iwb-settings-value"
      }, `${language2.languageId} \u95B3?${typeof language2.hint === "string" ? language2.hint : ""}`))
    ),
    import_react4.default.createElement("div", { className: "iwb-settings-group-title" }, t2("settings.shortcuts")),
    ...[
      ["goToDefinition", t2("settings.goToDefinitionShortcut"), t2("settings.goToDefinitionShortcutHint")],
      ["findUsages", t2("settings.findUsagesShortcut"), t2("settings.findUsagesShortcutHint")],
      ["findUsagesText", t2("settings.findUsagesTextShortcut"), t2("settings.findUsagesTextShortcutHint")],
      ["complete", t2("settings.completeShortcut"), t2("settings.completeShortcutHint")]
    ].map(([name2, label2, hint]) => import_react4.default.createElement(
      Row,
      { key: name2, label: label2, hint },
      import_react4.default.createElement("input", {
        type: "text",
        value: shortcuts[name2] ?? "",
        onChange: (event) => {
          writeShortcut(name2, event.target.value);
        }
      })
    ))
  );
}
function CodeIntelSettings({ contract, t: t2, store: provided }) {
  const fromRegistry = (0, import_react4.useMemo)(() => storeOf(contract, t2), [contract, t2]);
  const store = provided ?? fromRegistry;
  const state = useStoreState(store);
  if (store === null || state === null) {
    return import_react4.default.createElement(
      "div",
      { className: "iwb-settings-group" },
      import_react4.default.createElement(
        "div",
        { className: "iwb-settings-note iwb-settings-note-warn" },
        import_react4.default.createElement("div", { className: "iwb-settings-note-title" }, t2("codeintel.degradedTitle")),
        import_react4.default.createElement("div", { className: "iwb-settings-note-body" }, t2("codeintel.degradedBody"))
      )
    );
  }
  return import_react4.default.createElement(
    import_react4.default.Fragment,
    null,
    import_react4.default.createElement(Toast, { store, state }),
    import_react4.default.createElement(SettingsForm, { store, state })
  );
}

// src/client/decision.jsx
var import_react5 = __toESM(require("react"), 1);

// src/client/language-label.js
var NAMES = {
  typescript: "TypeScript",
  typescriptreact: "TypeScript React",
  javascript: "JavaScript",
  javascriptreact: "JavaScript React",
  python: "Python",
  yaml: "YAML",
  java: "Java",
  go: "Go",
  rust: "Rust",
  c: "C",
  cpp: "C++"
};
function languageLabel(languageId) {
  const id = typeof languageId === "string" ? languageId : "";
  return NAMES[id] ?? id;
}

// src/client/decision.jsx
function IndexDecision({ store, state }) {
  const t2 = store.t;
  const decision = state?.indexDecision ?? null;
  if (decision === null) return null;
  const button = (key, label2, hint, onClick) => import_react5.default.createElement("button", {
    key,
    type: "button",
    className: "iwb-textbtn iwb-index-decision-button",
    title: hint,
    onClick
  }, label2);
  return import_react5.default.createElement(
    "div",
    { className: "iwb-modal-backdrop iwb-index-decision-backdrop" },
    import_react5.default.createElement(
      "div",
      { className: "iwb-modal iwb-index-decision" },
      import_react5.default.createElement("div", { className: "iwb-modal-title" }, t2("index.decision.title")),
      import_react5.default.createElement(
        "div",
        { className: "iwb-modal-body" },
        import_react5.default.createElement("div", null, t2("index.decision.body")),
        decision.language === "" ? null : import_react5.default.createElement("div", null, languageLabel(decision.language)),
        decision.isRepo === false ? import_react5.default.createElement("div", { className: "iwb-index-decision-warning" }, t2("index.decision.rootWarning")) : null
      ),
      import_react5.default.createElement(
        "div",
        { className: "iwb-modal-actions" },
        button("build", t2("index.decision.build"), t2("index.decision.buildRoot"), () => {
          store.resolveIndexDecision("build");
        }),
        button("conservative", t2("index.decision.conservative"), t2("index.decision.conservativeHint"), () => {
          store.resolveIndexDecision("conservative");
        }),
        button("cancel", t2("index.decision.cancel"), t2("index.decision.cancelHint"), () => {
          store.resolveIndexDecision("cancel");
        })
      )
    )
  );
}
function MemoryDecision({ store, state }) {
  const t2 = store.t;
  const decision = state?.memoryDecision ?? null;
  if (decision === null) return null;
  const button = (key, label2, hint, onClick) => import_react5.default.createElement("button", {
    key,
    type: "button",
    className: "iwb-textbtn iwb-index-decision-button",
    title: hint,
    onClick
  }, label2);
  return import_react5.default.createElement(
    "div",
    { className: "iwb-modal-backdrop iwb-index-decision-backdrop" },
    import_react5.default.createElement(
      "div",
      { className: "iwb-modal iwb-index-decision" },
      import_react5.default.createElement("div", { className: "iwb-modal-title" }, t2("lsp.memoryWarn.title")),
      import_react5.default.createElement(
        "div",
        { className: "iwb-modal-body" },
        import_react5.default.createElement("div", null, t2("lsp.memoryWarn.body")),
        import_react5.default.createElement("div", null, `${decision.needMB} MB / ${decision.freeMB} MB`)
      ),
      import_react5.default.createElement(
        "div",
        { className: "iwb-modal-actions" },
        button("start", t2("lsp.memoryWarn.start"), "", () => {
          store.resolveMemoryDecision("start");
        }),
        button("conservative", t2("lsp.memoryWarn.conservative"), t2("lsp.memoryWarn.conservativeHint"), () => {
          store.resolveMemoryDecision("conservative");
        })
      )
    )
  );
}

// src/client/index.jsx
var inject = ["slots", "locale"];
var PLUGIN_ID = "dsh-ide-codeintel";
var DEGRADE_GRACE_MS = 1500;
function CodeIntelStatusItem({ contract, t: t2 }) {
  const store = storeOf(contract, t2);
  const state = useStoreState(store);
  if (store === null || state === null) return null;
  return import_react6.default.createElement(
    import_react6.default.Fragment,
    null,
    import_react6.default.createElement(LspStatus, { store, state }),
    import_react6.default.createElement(Toast, { store, state }),
    // The two questions of the plugin (the index decision and the memory
    // warning) are drawn by the plugin's own surfaces.
    import_react6.default.createElement(IndexDecision, { store, state }),
    import_react6.default.createElement(MemoryDecision, { store, state })
  );
}
function CodeIntelCommandItems({ contract, t: t2 }) {
  const store = storeOf(contract, t2);
  const state = useStoreState(store);
  if (store === null || state === null) return null;
  const commands = codeintelCommands(store);
  return import_react6.default.createElement(
    "div",
    { className: "iwb-codeintel-commands" },
    commands.map((command) => import_react6.default.createElement("button", {
      key: command.key,
      type: "button",
      className: "iwb-textbtn",
      disabled: command.enabled !== void 0 && command.enabled() !== true,
      onClick: () => {
        command.run();
      }
    }, command.shortcut === void 0 || command.shortcut === "" ? command.label : `${command.label} (${command.shortcut})`))
  );
}
function apply(ctx) {
  const t2 = ctx.locale.bind(NS);
  ctx.effect(() => {
    const offZh = ctx.locale.register(NS, "zh", zh);
    const offEn = ctx.locale.register(NS, "en", en);
    return () => {
      offZh();
      offEn();
    };
  }, "dsh-ide-codeintel: dictionaries");
  let contractSeen = false;
  let degradedStore = null;
  let degradeTimer = null;
  const degradedMode = () => {
    if (degradedStore === null) {
      degradedStore = new CodeIntelStore({ t: t2 });
      degradedStore.set({ degraded: true, degradedReason: "workbench-missing" });
    }
    return degradedStore;
  };
  const enterDegradedMode = () => {
    if (contractSeen) return;
    const store = degradedMode();
    store.toast("error", t2("codeintel.workbenchMissing"), t2("codeintel.workbenchMissingHint"));
    ctx.effect(() => ctx.slots.inject("settings.section", () => ctx.slots.register({
      name: "settings.section",
      id: PLUGIN_ID,
      order: 61,
      label: () => t2("codeintel.settingsTitle")
    }, () => import_react6.default.createElement(CodeIntelSettings, { contract: null, t: t2, store: degradedStore }))), "dsh-ide-codeintel: settings section");
  };
  degradeTimer = setTimeout(() => {
    enterDegradedMode();
  }, DEGRADE_GRACE_MS);
  const onContract = (contract) => {
    if (contract === null || contract === void 0) return;
    contractSeen = true;
    if (degradeTimer !== null) {
      clearTimeout(degradeTimer);
      degradeTimer = null;
    }
    if (degradedStore !== null) {
      degradedStore.dispose();
      degradedStore = null;
    }
  };
  ctx.effect(() => ctx.slots.inject(SLOT_KEYS.editorBridge, () => ctx.slots.register({
    name: SLOT_KEYS.editorBridge,
    id: PLUGIN_ID
  }, (props) => import_react6.default.createElement(CodeIntelBridge, { ...props, t: t2, onContract }))), "dsh-ide-codeintel: editor bridge");
  ctx.effect(() => ctx.slots.inject(SLOT_KEYS.statusItem, () => ctx.slots.register({
    name: SLOT_KEYS.statusItem,
    id: PLUGIN_ID
  }, (props) => import_react6.default.createElement(CodeIntelStatusItem, { ...props, t: t2 }))), "dsh-ide-codeintel: status item");
  ctx.effect(() => ctx.slots.inject(SLOT_KEYS.settingsSection, () => ctx.slots.register({
    name: SLOT_KEYS.settingsSection,
    id: PLUGIN_ID
  }, (props) => import_react6.default.createElement(CodeIntelSettings, { ...props, t: t2 }))), "dsh-ide-codeintel: settings section");
  ctx.effect(() => ctx.slots.inject(SLOT_KEYS.commandItem, () => ctx.slots.register({
    name: SLOT_KEYS.commandItem,
    id: PLUGIN_ID
  }, (props) => import_react6.default.createElement(CodeIntelCommandItems, { ...props, t: t2 }))), "dsh-ide-codeintel: commands");
  ctx.effect(() => () => {
    if (degradeTimer !== null) {
      clearTimeout(degradeTimer);
      degradeTimer = null;
    }
    if (degradedStore !== null) {
      degradedStore.dispose();
      degradedStore = null;
    }
  }, "dsh-ide-codeintel: teardown");
}

    return module.exports;
  }
});
