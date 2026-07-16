# OpenWA on Cloud Run + Baileys — Deployment Runbook

This is a stateful, single-instance app (one live WhatsApp connection held in
memory, auth state on disk). Cloud Run can run it, but only if you pin it to a
single always-on instance with a persistent volume. This runbook covers the
Cloud-Run-specific settings that make that work.

> **Why the extra work:** Cloud Run instances have an ephemeral, in-memory
> filesystem and (by default) scale to zero and throttle CPU between requests.
> A WhatsApp session needs its auth files to survive restarts and needs the
> process kept alive. We fix both below.

---

## 1. The three non-negotiables

| Requirement | Setting | Why |
|---|---|---|
| Keep the process alive | **CPU always allocated** (`--no-cpu-throttling`) | Baileys holds a persistent WebSocket; a throttled instance drops it between requests. |
| Exactly one instance | **`--min-instances=1 --max-instances=1`** | OpenWA is single-instance; two replicas on one auth store cause a forced logout/ban (project docs, findings H1/H11). min=1 also avoids cold-start logouts. |
| Persist auth state | **Volume mounted at `/app/data`** | `BAILEYS_AUTH_DIR=/app/data/baileys` must survive restarts, or you re-scan the QR every deploy. |

---

## 2. Persistent volume — use Filestore (NFS), not GCS FUSE

Baileys stores auth via `useMultiFileAuthState`: many small JSON files
(`creds.json`, pre-keys, sender-keys, app-state-sync keys) written frequently
on every key rotation. That write pattern (atomic renames, frequent small
writes) is exactly what **GCS FUSE handles poorly** — expect corruption or
random logouts if you back the volume with a bucket.

**Recommended:** a small **Filestore** instance mounted as a Cloud Run NFS volume.

```bash
# One-time: create a small Filestore instance (BASIC_HDD, min 1TiB on basic tier;
# use the "zonal" / smaller tiers if available in asia-south1 to cut cost).
gcloud filestore instances create openwa-fs \
  --zone=asia-south1-a \
  --tier=BASIC_HDD \
  --file-share=name=openwa,capacity=1TiB \
  --network=name=default
# Note the instance IP for the mount step.
```

> If Filestore's minimum cost is too high for your scale, the alternative is to
> accept ephemeral auth and re-link on each cold start — not acceptable for an
> always-on gateway. There is no reliable "tiny persistent disk" primitive on
> Cloud Run; that friction is the price of running this app here.

---

## 3. Cloud SQL

No change needed. The `/cloudsql/dulcet-port-498219-s8:asia-south1:openwa`
socket is provided automatically **when you attach the instance** to the
service (`--add-cloudsql-instances`). SSL over that socket is unnecessary
(`DATABASE_SSL=false`).

---

## 4. Database migration cutover (do this carefully — data risk)

You currently run `DATABASE_SYNCHRONIZE=true`, so TypeORM built your schema by
auto-sync. The corrected config sets both synchronize flags to `false`, and the
app then **runs migrations automatically at boot** (`migrationsRun: !synchronize`).

The risk: if the migrations table is empty but the tables already exist,
migrations may fail ("relation already exists") or, worse, try to reshape data.

**Safe cutover:**

1. Take a Cloud SQL backup / export first.
2. Clone the DB (or point a staging service at a copy).
3. Deploy the new revision (synchronize=false) against the **copy** and confirm
   it boots, runs migrations cleanly, and the app works.
4. If migrations conflict with the existing schema, baseline them (mark the
   already-applied migrations as run in the `migrations` table) before cutover.
5. Only then cut production over.

If you're not ready to validate this, keep `synchronize=true` for now and treat
the migration switch as a separate, planned change — but do **not** leave it on
long-term.

---

## 5. Deploy command

Build/push your image (Artifact Registry), then:

