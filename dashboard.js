const API = "/api/ga4?source=all";

let chart;

async function fetchGA() {
  let res;
  let bodyText = "";

  try {
    res = await fetch(API, {
      credentials: "include",
      headers: {
        "Accept": "application/json"
      }
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
  // changePct is already rounded server-side; keep UI stable
  if (changePct == null) return { text: "–", cls: "flat" };

  const n = Number(changePct);
  const abs = Math.abs(n).toFixed(1);

  if (n > 0) return { text: `↑ ${abs}%`, cls: "up" };
  if (n < 0) return { text: `↓ ${abs}%`, cls: "down" };
  return { text: "0.0%", cls: "flat" };
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
          <div class="ga-label">${row.channel}</div>
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

async function refresh() {
  try {
    const data = await fetchGA();

    renderKpis(data);
    renderChart(data.series || []);
    renderSessionsByChannel(data.channelSessions || []);

  } catch (e) {
    console.error(e);
    alert(e.message);
  }
}

refresh();
