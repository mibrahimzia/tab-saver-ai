// ============ CONFIG - replace API key below ============ //
const OPENROUTER_API_KEY = "YOUR_OPENROUTER_KEY_HERE"; // <-- put your OpenRouter / Groq key here
const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
// If you want to use Groq instead, swap endpoint + payload accordingly.
// ======================================================= //

/**
 * Helper: query all tabs as a Promise
 */
function getAllTabs() {
  return new Promise((resolve) => {
    chrome.tabs.query({}, (tabs) => {
      resolve(tabs || []);
    });
  });
}

/**
 * Helper: turn text into a data URL using FileReader (service worker safe)
 */
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    try {
      const reader = new FileReader();
      reader.onload = function () {
        resolve(reader.result);
      };
      reader.onerror = function (e) {
        reject(e);
      };
      reader.readAsDataURL(blob);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Helper: call OpenRouter-like chat completion
 * Returns string (the model response text) or throws
 */
async function callLLM(prompt, system = "You are a helpful assistant.") {
  if (!OPENROUTER_API_KEY) {
    throw new Error("Missing OpenRouter API key in background.js");
  }

  const body = {
    model: "gpt-3.5-turbo", // change if you have another supported model
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt }
    ],
    temperature: 0.6,
    max_tokens: 800
  };

  const resp = await fetch(OPENROUTER_ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`LLM API error ${resp.status}: ${text}`);
  }

  const data = await resp.json();
  // OpenRouter style: data.choices[0].message.content
  const text = data?.choices?.[0]?.message?.content;
  return text ?? "";
}

/**
 * Main message handler
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.action) {
    sendResponse({ error: "No action provided" });
    return;
  }

  // ---------- Save open tabs as TXT ----------
  if (message.action === "save_tabs") {
    (async () => {
      try {
        const tabs = await getAllTabs();
        const tabList = tabs.map(t => `${t.title || "(no title)"} - ${t.url || ""}`).join("\n");
        const blob = new Blob([tabList], { type: "text/plain" });
        const dataUrl = await blobToDataUrl(blob);
        chrome.downloads.download({
          url: dataUrl,
          filename: "open_tabs.txt",
          saveAs: true
        });
        sendResponse({ ok: true });
      } catch (err) {
        console.error("save_tabs error:", err);
        sendResponse({ error: String(err) });
      }
    })();
    // no async response needed (we already call sendResponse inside)
    return true;
  }

  // ---------- Categorize tabs using LLM (returns markdown) ----------
  if (message.action === "categorize_tabs") {
    (async () => {
      try {
        const tabs = await getAllTabs();
        const tabList = tabs.map(t => `${t.title || "(no title)"} — ${t.url || ""}`).join("\n");

        const prompt = `Categorize the following browser tabs into 3-6 meaningful categories.
Return the response in Markdown format with headings "## Category Name" and bullet lines:
## Category
- Tab Title — (URL)

Tabs:
${tabList}`;

        const llmText = await callLLM(prompt, "You are an expert organizer. Produce clean markdown groups.");
        // send back the raw markdown text
        sendResponse({ result: llmText ?? "" });
      } catch (err) {
        console.error("categorize_tabs error:", err);
        sendResponse({ error: String(err) });
      }
    })();

    // keep channel open for async response
    return true;
  }

  // ---------- Summarize tabs using LLM (returns markdown summary) ----------
  if (message.action === "summarize_tabs") {
    (async () => {
      try {
        const tabs = await getAllTabs();
        const tabList = tabs.map(t => `- ${t.title || "(no title)"} — ${t.url || ""}`).join("\n");

        const prompt = `Read this list of open browser tabs and produce a short Markdown summary (3-5 concise bullet points or a short paragraph) describing:
- The main topics being researched
- Any clear user intent or tasks visible
- Suggestions (1-2) for organizing or next actions

Tabs:
${tabList}`;

        const llmText = await callLLM(prompt, "You are a concise summarizer that outputs Markdown (bullets/short paragraphs).");
        sendResponse({ summary: llmText ?? "" });
      } catch (err) {
        console.error("summarize_tabs error:", err);
        sendResponse({ error: String(err) });
      }
    })();

    return true;
  }

  // unknown action
  sendResponse({ error: "Unknown action: " + message.action });
  return false;
});

