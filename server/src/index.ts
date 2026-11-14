/**
 * Budget sync relay.
 *
 * A deliberately small Express service: bearer-key identity, an append-only
 * change log per user, and a snapshot endpoint for new devices. Encrypted
 * payloads are stored as opaque strings.
 */

import { createHash } from "node:crypto";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import {
  ENTITY_TYPES,
  db,
  pullChanges,
  purgeOldChanges,
  pushChanges,
  resolveUser,
  snapshot,
  type ChangeInput,
  type EntityType,
  type UserRow,
} from "./db.js";

const PORT = Number(process.env.PORT ?? 8787);
const RETENTION_DAYS = Number(process.env.SYNC_RETENTION_DAYS ?? 90);
const BATCH_LIMIT = 200;
const MAX_PAYLOAD = 300_000;
const HLC_PATTERN = /^\d{15}-\d{6}-[A-Za-z0-9-]{6,64}$/;

/** Must match src/sync/protocol.ts. */
const SYNC_PROTOCOL_VERSION = 2;
const SYNC_SCHEMA_VERSION = 6;
const PROTOCOL_HEADER = "X-Budget-Sync-Protocol";
const SCHEMA_HEADER = "X-Budget-Sync-Schema";
const LEGACY_ENTITY_TYPES = new Set(["task", "project", "place"]);

const allowedOrigins = (process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

interface AuthedRequest extends Request {
  user: UserRow;
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));

app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader(
      "Access-Control-Allow-Headers",
      `Authorization, Content-Type, ${PROTOCOL_HEADER}, ${SCHEMA_HEADER}`,
    );
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Max-Age", "86400");
  }

  if (req.method === "OPTIONS") {
    res.sendStatus(origin && allowedOrigins.includes(origin) ? 204 : 403);
    return;
  }

  if (origin && !allowedOrigins.includes(origin)) {
    res.status(403).json({ error: "origin_not_allowed" });
    return;
  }

  next();
});

/** Tiny in-memory limiter, keyed by the bearer key hash. */
const buckets = new Map<string, { count: number; resetAt: number }>();

function rateLimited(keyHash: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(keyHash);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(keyHash, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > 240;
}

function authenticate(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? "";
  const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

  if (key.length < 32 || key.length > 200) {
    res.status(401).json({ error: "missing_key" });
    return;
  }

  const keyHash = createHash("sha256").update(key).digest("hex");
  if (rateLimited(keyHash)) {
    res.status(429).json({ error: "slow_down" });
    return;
  }

  (req as AuthedRequest).user = resolveUser(keyHash);
  next();
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "budget-sync",
    protocol: SYNC_PROTOCOL_VERSION,
    schema: SYNC_SCHEMA_VERSION,
  });
});

/**
 * Protocol gate. Old Tasker clients send no headers and are told to upgrade;
 * Budget clients always announce both the wire protocol and data schema.
 */
app.use("/v1/sync", (req: Request, res: Response, next: NextFunction) => {
  const protocol = req.get(PROTOCOL_HEADER) ?? "";
  const schema = req.get(SCHEMA_HEADER) ?? "";

  if (
    protocol !== String(SYNC_PROTOCOL_VERSION) ||
    schema !== String(SYNC_SCHEMA_VERSION)
  ) {
    res.status(426).json({
      error: "incompatible_protocol",
      message:
        `This relay requires Budget sync protocol ${SYNC_PROTOCOL_VERSION} ` +
        `(schema ${SYNC_SCHEMA_VERSION}). Update the app or point it at a Budget relay.`,
      protocol: SYNC_PROTOCOL_VERSION,
      schema: SYNC_SCHEMA_VERSION,
    });
    return;
  }

  next();
});

app.get("/v1/sync/head", authenticate, (req, res) => {
  const user = (req as AuthedRequest).user;
  res.json({ exists: user.head_seq > 0, head: user.head_seq });
});

