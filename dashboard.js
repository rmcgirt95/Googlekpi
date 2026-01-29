const API = "/api/ga4?source=all";

let chart;

async function fetchGA() {
  let res;
  let bodyText = "";

  try {
    res = await fetch(API, {
      credentials: "include",
      headers: { "Accept": "application/json" }
    });

    bodyText = await res.text();

    if (!res.ok) {
      let parsed;
      try {
        parsed = JSON.parse(bodyText);
      } catch {
        parsed = { raw: bodyText };
      }

      console.error("❌ GA API HTTP error", {
        url: API,
        status: res.status,
        statusText: res.statusText,
        response: parsed
      });

      throw new Error(
        parsed?.error ||
        parsed?.message ||
        `HTTP ${res.status} ${res.statusText}`
      );
    }

    try {
      return JSON.parse(bodyText);
    } catch (e) {
      console.error("❌ GA API invalid JSON response", bodyText);
      throw new Error("Invalid JSON response from server");
    }

  } catch (err) {
    console.error("❌ fetchGA() failed", {
      message: err.message,
      stack: err.stack
    });
    throw err;
  }
}

function secondsToMMSS(sec) {
  const n = Number(sec || 0);
  const m = Math.floor(n / 60);
  const s = n % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

function renderKpis(data) {
  const t = data.totals || {};

  document.getElementById("kpi-users").textContent = t.activeUsers ?? "–";
  document.getElementById("kpi-new-users").textContent = t.newUsers ?? "–";
  document.getElementById("kpi-engagement").textContent =
    (t.avgEngagementTimeSec != null) ? secondsToMMSS(t.avgEngagementTimeSec) : "–";

  // optional realtime (if you add it server-side later)
  const rt = document.getElementById("kpi-realtime");
  if (rt) rt.textContent = (t.activeUsersLast30Min ?? "–");
}

function renderChart(series) {
  const labels = (series || []).map(d => d.date);
  const values = (series || []).map(d => Number(d.activeUsers ?? d.value ?? 0));

  if (chart) chart.destroy();

  chart = new Chart(document.getElementById("usersChart"), {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Active users",
        data: values,
        tension: 0.35,
        fill: true,
        pointRadius: 3
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true }
      }
    }
  });
}

function formatPct(changePct) {
  if (changePct == null) return { text: "–", cls: "flat" };

  const n = Number(changePct);
  const abs = Math.abs(n).toFixed(1);

  if (n > 0) return { text: `↑ ${abs}%`, cls: "up" };
  if (n < 0) return { text: `↓ ${abs}%`, cls: "down" };
  return { text: "0.0%", cls: "flat" };
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderSessionsByChannel(list) {
  const el = document.getElementById("sessionsByChannel");
  if (!el) return;

  if (!Array.isArray(list) || list.length === 0) {
    el.innerHTML = `<div class="muted">No data</div>`;
    return;
  }

  const max = Math.max(...list.map(x => Number(x.sessions || 0)), 1);

  el.innerHTML = list.map(row => {
    const sessions = Number(row.sessions || 0);
    const widthPct = (sessions / max) * 100;

    const { text: changeText, cls } = formatPct(row.changePct);

    return `
      <div class="ga-row">
        <div class="ga-row-left">
          <div class="ga-label">${escapeHtml(row.channel)}</div>
          <div class="ga-bar">
            <div class="ga-bar-fill" style="width:${widthPct}%;"></div>
          </div>
        </div>

        <div class="ga-row-right">
          <div class="ga-sessions">${sessions}</div>
          <div class="ga-change ${cls}">${changeText}</div>
        </div>
      </div>
    `;
  }).join("");
}

/**
 * ✅ NEW: Views by Page title renderer
 * Expects: data.topPages = [{ title, views, changePct }]
 * and optional: data.topPagesMeta = { rangeLabel: "Last 7 days" }
 */
function renderTopPages(payload) {
  const rows = payload?.topPages;
  const meta = payload?.topPagesMeta || {};

  // We’ll render into the existing "Views by..." GA card table
  // ✅ Add an id="topPagesBody" to your HTML (recommended),
  // but we also support a fallback query.
  let bodyEl = document.getElementById("topPagesBody");
  if (!bodyEl) {
    // fallback: find the ga-card that contains "Views by"
    const cards = Array.from(document.querySelectorAll(".ga-card"));
    const target = cards.find(c => (c.textContent || "").includes("Views by"));
    if (target) {
      // find first .ga-table after header
      bodyEl = target.querySelector(".ga-table");
    }
  }

  if (!bodyEl) return;

  // If bodyEl is the whole table, we want to replace rows AFTER the header row.
  // Recommended structure is to have a dedicated container div.
  const hasDedicatedContainer = bodyEl.id === "topPagesBody";

  if (!Array.isArray(rows) || rows.length === 0) {
    if (hasDedicatedContainer) {
      bodyEl.innerHTML = `<div class="muted">No data</div>`;
    } else {
      // replace all rows except header
      const header = bodyEl.querySelector(".ga-row.ga-header");
      bodyEl.innerHTML = header ? header.outerHTML + `<div class="muted">No data</div>` : `<div class="muted">No data</div>`;
    }
    return;
  }

  const max = Math.max(...rows.map(r => Number(r.views || 0)), 1);

  const htmlRows = rows.map(r => {
    const views = Number(r.views || 0);
    const widthPct = (views / max) * 100;
    const { text: changeText, cls } = formatPct(r.changePct);

    return `
      <div class="ga-row">
        <span>${escapeHtml(r.title)}</span>
        <span>${views} <small class="${cls}">${escapeHtml(changeText)}</small></span>
        <div class="bar"><div style="width:${widthPct}%"></div></div>
      </div>
    `;
  }).join("");

  if (hasDedicatedContainer) {
    bodyEl.innerHTML = htmlRows;
  } else {
    const header = bodyEl.querySelector(".ga-row.ga-header");
    const headerHtml = header ? header.outerHTML : `
      <div class="ga-row ga-header">
        <span>PAGE TITLE</span>
        <span>VIEWS</span>
      </div>
    `;
    bodyEl.innerHTML = headerHtml + htmlRows;
  }

  // Optional footer label update if you add id="topPagesRangeLabel"
  const rangeLabelEl = document.getElementById("topPagesRangeLabel");
  if (rangeLabelEl && meta.rangeLabel) {
    rangeLabelEl.textContent = meta.rangeLabel;
  }
}
const PASSWORD_HASH = "8f75d1ea37920adabc2288bd7cc0b1a6ec2c4f689b126bd3866f66edc509de89";

  async function sha256(text) {
    const buf = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(text)
    );
    return Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");
  }

 async function unlock() {
  const input = document.getElementById("password").value;
  const normalized = input.normalize("NFKC"); // optional but helpful
  const hash = await sha256(normalized);


  console.log("computed hash:", hash);
  console.log("expected hash:", PASSWORD_HASH);

  if (hash === PASSWORD_HASH) {
    sessionStorage.setItem("unlocked", "true");
    document.getElementById("lock").style.display = "none";
    document.getElementById("app").style.display = "block";
  } else {
    document.getElementById("error").textContent = "Incorrect password";
  }
}

async function refresh() {
  try {
    const data = await fetchGA();

    renderKpis(data);
    renderChart(data.series || []);
    renderSessionsByChannel(data.channelSessions || []);

    // ✅ NEW
    renderTopPages(data);

  } catch (e) {
    console.error(e);
    alert(e.message);
  }
}

refresh();
