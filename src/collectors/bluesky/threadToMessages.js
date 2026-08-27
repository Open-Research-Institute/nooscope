import { createMessage } from '../../shared/message-format.js';

// When false, only the root post and its direct (top-level) replies are collected —
// replies-to-replies are fetched (fetchThread still asks for the full depth) but dropped
// during flattening. Flip to true to walk the full nested tree again.
const INCLUDE_NESTED_REPLIES = false;

const postPermalink = (uri, handle) => `https://bsky.app/profile/${handle}/post/${uri.split('/').pop()}`;

// Recursively flattens a getPostThread reply tree into schema messages, using each
// post's AT-URI as its id so parent/children stay valid however the array is later
// merged, filtered, or sorted.
export function threadToMessages(threadNode) {
    const messages = [];

    const walk = (node, parentId, depth) => {
        if (!node || !node.post) return; // skip notFound/blocked stub nodes

        // depth 0 = root, depth 1 = its direct replies — always walked so "top-level
        // replies" are collected regardless of the flag; deeper levels need it enabled.
        const willWalkReplies = INCLUDE_NESTED_REPLIES || depth === 0;

        const post = node.post;
        const childIds = willWalkReplies
            ? (node.replies || []).filter(reply => reply && reply.post).map(reply => reply.post.uri)
            : [];

        messages.push(createMessage({
            id: post.uri,
            author: post.author.handle,
            text: post.record?.text || '',
            timestamp: post.record?.createdAt || post.indexedAt,
            parent: parentId,
            children: childIds,
            metadata: {
                sourceUrl: postPermalink(post.uri, post.author.handle),
                likes: post.likeCount ?? 0,
                repostCount: post.repostCount ?? 0,
                replyCount: post.replyCount ?? 0,
                avatar: post.author.avatar || null,
            },
        }));

        if (willWalkReplies) {
            (node.replies || []).forEach(child => walk(child, post.uri, depth + 1));
        }
    };

    walk(threadNode, undefined, 0);
    return messages;
}
