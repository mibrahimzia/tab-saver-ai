document.addEventListener("DOMContentLoaded", async function () {
  const saveBtn = document.getElementById("saveTabs");
  const categorizeBtn = document.getElementById("categorizeTabs");
  const summarizeBtn = document.getElementById("summarizeTabs");
  const downloadAIResultBtn = document.getElementById("downloadAIResult");
  const downloadLLMBtn = document.getElementById("downloadLLM");
  const resultDiv = document.getElementById("result");

  // ----- Safe storage helpers -----
  function storageAvailable() {
    return (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local);
  }

  function getStorage(key) {
    return new Promise((resolve) => {
      if (!storageAvailable()) {
        console.warn("chrome.storage.local not available in this context.");
        resolve(null);
        return;
      }
      if (!key || typeof key !== "string") {
        resolve(null);
        return;
      }
      chrome.storage.local.get([key], (res) => {
        if (chrome.runtime.lastError) {
          console.error("Storage get error:", chrome.runtime.lastError);
          resolve(null);
          return;
        }
        resolve(res ? res[key] : null);
      });
    });
  }

  function setStorage(key, value) {
    return new Promise((resolve) => {
      if (!storageAvailable()) {
        console.warn("chrome.storage.local not available in this context.");
        resolve();
        return;
      }
      if (!key || typeof key !== "string") {
        resolve();
        return;
      }
      chrome.storage.local.set({ [key]: value }, () => {
        if (chrome.runtime.lastError) {
          console.error("Storage set error:", chrome.runtime.lastError);
        }
        resolve();
      });
    });
  }

  // ----- Simple markdown renderer (headings + bullets) -----
  function renderMarkdown(mdText) {
    if (!mdText) {
      resultDiv.innerText = "No result to display.";
      return;
    }
    const html = mdText
      .replace(/^### (.*$)/gim, "<h4>$1</h4>")
      .replace(/^## (.*$)/gim, "<h3>$1</h3>")
      .replace(/^# (.*$)/gim, "<h2>$1</h2>")
      .replace(/^- (.*$)/gim, "• $1")
      .replace(/\n/g, "<br>");
    resultDiv.innerHTML = html;
  }

  // ----- Download helper (popup can use createObjectURL) -----
  function downloadMarkdown(mdText, filename) {
    const blob = new Blob([mdText], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({
      url,
      filename,
      saveAs: true
    }, () => {
      // revoke after short delay to ensure download started
      setTimeout(() => URL.revokeObjectURL(url), 3000);
    });
  }

  // ----- Load persisted content on open -----
  const savedCategorization = await getStorage("aiResult");
  const savedSummary = await getStorage("llmSummary");

  if (savedCategorization) {
    renderMarkdown(savedCategorization);
    downloadAIResultBtn.style.display = "inline-block";
  } else if (savedSummary) {
    renderMarkdown(savedSummary);
    downloadLLMBtn.style.display = "inline-block";
  } else {
    resultDiv.innerText = "Click 'AI Categorize' or 'Summarize Session' to get started.";
  }

  // ----- Button handlers -----
  saveBtn?.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "save_tabs" }, (resp) => {
      if (resp && resp.error) {
        resultDiv.innerText = "Save failed: " + resp.error;
      } else {
        resultDiv.innerText = "Saving open tabs... a download should appear.";
      }
    });
  });

  categorizeBtn?.addEventListener("click", () => {
    resultDiv.innerText = "Analyzing tabs and generating markdown categories...";
    chrome.runtime.sendMessage({ action: "categorize_tabs" }, async (resp) => {
      if (resp && resp.error) {
        resultDiv.innerText = "Error: " + resp.error;
        return;
      }
      const md = resp?.result ?? "";
      if (!md) {
        resultDiv.innerText = "No result returned from LLM.";
        return;
      }
      await setStorage("aiResult", md);
      renderMarkdown(md);
      downloadAIResultBtn.style.display = "inline-block";
    });
  });

  summarizeBtn?.addEventListener("click", () => {
    resultDiv.innerText = "Generating a short summary of your browsing session...";
    chrome.runtime.sendMessage({ action: "summarize_tabs" }, async (resp) => {
      if (resp && resp.error) {
        resultDiv.innerText = "Error: " + resp.error;
        return;
      }
      const md = resp?.summary ?? "";
      if (!md) {
        resultDiv.innerText = "No summary returned from LLM.";
        return;
      }
      await setStorage("llmSummary", md);
      renderMarkdown(md);
      downloadLLMBtn.style.display = "inline-block";
    });
  });

  downloadAIResultBtn?.addEventListener("click", async () => {
    const md = await getStorage("aiResult");
    if (!md) {
      alert("No categorization saved.");
      return;
    }
    downloadMarkdown(md, "tab_categorization.md");
  });

  downloadLLMBtn?.addEventListener("click", async () => {
    const md = await getStorage("llmSummary");
    if (!md) {
      alert("No summary saved.");
      return;
    }
    downloadMarkdown(md, "browsing_summary.md");
  });
});
