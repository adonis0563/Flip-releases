/**
 * Cloudflare Pages Function: /api/metrics
 * Real-time analytics and telemetry backed by Cloudflare R2 (FLIP_R2 -> flip-releases).
 * Tracks real page visits, unique visitors, live active sessions (online now),
 * binary downloads per platform/version, bandwidth transferred, device OS, country,
 * and a live chronological event stream.
 */

const METRICS_KEY = 'live-state/metrics.json';
const ACTIVE_TTL_MS = 75 * 1000; // 75 seconds for active heartbeat window

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  'Content-Type': 'application/json; charset=utf-8'
};

function createEmptyMetrics() {
  return {
    totalVisits: 0,
    uniqueVisitors: 0,
    visitorIds: [],
    dailyStats: {},
    totalDownloads: 0,
    totalBandwidthBytes: 0,
    downloadsByPlatform: {
      'android': 0,
      'windows-installer': 0,
      'windows-portable': 0
    },
    downloadsByFile: {},
    countries: {},
    devices: {
      'Android': 0,
      'Windows': 0,
      'iOS': 0,
      'macOS': 0,
      'Linux': 0,
      'Other': 0
    },
    activeSessions: {},
    recentEvents: [],
    updatedAt: new Date().toISOString()
  };
}

function detectDevice(ua) {
  if (!ua) return 'Other';
  if (/android/i.test(ua)) return 'Android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'iOS';
  if (/windows/i.test(ua)) return 'Windows';
  if (/macintosh|mac os x/i.test(ua)) return 'macOS';
  if (/linux/i.test(ua)) return 'Linux';
  return 'Other';
}

function pruneActiveSessions(activeSessions) {
  const now = Date.now();
  const cleaned = {};
  if (activeSessions && typeof activeSessions === 'object') {
    for (const [id, session] of Object.entries(activeSessions)) {
      if (session && session.lastSeen && (now - session.lastSeen) <= ACTIVE_TTL_MS) {
        cleaned[id] = session;
      }
    }
  }
  return cleaned;
}

async function loadMetrics(env) {
  let metrics = createEmptyMetrics();
  const obj = await env.FLIP_R2.get(METRICS_KEY);
  if (obj) {
    try {
      const parsed = JSON.parse(await obj.text());
      metrics = {
        ...metrics,
        ...parsed,
        downloadsByPlatform: { ...metrics.downloadsByPlatform, ...(parsed.downloadsByPlatform || {}) },
        devices: { ...metrics.devices, ...(parsed.devices || {}) },
        countries: parsed.countries || {},
        downloadsByFile: parsed.downloadsByFile || {},
        dailyStats: parsed.dailyStats || {},
        visitorIds: Array.isArray(parsed.visitorIds) ? parsed.visitorIds : [],
        recentEvents: Array.isArray(parsed.recentEvents) ? parsed.recentEvents : []
      };
    } catch (_) {}
  }
  metrics.activeSessions = pruneActiveSessions(metrics.activeSessions);
  return metrics;
}

async function saveMetrics(env, metrics) {
  metrics.updatedAt = new Date().toISOString();
  await env.FLIP_R2.put(METRICS_KEY, JSON.stringify(metrics), {
    httpMetadata: {
      contentType: 'application/json; charset=utf-8',
      cacheControl: 'no-store, no-cache, must-revalidate, max-age=0'
    }
  });
}

