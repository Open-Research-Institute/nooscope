# Specification

The standard message format we use is:

```
[message, author, timestamp, (optional)parent, (optional)children[] ]
```

"Source" should be added but it would be repeated across all messages from a given source, maybe each message just has a "source index" and the source has the full details.

