require("dotenv").config();

console.log("CLIENT_SECRET length:", (process.env.GOOGLE_CLIENT_SECRET || "").length);
console.log("PORT:", process.env.PORT);

const express = require("express");
const session = require("express-session");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;

const app = express();

app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET || "dev-secret",
  resave: false,
  saveUninitialized: false,
}));

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: "/auth/google/callback",
}, (accessToken, refreshToken, profile, done) => {
  // store tokens in session user object
  return done(null, { profile, accessToken, refreshToken });
}));

app.get("/auth/google",
  passport.authenticate("google", {
    scope: [
      "openid",
      "profile",
      "email",
      "https://www.googleapis.com/auth/analytics.readonly"
    ],
    accessType: "offline",
    prompt: "consent"
  })
);

app.get("/auth/google/callback",
  passport.authenticate("google", { failureRedirect: "/" }),
  (req, res) => res.redirect("/")
);

app.get("/logout", (req, res) => {
  req.logout(() => {
    res.redirect("/");
  });
});

app.get("/favicon.ico", (req, res) => res.status(204).end());

// --- Helpers ---
function requireLogin(req, res, next) {
  if (!req.user || !req.user.accessToken) {
    return res.status(401).json({ error: "Not logged in. Visit /auth/google first." });
  }
  next();
}

function normalizePropertyId(raw) {
  const v = String(raw || "").trim();
  if (!v) return "";
  const m = v.match(/(\d+)/);
  return m ? m[1] : "";
}

async function gaRunReport(propertyPath, accessToken, payload) {
  const url = `https://analyticsdata.googleapis.com/v1beta/${propertyPath}:runReport`;

  console.log("GA4 REQUEST URL:", url);
  console.log("GA4 REQUEST PAYLOAD:", JSON.stringify(payload, null, 2));

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const text = await r.text();

  if (!r.ok) {
    console.error("GA4 REST ERROR", { status: r.status, body: text });
    throw new Error(`GA4 REST HTTP ${r.status}: ${text}`);
  }

  return JSON.parse(text);
}

