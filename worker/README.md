# Bring your own backend

The viewer is static. To share datasets (and let people you trust save new ones),
deploy this Cloudflare Worker on your own account and open the viewer with:

    https://openresearchinstitute.org/nooscope/?backend=<your worker URL>
    https://openresearchinstitute.org/nooscope/?backend=<your worker URL>&dataset=<name>

| Request | Who | Does |
|---|---|---|
| `GET /datasets` | anyone | list saved datasets (name, title, point count, saved time) |
| `GET /datasets/:name` | anyone | the visualization file, as saved |
| `PUT /datasets/:name` | write-key holders | save or overwrite a visualization file |

Reads are open to anyone with the URL. Writes need `Authorization: Bearer <write key>`.
Share the key privately, never in a link. With no key set, the backend is read-only.

## Deploy (free plan)

```
cd worker
npx wrangler login
npx wrangler kv namespace create DATASETS    # paste the printed id into wrangler.toml
npx wrangler deploy
npx wrangler secret put WRITE_KEY            # type a long random key, e.g. from `openssl rand -hex 24`
```

## Save a dataset

In the viewer (`?backend=...`): load a file, open "Save to this backend", enter a name
and the write key. The address bar then holds the share link.

Or from the terminal, with a pipeline output file:

```
curl -X PUT -H "Authorization: Bearer $WRITE_KEY" \
  -H "X-Nooscope-Title: My dataset" -H "X-Nooscope-Points: 1234" \
  --data-binary @data/my-run/output.json \
  https://<your worker>/datasets/my-dataset
```

Limits: names are 1–64 chars of `a-z 0-9 - _`; files up to 25 MB (one KV value);
the free plan allows 1,000 saves a day.
