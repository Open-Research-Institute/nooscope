import { createMessage } from '../../shared/message-format.js';

const itemUrl = (id) => `https://news.ycombinator.com/item?id=${id}`;

// Deleted/dead items carry no author or text and are skipped as messages — but their
// still-live replies are reparented past them to the nearest surviving ancestor
// (walked with the same effectiveParentId) so real content isn't dropped along with
// the "[deleted]" placeholder.
export function threadToMessages({ rootId, itemsById }) {
    const messages = [];
    const childrenOf = new Map();

    const addChild = (parentId, childId) => {
        if (parentId === undefined) return;
        if (!childrenOf.has(parentId)) childrenOf.set(parentId, []);
        childrenOf.get(parentId).push(childId);
    };

    const walk = (id, effectiveParentId) => {
        const item = itemsById.get(id);
        if (!item) return; // fetch resolved to null

        if (item.deleted || item.dead) {
            (item.kids || []).forEach(kidId => walk(kidId, effectiveParentId));
            return;
        }

        const messageId = String(item.id);
        addChild(effectiveParentId, messageId);

        messages.push(createMessage({
            id: messageId,
            author: item.by,
            text: item.type === 'story' ? [item.title, item.text].filter(Boolean).join('\n\n') : (item.text || ''),
            timestamp: item.time ? new Date(item.time * 1000).toISOString() : undefined,
            parent: effectiveParentId,
            metadata: {
                sourceUrl: itemUrl(item.id),
                score: item.score ?? undefined,
                type: item.type,
                externalUrl: item.url ?? undefined,
            },
        }));

        (item.kids || []).forEach(kidId => walk(kidId, messageId));
    };

    walk(rootId, undefined);

    for (const message of messages) {
        const kids = childrenOf.get(message.id);
        if (kids && kids.length > 0) message.children = kids;
    }

    return messages;
}