app.post("/v1/sync/push", authenticate, (req, res) => {
  const user = (req as AuthedRequest).user;
  const body = req.body as { clientId?: unknown; changes?: unknown };

  if (typeof body.clientId !== "string" || body.clientId.length > 80) {
    res.status(400).json({ error: "invalid_client" });
    return;
  }
  if (!Array.isArray(body.changes) || body.changes.length === 0) {
    res.status(400).json({ error: "no_changes" });
    return;
  }
  if (body.changes.length > BATCH_LIMIT) {
    res.status(413).json({ error: "batch_too_large" });
    return;
  }

  const acks = req.headers['x-budget-sync-acks'] === '1';

  const changes: ChangeInput[] = [];
  const mergedVerdicts: Array<{
    changeId: string;
    applied?: boolean;
    error?: string;
  }> = [];
  const appliedIndexes: number[] = [];

  for (const raw of body.changes) {
    const item = raw as Record<string, unknown>;
    const entityType = item.entityType;
    const changeId = typeof item.changeId === "string" ? item.changeId : "";

    if (typeof entityType === "string" && LEGACY_ENTITY_TYPES.has(entityType)) {
      if (acks) {
        mergedVerdicts.push({ changeId, error: "legacy_entity_type" });
        continue;
      }
      res.status(400).json({
        error: "legacy_entity_type",
        message:
          "This change uses a Tasker entity type. Budget sync only accepts accounts, " +
          "categories, groups, payees, transactions, budgets, recurring rules and settings.",
      });
      return;
    }

    if (
      typeof item.changeId !== "string" ||
      item.changeId.length < 8 ||
      item.changeId.length > 80 ||
      typeof item.entityId !== "string" ||
      item.entityId.length === 0 ||
      item.entityId.length > 120 ||
      typeof item.hlc !== "string" ||
      !HLC_PATTERN.test(item.hlc) ||
      typeof item.deleted !== "boolean" ||
      typeof entityType !== "string" ||
      !ENTITY_TYPES.includes(entityType as EntityType) ||
      typeof item.payload !== "string" ||
      item.payload.length > MAX_PAYLOAD ||
      (item.deleted && item.payload !== "")
    ) {
      if (acks) {
        mergedVerdicts.push({ changeId, error: "invalid_change" });
        continue;
      }
      res.status(400).json({ error: "invalid_change" });
      return;
    }

    appliedIndexes.push(mergedVerdicts.length);
    mergedVerdicts.push({ changeId: item.changeId, applied: false });
    changes.push({
      changeId: item.changeId,
      clientId: body.clientId,
      entityType,
      entityId: item.entityId,
      hlc: item.hlc,
      deleted: item.deleted,
      payload: item.payload,
    });
  }

  const result = pushChanges(user.key_hash, changes);
  const fresh = db
    .prepare("SELECT * FROM users WHERE key_hash = ?")
    .get(user.key_hash) as UserRow;

  for (let i = 0; i < appliedIndexes.length; i += 1) {
    mergedVerdicts[appliedIndexes[i]].applied = result.verdicts[i].applied;
  }

  const resBody: Record<string, unknown> = {
    accepted: result.accepted,
    duplicates: changes.length - result.accepted.length,
    cursor: fresh.head_seq,
  };
  if (acks) resBody.changes = mergedVerdicts;
  res.json(resBody);
});

app.get("/v1/sync/changes", authenticate, (req, res) => {
  const user = (req as AuthedRequest).user;
  const since = Number(req.query.since ?? 0);
  const limit = Math.min(
    Math.max(Number(req.query.limit ?? 200), 1),
    BATCH_LIMIT,
  );

  if (!Number.isFinite(since) || since < 0 || !Number.isFinite(limit)) {
    res.status(400).json({ error: "invalid_cursor" });
    return;
  }

  if (since < user.min_seq) {
    res.status(410).json({ error: "resync_required", head: user.head_seq });
    return;
  }

  const page = pullChanges(user.key_hash, Math.floor(since), limit);
  res.json({
    changes: page.changes.map((change) => ({
      seq: change.seq,
      changeId: change.change_id,
      clientId: change.client_id,
      entityType: change.entity_type,
      entityId: change.entity_id,
      hlc: change.hlc,
      deleted: change.deleted === 1,
      payload: change.payload,
    })),
    cursor: page.cursor,
    hasMore: page.hasMore,
  });
});

app.get("/v1/sync/snapshot", authenticate, (req, res) => {
  const user = (req as AuthedRequest).user;
  const limit = Math.min(
    Math.max(Number(req.query.limit ?? 200), 1),
    BATCH_LIMIT,
  );
  const afterType =
    typeof req.query.afterType === "string" ? req.query.afterType : "";
  const afterId =
    typeof req.query.afterId === "string" ? req.query.afterId : "";
  const after = afterType && afterId ? { type: afterType, id: afterId } : null;

  if (!Number.isFinite(limit)) {
    res.status(400).json({ error: "invalid_limit" });
    return;
  }

  const page = snapshot(user.key_hash, user.head_seq, after, limit);
  res.json({
    entities: page.entities.map((entity) => ({
      entityType: entity.entity_type,
      entityId: entity.entity_id,
      hlc: entity.hlc,
      deleted: entity.deleted === 1,
      payload: entity.payload,
    })),
    next: page.next,
    head: user.head_seq,
  });
});

app.use((_req, res) => {
  res.status(404).json({ error: "not_found" });
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(error);
  res.status(500).json({ error: "internal" });
});

purgeOldChanges(RETENTION_DAYS);
const purgeTimer = setInterval(
  () => purgeOldChanges(RETENTION_DAYS),
  6 * 60 * 60 * 1000,
);
purgeTimer.unref();

app.listen(PORT, () => {
  console.log(`budget sync relay listening on ${PORT}`);
});
