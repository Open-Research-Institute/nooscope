const API_BASE = 'https://www.googleapis.com/youtube/v3';

// When false, only top-level comments are collected — replies aren't fetched at all.
// This saves API quota: resolving a thread's full reply list beyond what's inlined
// requires extra comments.list calls, each billed separately. Flip to true to fetch
// every reply again (mirrors the bluesky collector's INCLUDE_NESTED_REPLIES toggle).
const INCLUDE_REPLIES = false;

export function parseYoutubeVideoUrl(url) {
    let parsed;
    try {
        parsed = new URL(url.trim());
    } catch {
        throw new Error('Not a recognizable YouTube URL');
    }

    if (parsed.hostname.endsWith('youtu.be')) {
        const id = parsed.pathname.slice(1);
        if (id) return id;
    }

    if (parsed.hostname.endsWith('youtube.com')) {
        if (parsed.pathname === '/watch') {
            const id = parsed.searchParams.get('v');
            if (id) return id;
        }
        const match = parsed.pathname.match(/^\/(shorts|embed|live)\/([^/?#]+)/);
        if (match) return match[2];
    }

    throw new Error('Not a recognizable YouTube URL (expected a youtube.com/watch, youtu.be, shorts, or embed link)');
}

async function apiFetch(path, params, apiKey) {
    const url = new URL(`${API_BASE}/${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    url.searchParams.set('key', apiKey);
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `YouTube API error (${res.status})`);
    return data;
}

export async function fetchVideoMeta(videoId, apiKey) {
    const data = await apiFetch('videos', { part: 'snippet', id: videoId }, apiKey);
    const video = data.items?.[0];
    if (!video) throw new Error(`No video found for id "${videoId}"`);
    return video;
}

// Paginates commentThreads.list until nextPageToken is exhausted. Each thread carries
// up to a handful of replies inline (snippet.totalReplyCount may exceed what's included).
async function fetchCommentThreads(videoId, apiKey, onProgress) {
    const threads = [];
    let pageToken;
    do {
        const data = await apiFetch('commentThreads', {
            part: 'snippet,replies',
            videoId,
            maxResults: 100,
            ...(pageToken ? { pageToken } : {}),
        }, apiKey);
        threads.push(...data.items);
        pageToken = data.nextPageToken;
        onProgress?.(`Fetched ${threads.length} comment thread${threads.length === 1 ? '' : 's'}${pageToken ? '...' : '.'}`);
    } while (pageToken);
    return threads;
}

// Paginates comments.list for a single thread's replies — used when a thread's
// totalReplyCount exceeds what commentThreads.list inlined.
async function fetchAllReplies(parentId, apiKey, onProgress) {
    const replies = [];
    let pageToken;
    do {
        const data = await apiFetch('comments', {
            part: 'snippet',
            parentId,
            maxResults: 100,
            ...(pageToken ? { pageToken } : {}),
        }, apiKey);
        replies.push(...data.items);
        pageToken = data.nextPageToken;
        onProgress?.(replies.length, pageToken);
    } while (pageToken);
    return replies;
}

// Fetches video metadata plus every top-level comment thread, each with its full reply
// list (re-fetched in full via comments.list when the inline set from commentThreads.list
// is incomplete, rather than trying to merge/dedupe the two).
//
// onProgress, if given, is called with a human-readable string after each network call —
// useful for surfacing pagination progress in a UI, since a video with a lot of comments
// can take many round trips.
export async function fetchAllCommentsForVideo(videoId, apiKey, onProgress) {
    onProgress?.('Fetching video info...');
    const video = await fetchVideoMeta(videoId, apiKey);

    onProgress?.(`Video: "${video.snippet.title}" — fetching comment threads...`);
    const rawThreads = await fetchCommentThreads(videoId, apiKey, onProgress);

    const threads = [];
    let repliesFetched = 0;
    for (const [i, thread] of rawThreads.entries()) {
        const comment = thread.snippet.topLevelComment;
        let replies = [];
        if (INCLUDE_REPLIES) {
            const totalReplyCount = thread.snippet.totalReplyCount ?? 0;
            const inlineReplies = thread.replies?.comments ?? [];
            replies = inlineReplies;
            if (inlineReplies.length < totalReplyCount) {
                onProgress?.(`Resolving replies for thread ${i + 1}/${rawThreads.length} (${totalReplyCount} replies)...`);
                replies = await fetchAllReplies(comment.id, apiKey, (count, hasMore) =>
                    onProgress?.(`Resolving replies for thread ${i + 1}/${rawThreads.length}: ${count}/${totalReplyCount}${hasMore ? '...' : ''}`));
            }
        }
        repliesFetched += replies.length;
        threads.push({ comment, replies });
    }

    onProgress?.(`Done — ${rawThreads.length} threads, ${repliesFetched} replies.`);
    return { video, threads };
}
