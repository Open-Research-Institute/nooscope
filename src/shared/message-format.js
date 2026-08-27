// Source of truth for the schema in docs/spec.md. Collectors (twitter, bluesky, ...) build
// their output through these so every collector stays shaped the same way.

export const SCHEMA_VERSION = '0.1';

export function createContext({ collector, source }) {
    if (!collector) throw new Error('createContext: collector is required');
    return { version: SCHEMA_VERSION, collector, source };
}

export function createMessage({ id, author, text, timestamp, parent, children, metadata }) {
    if (!id) throw new Error('createMessage: id is required');
    const message = { id, author, text, timestamp };
    if (parent !== undefined) message.parent = parent;
    if (children !== undefined) message.children = children;
    if (metadata !== undefined) message.metadata = metadata;
    return message;
}
