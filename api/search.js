// محرك بحث عربي محلي (BM25) لاسترجاع أقرب المواد القانونية للسؤال
// (نفس فكرة النسخة اللي شغالة في المتصفح، لكن هنا كخطوة RAG قبل ما نبعت للموديل)

const fs = require("fs");
const path = require("path");

const ARTICLES = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "data", "articles.json"), "utf8")
);

const STOPWORDS = new Set([
  "في","من","إلى","الى","على","عن","مع","أن","ان","إن","ما","لا","هذا","هذه",
  "ذلك","تلك","التي","الذي","الذين","و","ف","ب","ك","ل","كل","قد","لم","لن",
  "ثم","أو","أم","هل","كان","يكون","تكون","بين","عند","حتى","بعد","قبل","غير",
  "دون","نحو","لدى","كما","إذا","اذا","إلا","الا","ايه","إيه","يا","انا","أنا",
  "انت","أنت","هو","هي","هم","احنا","إحنا","بس","يعني","ايوه","لو","عايز",
  "عاوز","عايزة","عاوزة","ممكن","ازاي","إزاي","فين","امتى","إمتى","ليه","مين",
  "بتاع","بتاعة","دة","ده","دي","دى",
]);

function normalizeAr(s) {
  return (s || "")
    .replace(/[\u064B-\u0652\u0670\u0640]/g, "")
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[^\u0600-\u06FF0-9a-zA-Z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function lightStem(tok) {
  tok = tok.replace(/^(وال|بال|كال|فال|لل|ال|و|ف|ب|ك|ل)/, "");
  tok = tok.replace(/(هما|هم|هن|كما|كم|نا|ها|ية|ين|ون|ات|ه|ي)$/, "");
  return tok;
}

function tokenize(s) {
  return normalizeAr(s)
    .split(" ")
    .filter((t) => t && t.length > 1 && !STOPWORDS.has(t))
    .map(lightStem);
}

const DOCS = ARTICLES.map((a) => {
  const toks = tokenize(a.title + " " + a.text);
  return { ...a, toks, len: toks.length };
});
const AVGDL = DOCS.reduce((s, d) => s + d.len, 0) / DOCS.length;
const DF = {};
DOCS.forEach((d) => {
  new Set(d.toks).forEach((t) => {
    DF[t] = (DF[t] || 0) + 1;
  });
});
const N = DOCS.length;

function idf(t) {
  const df = DF[t] || 0;
  return Math.log(1 + (N - df + 0.5) / (df + 0.5));
}

function bm25Score(queryToks, doc) {
  const k1 = 1.5,
    b = 0.75;
  const tf = {};
  doc.toks.forEach((t) => {
    tf[t] = (tf[t] || 0) + 1;
  });
  let score = 0;
  queryToks.forEach((t) => {
    const f = tf[t] || 0;
    if (!f) return;
    score += (idf(t) * (f * (k1 + 1))) / (f + k1 * (1 - b + (b * doc.len) / AVGDL));
  });
  return score;
}

function directArticleLookup(normQuery) {
  const m = normQuery.match(/ماده\s*\(?(\d+)\)?/);
  if (!m) return null;
  const num = m[1];
  return DOCS.find((d) => d.num === num || d.num === String(num));
}

/**
 * يرجع أقرب topN مواد قانونية للسؤال المُدخل
 */
function search(query, topN = 5) {
  const normQ = normalizeAr(query);
  const direct = directArticleLookup(normQ);
  const qToks = tokenize(query);
  if (!qToks.length && !direct) return [];

  const scored = DOCS.map((d) => ({ doc: d, score: bm25Score(qToks, d) }))
    .filter((x) => x.score > 0.05)
    .sort((a, b) => b.score - a.score);

  let results = scored.slice(0, topN).map((x) => x.doc);
  if (direct && !results.includes(direct)) {
    results = [direct, ...results].slice(0, topN);
  }
  return results.map((d) => ({
    source: d.source,
    num: d.num,
    title: d.title,
    text: d.text,
  }));
}

module.exports = { search };
