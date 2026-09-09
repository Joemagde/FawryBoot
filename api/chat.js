const { search } = require("./search.js");

// الموديل الافتراضي: راوتر OpenRouter المجاني اللي بيختار موديل مجاني تلقائيًا
// بدّله في Environment Variables لو عايز موديل تاني (مجاني أو مدفوع)
const MODEL = process.env.OPENROUTER_MODEL || "openrouter/free";

function buildSystemPrompt(matches) {
  const context = matches
    .map(
      (m) =>
        `[المادة ${m.num}${m.title ? " — " + m.title : ""} — المصدر: ${m.source}]\n${m.text}`
    )
    .join("\n\n---\n\n");

  return `أنت "Fawry HR Assistant"، مساعد ودود متخصص في قانون العمل المصري (القانون رقم 14 لسنة 2025، ولائحته التنفيذية الصادرة بقرار وزير العمل رقم 162 لسنة 2026).

هحطلك تحت أقرب المواد القانونية اللي تم استرجاعها بالبحث بخصوص سؤال المستخدم. دورك إنك:
- تقرا المواد دي كويس وتجاوب على السؤال بأسلوب طبيعي وودود، وكأنك زميل بيشرحله، مش بس بتنسخ النص.
- تذكر رقم المادة ومصدرها (قانون العمل أو لائحة تنظيم العمل) في إجابتك.
- لو السؤال بالعامية المصرية، جاوب بالعامية المصرية. لو بالإنجليزية، جاوب بالإنجليزية.
- لو المواد المسترجعة تحت مش بتغطي سؤال المستخدم فعليًا، قول بصراحة إن المعلومة دي مش موجودة في النصوص المتاحة عندك، ومتخترعش إجابة من عندك.
- خلي الإجابة مختصرة ومباشرة ومفيدة، من غير حشو.

--- المواد القانونية المسترجعة المتعلقة بالسؤال ---
${context || "لم يتم العثور على مواد قانونية واضحة الصلة بالسؤال."}
--- نهاية المواد ---`;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const API_KEY = process.env.OPENROUTER_API_KEY;
  if (!API_KEY) {
    res.status(500).json({
      error:
        "OPENROUTER_API_KEY غير مضبوط. ضيفه في Vercel: Settings → Environment Variables.",
    });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const messages = Array.isArray(body?.messages) ? body.messages : [];

    if (!messages.length) {
      res.status(400).json({ error: "لازم ترسل messages." });
      return;
    }

    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    const query = lastUserMsg ? String(lastUserMsg.content || "") : "";

    // 1) استرجاع أقرب المواد القانونية للسؤال (RAG محلي، بدون أي تكلفة)
    const matches = search(query, 5);
    const systemPrompt = buildSystemPrompt(matches);

    const trimmed = messages.slice(-8).map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content || "").slice(0, 4000),
    }));

    // 2) نبعت لـ OpenRouter (واجهة متوافقة مع OpenAI)
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
        // اختياري لكن بينصح بيه OpenRouter عشان يظهر تطبيقك في الإحصائيات بتاعهم
        "HTTP-Referer": "https://fawry-hr-ai.vercel.app",
        "X-Title": "Fawry HR AI",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "system", content: systemPrompt }, ...trimmed],
        temperature: 0.3,
        max_tokens: 800,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      res.status(response.status).json({
        error:
          data?.error?.message ||
          "خطأ من OpenRouter. لو الموديل المجاني بيرفض بسبب rate limit، جرب موديل تاني أو استنى شوية.",
      });
      return;
    }

    const answer = data.choices?.[0]?.message?.content?.trim() || "";

    res.status(200).json({
      answer,
      sources: matches.map((m) => `المادة ${m.num} — ${m.source}`),
      modelUsed: data.model || MODEL,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "خطأ غير متوقع" });
  }
};
