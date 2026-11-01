/**
 * Cloudflare Pages Function: /api/state
 * Shared real-time backend state stored in Cloudflare R2 (FLIP_R2 -> flip-releases)
 * Synchronizes Releases, What's New notes, and Media Items between flip-admin and flip-download.
 */

const STATE_KEY = 'live-state/portal-state.json';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  'Content-Type': 'application/json; charset=utf-8'
};

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
    const obj = await env.FLIP_R2.get(STATE_KEY);
    if (!obj) {
      return new Response(JSON.stringify({ initialized: false }), {
        status: 200,
        headers: CORS_HEADERS
      });
    }

    const text = await obj.text();
    return new Response(text, {
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
    const incoming = await request.json();
    let current = { initialized: true, releases: null, mediaItems: null, updatedAt: null };

    const existingObj = await env.FLIP_R2.get(STATE_KEY);
    if (existingObj) {
      try {
        current = JSON.parse(await existingObj.text());
      } catch (_) {}
    }

    const updated = {
      initialized: true,
      releases: incoming.releases !== undefined ? incoming.releases : current.releases,
      mediaItems: incoming.mediaItems !== undefined ? incoming.mediaItems : current.mediaItems,
      updatedAt: new Date().toISOString()
    };

    await env.FLIP_R2.put(STATE_KEY, JSON.stringify(updated, null, 2), {
      httpMetadata: {
        contentType: 'application/json; charset=utf-8',
        cacheControl: 'no-store, no-cache, must-revalidate, max-age=0'
      }
    });

    return new Response(JSON.stringify({ success: true, state: updated }), {
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

export async function onRequestPut(context) {
  return onRequestPost(context);
}