function buildResponsePayload(metrics) {
  const todayKey = new Date().toISOString().slice(0, 10);
  const todayStats = metrics.dailyStats[todayKey] || { visits: 0, downloads: 0 };
  const activeList = Object.values(metrics.activeSessions || {});

  return {
    onlineNow: activeList.length,
    activeVisitors: activeList,
    totalVisits: metrics.totalVisits || 0,
    uniqueVisitors: metrics.uniqueVisitors || 0,
    visitsToday: todayStats.visits || 0,
    totalDownloads: metrics.totalDownloads || 0,
    downloadsToday: todayStats.downloads || 0,
    totalBandwidthBytes: metrics.totalBandwidthBytes || 0,
    downloadsByPlatform: metrics.downloadsByPlatform || {},
    downloadsByFile: metrics.downloadsByFile || {},
    countries: metrics.countries || {},
    devices: metrics.devices || {},
    dailyStats: metrics.dailyStats || {},
    recentEvents: (metrics.recentEvents || []).slice(0, 50),
    updatedAt: metrics.updatedAt
  };
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestGet(context) {
  const { env } = context;
  if (!env.FLIP_R2) {
    return new Response(JSON.stringify({ error: 'R2 binding FLIP_R2 not configured' }), {
      status: 500,
      headers: CORS_HEADERS
    });
  }

  try {
    const metrics = await loadMetrics(env);
    return new Response(JSON.stringify(buildResponsePayload(metrics)), {
      status: 200,
      headers: CORS_HEADERS
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: CORS_HEADERS
    });
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.FLIP_R2) {
    return new Response(JSON.stringify({ error: 'R2 binding FLIP_R2 not configured' }), {
      status: 500,
      headers: CORS_HEADERS
    });
  }

  try {
    const body = await request.json();
    const type = body.type || 'visit';

    if (type === 'reset') {
      const empty = createEmptyMetrics();
      await saveMetrics(env, empty);
      return new Response(JSON.stringify(buildResponsePayload(empty)), {
        status: 200,
        headers: CORS_HEADERS
      });
    }

    const ua = request.headers.get('user-agent') || '';
    const device = detectDevice(ua);
    const country = (request.cf && request.cf.country) || request.headers.get('cf-ipcountry') || 'XX';
    const city = (request.cf && request.cf.city) || '';
    const ip = request.headers.get('cf-connecting-ip') || 'anon';
    const visitorId = body.visitorId || `${ip}_${device}`;
    const page = body.page || '/';
    const todayKey = new Date().toISOString().slice(0, 10);

    const metrics = await loadMetrics(env);

    if (!metrics.dailyStats[todayKey]) {
      metrics.dailyStats[todayKey] = { visits: 0, downloads: 0 };
    }

    // Update active session presence
    if (type !== 'leave') {
      metrics.activeSessions[visitorId] = {
        lastSeen: Date.now(),
        page,
        device,
        country,
        city
      };
    } else {
      delete metrics.activeSessions[visitorId];
    }

    if (type === 'visit') {
      metrics.totalVisits = (metrics.totalVisits || 0) + 1;
      metrics.dailyStats[todayKey].visits += 1;

      if (!metrics.visitorIds.includes(visitorId)) {
        metrics.visitorIds.push(visitorId);
        if (metrics.visitorIds.length > 10000) {
          metrics.visitorIds.shift();
        }
        metrics.uniqueVisitors = (metrics.uniqueVisitors || 0) + 1;
      }

      metrics.devices[device] = (metrics.devices[device] || 0) + 1;
      if (country && country !== 'XX') {
        metrics.countries[country] = (metrics.countries[country] || 0) + 1;
      }

      metrics.recentEvents.unshift({
        id: 'evt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        type: 'visit',
        label: `Page visit (${page})`,
        page,
        device,
        country,
        city,
        timestamp: new Date().toISOString()
      });
    } else if (type === 'download') {
      const platform = body.platform || 'android';
      const filename = body.filename || 'Flip.apk';
      const version = body.version || '1.0.1';
      const fileSize = Number(body.fileSize || 0);
      const fileKey = `${filename} (v${version})`;

      metrics.totalDownloads = (metrics.totalDownloads || 0) + 1;
      metrics.dailyStats[todayKey].downloads += 1;
      metrics.totalBandwidthBytes = (metrics.totalBandwidthBytes || 0) + fileSize;

      metrics.downloadsByPlatform[platform] = (metrics.downloadsByPlatform[platform] || 0) + 1;
      metrics.downloadsByFile[fileKey] = (metrics.downloadsByFile[fileKey] || 0) + 1;

      if (country && country !== 'XX') {
        metrics.countries[country] = (metrics.countries[country] || 0) + 1;
      }

      metrics.recentEvents.unshift({
        id: 'evt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        type: 'download',
        label: `Downloaded ${filename} (v${version})`,
        platform,
        filename,
        version,
        fileSize,
        device,
        country,
        city,
        page,
        timestamp: new Date().toISOString()
      });
    }

    if (metrics.recentEvents.length > 50) {
      metrics.recentEvents.length = 50;
    }

    await saveMetrics(env, metrics);

    return new Response(JSON.stringify(buildResponsePayload(metrics)), {
      status: 200,
      headers: CORS_HEADERS
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: CORS_HEADERS
    });
  }
}
