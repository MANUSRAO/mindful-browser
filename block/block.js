import { getApiKey } from "../utils/storage.js";
import { classifyIntent } from "../utils/gemini.js";

const params = new URLSearchParams(window.location.search);
const domain = (params.get("domain") ?? "").toLowerCase();

const $ = (id) => document.getElementById(id);
const headingEl = $("heading");
const form = $("form");
const reasonEl = $("reason");
const submitBtn = $("submit");
const backBtn = $("back");
const statusEl = $("status");
const resultEl = $("result");
const settingsBtn = $("openSettings");

function friendlyName(d) {
  if (!d) return "";
  const stem = d.split(".")[0];
  return stem.charAt(0).toUpperCase() + stem.slice(1);
}

function setReasonDisabled(disabled) {
  reasonEl.contentEditable = disabled ? "false" : "true";
  reasonEl.setAttribute("aria-disabled", disabled ? "true" : "false");
}

if (!domain) {
  headingEl.textContent = "🚫 This site is blocked";
  setReasonDisabled(true);
  submitBtn.disabled = true;
  showStatus(
    "No domain in URL — open this page via a redirect, not directly.",
    "error",
  );
} else {
  headingEl.textContent = `🚫 ${friendlyName(domain)} is blocked`;
  document.title = `Blocked: ${domain}`;
}

settingsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

backBtn.addEventListener("click", () => {
  if (history.length > 1) {
    history.back();
  } else {
    window.location.href = "about:blank";
  }
});

function showStatus(text, kind = "info") {
  statusEl.textContent = text;
  statusEl.className = `status ${kind}`;
  statusEl.hidden = false;
}

function showResult(html) {
  resultEl.innerHTML = html;
  resultEl.hidden = false;
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!domain) return;

  const justification = (reasonEl.innerText || "").trim();
  if (justification.length < 10) {
    showStatus(
      "Give a real, specific reason (at least 10 characters).",
      "error",
    );
    return;
  }

  submitBtn.disabled = true;
  resultEl.hidden = true;
  showStatus("Evaluating your reason…", "info");

  try {
    const apiKey = await getApiKey();
    if (!apiKey) {
      showStatus(
        "No Gemini API key set — access denied. Open settings to add one.",
        "error",
      );
      submitBtn.disabled = false;
      return;
    }

    const { verdict, reason } = await classifyIntent({
      apiKey,
      domain,
      justification,
    });

    if (verdict === "productive") {
      showStatus("Approved — granting 5 minutes of access.", "ok");
      const resp = await chrome.runtime.sendMessage({
        type: "GRANT_ACCESS",
        domain,
      });
      if (!resp?.ok) throw new Error(resp?.error || "Failed to grant access");
      showResult(
        `<p><strong>Reason accepted.</strong> ${escapeHtml(reason)}</p>` +
          `<p>Redirecting to ${escapeHtml(domain)}…</p>`,
      );
      setTimeout(() => {
        window.location.replace(`https://${domain}/`);
      }, 1200);
    } else {
      showStatus("Reason looks non-productive — access denied.", "error");
      showResult(
        `<p><strong>Why this was rejected:</strong> ${escapeHtml(reason)}</p>` +
          `<p>Try again with a more specific, work- or learning-grounded justification.</p>`,
      );
      submitBtn.disabled = false;
    }
  } catch (err) {
    showStatus(`Error: ${err.message}. Access denied.`, "error");
    submitBtn.disabled = false;
  }
});