function fmtDateYYYYMMDDToISO(yyyymmdd) {
  if (!yyyymmdd || yyyymmdd.length !== 8) return yyyymmdd;
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

function rowsToActiveUsersSeries(rows) {
  return (rows || []).map(r => {
    const dateRaw = r.dimensionValues?.[0]?.value || "";
    const date = fmtDateYYYYMMDDToISO(dateRaw);
    const v = Number(r.metricValues?.[0]?.value || 0);
    return { date, activeUsers: v };
  });
}

function mapRowsToKeyedMetric(rows, keyIndex, metricIndex) {
  const out = new Map();
  for (const r of (rows || [])) {
    const key = r.dimensionValues?.[keyIndex]?.value || "Unknown";
    const val = Number(r.metricValues?.[metricIndex]?.value || 0);
    out.set(key, val);
  }
  return out;
}

function pctChange(cur, prev) {
  if (!prev || prev === 0) return null;
  return ((cur - prev) / prev) * 100;
}

// --- Metadata endpoint ---
app.get("/api/ga4/metadata", requireLogin, async (req, res) => {
  try {
    const propertyId = String(process.env.GA4_PROPERTY_ID || "").match(/(\d+)/)?.[1] || "";
    if (!propertyId) return res.status(500).json({ error: "Missing GA4_PROPERTY_ID in .env" });

    const propertyPath = `properties/${propertyId}`;
    const url = `https://analyticsdata.googleapis.com/v1beta/${propertyPath}/metadata`;

    const r = await fetch(url, {
      headers: { "Authorization": `Bearer ${req.user.accessToken}` }
    });

    const text = await r.text();
    if (!r.ok) return res.status(r.status).send(text);
    return res.type("json").send(text);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});
function gaRoundPct(n) {
  if (!isFinite(n)) return null;
  return Math.round(n * 10) / 10;
}

// --- Main GA endpoint ---
app.get("/api/ga4", requireLogin, async (req, res) => {
  try {
    const source = String(req.query.source || "all");

    const propertyId = normalizePropertyId(process.env.GA4_PROPERTY_ID);
    if (!propertyId) {
      return res.status(500).json({
        error: "Missing/invalid GA4_PROPERTY_ID in .env. Use the numeric GA4 Property ID (digits)."
      });
    }

    const propertyPath = `properties/${propertyId}`;
    console.log("GA4 propertyPath:", propertyPath);

    // GA Home style: last 7 days vs previous 7 days
    const curRange  = { startDate: "7daysAgo",  endDate: "yesterday" };
const prevRange = { startDate: "14daysAgo", endDate: "8daysAgo" };


    // 1) Timeseries: Active users by date (current)
    const curReport = await gaRunReport(propertyPath, req.user.accessToken, {
      dateRanges: [curRange],
      dimensions: [{ name: "date" }],
      metrics: [{ name: "activeUsers" }]
    });

    // 2) Timeseries: Active users by date (previous)
    const prevReport = await gaRunReport(propertyPath, req.user.accessToken, {
      dateRanges: [prevRange],
      dimensions: [{ name: "date" }],
      metrics: [{ name: "activeUsers" }]
    });

    const series = rowsToActiveUsersSeries(curReport.rows || []);
    const prevSeries = rowsToActiveUsersSeries(prevReport.rows || []);

    // 3) Totals card: active users, new users, avg engagement time
    const totalsReport = await gaRunReport(propertyPath, req.user.accessToken, {
      dateRanges: [curRange],
      metrics: [
        { name: "activeUsers" },
        { name: "newUsers" },
        { name: "userEngagementDuration" }
      ]
    });

    const row = totalsReport.rows?.[0]?.metricValues || [];
    const activeUsers = Number(row[0]?.value || 0);
    const newUsers = Number(row[1]?.value || 0);
    const userEngagementDuration = Number(row[2]?.value || 0);

    const avgEngagementTimeSec =
      activeUsers > 0 ? Math.round(userEngagementDuration / activeUsers) : 0;

    const totals = { activeUsers, newUsers, avgEngagementTimeSec };

    // 4) Sessions by channel (GA Home card) - current + previous, with % change
    const channelCur = await gaRunReport(propertyPath, req.user.accessToken, {
      dateRanges: [curRange],
      dimensions: [{ name: "sessionDefaultChannelGroup" }],
      metrics: [{ name: "sessions" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 7
    });

    const channelPrev = await gaRunReport(propertyPath, req.user.accessToken, {
      dateRanges: [prevRange],
      dimensions: [{ name: "sessionDefaultChannelGroup" }],
      metrics: [{ name: "sessions" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 50
    });

    const prevMap = mapRowsToKeyedMetric(channelPrev.rows || [], 0, 0);

    const channelSessions = (channelCur.rows || []).map(r => {
      const channel = r.dimensionValues?.[0]?.value || "Unknown";
      const sessions = Number(r.metricValues?.[0]?.value || 0);
      const prevSessions = Number(prevMap.get(channel) || 0);
      const changePct = pctChange(sessions, prevSessions);

   return {
  channel,
  sessions,
  prevSessions,
  changePct: gaRoundPct(changePct)
};


    });

    // 5) Top pages (pagePathPlusQueryString) - keep it REST like everything else
    const pagesReport = await gaRunReport(propertyPath, req.user.accessToken, {
      dateRanges: [curRange],
      dimensions: [{ name: "pagePathPlusQueryString" }],
      metrics: [{ name: "screenPageViews" }, { name: "userEngagementDuration" }],
      orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
      limit: 5
    });

    const pages = (pagesReport.rows || []).map(r => ({
      page: r.dimensionValues?.[0]?.value || "",
      views: Number(r.metricValues?.[0]?.value || 0),
      engagementSec: Math.round(Number(r.metricValues?.[1]?.value || 0))
    }));

    return res.json({
      query: { source },
      totals,
      series,
      prevSeries,
      channelSessions,
      pages
    });

  } catch (err) {
    console.error("GA4 ERROR", {
      message: err?.message,
      stack: err?.stack
    });
return res.status(500).json({
  error: err?.message || "GA4 request failed",
  stack: err?.stack || null
});
  }
});

// Serve your frontend files
app.use(express.static("."));

const port = Number(process.env.PORT || 5050);
app.listen(port, () => {
  console.log(`✅ Server running at http://127.0.0.1:${port}`);
});
