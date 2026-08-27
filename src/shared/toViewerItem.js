// Adapts spec messages (src/shared/message-format.js) into the flat shape the
// pipeline consumes, tagging each item with which input file it came from.
export function messagesToViewerItems(messages, sourceIndex) {
    return messages.map(m => ({
        id: m.id,
        author: m.author,
        content: m.text,
        timestamp: m.timestamp,
        likes: m.metadata?.likes ?? 0,
        url: m.metadata?.sourceUrl ?? null,
        sourceIndex,
    }));
}
