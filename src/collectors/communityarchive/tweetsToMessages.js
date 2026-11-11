import { createMessage } from '../../shared/message-format.js';

/**
 * Community Archive v1 Tweet objects -> spec messages (docs/spec.md).
 *
 * Returns { messages, skipped } — nothing is dropped silently: every tweet that does not become a
 * message is listed in `skipped` with its id (if any) and a reason.
 *
 * Threading: `parent` must reference an id in the same batch (spec), so it is set only when the
 * replied-to tweet is in this batch. The raw reply_to_tweet_id is always kept in
 * metadata.replyToTweetId, so a reply to a tweet outside the batch is not lost.
 */
export function tweetsToMessages(tweets, { keepRetweets = false } = {}) {
    const messages = [];
    const skipped = [];
    const seen = new Set();

    for (const t of tweets) {
        const id = tweetIdOf(t);
        const reason = skipReason(t, id, seen, { keepRetweets });
        if (reason) {
            skipped.push({ tweetId: id || null, reason });
            continue;
        }
        seen.add(id);
        messages.push(tweetToMessage(t, id));
    }

    linkReplies(messages);
    return { messages, skipped };
}

export function tweetIdOf(t) {
    return t?.tweet_id != null ? String(t.tweet_id) : '';
}

export function tweetUrl(t) {
    return `https://x.com/${t.username || 'i'}/status/${t.tweet_id}`;
}

// The bouncer: why a tweet should not become a message, or null if it should.
export function skipReason(t, id, seen, { keepRetweets = false } = {}) {
    if (!id) return 'missing tweet_id';
    if (seen.has(id)) return 'duplicate tweet_id in batch';
    if (!keepRetweets && t.retweeted_tweet_id) return `retweet of ${t.retweeted_tweet_id}`;
    if (!t.full_text || !t.full_text.trim()) return 'empty full_text';
    return null;
}

// One tweet -> one message. Spec fields first; everything else in metadata.
export function tweetToMessage(t, id) {
    return createMessage({
        id,
        author: t.username ?? t.account_id ?? undefined,
        text: t.full_text,
        timestamp: t.created_at ?? undefined,
        metadata: {
            sourceUrl: tweetUrl(t),
            likes: t.favorite_count ?? 0,
            retweets: t.retweet_count ?? 0,
            replyToTweetId: t.reply_to_tweet_id ?? undefined,
            replyToUsername: t.reply_to_username ?? undefined,
            conversationId: t.conversation_id ?? undefined,
            quotedTweetId: t.quoted_tweet_id ?? undefined,
            urls: (t.urls || []).map((u) => u.expanded_url || u.url).filter(Boolean),
            accountId: t.account_id ?? undefined,
        },
    });
}

// Second pass: wire parent/children for replies whose parent is in this batch. Runs after all
// messages exist, so it works whatever order the tweets arrived in.
export function linkReplies(messages) {
    const byId = new Map(messages.map((m) => [m.id, m]));
    for (const m of messages) {
        const parentId = m.metadata.replyToTweetId;
        if (!parentId || !byId.has(parentId)) continue;
        m.parent = parentId;
        const parent = byId.get(parentId);
        (parent.children ||= []).push(m.id);
    }
    return messages;
}
