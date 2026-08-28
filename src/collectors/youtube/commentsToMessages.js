import { createMessage } from '../../shared/message-format.js';

const watchUrl = (videoId) => `https://www.youtube.com/watch?v=${videoId}`;
const commentUrl = (videoId, commentId) => `${watchUrl(videoId)}&lc=${commentId}`;

const commentToMessage = (videoId, comment, parentId) => {
    const s = comment.snippet;
    return createMessage({
        id: comment.id,
        author: s.authorDisplayName,
        text: s.textOriginal ?? s.textDisplay ?? '',
        timestamp: s.publishedAt,
        parent: parentId,
        metadata: {
            sourceUrl: commentUrl(videoId, comment.id),
            likes: s.likeCount ?? 0,
        },
    });
};

// Video becomes the root message so top-level comments parent to it and replies parent
// to their comment — same shape Bluesky uses for its root post.
export function commentsToMessages({ video, threads }) {
    const s = video.snippet;
    const messages = [];

    messages.push(createMessage({
        id: video.id,
        author: s.channelTitle,
        text: s.title,
        timestamp: s.publishedAt,
        children: threads.map(({ comment }) => comment.id),
        metadata: { sourceUrl: watchUrl(video.id) },
    }));

    for (const { comment, replies } of threads) {
        messages.push(commentToMessage(video.id, comment, video.id));
        for (const reply of replies) {
            messages.push(commentToMessage(video.id, reply, comment.id));
        }
    }

    return messages;
}