```bash
gcloud run deploy openwa \
  --image=asia-south1-docker.pkg.dev/dulcet-port-498219-s8/openwa/openwa:latest \
  --region=asia-south1 \
  --platform=managed \
  --no-cpu-throttling \
  --min-instances=1 \
  --max-instances=1 \
  --concurrency=80 \
  --memory=1Gi \
  --cpu=1 \
  --timeout=3600 \
  --port=2785 \
  --add-cloudsql-instances=dulcet-port-498219-s8:asia-south1:openwa \
  --add-volume=name=openwa-data,type=nfs,location=<FILESTORE_IP>:/openwa \
  --add-volume-mount=volume=openwa-data,mount-path=/app/data \
  --set-env-vars="^@^NODE_ENV=production@LOG_LEVEL=info@AUTO_START_SESSIONS=true@ENGINE_TYPE=baileys@BAILEYS_AUTH_DIR=/app/data/baileys@CORS_ORIGINS=https://YOUR-DASHBOARD-DOMAIN@ENABLE_SWAGGER=false@DATABASE_TYPE=postgres@DATABASE_HOST=/cloudsql/dulcet-port-498219-s8:asia-south1:openwa@DATABASE_PORT=5432@DATABASE_NAME=postgres@DATABASE_USERNAME=postgres@DATABASE_SSL=false@DATABASE_POOL_SIZE=10@DATABASE_SYNCHRONIZE=false@MAIN_DATABASE_SYNCHRONIZE=false@STORAGE_TYPE=local@STORAGE_LOCAL_PATH=/app/data/media@PLUGINS_ENABLED=true@PLUGINS_DIR=/app/data/plugins@REDIS_ENABLED=false@QUEUE_ENABLED=false@CACHE_ENABLED=false" \
  --set-secrets="API_MASTER_KEY=openwa-api-master-key:latest,DATABASE_PASSWORD=openwa-db-password:latest"
```

Notes:
- `^@^` sets `@` as the delimiter so the `/cloudsql/...` value (which contains
  colons) is passed intact.
- Put **`API_MASTER_KEY` and `DATABASE_PASSWORD` in Secret Manager**, not in
  `--set-env-vars`. Create them once:
  ```bash
  printf 'owa_k1_db8f425aa90d44a06bf46a1378a7d3c509f690628a04f3c28fd1f683b99eb172' \
    | gcloud secrets create openwa-api-master-key --data-file=-
  printf 'YOUR_DB_PASSWORD' \
    | gcloud secrets create openwa-db-password --data-file=-
  ```
  (Rotate the API key value — the one above is a generated placeholder.)
- `--memory=1Gi` is generous for Baileys (no Chromium). You can likely drop to
  512Mi after observing real usage.

---

## 6. Deploy-time caveat (read this)

With `max-instances=1`, Cloud Run still briefly runs the **old and new revision
at the same time** during a rollout. For a moment both point at the same Baileys
auth files on the volume. WhatsApp allows one socket per linked-device session,
so the overlap can trigger a logout and force a one-time re-link.

Mitigations:
- Deploy during low-traffic windows.
- Expect an occasional QR re-scan right after a deploy; watch the logs for a
  `session.status` change and re-link if needed.
- This is inherent to running a single stateful WhatsApp session on Cloud Run;
  it's the main reason the project's own docs prefer a single pinned host.

---

## 7. First cutover to Baileys

Switching engines invalidates the old whatsapp-web.js session, so you re-link
once:

1. Deploy with the settings above.
2. Open the dashboard → **New Session** → scan the QR (Baileys shows it fast, no
   Chromium to boot).
3. Confirm the session goes **Connected** and the phone number populates.
4. Because auth now lives on the persistent volume, it survives restarts and
   `AUTO_START_SESSIONS=true` brings it back on boot.
5. Verify chats populate after activity (Baileys builds its chat list from the
   post-link history sync + new messages — an empty list right after linking is
   normal).

---

## 8. Post-deploy checklist

- [ ] Filestore volume mounted at `/app/data`; `BAILEYS_AUTH_DIR=/app/data/baileys`.
- [ ] `--no-cpu-throttling`, `--min-instances=1`, `--max-instances=1` all set.
- [ ] `API_MASTER_KEY` + `DATABASE_PASSWORD` served from Secret Manager.
- [ ] `DATABASE_SYNCHRONIZE=false` validated against a DB copy first.
- [ ] `ENABLE_SWAGGER=false`, `CORS_ORIGINS` set to the real domain.
- [ ] Session re-linked and shows Connected.
- [ ] Restart the service once and confirm the session auto-restores (proves the
      volume + auth persistence actually work).
